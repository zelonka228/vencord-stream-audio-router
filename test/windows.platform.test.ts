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

import { extractAudioApps, extractRenderDevices, parseCsvLine, parseSvclCsv } from "../platform/windows.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
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
    "Speakers,Device,Render,NVIDIA High Definition Audio,,,,Active,No,,100.0%,-64.00 dB,0.00 dB,1.00 dB,2,,\"100.0%, 100.0%\",{0.0.0.00000001}.{deadbeef},NVIDIA High Definition Audio\\Device\\Speakers\\Render,,,,HKEY_LOCAL_MACHINE\\...,,\"2 Channel, 16 bit, 48000 Hz\""
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
    assert.equal(rows.length, 5);
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

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
