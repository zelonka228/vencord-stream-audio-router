/*
 * Standalone logic tests for the pure parsing functions in
 * platform/linux.ts. These do not require pactl, Vencord,
 * or Discord to be installed - they run against captured/hand-built pactl
 * output to make sure the regex-based parsing holds up against real-world
 * formatting quirks (quotes, extra whitespace, multiple blocks, CRLF, etc).
 *
 * Run with: node test/linux.platform.test.ts
 */

import assert from "node:assert/strict";

import {
    findModuleIdsByArgument,
    findOwnerModuleOfSink,
    parseSinkInputs,
    shortSinksContainsName
} from "../platform/linux.ts";

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

// ---------------------------------------------------------------------------

console.log("parseSinkInputs");

test("parses a single sink input with application.name", () => {
    const raw = `
Sink Input #123
	Driver: PipeWire
	Owner Module: n/a
	Client: 45
	Sink: 1
	Sample Specification: float32le 2ch 48000Hz
	Channel Map: front-left,front-right
	Format: pcm, format.sample_format = "\\"float32le\\"" format.rate = "48000" format.channels = "2" format.channel_map = "\\"front-left,front-right\\""
	Corked: no
	Mute: no
	Volume: front-left: 65536 / 100% / 0.00 dB,   front-right: 65536 / 100% / 0.00 dB
	        balance 0.00
	Buffer Latency: 0 usec
	Sink Latency: 0 usec
	Resample method: PipeWire
	Properties:
		media.name = "Playback"
		application.name = "Firefox"
		application.icon_name = "firefox"
		application.process.id = "9911"
`.trim();

    const result = parseSinkInputs(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "123");
    assert.equal(result[0].name, "Firefox");
});

test("falls back to media.name when application.name is missing", () => {
    const raw = `
Sink Input #7
	Driver: PulseAudio
	Owner Module: 4
	Properties:
		media.name = "Spotify Free"
`.trim();

    const result = parseSinkInputs(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Spotify Free");
});

test("falls back to a placeholder when no name property exists at all", () => {
    const raw = `
Sink Input #99
	Driver: PulseAudio
	Properties:
		application.process.id = "1"
`.trim();

    const result = parseSinkInputs(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Unknown app (#99)");
});

test("parses multiple sink inputs in one listing", () => {
    const raw = `
Sink Input #1
	Properties:
		application.name = "Firefox"

Sink Input #2
	Properties:
		application.name = "Discord"

Sink Input #3
	Properties:
		application.name = "Spotify"
`.trim();

    const result = parseSinkInputs(raw);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map(a => a.id), ["1", "2", "3"]);
    assert.deepEqual(result.map(a => a.name), ["Firefox", "Discord", "Spotify"]);
});

test("returns an empty array for empty/whitespace-only input", () => {
    assert.deepEqual(parseSinkInputs(""), []);
    assert.deepEqual(parseSinkInputs("   \n\n  "), []);
});

test("handles CRLF line endings", () => {
    const raw = "Sink Input #5\r\n\tProperties:\r\n\t\tapplication.name = \"VLC\"\r\n";
    const result = parseSinkInputs(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "VLC");
});

test("ignores unrelated leading noise before the first block", () => {
    const raw = `Some unrelated warning line\nSink Input #10\n\tProperties:\n\t\tapplication.name = "OBS"`;
    const result = parseSinkInputs(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "10");
});

// ---------------------------------------------------------------------------

console.log("findOwnerModuleOfSink");

test("finds the owning module id for a matching sink name", () => {
    const raw = `
Sink #55
	State: RUNNING
	Name: VencordStreamMix
	Description: VencordStreamMix
	Owner Module: 77
	Driver: module-null-sink.c

Sink #1
	State: RUNNING
	Name: alsa_output.pci-0000_00_1f.3.analog-stereo
	Owner Module: 6
`.trim();

    assert.equal(findOwnerModuleOfSink(raw, "VencordStreamMix"), "77");
});

test("returns null when the sink name does not exist", () => {
    const raw = `
Sink #1
	Name: alsa_output.pci-0000_00_1f.3.analog-stereo
	Owner Module: 6
`.trim();

    assert.equal(findOwnerModuleOfSink(raw, "VencordStreamMix"), null);
});

test("does not false-positive on a name that is a prefix of another sink's name", () => {
    const raw = `
Sink #2
	Name: VencordStreamMixExtra
	Owner Module: 9
`.trim();

    assert.equal(findOwnerModuleOfSink(raw, "VencordStreamMix"), null);
});

// ---------------------------------------------------------------------------

console.log("findModuleIdsByArgument");

test("finds a single module by argument substring", () => {
    const raw = `
Module #10
	Name: module-null-sink
	Argument: sink_name=VencordStreamMix sink_properties=device.description=VencordStreamMix

Module #11
	Name: module-loopback
	Argument: source=VencordStreamMix.monitor sink=alsa_output.pci-0000_00_1f.3.analog-stereo latency_msec=1
`.trim();

    assert.deepEqual(findModuleIdsByArgument(raw, "source=VencordStreamMix.monitor"), ["11"]);
});

test("finds multiple matching modules", () => {
    const raw = `
Module #1
	Argument: source=VencordStreamMix.monitor sink=A

Module #2
	Argument: source=VencordStreamMix.monitor sink=B

Module #3
	Argument: unrelated=true
`.trim();

    assert.deepEqual(findModuleIdsByArgument(raw, "source=VencordStreamMix.monitor"), ["1", "2"]);
});

test("returns an empty array when nothing matches", () => {
    const raw = `
Module #1
	Argument: unrelated=true
`.trim();

    assert.deepEqual(findModuleIdsByArgument(raw, "source=VencordStreamMix.monitor"), []);
});

test("does not false-positive on an argument that is a prefix of another module's argument", () => {
    const raw = `
Module #1
	Argument: source=VencordStreamMixExtra.monitor sink=A
`.trim();

    assert.deepEqual(findModuleIdsByArgument(raw, "source=VencordStreamMix.monitor"), []);
});

test("handles modules with no Argument line at all", () => {
    const raw = `
Module #1
	Name: module-suspend-on-idle
`.trim();

    assert.deepEqual(findModuleIdsByArgument(raw, "anything"), []);
});

// ---------------------------------------------------------------------------

console.log("shortSinksContainsName");

test("finds an exact name match in short sink listing", () => {
    const raw = "1\tVencordStreamMix\t5\tfloat32le 2ch 48000Hz\tRUNNING\n2\talsa_output.pci\t3\tfloat32le 2ch 48000Hz\tIDLE";
    assert.equal(shortSinksContainsName(raw, "VencordStreamMix"), true);
});

test("does not match a name that only contains the target as a substring", () => {
    const raw = "1\tVencordStreamMixBackup\t5\tfloat32le 2ch 48000Hz\tRUNNING";
    assert.equal(shortSinksContainsName(raw, "VencordStreamMix"), false);
});

test("returns false for empty input", () => {
    assert.equal(shortSinksContainsName("", "VencordStreamMix"), false);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
