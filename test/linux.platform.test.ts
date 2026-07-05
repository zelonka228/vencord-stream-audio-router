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

test("unescapes embedded quotes/backslashes pactl escapes in property values", () => {
    const raw = `
Sink Input #8
	Properties:
		application.name = "He said \\"Hi\\""
`.trim();

    const result = parseSinkInputs(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "He said \"Hi\"");
});

test("ignores unrelated leading noise before the first block", () => {
    const raw = "Some unrelated warning line\nSink Input #10\n\tProperties:\n\t\tapplication.name = \"OBS\"";
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

test("does not false-positive on an unrelated field whose value happens to end in 'Name: <target>'", () => {
    // Regression: the "Name:" match used to only anchor on `\s*$`, so a
    // *different* field (e.g. Description) whose text incidentally ends in
    // "Name: VencordStreamMix" would satisfy the old unanchored regex and
    // report that earlier, unrelated sink's Owner Module instead of the real
    // one - restoreAudio() would then unload the wrong module.
    const raw = `
Sink #1
	State: RUNNING
	Name: alsa_output.foo
	Description: My Device Name: VencordStreamMix
	Owner Module: 6

Sink #2
	State: RUNNING
	Name: VencordStreamMix
	Owner Module: 55
`.trim();

    assert.equal(findOwnerModuleOfSink(raw, "VencordStreamMix"), "55");
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

test("handles a module with an empty Argument line without bleeding into the next line", () => {
    // Real pactl prints a bare "Argument: " (trailing space, no value) for
    // modules loaded with no arguments, e.g. module-suspend-on-idle. The next
    // line's text must never be picked up as the argument value.
    const raw = `
Module #1
	Name: module-suspend-on-idle
	Argument:
	Usage counter: n/a

Module #2
	Name: module-loopback
	Argument: source=VencordStreamMix.monitor sink=A
`.trim();

    assert.deepEqual(findModuleIdsByArgument(raw, "source=VencordStreamMix.monitor"), ["2"]);
    assert.deepEqual(findModuleIdsByArgument(raw, "Usage counter: n/a"), []);
});

test("handles CRLF line endings without bleeding an empty Argument into the next line", () => {
    const raw = "Module #1\r\n\tArgument: source=VencordStreamMix.monitor sink=A\r\n\r\n" +
        "Module #2\r\n\tArgument: \r\n\tUsage counter: n/a\r\n";

    assert.deepEqual(findModuleIdsByArgument(raw, "source=VencordStreamMix.monitor"), ["1"]);
});

test("handles modules with no Argument line at all", () => {
    const raw = `
Module #1
	Name: module-suspend-on-idle
`.trim();

    assert.deepEqual(findModuleIdsByArgument(raw, "anything"), []);
});

test("a loopback pointed at the excluded sink itself is detectable as self-referential", () => {
    // Regression: ensureLocalLoopback() looks up "already pointed at the
    // current default sink" via findModuleIdsByArgument(modulesRaw,
    // `sink=${defaultSink}`). If get-default-sink ever reports the plugin's
    // OWN hidden null-sink as the system default (e.g. the real output
    // device got unplugged while a stale sink from a previous crashed/
    // improperly-restored session was still loaded, and PipeWire fell back
    // to it), the naive "sink=" lookup happily matches a loopback whose
    // source AND sink both name the excluded sink - a self-feedback loopback
    // that plays nothing anywhere. ensureLocalLoopback() now special-cases
    // defaultSink === EXCLUDED_SINK_NAME and throws instead of wiring this.
    // This test locks in that the raw string-matching building block used to
    // detect that condition actually fires for this exact argument shape.
    const raw = `
Module #1
	Name: module-loopback
	Argument: source=VencordExcludedAudio.monitor sink=VencordExcludedAudio latency_msec=1
`.trim();

    const bySource = findModuleIdsByArgument(raw, "source=VencordExcludedAudio.monitor");
    const bySelfSink = findModuleIdsByArgument(raw, "sink=VencordExcludedAudio");
    assert.deepEqual(bySource, ["1"]);
    assert.deepEqual(bySelfSink, ["1"]);
    // Same module id shows up both ways - proof the old code would have
    // treated this self-loopback as "a valid loopback already targeting the
    // current default" and returned early instead of refusing to proceed.
});

test("can detect a loopback whose source matches but whose sink target has changed (stale after default-sink switch)", () => {
    // Regression: ensureLocalLoopback() must not treat a loopback that still
    // points at an OLD default sink as "already set up" - it needs to notice
    // the sink= argument no longer matches the CURRENT default sink so it can
    // tear down and recreate. This test exercises the two lookups it combines.
    const raw = `
Module #5
	Name: module-loopback
	Argument: source=VencordExcludedAudio.monitor sink=old_headphones latency_msec=1
`.trim();

    const bySource = findModuleIdsByArgument(raw, "source=VencordExcludedAudio.monitor");
    assert.deepEqual(bySource, ["5"]);

    // The user switched their default sink to "new_speakers" - module #5 should
    // NOT be found when searching by the new sink argument, proving it's stale.
    const byNewSink = findModuleIdsByArgument(raw, "sink=new_speakers");
    assert.deepEqual(byNewSink, []);

    // But it should be found by the sink it actually still targets.
    const byOldSink = findModuleIdsByArgument(raw, "sink=old_headphones");
    assert.deepEqual(byOldSink, ["5"]);
});

test("distinguishes a stale duplicate loopback from a current one when both are loaded at once", () => {
    // Regression: if two loopback modules already exist (e.g. a leftover from
    // a crash, or manual pactl use) - one pointed at an old sink, one at the
    // current default - ensureLocalLoopback() must be able to tell them apart
    // by id so it only tears down the stale one and keeps the current one,
    // rather than treating "any match" as "everything is fine".
    const raw = `
Module #1
	Name: module-loopback
	Argument: source=VencordExcludedAudio.monitor sink=old_sink latency_msec=1

Module #2
	Name: module-loopback
	Argument: source=VencordExcludedAudio.monitor sink=new_sink latency_msec=1
`.trim();

    const existing = findModuleIdsByArgument(raw, "source=VencordExcludedAudio.monitor");
    assert.deepEqual(existing, ["1", "2"]);

    const currentDefaultIds = new Set(findModuleIdsByArgument(raw, "sink=new_sink"));
    assert.deepEqual([...currentDefaultIds], ["2"]);

    const stale = existing.filter(id => !currentDefaultIds.has(id));
    assert.deepEqual(stale, ["1"]);
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
