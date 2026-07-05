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
    buildRestoreAudioError,
    findModuleIdsByArgument,
    findOwnerModuleIdOfShortSink,
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

test("handles emoji and RTL text in application names", () => {
    const raw = `
Sink Input #1
	Properties:
		application.name = "Firefox 🔥🎮"

Sink Input #2
	Properties:
		application.name = "لعبة"
`.trim();

    const result = parseSinkInputs(raw);
    assert.equal(result[0].name, "Firefox 🔥🎮");
    assert.equal(result[1].name, "لعبة");
});

test("an app cannot inject a fabricated extra Sink Input block via an embedded literal newline in its name", () => {
    // Regression: pactl does not escape embedded literal newlines inside
    // quoted property values (it only escapes embedded quotes/backslashes).
    // A malicious/buggy app can set its own application.name / media.name
    // property (fully self-reported, e.g. via libpulse's pa_proplist) to a
    // string containing a real "\n" followed by text that looks exactly
    // like a whole new "Sink Input #<n>" block - including an attacker-
    // chosen id. The naive line-based block splitter used to treat that
    // embedded text as a genuine second block, producing a fabricated
    // AudioApp entry with a DIFFERENT id than the real sink input it came
    // from. Worst case: the fabricated id collides with a real sink input's
    // id elsewhere in the same listing, so two entries share one id and the
    // user can no longer trust which entry's label corresponds to which
    // underlying stream - "Exclude" could then silently act on the wrong
    // app. The quote-aware splitter must keep the injected text as part of
    // its OWN block (id 3) and must not spawn a second entry for id 42 that
    // shadows/duplicates the real one.
    const raw = `
Sink Input #3
	Properties:
		application.name = "Evil
Sink Input #42
	Properties:
		application.name = "Injected""

Sink Input #42
	Properties:
		application.name = "RealApp"
`.trim();

    const result = parseSinkInputs(raw);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(a => a.id), ["3", "42"]);
    // The id "42" entry must be the REAL one, not the injected impostor -
    // and no entry may contain a raw embedded newline (control characters
    // are stripped from displayed names as defense in depth).
    assert.equal(result[1].name, "RealApp");
    assert.ok(!result[0].name.includes("\n"));
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

test("refuses to pick a module id when a sink name is ambiguous (multiple blocks claim it), even across a blank-line boundary", () => {
    // Regression: unlike application.name/media.name, bare fields such as
    // Description: are printed by pactl completely unescaped - not even
    // embedded literal newlines are escaped. Something that feeds into a
    // sink's description (e.g. a Bluetooth device's self-advertised name)
    // is attacker-influenced (or just weird/malformed, no attacker needed).
    // A crafted description containing a real "\n" followed by text shaped
    // like "Sink #<n>\n\tName: <target>\n\tOwner Module: <bogus id>" fabricates
    // an entire extra "Sink #" block that never really existed on the server.
    //
    // A tempting "fix" is to only treat "Sink #" as a real boundary when it's
    // preceded by a blank line, since genuine pactl output always separates
    // top-level entries that way. That is NOT sufficient: the attacker fully
    // controls the injected text, including any blank line(s) they choose to
    // put before their fake header - "Description: Evil Device\n\nSink
    // #999\n..." satisfies the blank-line heuristic just as well as a real
    // boundary would, so that check alone can be bypassed trivially.
    //
    // The invariant that can't be spoofed away: the server enforces unique
    // sink names, so a legitimate listing can never contain two real "Sink #"
    // blocks both claiming the same Name. Whenever more than one block does
    // (whether or not a blank line precedes the suspicious one), the input is
    // inherently inconsistent and must not be trusted - refuse (return null)
    // rather than guess, so restoreAudio() simply skips unloading anything
    // instead of risking unloading an attacker-chosen module id.
    const withAttackerSuppliedBlankLine = `
Sink #1
	Name: bluez_output.AA_BB
	Description: Evil Device

Sink #999
	Name: VencordExcludedAudio
	Owner Module: 31337

Sink #2
	Name: VencordExcludedAudio
	Owner Module: 6
`.trim();
    assert.equal(findOwnerModuleOfSink(withAttackerSuppliedBlankLine, "VencordExcludedAudio"), null);

    const withoutBlankLine = `
Sink #1
	Name: bluez_output.AA_BB
	Description: Evil Device
Sink #999
	Name: VencordExcludedAudio
	Owner Module: 31337

Sink #2
	Name: VencordExcludedAudio
	Owner Module: 6
`.trim();
    assert.equal(findOwnerModuleOfSink(withoutBlankLine, "VencordExcludedAudio"), null);
});

test("does not false-positive on an unrelated field whose value happens to CONTAIN 'Owner Module: <n>' (no fake extra block needed)", () => {
    // Regression (round 4): the "Owner Module:" match used to be a plain,
    // unanchored `block.match(/Owner Module:\s*(\d+)/)`. `Description:` (like
    // `Name:`, checked above) is a bare, unescaped field that pactl prints
    // verbatim - it can come from attacker/hardware-influenced sources (e.g.
    // a Bluetooth device's self-advertised name). Unlike the fabricated-
    // extra-block attacks tested elsewhere, this doesn't even need an
    // embedded newline or a second block: a description whose text simply
    // CONTAINS the literal substring "Owner Module: 31337" anywhere on its
    // own line, inside ONE single genuine "Sink #" block, used to be enough
    // to fool the unanchored regex into reporting that fake id instead of
    // the block's real "Owner Module:" line - causing restoreAudio() (via
    // findOwnerModuleOfSink, if ever reintroduced as a live lookup) to
    // unload an attacker-chosen module id instead of the sink's real owner.
    const raw = `
Sink #55
	State: RUNNING
	Name: VencordExcludedAudio
	Description: Fake Owner Module: 31337
	Owner Module: 77
	Driver: module-null-sink.c
`.trim();

    assert.equal(findOwnerModuleOfSink(raw, "VencordExcludedAudio"), "77");
});

test("an embedded-newline injection landing INSIDE the real block (not as a fully separate fake block) must not steal the real Owner Module line", () => {
    // Regression (round 5): `findOwnerModuleOfSink` still splits blocks with
    // the naive, non-quote-aware `raw.split(/\r?\n(?=Sink #)/g)` - unlike
    // parseSinkInputs/findModuleIdsByArgument, there's no quoting on these
    // bare fields to even be "aware" of. The existing ambiguous-block
    // regression test above only covers the case where the injected text
    // becomes a fully self-contained fake block (fake Name + fake Owner
    // Module both inside the fabricated block), which correctly produces 2
    // matches and refuses. But if the injected "\nSink #999\nName:
    // <target>\nOwner Module: <fake id>" is placed inside a free-text field
    // (e.g. Description) that appears BEFORE the real block's own trailing
    // "Owner Module:" line, the naive split slices the real block in two:
    // the real "Owner Module:" line ends up stranded after the fabricated
    // "Sink #999" header instead of stapled to the real block. Because the
    // old code used a non-global `.match()` (first occurrence only), it
    // found only ONE "Owner Module:" line total - the attacker-chosen fake
    // one, which appears first - and never even noticed the real line, so
    // the "more than one match -> refuse" ambiguity guard never triggered.
    // It must instead collect every "Owner Module:" line and refuse.
    const raw =
        "Sink #3\n\tName: RealSink\n\tDescription: fake\r\nSink #999\r\nName: RealSink\r\nOwner Module: 1337\n\tOwner Module: 5\n";

    assert.equal(findOwnerModuleOfSink(raw, "RealSink"), null);
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

test("a module cannot inject a fabricated extra Module block via an embedded literal newline in a free-text property", () => {
    // Regression (round 3): like sink-inputs' application.name/media.name,
    // a module's Properties: block can hold free-text values (e.g.
    // module.description, which for something like a Bluetooth-backed
    // module can mirror a device's self-advertised name) that pactl escapes
    // the same way - embedded quotes/backslashes are escaped, an embedded
    // LITERAL newline is not. findModuleIdsByArgument used to split blocks
    // with a naive `raw.split(/\r?\n(?=Module #)/g)` (not quote-aware, unlike
    // parseSinkInputs' splitBlocksQuoteAware), so a crafted module.description
    // containing "\nModule #999\n\tArgument: source=<needle>...\n" fabricated
    // an entire extra "Module #" block with an attacker-chosen id that never
    // really existed - which could collide with a real, unrelated module's id
    // elsewhere in the listing and cause callers to unload-module the wrong,
    // legitimate module. The fix reuses splitBlocksQuoteAware (a still-open
    // quote keeps a header-looking line from ever being treated as a real
    // block boundary) plus an anchored `^Module #(\d+)/m` id match, so the
    // fabricated text - if it survives the merge - is at worst attributed
    // back to the block it actually came from, never to an unrelated real id.
    const raw = `
Module #5
	Name: module-null-sink
	Properties:
		module.description = "Evil
Module #999
	Name: module-loopback
	Argument: source=VencordExcludedAudio.monitor sink=VencordExcludedAudio"

Module #7
	Name: module-loopback
	Argument: source=VencordExcludedAudio.monitor sink=real_speakers
`.trim();

    const result = findModuleIdsByArgument(raw, "source=VencordExcludedAudio.monitor");
    // Must find the real loopback (7) and must NOT contain the fabricated,
    // attacker-chosen id "999".
    assert.deepEqual(result, ["7"]);
});

test("an injected fake Module block cannot collide with a real, unrelated module's id", () => {
    // Regression (round 3), collision variant: the fabricated block's chosen
    // id can be crafted to match a REAL, wholly unrelated module elsewhere in
    // the same listing (e.g. the user's actual bluetooth-policy module). If
    // findModuleIdsByArgument's id extraction were still unanchored
    // (`Module #(\d+)` searched anywhere in the block), it could report that
    // colliding id - and a caller would then unload-module the real,
    // unrelated module instead of anything to do with this plugin. With the
    // fix, any injected text that survives the quote-aware merge is always
    // attributed to the block it's physically embedded in (module 5 here),
    // never to module 10's separate, real block.
    const raw = `
Module #5
	Name: module-null-sink
	Properties:
		module.description = "Evil
Module #10
	Name: module-loopback
	Argument: source=VencordExcludedAudio.monitor sink=SOME_FAKE_TARGET"

Module #10
	Name: module-bluetooth-policy
	Argument: real unrelated legitimate bluetooth module, nothing to do with us
`.trim();

    const result = findModuleIdsByArgument(raw, "source=VencordExcludedAudio.monitor");
    // The injected "Argument:" line is inside a quoted property value, so
    // stripQuotedContent blanks it out before matching - it must not be
    // treated as a real Argument line at all (for module 5 or anyone else),
    // and "10" (the real, unrelated bluetooth-policy module) must never
    // appear in the result.
    assert.deepEqual(result, []);
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

console.log("findOwnerModuleIdOfShortSink");

test("finds the owning module id for a matching sink name in short-list format", () => {
    const raw = "1\tVencordExcludedAudio\t42\tfloat32le 2ch 48000Hz\tRUNNING\n2\talsa_output.pci\t3\tfloat32le 2ch 48000Hz\tIDLE";
    assert.equal(findOwnerModuleIdOfShortSink(raw, "VencordExcludedAudio"), "42");
});

test("returns null when the sink name does not exist in short-list format", () => {
    const raw = "1\talsa_output.pci\t3\tfloat32le 2ch 48000Hz\tIDLE";
    assert.equal(findOwnerModuleIdOfShortSink(raw, "VencordExcludedAudio"), null);
});

test("returns null for empty input", () => {
    assert.equal(findOwnerModuleIdOfShortSink("", "VencordExcludedAudio"), null);
});

test("cannot be fooled by a fabricated 'Description'-style injection, unlike the verbose-format lookup", () => {
    // restoreAudio() switched from findOwnerModuleOfSink (parses verbose
    // `pactl list sinks`, which contains free-text fields like Description:
    // that pactl prints completely unescaped - including a real embedded
    // newline, so a Bluetooth device's self-advertised name could smuggle in
    // text shaped like a fake extra "Sink #" entry) to this function, which
    // parses `pactl list short sinks` instead. That format has no free-text
    // column at all: name and module id are both restricted to pactl's own
    // safe identifier charset, so there is nothing for an attacker/hostile
    // device to inject a fake row's worth of tab-separated fields into. A
    // literal tab character can't sneak into the name/module columns the way
    // a literal newline could sneak into a verbose Description value.
    const raw = "1\tVencordExcludedAudio\t42\tfloat32le 2ch 48000Hz\tRUNNING";
    assert.equal(findOwnerModuleIdOfShortSink(raw, "VencordExcludedAudio"), "42");
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

console.log("buildRestoreAudioError / restoreAudio failure surfacing");

test("returns null (no error) when nothing failed", () => {
    assert.equal(buildRestoreAudioError([]), null);
});

test("restoreAudio must not silently report success when a pactl step actually failed", () => {
    // Regression (round 4): restoreAudio() used to swallow every pactl
    // failure via unconditional `.catch(() => {})`, including the very first
    // `pactl list modules` lookup. If pactl was genuinely failing - e.g.
    // transiently unreachable under heavy system load, or a PipeWire hiccup -
    // restoreAudio() would resolve successfully having done NOTHING, and
    // index.tsx's handleRestore shows an unconditional "Audio restored"
    // success toast the moment the promise resolves. The user would be told
    // the null-sink/loopback routing was torn down when it's actually still
    // fully active. restoreAudio() now collects a message per failed step and
    // throws via buildRestoreAudioError when any step failed, so the toast
    // (which calls notifyError on a thrown rejection) reflects reality
    // instead of always claiming success.
    const err = buildRestoreAudioError(["could not list modules: pactl timed out"]);
    assert.ok(err instanceof Error);
    assert.match(err!.message, /did not fully complete/);
    assert.match(err!.message, /could not list modules: pactl timed out/);
});

test("aggregates multiple independent step failures into one message", () => {
    const err = buildRestoreAudioError([
        "could not unload loopback module 11: pactl timed out",
        "could not unload excluded sink module 5: pactl timed out"
    ]);
    assert.ok(err instanceof Error);
    assert.match(err!.message, /loopback module 11/);
    assert.match(err!.message, /excluded sink module 5/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
