/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Windows backend. Windows has no built-in tool or public API that lets a
 * script silently reassign one running app's audio output device - the
 * "App volume and device preferences" panel is backed by an undocumented
 * mechanism Microsoft never published. So this backend automates it the
 * same way Microsoft's own Settings app effectively does under the hood,
 * by driving SoundVolumeCommandLine (svcl.exe) - a small, long-standing,
 * free (though closed-source) utility from NirSoft built specifically for
 * this - downloaded on first use directly from nirsoft.net, the same way
 * Vencord's own installer downloads its CLI tool on demand.
 *
 * Same strategy as the Linux backend: move the app you DON'T want heard
 * (e.g. the game) off the system default output onto a different real
 * output device, leave everything you DO want heard (e.g. the browser) on
 * the default, then use Discord's own "Share Audio" screen-share toggle -
 * it captures the default device. The microphone is never touched.
 *
 * Honest limitation: unlike Linux, Windows has no free built-in virtual
 * audio device, so this only works if you actually have a second real
 * playback device (e.g. speakers + a headset) - moving an app to a device
 * you can't hear would silently mute it for you, which is worse than
 * doing nothing. If only one device is found, excludeAppAudio() throws a
 * clear error instead of guessing.
 */

import { exec as execCb, execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join, sep } from "path";
import { promisify } from "util";

const exec = promisify(execCb);
const execFileAsync = promisify(execFile);

const SVCL_URL = "https://www.nirsoft.net/utils/svcl.zip";

// `electron` is only resolvable inside a running Vencord/Discord process, so
// it's imported lazily here (not at module top-level) - that keeps this
// file's pure parsing functions loadable and unit-testable in plain Node.
async function getSvclPaths(): Promise<{ dir: string; exe: string; }> {
    const { app } = await import("electron");
    const dir = join(app.getPath("userData"), "StreamAudioRouter");
    return { dir, exe: join(dir, "svcl.exe") };
}

export interface AudioApp {
    /** Process executable name, e.g. "chrome.exe" - what svcl.exe's /SetAppDefault expects. */
    id: string;
    name: string;
}

export interface RenderDevice {
    /** svcl.exe's "Command-Line Friendly ID" for this device. */
    id: string;
    /** The raw MMDevice endpoint id (svcl's "Item ID"), needed to point the "Listen" feature at this device. */
    itemId: string;
    name: string;
    /**
     * The parent sound card/driver name (svcl's "Device Name" column, e.g.
     * "High Definition Audio Device" or, for VB-Cable, exactly
     * "VB-Audio Virtual Cable"). Used by isCableDevice() instead of fuzzy-
     * matching "cable" against the user-facing endpoint `name`, since a real
     * device can legitimately have "cable" as a substring of its name (e.g.
     * "Cablevision Audio Device", "USB-C Cable Adapter") without being
     * VB-Audio Virtual Cable at all.
     */
    deviceName: string;
    isDefault: boolean;
}

/**
 * True if a device belongs to the VB-Audio virtual-device family, checked
 * against the specific driver/product name svcl.exe reports (its "Device
 * Name" column) rather than substring-matching "cable" against the
 * endpoint's user-facing name. The endpoint name alone is not a safe signal:
 * real hardware can contain "cable" as a substring (e.g. "Cablevision Audio
 * Device", "USB-C Cable Adapter Audio") without being VB-Cable, and the old
 * `name.includes("cable")` check would misclassify such a device as the
 * virtual cable - blocking a perfectly usable, audible alternate output
 * device in pickAlternateDevice() and reporting a false "only VB-Cable
 * found" state elsewhere.
 *
 * Matches on the "vb-audio " driver-name prefix rather than the single exact
 * string "vb-audio virtual cable", because installVirtualCable() is not the
 * only way one of these devices can end up on a machine: a user may already
 * have a *different* VB-Audio product installed on their own (e.g. the paid
 * "VB-Audio Cable A+B" two-cable pack, or the Voicemeeter/Voicemeeter
 * Banana/Potato mixers, which install their own "VB-Audio Voicemeeter VAIO"-
 * family virtual render devices). Every product in this family reports a
 * "Device Name" starting with "VB-Audio " and behaves identically for this
 * plugin's purposes - a virtual endpoint that is silent unless something is
 * actively routing/listening to it. Matching only the single-cable product's
 * exact name would let e.g. a Voicemeeter virtual input be picked as a
 * "real" alternate device by pickAlternateDevice(), silently muting the
 * excluded app for the user - exactly the failure mode this file exists to
 * avoid, just via a different VB-Audio product than the one this plugin
 * installs. Pure function.
 */
export function isCableDevice(device: Pick<RenderDevice, "deviceName">): boolean {
    return device.deviceName.trim().toLowerCase().startsWith("vb-audio ");
}

/**
 * Parses one line of svcl.exe's CSV export, handling comma-containing
 * quoted fields (e.g. "11.10 dB, 11.10 dB"). Pure function.
 */
export function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const c = line[i];

        if (inQuotes) {
            if (c === "\"" && line[i + 1] === "\"") {
                current += "\"";
                i++;
            } else if (c === "\"") {
                inQuotes = false;
            } else {
                current += c;
            }
        } else if (c === "\"") {
            inQuotes = true;
        } else if (c === ",") {
            fields.push(current);
            current = "";
        } else {
            current += c;
        }
    }
    fields.push(current);

    return fields;
}

export interface SvclRow {
    name: string;
    type: string;
    direction: string;
    deviceName: string;
    isDefault: boolean;
    deviceState: string;
    itemId: string;
    commandLineFriendlyId: string;
    processPath: string;
    registryKey: string;
}

// Column order comes from svcl.exe's fixed CSV header:
// Name,Type,Direction,Device Name,Default,Default Multimedia,Default
// Communications,Device State,Muted,Volume dB,Volume Percent,Min Volume dB,
// Max Volume dB,Volume Step,Channels Count,Channels dB,Channels  Percent,
// Item ID,Command-Line Friendly ID,Process Path,Process ID,Window Title,
// Registry Key,Speakers Config
const COLUMN_INDEX = {
    name: 0,
    type: 1,
    direction: 2,
    deviceName: 3,
    default: 4,
    deviceState: 7,
    itemId: 17,
    commandLineFriendlyId: 18,
    processPath: 19,
    registryKey: 22
};

/**
 * Parses the full CSV export of `svcl.exe /scomma` into structured rows.
 * Pure function - no side effects - so it can be unit tested without
 * svcl.exe or any real audio devices.
 */
export function parseSvclCsv(raw: string): SvclRow[] {
    if (!raw || !raw.trim()) return [];

    // Strip a UTF-8 BOM if the caller didn't already (svcl.exe writes its
    // CSV export as UTF-8 with BOM).
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    return lines.slice(1).map(line => {
        const f = parseCsvLine(line);
        return {
            name: f[COLUMN_INDEX.name] ?? "",
            type: f[COLUMN_INDEX.type] ?? "",
            direction: f[COLUMN_INDEX.direction] ?? "",
            deviceName: f[COLUMN_INDEX.deviceName] ?? "",
            isDefault: (f[COLUMN_INDEX.default] ?? "").trim().length > 0,
            deviceState: f[COLUMN_INDEX.deviceState] ?? "",
            itemId: f[COLUMN_INDEX.itemId] ?? "",
            commandLineFriendlyId: f[COLUMN_INDEX.commandLineFriendlyId] ?? "",
            processPath: f[COLUMN_INDEX.processPath] ?? "",
            registryKey: f[COLUMN_INDEX.registryKey] ?? ""
        };
    });
}

function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Resolves a zip entry name against an extraction directory and throws if
 * the entry tries to escape it via ".." path segments ("zip slip") - e.g. a
 * malicious/corrupted archive with an entry literally named
 * "../../../Windows/System32/evil.dll". SVCL_URL/VB_CABLE_URL are fixed
 * HTTPS URLs, not attacker-controlled input, but defense in depth costs
 * nothing here, especially since extraction now creates nested parent
 * directories on demand (see ensureSvcl()/installVirtualCable()) which would
 * otherwise happily create them anywhere `join()` resolves to. Pure function.
 */
export function safeExtractPath(extractDir: string, entryName: string): string {
    const dest = join(extractDir, entryName);
    const normalizedDir = join(extractDir, ".");
    if (dest !== normalizedDir && !dest.startsWith(normalizedDir + sep)) {
        throw new Error(`Refusing to extract zip entry outside the target directory: ${JSON.stringify(entryName)}`);
    }
    return dest;
}

/**
 * Extracts the list of apps currently playing audio from parsed svcl rows.
 * Pure function.
 */
export function extractAudioApps(rows: SvclRow[]): AudioApp[] {
    const seen = new Map<string, AudioApp>();

    for (const row of rows) {
        if (row.type !== "Application" || row.direction !== "Render") continue;
        if (row.deviceState !== "Active") continue;

        // Some sandboxed/UWP (Microsoft Store) audio sessions report an empty
        // Process Path - svcl.exe can't always resolve the image path of a
        // process running under a restricted AppContainer token. This used to
        // fall back to the row's friendly session name (e.g. "Spotify")
        // instead, but that name has no ".exe" and often doesn't match the
        // process's actual image name at all (UWP audio sessions are commonly
        // hosted by a wrapper like "WWAHost.exe", not an exe named after the
        // app) - so it's not a usable id for svcl's /SetAppDefault regardless.
        // Skipping the row entirely is more honest than listing an app the
        // user could select but which excludeAppAudio() would always reject
        // (it requires a ".exe" suffix) or, worse, that would silently no-op
        // against the wrong process if the id happened to coincidentally
        // collide with something else.
        if (!row.processPath) continue;

        const id = basename(row.processPath);
        if (!id || seen.has(id)) continue;

        seen.set(id, { id, name: row.name || id });
    }

    return [...seen.values()];
}

/**
 * Extracts real playback devices (not virtual "Subunit" entries) from
 * parsed svcl rows. Pure function.
 */
export function extractRenderDevices(rows: SvclRow[]): RenderDevice[] {
    return rows
        // deviceState must be "Active" - otherwise a disabled/unplugged device
        // (still listed by svcl.exe, e.g. a headset that used to be plugged in)
        // could get picked as the alternate output in pickAlternateDevice(),
        // which would silently mute the excluded app instead of rerouting it -
        // exactly the failure mode this backend exists to avoid.
        .filter(row => row.type === "Device" && row.direction === "Render" && row.deviceState === "Active")
        .map(row => ({
            id: row.commandLineFriendlyId,
            itemId: row.itemId,
            // row.name is the specific endpoint (e.g. "Headphones"); row.deviceName
            // is the parent sound card/driver (e.g. "High Definition Audio Device") -
            // multiple endpoints can share the same deviceName, so it's not unique enough
            // to use as the display name, but it IS the reliable signal for
            // isCableDevice() (see RenderDevice.deviceName doc comment).
            name: row.name || row.deviceName,
            deviceName: row.deviceName,
            isDefault: row.isDefault
        }));
}

/**
 * Finds the registry key (as reported by svcl.exe itself, no GUID-guessing)
 * for VB-Cable's recording endpoint ("CABLE Output") - the counterpart you
 * enable "Listen to this device" on to hear audio that was routed onto the
 * cable. Pure function.
 *
 * Uses isCableDevice() for the driver-family check (same as everywhere else
 * that classifies a device as "the cable") instead of hardcoding the single
 * exact string "vb-audio virtual cable". That exact-match was a leftover
 * from before round 3 broadened cable detection to the whole "VB-Audio "
 * product family (VB-Cable A+B, Voicemeeter, etc.) - left as-is, a user with
 * e.g. Voicemeeter instead of the single-cable product would get `null` here
 * even though the rest of this file (pickAlternateDevice(), etc.) correctly
 * treats their virtual device as "the cable", making enableCableListen()
 * throw a misleading "install VB-Audio Virtual Cable" error for a device
 * that actually is a supported cable-family product.
 */
export function findCableCaptureRegistryKey(rows: SvclRow[]): string | null {
    const row = rows.find(r =>
        r.type === "Device" &&
        r.direction === "Capture" &&
        isCableDevice(r) &&
        r.name.toLowerCase().includes("cable output") &&
        r.registryKey
    );
    return row?.registryKey ?? null;
}

// Caches the in-flight download/extract so concurrent callers share one
// attempt instead of racing. Without this, two near-simultaneous callers
// (e.g. WindowsDeviceStatus's `Promise.all([windowsHasSecondPlaybackDevice(),
// windowsIsVirtualCableInstalled()])` on mount, before svcl.exe has ever been
// downloaded) would both see `existsSync(exe) === false`, both fetch+unzip
// the archive, and both `writeFile()` the same svcl.exe path concurrently -
// on Windows that can surface as EBUSY/EPERM (the file is still open for
// writing by the other in-flight extraction) or, worse, let one caller's
// execFileAsync() launch a truncated/partially-written exe if it reads the
// file between the other write's open and its completion. Cleared on
// failure so a later call can retry instead of being stuck replaying a
// failed download forever.
let svclEnsurePromise: Promise<string> | null = null;

async function ensureSvcl(): Promise<string> {
    if (svclEnsurePromise) return svclEnsurePromise;

    svclEnsurePromise = (async () => {
        const { dir, exe } = await getSvclPaths();
        const { existsSync } = await import("fs");
        if (existsSync(exe)) return exe;

        const res = await fetch(SVCL_URL);
        if (!res.ok) throw new Error(`Failed to download svcl.exe: ${res.status} ${res.statusText}`);

        const zipBytes = new Uint8Array(await res.arrayBuffer());
        const { unzipSync } = await import("fflate");
        const files = unzipSync(zipBytes);

        await mkdir(dir, { recursive: true });
        for (const [name, data] of Object.entries(files)) {
            // Zip entries can include nested paths (e.g. "docs/readme.txt");
            // writeFile() does not create missing parent directories on its own,
            // so a nested entry would otherwise throw ENOENT instead of
            // extracting. Skip directory entries themselves (zero-length name
            // ending in "/") since there's nothing to write for them.
            if (name.endsWith("/")) continue;
            const dest = safeExtractPath(dir, name);
            await mkdir(dirname(dest), { recursive: true });
            await writeFile(dest, data);
        }

        if (!existsSync(exe)) throw new Error("svcl.exe was not found in the downloaded archive.");
        return exe;
    })();

    try {
        return await svclEnsurePromise;
    } catch (e) {
        svclEnsurePromise = null;
        throw e;
    }
}

// Every svcl.exe invocation goes through excludeAppAudio()/restoreAudio()'s
// serialize() tail (see the comment above `serialize()`), which means a
// svcl.exe process that never exits - e.g. hung waiting on a modal dialog,
// or wedged against a misbehaving audio driver's IPC call, both observed in
// the wild with NirSoft's command-line tools on some machines - would leave
// `operationTail` permanently unsettled: `result.then(() => {}, () => {})`
// (the line that advances the tail for the *next* queued caller) itself
// never runs, because `result` never resolves or rejects. Every later
// excludeAppAudio()/restoreAudio() call, including the plugin's own
// stop()-triggered restoreAudio(), would then await forever with no way to
// recover short of restarting Discord. execFileAsync() has no default
// timeout, so one is set explicitly here to bound the damage: on timeout,
// Node kills the child process and execFileAsync's promise rejects, which
// serialize() already handles correctly (a rejected call still unblocks the
// queue for whoever's next).
const SVCL_TIMEOUT_MS = 15_000;

async function runSvcl(args: string[]): Promise<string> {
    const exePath = await ensureSvcl();
    try {
        const { stdout } = await execFileAsync(exePath, args, { timeout: SVCL_TIMEOUT_MS });
        return stdout;
    } catch (e: any) {
        throw new Error(`svcl.exe ${args.join(" ")} failed: ${e?.message ?? e}`);
    }
}

async function getRows(): Promise<SvclRow[]> {
    const { mkdtemp, readFile, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");

    const dir = await mkdtemp(join(tmpdir(), "vencord-svcl-"));
    const csvPath = join(dir, "sessions.csv");
    try {
        await runSvcl(["/scomma", csvPath]);
        const raw = await readFile(csvPath, "utf8");
        return parseSvclCsv(raw);
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

export async function listAudioApps(): Promise<AudioApp[]> {
    const rows = await getRows();
    return extractAudioApps(rows);
}

/** Remembers {process -> original device id} for apps we've excluded, so restore can undo precisely. */
const excludedApps = new Map<string, string>();

// Serializes every excludeAppAudio()/restoreAudio() call through a single
// chained tail promise, so they can never interleave their svcl.exe calls
// against the shared `excludedApps` Map.
//
// Without this, restoreAudio() (called not just from the settings panel's
// Restore button, but unconditionally from the plugin's stop() hook so
// disabling the plugin never leaves audio silently rerouted) could run
// concurrently with an in-flight excludeAppAudio() for the same process:
// excludeAppAudio() records the app's original device in `excludedApps`
// *before* its own `runSvcl(/SetAppDefault, alternateDevice, ...)` call
// resolves; if restoreAudio() reads that same Map entry in the meantime and
// fires its own `runSvcl(/SetAppDefault, originalDevice, ...)` for the same
// process, two svcl.exe invocations race to set the same app's default
// device and whichever's execFileAsync happens to finish last silently wins
// - possibly leaving the app rerouted onto the alternate device even though
// the user just disabled the plugin expecting everything restored. Chaining
// both functions' bodies onto one tail promise makes each call fully
// complete (svcl.exe call and Map mutation together) before the next one
// starts, eliminating the race entirely.
let operationTail: Promise<void> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = operationTail.then(fn, fn);
    // Swallow rejections in the tail itself (each caller still gets the real
    // rejection via `result`) so one failed operation doesn't permanently
    // wedge every later queued operation behind a rejected tail promise.
    operationTail = result.then(() => { }, () => { });
    return result;
}

/**
 * Picks which device to route the excluded app onto: prefers a real
 * (non-cable) non-default device, since svcl.exe's row order isn't
 * guaranteed to put a real headset ahead of VB-Cable's "CABLE Input", and
 * routing onto the cable while "Listen to this device" isn't configured yet
 * would silently mute the excluded app for the user - exactly the failure
 * mode this backend exists to avoid. Only falls back to the cable if Listen
 * has already been set up. Pure function.
 */
export function pickAlternateDevice(devices: RenderDevice[], listenReady: boolean): RenderDevice | null {
    const nonDefaultDevices = devices.filter(d => !d.isDefault);
    const realAlternate = nonDefaultDevices.find(d => !isCableDevice(d));
    if (realAlternate) return realAlternate;

    const cableAlternate = nonDefaultDevices.find(d => isCableDevice(d));
    if (cableAlternate && listenReady) return cableAlternate;

    return null;
}

/**
 * Moves the given app's audio output to a different real playback device
 * than the current system default, so it's off whatever Discord's "Share
 * Audio" captures. Requires at least 2 real playback devices - throws a
 * clear error otherwise, since silently muting the app for the user would
 * be worse than doing nothing.
 */
export async function excludeAppAudio(processId: string): Promise<void> {
    // Real Windows executable filenames can legitimately contain spaces,
    // parentheses, ampersands, etc. (e.g. "Report Viewer.exe") - the ids
    // fed in here come straight from extractAudioApps()'s basename() of a
    // trusted svcl.exe process path, so this only needs to reject path
    // separators / drive-letter-ish inputs (defense in depth for argv
    // injection into svcl.exe, since this is passed via execFile, not a
    // shell), not restrict to a narrow identifier charset.
    if (!/^[^\\/:*?"<>|]+\.exe$/i.test(processId)) throw new Error(`Invalid process id: ${JSON.stringify(processId)}`);

    // Serialized against restoreAudio() (and any other concurrent
    // excludeAppAudio() call) - see the long comment above `serialize()`.
    return serialize(async () => {
        const rows = await getRows();
        const devices = extractRenderDevices(rows);

        const defaultDevice = devices.find(d => d.isDefault);
        const hasCableAlternate = devices.some(d => !d.isDefault && isCableDevice(d));
        const hasRealAlternate = devices.some(d => !d.isDefault && !isCableDevice(d));

        let alternateDevice: RenderDevice | null = null;
        if (defaultDevice) {
            // isCableListenConfigured() always returns false by design (see the
            // comment above it) - calling it here would just spawn another
            // svcl.exe run for a hardcoded result, so skip straight to false.
            alternateDevice = pickAlternateDevice(devices, false);
        }

        if (!defaultDevice || !alternateDevice) {
            if (defaultDevice && hasCableAlternate && !hasRealAlternate) {
                throw new Error(
                    "The only alternate output device found is VB-Audio Virtual Cable, but \"Listen to this device\" " +
                    "isn't configured yet - moving this app there now would silently mute it for you. Configure " +
                    "Listen for the cable first (see below), then try again."
                );
            }
            throw new Error(
                "Only one playback device was found. Windows has no built-in virtual audio device, so there's " +
                "nowhere to move this app's sound while still letting you hear it. Install a free virtual audio " +
                "cable (e.g. VB-Audio Virtual Cable) to get a second destination, or use the settings page below manually."
            );
        }

        // Record the original device only after the move to the alternate has
        // actually succeeded, not before. Recording it first (the previous
        // order) meant that if runSvcl() below threw, `excludedApps` would
        // already claim the app had been excluded even though it never left
        // its original device - a subsequent excludeAppAudio() retry would
        // then skip re-recording (the `!has()` guard) and could pin a stale
        // "original device" if the system default changed in between.
        await runSvcl(["/Stdout", "/SetAppDefault", alternateDevice.id, "all", processId]);

        if (!excludedApps.has(processId)) {
            excludedApps.set(processId, defaultDevice.id);
        }
    });
}

/** Moves every currently-excluded app back to the device it was on before. */
export async function restoreAudio(): Promise<void> {
    // Serialized against excludeAppAudio() - see the long comment above
    // `serialize()`. This guarantees restoreAudio() only ever observes
    // `excludedApps` states left behind by a *fully completed* exclude (or
    // restore) call, never one that's still mid-flight.
    return serialize(async () => {
        for (const [processId, originalDeviceId] of excludedApps) {
            await runSvcl(["/Stdout", "/SetAppDefault", originalDeviceId, "all", processId]).catch(() => { });
        }
        excludedApps.clear();
    });
}

/** Opens Settings > System > Sound > "App volume and device preferences", as a manual fallback. */
export async function openAppVolumeSettings(): Promise<void> {
    try {
        // `start` is a cmd.exe builtin, not an executable, so it must be run through cmd.
        // The empty "" title argument avoids `start` misinterpreting the URI as a window title.
        await exec('start "" ms-settings:apps-volumes');
    } catch (e: any) {
        throw new Error(`Could not open Windows sound settings: ${e?.message ?? e}`);
    }
}

const VB_CABLE_URL = "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip";

/**
 * True if a machine has a second playback device that excludeAppAudio() can
 * actually route onto right now. This intentionally does NOT count
 * VB-Cable's "CABLE Input" as satisfying the requirement: pickAlternateDevice()
 * only falls back to the cable when "Listen to this device" is confirmed
 * configured, and isCableListenConfigured() always returns false (see the
 * long comment above it) - so a machine with only the cable installed and no
 * other real output device would still make excludeAppAudio() throw. If this
 * returned true for a cable-only device, WindowsDeviceStatus would hide its
 * "install a second device" warning (`if (hasSecondDevice) return null;` in
 * index.tsx) and the Exclude button would then fail with a confusing error
 * right after the UI implied everything was ready.
 */
export async function hasSecondPlaybackDevice(): Promise<boolean> {
    const rows = await getRows();
    const devices = extractRenderDevices(rows);
    return devices.some(d => !d.isDefault && !isCableDevice(d));
}

/**
 * True if VB-Audio Virtual Cable is already installed (its "CABLE Input"
 * playback endpoint shows up like any other real device once the driver
 * is present).
 */
export async function isVirtualCableInstalled(): Promise<boolean> {
    const rows = await getRows();
    const devices = extractRenderDevices(rows);
    return devices.some(d => isCableDevice(d));
}

/**
 * Runs an arbitrary PowerShell script elevated (triggers the normal Windows
 * UAC prompt - this cannot be bypassed, and shouldn't be, for anything that
 * touches drivers or HKLM). The script is passed via `-EncodedCommand`
 * (base64 of UTF-16LE) instead of interpolating it into a quoted command
 * string - that sidesteps the multi-layer quoting hell of nesting
 * cmd.exe -> powershell.exe -> Start-Process -> another powershell.exe,
 * where manually escaped quotes are extremely easy to get subtly wrong.
 */
async function runElevatedPowerShell(script: string, timeoutMs: number): Promise<void> {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    await exec(
        `powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile -EncodedCommand ${encoded}' -Verb RunAs -Wait"`,
        { timeout: timeoutMs }
    );
}

/**
 * Downloads the VB-Audio Virtual Cable driver installer and launches it
 * elevated. Windows requires admin rights and a reboot to install any
 * audio driver - neither can be scripted away, so this only gets the user
 * to the installer's own UAC prompt as fast as possible instead of making
 * them go find the download themselves.
 */
export async function installVirtualCable(): Promise<void> {
    const { existsSync, mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");

    const stageDir = mkdtempSync(join(tmpdir(), "vencord-vbcable-"));

    const res = await fetch(VB_CABLE_URL);
    if (!res.ok) throw new Error(`Failed to download VB-Cable: ${res.status} ${res.statusText}`);

    const zipBytes = new Uint8Array(await res.arrayBuffer());
    const { unzipSync } = await import("fflate");
    const files = unzipSync(zipBytes);

    for (const [name, data] of Object.entries(files)) {
        // See the identical comment in ensureSvcl(): VB-Cable's driver pack
        // ships its setup exe alongside nested driver subfolders (e.g.
        // "x64/", "x32/"), and writeFile() won't create missing parent
        // directories, so this must create them first or extraction throws
        // ENOENT instead of ever reaching the "setup exe not found" check.
        if (name.endsWith("/")) continue;
        const dest = safeExtractPath(stageDir, name);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, data);
    }

    // basename() so a setup exe nested under a subfolder (e.g.
    // "VBCABLE_Driver_Pack/VBCABLE_Setup_x64.exe") is still found by name -
    // Object.keys(files).find() below only matched top-level entries before.
    const setupName = Object.keys(files).find(n => /^VBCABLE_Setup_x64\.exe$/i.test(basename(n)))
        ?? Object.keys(files).find(n => /^VBCABLE_Setup\.exe$/i.test(basename(n)));
    if (!setupName) throw new Error("Could not find the VB-Cable setup executable in the downloaded archive.");

    const setupPath = join(stageDir, setupName);
    if (!existsSync(setupPath)) throw new Error("VB-Cable setup executable failed to extract.");

    await runElevatedPowerShell(
        `Start-Process -FilePath '${setupPath.replace(/'/g, "''")}' -Verb RunAs -Wait`,
        5 * 60 * 1000
    ).catch((e: any) => {
        throw new Error(`Could not launch the VB-Cable installer: ${e?.message ?? e}`);
    });
}

// The "Listen to this device" feature's endpoint property GUID, seen in the
// wild on several audio automation tools/forum threads next to properties
// named ",0"/",1" on a capture endpoint's Properties key.
//
// IMPORTANT - verified against a real, live machine's registry during review
// and found NOT to match the "DWORD flag + REG_SZ device id" shape this code
// used to assume:
//   - On a real Capture endpoint's Properties key, there is no ",0" value at
//     all; ",1" and ",2" both exist and are REG_BINARY (a short PROPVARIANT-
//     shaped blob: 11 00 00 00 01 00 00 00 00 00 00 00 - VT_BOOL-ish, not a
//     device id string).
//   - A REG_SZ endpoint-id-shaped string under this same GUID was instead
//     found at ",0" on a *Render* endpoint's Properties key, i.e. on the
//     opposite endpoint direction from the one this code writes to.
// In short: the exact registry shape of "Listen to this device" is
// undocumented, differs from the scheme previously assumed here, and blindly
// writing REG_DWORD/REG_SZ values under fabricated indices risks corrupting
// unrelated property slots on a live audio endpoint. Rather than guess a new
// binary layout without authoritative confirmation, this feature now
// refuses to write and reports itself as unavailable - safer than silently
// "succeeding" at nothing (or at something harmful).
//
// SECOND-ROUND FINDING: the ",1" REG_BINARY read this code briefly used as a
// "Listen is on" signal is ALSO not trustworthy. Live inspection of every
// MMDevices Render/Capture endpoint on a real machine found the exact same
// blob (REG_BINARY 0B0000000100000000000000) at ",1" on *every* endpoint
// that has this GUID at all - both Render and Capture, including a USB
// microphone with no plausible manual "Listen" configuration - while ",0"
// on Render endpoints instead holds a cross-referenced endpoint-id string
// (paired GUIDs pointing at each other). That pattern is much more
// consistent with ",1" recording a fixed capability/pairing flag than a
// per-endpoint boolean toggle state, so treating "REG_BINARY 0B0000000100
// is present at ,1" as proof Listen is enabled produces false positives on
// completely unconfigured endpoints. There is no known-good read path
// either, so isCableListenConfigured() below no longer reads or writes
// under this GUID at all - the constant is kept purely so this comment
// stays attached to the right symbol for future readers.
const LISTEN_PROPERTY_GUID = "{24dbb0fc-9311-4b3d-9cf0-18ff155639d4}";

/**
 * True if VB-Cable's "CABLE Output" already has "Listen to this device"
 * turned on. Reading HKLM's MMDevices subtree doesn't need elevation.
 *
 * See the long comment above LISTEN_PROPERTY_GUID: neither the original
 * ",0" REG_DWORD assumption nor the later ",1" REG_BINARY-prefix check
 * survived live verification against a real registry - the ",1" blob turned
 * out to be present (with the identical bytes) on every endpoint that has
 * this property GUID at all, whether or not Listen is plausibly configured,
 * so it cannot distinguish "on" from "off". There is currently no known-good
 * way to read this state from the registry, so this always reports `false`
 * (matching enableCableListen()'s refusal to write) rather than risk a false
 * "Listen configured" that would hide the manual setup instructions from a
 * user who actually still needs them. Callers must not treat a `false` here
 * as proof the feature is off - only as "we can't confirm it via the
 * registry", per the UI copy in WindowsListenStatus.
 */
export async function isCableListenConfigured(): Promise<boolean> {
    const rows = await getRows();
    const cableKey = findCableCaptureRegistryKey(rows);
    if (!cableKey) return false;

    // Intentionally not reading LISTEN_PROPERTY_GUID here - see the comment
    // above it for why that value cannot reliably distinguish Listen on/off.
    return false;
}

/**
 * Would turn on "Listen to this device" for VB-Cable's recording endpoint,
 * pointed at the current default playback device (your real headphones/
 * speakers) - this is what would let you keep hearing an app once it's been
 * moved onto the cable.
 *
 * Disabled by design: see the long comment above LISTEN_PROPERTY_GUID. Live
 * registry inspection during review showed this code's assumed property
 * shape (REG_DWORD flag at ",0" + REG_SZ device id at ",1") does not match
 * what's actually on a real Capture endpoint, and no authoritative public
 * documentation of the real shape could be found. Writing fabricated values
 * under HKLM to a live audio endpoint on a guess is worse than doing
 * nothing, so this now throws and directs the user to the manual Sound
 * Control Panel toggle instead of attempting an unverified registry write.
 */
export async function enableCableListen(): Promise<void> {
    const rows = await getRows();

    const cableKey = findCableCaptureRegistryKey(rows);
    if (!cableKey) {
        throw new Error(
            "Could not find VB-Cable's recording device. Make sure VB-Audio Virtual Cable is installed " +
            "and you've restarted your PC since installing it."
        );
    }

    const devices = extractRenderDevices(rows);
    const target = devices.find(d => d.isDefault && !isCableDevice(d));
    if (!target) throw new Error("Could not determine your real default playback device.");

    throw new Error(
        "Automatic \"Listen to this device\" setup isn't available - its registry format couldn't be reliably " +
        "verified, and writing unverified values to a live audio device's registry key is riskier than leaving " +
        "it alone. Please enable it manually instead: right-click the speaker icon in the taskbar > Sounds > " +
        "Recording tab > CABLE Output > Properties > Listen tab > check \"Listen to this device\" > pick " +
        `"${target.name}" as the playback device.`
    );
}

export async function isSupported(): Promise<boolean> {
    return process.platform === "win32";
}
