/*
 * Standalone logic tests for the pure parsing functions in
 * platform/windows.ts. These do not require svcl.exe or a real Windows
 * audio stack - they run against a real CSV export captured live from
 * `svcl.exe /scomma` on an actual Windows machine during development, to
 * make sure the parsing holds up against real-world column layout and
 * quoted-comma fields (e.g. "11.10 dB, 11.10 dB").
 *
 * Run with: node test/windows.platform.test.ts
 */

import assert from "node:assert/strict";

import { extractAudioApps, extractRenderDevices, findCableCaptureRegistryKey, parseCsvLine, parseSvclCsv, pickAlternateDevice, safeExtractPath } from "../platform/windows.ts";
import type { RenderDevice } from "../platform/windows.ts";

let passed = 0;
let failed = 0;

const pending: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>) {
    try {
        const result = fn();
        if (result instanceof Promise) {
            pending.push(
                result.then(() => {
                    passed++;
                    console.log(`  ok - ${name}`);
                }).catch(e => {
                    failed++;
                    console.error(`  FAIL - ${name}`);
                    console.error(e);
                })
            );
            return;
        }
        passed++;
        console.log(`  ok - ${name}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL - ${name}`);
        console.error(e);
    }
}

// Real header + a representative sample of rows captured live from
// `svcl.exe /scomma`, trimmed to the columns that matter for parsing.
const SAMPLE_CSV = [
    "Name,Type,Direction,Device Name,Default,Default Multimedia,Default Communications,Device State,Muted,Volume dB,Volume Percent,Min Volume dB,Max Volume dB,Volume Step,Channels Count,Channels dB,Channels  Percent,Item ID,Command-Line Friendly ID,Process Path,Process ID,Window Title,Registry Key,Speakers Config,",
    "Discord,Application,Render,High Definition Audio Device,,,,Active,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{0.0.0.00000000}.{181f65d2}|foo|1%b21416,High Definition Audio Device\\Application\\Discord,C:\\Users\\Administrator\\AppData\\Local\\Discord\\app-1.0.9244\\Discord.exe,21416,,,,",
    "RustClient.exe,Application,Render,High Definition Audio Device,,,,Active,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{0.0.0.00000000}.{181f65d2}|bar|1%b48528,High Definition Audio Device\\Application\\RustClient.exe,C:\\Program Files (x86)\\Steam\\steamapps\\common\\Rust\\RustClient.exe,48528,Rust,,,",
    "Steam,Application,Render,High Definition Audio Device,,,,Inactive,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{0.0.0.00000000}.{181f65d2}|baz|1%b21336,High Definition Audio Device\\Application\\Steam,C:\\Program Files (x86)\\Steam\\steam.exe,21336,,,,",
    "Headphones,Device,Render,High Definition Audio Device,Render,Render,Render,Active,No,0.00 dB,100.0%,-64.00 dB,0.00 dB,1.00 dB,2,\"0.00 dB, 0.00 dB\",\"100.0%, 100.0%\",{0.0.0.00000000}.{181f65d2},High Definition Audio Device\\Device\\Headphones\\Render,,,,HKEY_LOCAL_MACHINE\\...,0x3 0x0 0x0,\"2 Channel, 16 bit, 48000 Hz\"",
    "Speakers,Device,Render,NVIDIA High Definition Audio,,,,Active,No,,100.0%,-64.00 dB,0.00 dB,1.00 dB,2,,\"100.0%, 100.0%\",{0.0.0.00000001}.{deadbeef},NVIDIA High Definition Audio\\Device\\Speakers\\Render,,,,HKEY_LOCAL_MACHINE\\...,,\"2 Channel, 16 bit, 48000 Hz\"",
    "CABLE Output,Device,Capture,VB-Audio Virtual Cable,,,,Active,No,,100.0%,-64.00 dB,0.00 dB,1.00 dB,2,,\"100.0%, 100.0%\",{0.0.1.00000000}.{cablecab-1234-5678-9abc-cablecable01},VB-Audio Virtual Cable\\Device\\CABLE Output\\Capture,,,,HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture\\{cablecab-1234-5678-9abc-cablecable01},,\"2 Channel, 16 bit, 48000 Hz\""
].join("\r\n");

console.log("parseCsvLine");

test("splits plain comma-separated fields", () => {
    assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
});

test("keeps commas inside quoted fields intact", () => {
    assert.deepEqual(parseCsvLine("a,\"b, c\",d"), ["a", "b, c", "d"]);
});

test("handles an empty field between commas", () => {
    assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
});

test("handles escaped double-quotes inside a quoted field", () => {
    assert.deepEqual(parseCsvLine("a,\"say \"\"hi\"\"\",c"), ["a", "say \"hi\"", "c"]);
});

// ---------------------------------------------------------------------------

console.log("parseSvclCsv");

test("parses the header + all data rows", () => {
    const rows = parseSvclCsv(SAMPLE_CSV);
    assert.equal(rows.length, 6);
});

test("extracts application rows with correct fields", () => {
    const rows = parseSvclCsv(SAMPLE_CSV);
    const rust = rows.find(r => r.name === "RustClient.exe");
    assert.ok(rust);
    assert.equal(rust!.type, "Application");
    assert.equal(rust!.direction, "Render");
    assert.equal(rust!.deviceState, "Active");
    assert.equal(rust!.processPath, "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Rust\\RustClient.exe");
});

test("extracts device rows and marks the default one", () => {
    const rows = parseSvclCsv(SAMPLE_CSV);
    const headphones = rows.find(r => r.name === "Headphones");
    assert.ok(headphones);
    assert.equal(headphones!.isDefault, true);

    const speakers = rows.find(r => r.name === "Speakers" && r.type === "Device");
    assert.ok(speakers);
    assert.equal(speakers!.isDefault, false);
});

test("returns an empty array for empty input", () => {
    assert.deepEqual(parseSvclCsv(""), []);
});

test("returns an empty array for header-only input", () => {
    assert.deepEqual(parseSvclCsv(SAMPLE_CSV.split("\r\n")[0]), []);
});

// ---------------------------------------------------------------------------

console.log("extractAudioApps");

test("lists only active, rendering application rows", () => {
    const rows = parseSvclCsv(SAMPLE_CSV);
    const apps = extractAudioApps(rows);
    const names = apps.map(a => a.id).sort();
    assert.deepEqual(names, ["Discord.exe", "RustClient.exe"]);
});

test("excludes inactive apps (e.g. Steam, currently not playing)", () => {
    const rows = parseSvclCsv(SAMPLE_CSV);
    const apps = extractAudioApps(rows);
    assert.ok(!apps.some(a => a.id === "Steam.exe" || a.id === "steam.exe"));
});

test("dedupes an app that appears in multiple rows", () => {
    const rows = parseSvclCsv(SAMPLE_CSV + "\r\n" + SAMPLE_CSV.split("\r\n")[2]);
    const apps = extractAudioApps(rows);
    assert.equal(apps.filter(a => a.id === "RustClient.exe").length, 1);
});

// ---------------------------------------------------------------------------

console.log("extractRenderDevices");

test("lists real playback devices with default flag", () => {
    const rows = parseSvclCsv(SAMPLE_CSV);
    const devices = extractRenderDevices(rows);
    assert.equal(devices.length, 2);
    assert.ok(devices.some(d => d.name === "Headphones" && d.isDefault));
    assert.ok(devices.some(d => d.name === "Speakers" && !d.isDefault));
});

test("excludes a disabled/unplugged device even though it still shows up in svcl's listing", () => {
    // Regression: extractRenderDevices() used to have no deviceState filter at
    // all, unlike extractAudioApps() which requires "Active" - so a device
    // that's no longer physically connected (e.g. unplugged headphones still
    // remembered by Windows) could be returned as a candidate alternate
    // device, and pickAlternateDevice() could route an excluded app onto it,
    // silently muting it for the user.
    const raw = [
        SAMPLE_CSV.split("\r\n")[0],
        "Old Headset,Device,Render,USB Audio Device,,,,Unplugged,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{x}.{y},USB Audio Device\\Device\\Old Headset\\Render,,,,HKEY_LOCAL_MACHINE\\Should\\Not\\Match,,"
    ].join("\r\n");
    const devices = extractRenderDevices(parseSvclCsv(raw));
    assert.equal(devices.length, 0);
});

// ---------------------------------------------------------------------------

console.log("findCableCaptureRegistryKey");

test("finds CABLE Output's registry key when VB-Cable is installed", () => {
    const rows = parseSvclCsv(SAMPLE_CSV);
    const key = findCableCaptureRegistryKey(rows);
    assert.equal(
        key,
        "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture\\{cablecab-1234-5678-9abc-cablecable01}"
    );
});

test("returns null when VB-Cable is not installed", () => {
    const rows = parseSvclCsv(SAMPLE_CSV.split("\r\n").slice(0, -1).join("\r\n"));
    assert.equal(findCableCaptureRegistryKey(rows), null);
});

test("does not match a Render-direction device that happens to have 'cable' in its name", () => {
    const raw = [
        SAMPLE_CSV.split("\r\n")[0],
        "My Cable Output,Device,Render,Some Card,,,,Active,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{x}.{y},Some Card\\Device\\My Cable Output\\Render,,,,HKEY_LOCAL_MACHINE\\Should\\Not\\Match,,"
    ].join("\r\n");
    assert.equal(findCableCaptureRegistryKey(parseSvclCsv(raw)), null);
});

// ---------------------------------------------------------------------------

console.log("pickAlternateDevice");

function device(name: string, isDefault: boolean): RenderDevice {
    return { id: name, itemId: name, name, isDefault };
}

test("prefers a real non-default device over the cable, regardless of array order", () => {
    // Cable listed first - a naive `.find(d => !d.isDefault)` would pick it
    // and silently mute the excluded app if Listen isn't configured.
    const devices = [device("Speakers", true), device("CABLE Input", false), device("Headphones", false)];
    const picked = pickAlternateDevice(devices, false);
    assert.equal(picked?.name, "Headphones");
});

test("falls back to the cable only when Listen is already configured", () => {
    const devices = [device("Speakers", true), device("CABLE Input", false)];
    assert.equal(pickAlternateDevice(devices, false), null);
    assert.equal(pickAlternateDevice(devices, true)?.name, "CABLE Input");
});

test("returns null when there is no non-default device at all", () => {
    const devices = [device("Speakers", true)];
    assert.equal(pickAlternateDevice(devices, true), null);
});

// ---------------------------------------------------------------------------

// Regression test for a real bug found in round 2: ensureSvcl() and
// installVirtualCable() both extract a downloaded zip by doing
// `writeFile(join(dir, name), data)` for every entry `unzipSync()` returns.
// fs.writeFile does NOT create missing parent directories, so any zip entry
// with a nested path (e.g. a driver pack shipping "x64/driver.sys" alongside
// its setup exe) used to throw ENOENT instead of extracting. The fix creates
// each entry's parent directory first. This test exercises that exact
// write-loop pattern standalone (no fflate/network/electron needed) against
// a simulated nested zip listing to prove the parent-dir creation actually
// prevents the crash.
console.log("\nzip extraction (nested-path regression)");

test("writing a nested zip entry succeeds when parent dirs are created first", async () => {
    const { mkdtemp, writeFile: writeFileP, mkdir: mkdirP, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath, dirname } = await import("node:path");

    const stageDir = await mkdtemp(joinPath(tmpdir(), "svcl-zip-test-"));

    // Simulates what unzipSync() would return for a zip containing a
    // top-level file plus a nested subfolder - the shape that used to break.
    const files: Record<string, Uint8Array> = {
        "VBCABLE_Setup_x64.exe": new Uint8Array([1, 2, 3]),
        "x64/vbaudio_cable64.sys": new Uint8Array([4, 5, 6]),
        "x64/": new Uint8Array(0) // directory entry, as some zip tools emit
    };

    for (const [name, data] of Object.entries(files)) {
        if (name.endsWith("/")) continue;
        const dest = joinPath(stageDir, name);
        await mkdirP(dirname(dest), { recursive: true });
        await writeFileP(dest, data);
    }

    const nested = await readFile(joinPath(stageDir, "x64", "vbaudio_cable64.sys"));
    assert.deepEqual([...nested], [4, 5, 6]);
});

// ---------------------------------------------------------------------------

// Regression test for a real bug found in round 3: the zip-extraction loops
// in ensureSvcl() and installVirtualCable() resolve each entry's path with
// `join(extractDir, entryName)`, where entryName comes straight from the
// downloaded zip. A malicious/corrupted archive with a "zip slip" entry name
// (e.g. "../../evil.exe") would resolve outside the intended staging
// directory - and since the round-2 fix now creates missing parent
// directories automatically, that could silently create attacker-chosen
// directories outside the sandbox. safeExtractPath() rejects any entry that
// doesn't resolve inside extractDir. Pure function - testable directly.
console.log("\nsafeExtractPath");

test("resolves a normal nested entry inside the extraction directory", () => {
    const resolved = safeExtractPath("C:\\stage", "x64/driver.sys");
    assert.ok(resolved.startsWith("C:\\stage"));
    assert.ok(resolved.endsWith("driver.sys"));
});

test("throws on a zip-slip entry name that escapes the extraction directory", () => {
    assert.throws(() => safeExtractPath("C:\\stage", "../../evil.exe"));
});

test("throws on an absolute-path-like entry name", () => {
    assert.throws(() => safeExtractPath("C:\\stage", "..\\..\\Windows\\System32\\evil.dll"));
});

// ---------------------------------------------------------------------------

await Promise.all(pending);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
