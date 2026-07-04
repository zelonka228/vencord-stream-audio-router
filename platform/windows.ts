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
import { join } from "path";
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
    isDefault: boolean;
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
 * Extracts the list of apps currently playing audio from parsed svcl rows.
 * Pure function.
 */
export function extractAudioApps(rows: SvclRow[]): AudioApp[] {
    const seen = new Map<string, AudioApp>();

    for (const row of rows) {
        if (row.type !== "Application" || row.direction !== "Render") continue;
        if (row.deviceState !== "Active") continue;

        const id = row.processPath ? basename(row.processPath) : row.name;
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
        .filter(row => row.type === "Device" && row.direction === "Render")
        .map(row => ({
            id: row.commandLineFriendlyId,
            itemId: row.itemId,
            // row.name is the specific endpoint (e.g. "Headphones"); row.deviceName
            // is the parent sound card/driver (e.g. "High Definition Audio Device") -
            // multiple endpoints can share the same deviceName, so it's not unique enough.
            name: row.name || row.deviceName,
            isDefault: row.isDefault
        }));
}

/**
 * Finds the registry key (as reported by svcl.exe itself, no GUID-guessing)
 * for VB-Cable's recording endpoint ("CABLE Output") - the counterpart you
 * enable "Listen to this device" on to hear audio that was routed onto the
 * cable. Pure function.
 */
export function findCableCaptureRegistryKey(rows: SvclRow[]): string | null {
    const row = rows.find(r =>
        r.type === "Device" &&
        r.direction === "Capture" &&
        r.name.toLowerCase().includes("cable output") &&
        r.registryKey
    );
    return row?.registryKey ?? null;
}

async function ensureSvcl(): Promise<string> {
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
        await writeFile(join(dir, name), data);
    }

    if (!existsSync(exe)) throw new Error("svcl.exe was not found in the downloaded archive.");
    return exe;
}

async function runSvcl(args: string[]): Promise<string> {
    const exePath = await ensureSvcl();
    try {
        const { stdout } = await execFileAsync(exePath, args);
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

/**
 * Moves the given app's audio output to a different real playback device
 * than the current system default, so it's off whatever Discord's "Share
 * Audio" captures. Requires at least 2 real playback devices - throws a
 * clear error otherwise, since silently muting the app for the user would
 * be worse than doing nothing.
 */
export async function excludeAppAudio(processId: string): Promise<void> {
    if (!/^[\w.-]+\.exe$/i.test(processId)) throw new Error(`Invalid process id: ${JSON.stringify(processId)}`);

    const rows = await getRows();
    const devices = extractRenderDevices(rows);

    const defaultDevice = devices.find(d => d.isDefault);
    const alternateDevice = devices.find(d => !d.isDefault);

    if (!defaultDevice || !alternateDevice) {
        throw new Error(
            "Only one playback device was found. Windows has no built-in virtual audio device, so there's " +
            "nowhere to move this app's sound while still letting you hear it. Install a free virtual audio " +
            "cable (e.g. VB-Audio Virtual Cable) to get a second destination, or use the settings page below manually."
        );
    }

    if (!excludedApps.has(processId)) {
        excludedApps.set(processId, defaultDevice.id);
    }

    await runSvcl(["/Stdout", "/SetAppDefault", alternateDevice.id, "all", processId]);
}

/** Moves every currently-excluded app back to the device it was on before. */
export async function restoreAudio(): Promise<void> {
    for (const [processId, originalDeviceId] of excludedApps) {
        await runSvcl(["/Stdout", "/SetAppDefault", originalDeviceId, "all", processId]).catch(() => { });
    }
    excludedApps.clear();
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

/** True if a machine has any real playback device besides the current default. */
export async function hasSecondPlaybackDevice(): Promise<boolean> {
    const rows = await getRows();
    const devices = extractRenderDevices(rows);
    return devices.some(d => !d.isDefault);
}

/**
 * True if VB-Audio Virtual Cable is already installed (its "CABLE Input"
 * playback endpoint shows up like any other real device once the driver
 * is present).
 */
export async function isVirtualCableInstalled(): Promise<boolean> {
    const rows = await getRows();
    const devices = extractRenderDevices(rows);
    return devices.some(d => d.name.toLowerCase().includes("cable"));
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
        await writeFile(join(stageDir, name), data);
    }

    const setupName = Object.keys(files).find(n => /^VBCABLE_Setup_x64\.exe$/i.test(n))
        ?? Object.keys(files).find(n => /^VBCABLE_Setup\.exe$/i.test(n));
    if (!setupName) throw new Error("Could not find the VB-Cable setup executable in the downloaded archive.");

    const setupPath = join(stageDir, setupName);
    if (!existsSync(setupPath)) throw new Error("VB-Cable setup executable failed to extract.");

    // Launching an elevated process from an unelevated one requires the
    // "RunAs" verb - Node has no built-in way to do this, so we go through
    // PowerShell's Start-Process, which triggers the normal Windows UAC
    // prompt (this cannot be bypassed, and shouldn't be - it's a real
    // driver install).
    await exec(
        `powershell -NoProfile -Command "Start-Process -FilePath '${setupPath}' -Verb RunAs -Wait"`,
        { timeout: 5 * 60 * 1000 }
    ).catch((e: any) => {
        throw new Error(`Could not launch the VB-Cable installer: ${e?.message ?? e}`);
    });
}

// The "Listen to this device" feature's endpoint property GUID - a publicly
// documented/reverse-engineered constant used by many audio automation
// tools, not something we guessed. Property `,0` is the DWORD on/off flag;
// `,1` is the string ID of the playback device to listen through.
const LISTEN_PROPERTY_GUID = "{24dbb0fc-9311-4b3d-9cf0-18ff155639d4}";

function toRegPath(registryKey: string): string {
    return registryKey.replace(/^HKEY_LOCAL_MACHINE\\/i, "HKLM\\") + "\\Properties";
}

/**
 * True if VB-Cable's "CABLE Output" already has "Listen to this device"
 * turned on. Reading HKLM's MMDevices subtree doesn't need elevation.
 */
export async function isCableListenConfigured(): Promise<boolean> {
    const rows = await getRows();
    const cableKey = findCableCaptureRegistryKey(rows);
    if (!cableKey) return false;

    try {
        const { stdout } = await execFileAsync("reg", [
            "query", toRegPath(cableKey), "/v", `${LISTEN_PROPERTY_GUID},0`
        ]);
        return /0x1\b/.test(stdout);
    } catch {
        return false;
    }
}

/**
 * Turns on "Listen to this device" for VB-Cable's recording endpoint,
 * pointed at the current default playback device (your real headphones/
 * speakers) - this is what lets you keep hearing an app once it's been
 * moved onto the cable. Writing under HKLM needs elevation, so this opens
 * one more (unavoidable) UAC prompt, same as the driver install itself.
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
    const target = devices.find(d => d.isDefault && !d.name.toLowerCase().includes("cable"));
    if (!target) throw new Error("Could not determine your real default playback device.");

    const regPath = toRegPath(cableKey);
    const script =
        `reg add "${regPath}" /v "${LISTEN_PROPERTY_GUID},0" /t REG_DWORD /d 1 /f ; ` +
        `reg add "${regPath}" /v "${LISTEN_PROPERTY_GUID},1" /t REG_SZ /d "${target.itemId}" /f`;

    await exec(
        `powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile -Command \\"${script}\\"' -Verb RunAs -Wait"`,
        { timeout: 60 * 1000 }
    ).catch((e: any) => {
        throw new Error(`Could not configure audio Listen: ${e?.message ?? e}`);
    });
}

export async function isSupported(): Promise<boolean> {
    return process.platform === "win32";
}
