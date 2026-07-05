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
 * Parses the (verbose) output of `pactl list sink-inputs` into a flat list
 * of {id, name}. Pure function - no side effects - so it can be unit tested
 * without a real PulseAudio server.
 */
export function parseSinkInputs(raw: string): AudioApp[] {
    if (!raw || !raw.trim()) return [];

    const blocks = raw.split(/\r?\n(?=Sink Input #)/g).filter(b => b.trim().startsWith("Sink Input #"));
    const apps: AudioApp[] = [];

    for (const block of blocks) {
        const idMatch = block.match(/Sink Input #(\d+)/);
        if (!idMatch) continue;

        // pactl escapes embedded quotes/backslashes in property values as \" / \\,
        // so a plain [^"]* class would stop at the first escaped quote and
        // truncate names like `He said \"Hi\"`. Match escaped-or-non-quote runs,
        // then unescape.
        const nameMatch =
            block.match(/application\.name\s*=\s*"((?:[^"\\]|\\.)*)"/) ??
            block.match(/media\.name\s*=\s*"((?:[^"\\]|\\.)*)"/);

        const name = nameMatch?.[1]?.replace(/\\(.)/g, "$1").trim();

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
 * Parses `pactl list sinks` (verbose) output and returns the module id that
 * owns the sink with the given name, or null if no such sink exists.
 * Pure function.
 */
export function findOwnerModuleOfSink(raw: string, sinkName: string): string | null {
    if (!raw) return null;

    const blocks = raw.split(/\r?\n(?=Sink #)/g);
    for (const block of blocks) {
        if (!new RegExp(`Name:\\s*${escapeRegExp(sinkName)}\\s*$`, "m").test(block)) continue;

        const ownerMatch = block.match(/Owner Module:\s*(\d+)/);
        return ownerMatch ? ownerMatch[1] : null;
    }

    return null;
}

/**
 * Parses `pactl list modules` (verbose) output and returns the ids of every
 * module whose "Argument:" line contains the given needle as a whole token.
 * Pure function.
 */
export function findModuleIdsByArgument(raw: string, needle: string): string[] {
    if (!raw) return [];

    const blocks = raw.split(/\r?\n(?=Module #)/g);
    const ids: string[] = [];
    // Match needle as a whole token (bounded by start/whitespace and end/whitespace)
    // so e.g. "source=Foo.monitor" doesn't false-positive on "source=FooBar.monitor".
    const needleRegex = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`);

    for (const block of blocks) {
        // [^\S\r\n]* (not \s*) so we only skip horizontal whitespace after the
        // colon - \s* would also swallow the line break when Argument is empty
        // (e.g. module-suspend-on-idle prints a bare "Argument: " line), which
        // let (.*) bleed into the next line's text and could false-positive
        // against the needle.
        const argMatch = block.match(/Argument:[^\S\r\n]*(.*)/);
        if (!argMatch) continue;
        if (!needleRegex.test(argMatch[1])) continue;

        const idMatch = block.match(/Module #(\d+)/);
        if (idMatch) ids.push(idMatch[1]);
    }

    return ids;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

    const sinksRaw = await pactl(["list", "sinks"]).catch(() => "");
    const excludedSinkModuleId = findOwnerModuleOfSink(sinksRaw, EXCLUDED_SINK_NAME);
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
