/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Linux backend. Uses `pactl` (PulseAudio / PipeWire-Pulse, both share the same
 * CLI) to move the app you DON'T want heard (e.g. a game) out of the default
 * audio pipeline and into a dedicated sink, while looping it back to your real
 * speakers so you still hear it locally. Everything else - including the app
 * you DO want Discord to hear - stays on the system default output.
 *
 * This never touches the microphone/input device. Discord's own "Share Audio"
 * / "Stream With Audio" toggle (shown when you start a screen share) captures
 * whatever plays through the system default output - once the noisy app is
 * excluded, that's just the app you want. Your voice keeps going out on its
 * own separate channel, completely unaffected, so it can never get drowned
 * out by the routed audio.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export interface AudioApp {
    /** pactl sink-input index, e.g. "42" */
    id: string;
    /** Human readable app/media name, e.g. "Firefox" or "Counter-Strike" */
    name: string;
}

export const EXCLUDED_SINK_NAME = "VencordExcludedAudio";

/**
 * Splits `raw` into blocks at every line that starts with `headerPrefix`
 * (e.g. "Sink Input #", "Sink #", "Module #"), the same way pactl's verbose
 * listings separate entries. Unlike a naive `split(/\n(?=prefix)/)`, this is
 * quote-aware: a candidate header line that falls *inside* an still-open
 * double-quoted property value is NOT treated as a real boundary.
 *
 * This matters because property values (application.name, media.name, a
 * Bluetooth device's advertised description, etc.) can be fully attacker/
 * app-controlled and pactl does not escape embedded literal newlines inside
 * them - only embedded quotes/backslashes are escaped. Without this guard, a
 * media.name like `Evil\nSink Input #999\n...` would inject a second,
 * entirely fabricated block into the listing, complete with an attacker-
 * chosen id - which the UI would then show and let the user "exclude", and
 * which could collide with a real entry's id.
 */
function splitBlocksQuoteAware(raw: string, headerPrefix: string): string[] {
    const lineHeaderRe = new RegExp(`^${escapeRegExp(headerPrefix)}`, "gm");
    const candidates: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = lineHeaderRe.exec(raw))) candidates.push(m.index);

    const insideQuoteAt = new Array<boolean>(candidates.length).fill(false);
    let inQuote = false;
    let candIdx = 0;
    for (let i = 0; i < raw.length; i++) {
        while (candIdx < candidates.length && candidates[candIdx] === i) {
            insideQuoteAt[candIdx] = inQuote;
            candIdx++;
        }
        const c = raw[i];
        if (c === "\\" && inQuote) { i++; continue; }
        if (c === "\"") inQuote = !inQuote;
    }

    const boundaries = candidates.filter((_, k) => !insideQuoteAt[k]);
    if (boundaries.length === 0 || boundaries[0] !== 0) boundaries.unshift(0);

    const blocks: string[] = [];
    for (let k = 0; k < boundaries.length; k++) {
        const start = boundaries[k];
        const end = k + 1 < boundaries.length ? boundaries[k + 1] : raw.length;
        if (start === end) continue;
        blocks.push(raw.slice(start, end));
    }
    return blocks;
}

/**
 * Parses the (verbose) output of `pactl list sink-inputs` into a flat list
 * of {id, name}. Pure function - no side effects - so it can be unit tested
 * without a real PulseAudio server.
 */
export function parseSinkInputs(raw: string): AudioApp[] {
    if (!raw || !raw.trim()) return [];

    const blocks = splitBlocksQuoteAware(raw, "Sink Input #").filter(b => b.trim().startsWith("Sink Input #"));
    const apps: AudioApp[] = [];

    for (const block of blocks) {
        const idMatch = block.match(/Sink Input #(\d+)/);
        if (!idMatch) continue;

        // pactl escapes embedded quotes/backslashes in property values as \" / \\,
        // so a plain [^"]* class would stop at the first escaped quote and
        // truncate names like `He said \"Hi\"`. Match escaped-or-non-quote runs,
        // then unescape. The character class explicitly excludes \r/\n: pactl
        // does NOT escape embedded literal newlines in property values (only
        // " and \ are escaped), so a name containing a real newline must not
        // let [^"\\] silently span past it into whatever comes after -
        // including a fabricated "Sink Input #<n>" block injected via that
        // same newline.
        //
        // Only the FIRST application.name/media.name line in the block may
        // ever be considered - matchNameOnFirstOccurrence below fails
        // outright (rather than letting a plain, non-anchored .match() skip
        // ahead) if that first occurrence doesn't cleanly close its quote on
        // the same line. Otherwise a malformed/hostile first value could
        // cause the overall match to silently fall through to a LATER
        // occurrence of the same property key elsewhere in the block (e.g.
        // inside injected fake content that got merged into this block
        // because its own quote never validly closed), attributing that
        // later value's text to this entry instead.
        const nameMatch = matchNameOnFirstOccurrence(block, "application.name") ??
            matchNameOnFirstOccurrence(block, "media.name");

        // Strip control characters (including any embedded literal newline)
        // before display. A legitimate application/media name is a single
        // line of text; pactl does not escape control characters inside
        // property values, so without this an app could plant raw \n/\r (or
        // other control bytes) in its self-reported name and have it render
        // as if it were multiple lines / structured pactl output in the UI.
        const name = nameMatch?.[1]
            ?.replace(/\\(.)/g, "$1")
            .replace(/[\x00-\x1f\x7f]+/g, " ")
            .trim();

        apps.push({
            id: idMatch[1],
            name: name && name.length > 0 ? name : `Unknown app (#${idMatch[1]})`
        });
    }

    return apps;
}

/**
 * Parses `pactl list short sinks` (tab-separated: index, name, module, format, state)
 * and returns whether a sink with exactly the given name exists.
 * Pure function.
 */
export function shortSinksContainsName(raw: string, sinkName: string): boolean {
    if (!raw) return false;
    return raw.split(/\r?\n/).some(line => line.split("\t")[1] === sinkName);
}

/**
 * Parses `pactl list short sinks` (tab-separated: index, name, module, format,
 * state) and returns the owner module id for the sink with exactly the given
 * name, or null if no such sink exists. Pure function.
 *
 * This is the injection-safe alternative to parsing verbose `pactl list
 * sinks` output for the same lookup (see findOwnerModuleOfSink's doc comment
 * for why that's NOT safe): the short-list format's name and module-id
 * columns come from pactl's own restricted, non-free-text sink-name/id
 * generation (safe identifier characters only, no attacker/hardware-supplied
 * text - unlike `Description:`, which mirrors things like a Bluetooth
 * device's self-advertised name and is printed completely unescaped). There
 * is no field here an attacker can stuff a fake extra row into.
 */
export function findOwnerModuleIdOfShortSink(raw: string, sinkName: string): string | null {
    if (!raw) return null;
    for (const line of raw.split(/\r?\n/)) {
        const cols = line.split("\t");
        if (cols[1] === sinkName) return cols[2] ?? null;
    }
    return null;
}

/**
 * Parses `pactl list sinks` (verbose) output and returns the module id that
 * owns the sink with the given name, or null if no such sink exists.
 * Pure function.
 */
export function findOwnerModuleOfSink(raw: string, sinkName: string): string | null {
    if (!raw) return null;

    // `Description:`, `device.description`, and similar free-text fields
    // pactl prints unquoted (unlike application.name/media.name, they get no
    // escaping at all - not even of embedded literal newlines) can come from
    // attacker-influenced sources, e.g. an advertised Bluetooth device name.
    // Such a value could smuggle in a fabricated "Sink #<n>\nName:
    // <sinkName>\nOwner Module: <attacker-chosen id>" block that never
    // really existed.
    //
    // Requiring "Sink #" to be preceded by a blank line (real pactl always
    // separates genuine top-level entries that way) is a useful heuristic
    // but NOT sufficient on its own: the attacker fully controls the
    // injected text, including any blank line(s) they choose to put before
    // their fake header, so "\n\nSink #999\n..." embedded in a description
    // bypasses that check just as easily.
    //
    // The invariant that actually can't be spoofed away: the server enforces
    // unique sink names, so a legitimate listing can never contain two real
    // "Sink #" blocks both claiming the same Name. If more than one block -
    // real or fabricated - claims the target name, the input is inherently
    // inconsistent, and blindly trusting whichever one matches first (which
    // the attacker can arrange to be their fake block) is exactly the
    // confusion they're going for. Refuse and return null in that case, so
    // restoreAudio() simply skips unloading anything rather than unloading
    // an attacker-chosen module id.
    const blocks = raw.split(/\r?\n(?=Sink #)/g);
    const matches: string[] = [];
    for (const block of blocks) {
        // Anchored to the start of the line (modulo leading indentation) so a
        // *different* field - e.g. `Description:` - can never false-match just
        // because its value happens to end in "Name: <sinkName>". Only the
        // sink's own top-level "Name:" property line should count.
        if (!new RegExp(`^[^\\S\\r\\n]*Name:\\s*${escapeRegExp(sinkName)}\\s*$`, "m").test(block)) continue;

        const ownerMatch = block.match(/Owner Module:\s*(\d+)/);
        if (ownerMatch) matches.push(ownerMatch[1]);
    }

    if (matches.length > 1) return null;
    return matches[0] ?? null;
}

/**
 * Parses `pactl list modules` (verbose) output and returns the ids of every
 * module whose "Argument:" line contains the given needle as a whole token.
 * Pure function.
 *
 * Like sink-inputs, a module's `Properties:` block can contain free-text
 * values that come from attacker/hardware-influenced sources - e.g.
 * `module.description`, which for things like a Bluetooth-backed module can
 * mirror a device's self-advertised name - and pactl escapes those the same
 * way it escapes application.name/media.name: embedded quotes/backslashes
 * are escaped, but an embedded LITERAL newline is not. Without a quote-aware
 * split, a crafted property value containing "\nModule #999\n\tArgument:
 * source=<needle>...\n" would inject a fabricated extra "Module #" block
 * with an attacker-chosen id into the listing - which could collide with a
 * real, wholly unrelated module's id elsewhere in the same listing, causing
 * callers (ensureLocalLoopback's stale-cleanup, restoreAudio) to
 * unload-module the wrong, legitimate module. Use the same
 * splitBlocksQuoteAware helper used for sink-inputs so a header-looking line
 * inside a still-open quoted property value is never treated as a real
 * block boundary.
 */
export function findModuleIdsByArgument(raw: string, needle: string): string[] {
    if (!raw) return [];

    const blocks = splitBlocksQuoteAware(raw, "Module #").filter(b => b.trim().startsWith("Module #"));
    const ids: string[] = [];
    // Match needle as a whole token (bounded by start/whitespace and end/whitespace)
    // so e.g. "source=Foo.monitor" doesn't false-positive on "source=FooBar.monitor".
    const needleRegex = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`);

    for (const block of blocks) {
        // Blank out quoted-string contents first: splitBlocksQuoteAware only
        // guarantees a fake header-looking line trapped inside a still-open
        // quote wasn't treated as a NEW block boundary - the trapped text is
        // still physically present in this block's string. Without this,
        // e.g. a module.description value containing an embedded literal
        // newline followed by fake "Argument: source=<needle>..." /
        // "Module #<n>" lines would still be matched by the plain regexes
        // below, even though pactl never actually printed them as real
        // fields.
        const stripped = stripQuotedContent(block);

        // [^\S\r\n]* (not \s*) so we only skip horizontal whitespace after the
        // colon - \s* would also swallow the line break when Argument is empty
        // (e.g. module-suspend-on-idle prints a bare "Argument: " line), which
        // let (.*) bleed into the next line's text and could false-positive
        // against the needle.
        const argMatch = stripped.match(/Argument:[^\S\r\n]*(.*)/);
        if (!argMatch) continue;
        if (!needleRegex.test(argMatch[1])) continue;

        // Anchored to the block's own header line (modulo leading
        // indentation isn't expected here, but staying consistent with the
        // sink/module header shape) so an unanchored search can never pick
        // up a "Module #<n>" substring that an attacker embedded further
        // down inside this same block's own free-text properties instead of
        // the block's real leading header.
        const idMatch = stripped.match(/^Module #(\d+)/m);
        if (idMatch) ids.push(idMatch[1]);
    }

    return ids;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces the contents of every double-quoted string in `block` with `#`
 * (same length, so line/column positions and the overall block length are
 * preserved) while leaving everything outside quotes untouched. Quote-aware
 * in the same sense as splitBlocksQuoteAware: an escaped quote/backslash
 * (`\"`, `\\`) does not toggle the in-quote state.
 *
 * Used before running "top-level field" regexes (Argument:, Module #, etc.)
 * over a block that has already survived splitBlocksQuoteAware's boundary
 * check. That check guarantees any header-looking text trapped inside a
 * still-open quote wasn't treated as a new block boundary - but the block
 * itself can still legitimately CONTAIN that trapped text (e.g. inside a
 * module.description value), and a plain (non-anchored, or line-anchored
 * with the `m` flag) regex would still happily match a fake "Argument:" or
 * "Module #<n>" line sitting inside that quoted value. Blanking out quoted
 * content first means only text pactl actually printed as real top-level
 * fields can ever match.
 */
function stripQuotedContent(block: string): string {
    let out = "";
    let inQuote = false;
    for (let i = 0; i < block.length; i++) {
        const c = block[i];
        if (c === "\\" && inQuote) {
            out += "##";
            i++;
            continue;
        }
        if (c === "\"") {
            inQuote = !inQuote;
            out += c;
            continue;
        }
        if (inQuote && c !== "\n" && c !== "\r") {
            out += "#";
        } else {
            out += c;
        }
    }
    return out;
}

/**
 * Finds the FIRST line in `block` that looks like `key = "..."` and returns
 * a match array whose group 1 is the raw (still-escaped) quoted value - but
 * only if that first occurrence's quote actually closes on the same line.
 * If the first occurrence's quote never closes before the line ends, this
 * returns null outright instead of letting a plain non-anchored regex search
 * skip ahead and match a later, unrelated occurrence of the same key further
 * down in the block (which could be attacker-injected content that only
 * "exists" in this block because the first occurrence's own quote never
 * validly closed).
 */
function matchNameOnFirstOccurrence(block: string, key: string): RegExpMatchArray | null {
    const keyRe = new RegExp(`^[^\\S\\r\\n]*${escapeRegExp(key)}\\s*=\\s*"`, "m");
    const keyMatch = keyRe.exec(block);
    if (!keyMatch) return null;

    const rest = block.slice(keyMatch.index + keyMatch[0].length);
    const valueMatch = rest.match(/^((?:[^"\\\r\n]|\\.)*)"/);
    return valueMatch;
}

/** Restricts ids coming from the renderer to digits only before they ever touch execFile args. */
function assertNumericId(id: string, label: string): void {
    if (!/^\d+$/.test(id)) throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
}

async function pactl(args: string[]): Promise<string> {
    try {
        const { stdout } = await exec("pactl", args);
        return stdout;
    } catch (e: any) {
        if (e?.code === "ENOENT") {
            throw new Error(
                "pactl was not found. Install PulseAudio utils (e.g. `sudo apt install pulseaudio-utils`) " +
                "or, if you're on PipeWire, `sudo apt install pipewire-pulse`."
            );
        }
        throw new Error(`pactl ${args.join(" ")} failed: ${e?.stderr?.trim() || e?.message || e}`);
    }
}

export async function listAudioApps(): Promise<AudioApp[]> {
    const raw = await pactl(["list", "sink-inputs"]);
    return parseSinkInputs(raw);
}

async function sinkExists(): Promise<boolean> {
    const raw = await pactl(["list", "short", "sinks"]);
    return shortSinksContainsName(raw, EXCLUDED_SINK_NAME);
}

async function ensureExcludedSink(): Promise<void> {
    if (await sinkExists()) return;

    await pactl([
        "load-module",
        "module-null-sink",
        `sink_name=${EXCLUDED_SINK_NAME}`,
        `sink_properties=device.description=${EXCLUDED_SINK_NAME}`
    ]);
}

async function ensureLocalLoopback(): Promise<void> {
    const defaultSink = (await pactl(["get-default-sink"])).trim();
    if (!defaultSink) throw new Error("Could not determine the default output sink.");

    // If our own dedicated null-sink has somehow become the system default -
    // e.g. the real output device was unplugged while the sink from a
    // previous (crashed or improperly restored) session was still loaded,
    // and PipeWire/PulseAudio fell back to whatever sink remained - wiring a
    // loopback "source=EXCLUDED_SINK_NAME.monitor sink=EXCLUDED_SINK_NAME"
    // would feed the null-sink's monitor back into itself. That's a silent
    // no-op audio path at best and a feedback loop at worst, and it would
    // leave the excluded app completely inaudible locally. Refuse instead of
    // wiring something broken.
    if (defaultSink === EXCLUDED_SINK_NAME) {
        throw new Error(
            `The system default output is currently "${EXCLUDED_SINK_NAME}" (this plugin's own hidden sink), ` +
            "not a real speaker/headphone device. Pick your actual output device as the default " +
            "(e.g. in your system sound settings) and try again."
        );
    }

    const modulesRaw = await pactl(["list", "modules"]);
    const existing = findModuleIdsByArgument(modulesRaw, `source=${EXCLUDED_SINK_NAME}.monitor`);

    if (existing.length > 0) {
        // A loopback already exists, but it may still be pointed at a sink that
        // was the default at the time it was created. If the user has since
        // switched their default output device (e.g. unplugged headphones,
        // picked a different speaker), that stale loopback silently stops
        // reaching whatever is now the default sink - the excluded app would
        // go quiet locally even though everything still "looks" wired up.
        //
        // There can also be more than one loopback module already loaded (e.g.
        // a leftover duplicate from a crash mid-operation, or the user poking
        // at `pactl` by hand). Partition them: keep at most the one(s) already
        // pointed at the CURRENT default sink, and unload every other one so
        // we never leave stale/duplicate loopbacks running (which would double
        // up the audio through two paths at once).
        const currentDefaultIds = new Set(findModuleIdsByArgument(modulesRaw, `sink=${defaultSink}`));
        const stale = existing.filter(id => !currentDefaultIds.has(id));
        for (const id of stale) {
            await pactl(["unload-module", id]).catch(() => { });
        }

        const stillPointingAtCurrentDefault = existing.some(id => currentDefaultIds.has(id));
        if (stillPointingAtCurrentDefault) return;
    }

    await pactl([
        "load-module",
        "module-loopback",
        `source=${EXCLUDED_SINK_NAME}.monitor`,
        `sink=${defaultSink}`,
        "latency_msec=1"
    ]);
}

/**
 * Moves the given app's audio stream OUT of the default output pipeline and
 * into a dedicated sink, looped back to your speakers so you still hear it
 * locally. Anything left on the default output (e.g. your browser) is what
 * Discord's own "Share Audio" screen-share toggle will pick up. Never
 * touches the microphone/input device.
 */
export async function excludeAppAudio(sinkInputId: string): Promise<void> {
    assertNumericId(sinkInputId, "sink input id");

    await ensureExcludedSink();
    await ensureLocalLoopback();

    await pactl(["move-sink-input", sinkInputId, EXCLUDED_SINK_NAME]);
}

/**
 * Undoes everything: tears down the loopback and the exclusion sink. Any
 * stream still assigned to the exclusion sink is automatically reassigned
 * to the system default sink by PulseAudio/PipeWire the moment that sink is
 * unloaded, so excluded apps go right back to normal without extra bookkeeping.
 *
 * Modules are looked up by name/argument instead of relying on in-memory
 * state, so this still works correctly after a Discord restart or plugin
 * reload.
 */
export async function restoreAudio(): Promise<void> {
    const modulesRaw = await pactl(["list", "modules"]).catch(() => "");
    const loopbackIds = findModuleIdsByArgument(modulesRaw, `source=${EXCLUDED_SINK_NAME}.monitor`);
    for (const id of loopbackIds) {
        await pactl(["unload-module", id]).catch(() => { });
    }

    // Uses the short-list format (not the verbose `list sinks` parsed by
    // findOwnerModuleOfSink) specifically because it's injection-safe - see
    // findOwnerModuleIdOfShortSink's doc comment. That matters here: this is
    // the actual live cleanup path, and unlike a defensive "refuse if
    // ambiguous" fallback, looking the id up from a format that can't be
    // spoofed in the first place means a stray/hostile Bluetooth device
    // description (or similar free-text field) sitting in the same `pactl
    // list sinks` output can never prevent restoreAudio() from finding and
    // unloading our own sink's real module.
    const shortSinksRaw = await pactl(["list", "short", "sinks"]).catch(() => "");
    const excludedSinkModuleId = findOwnerModuleIdOfShortSink(shortSinksRaw, EXCLUDED_SINK_NAME);
    if (excludedSinkModuleId) {
        await pactl(["unload-module", excludedSinkModuleId]).catch(() => { });
    }
}

export async function isSupported(): Promise<boolean> {
    try {
        await exec("pactl", ["--version"]);
        return true;
    } catch {
        return false;
    }
}
