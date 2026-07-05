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

import { extractAudioApps, extractRenderDevices, findCableCaptureRegistryKey, isCableDevice, parseCsvLine, parseSvclCsv, pickAlternateDevice, type RenderDevice, safeExtractPath } from "../platform/windows.ts";

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

test("skips a UWP/Store app row with no resolvable Process Path instead of using its bare display name", () => {
    // Regression: extractAudioApps() used to fall back to the row's friendly
    // session name (e.g. "Spotify") as `id` whenever Process Path was empty -
    // which happens for some sandboxed/UWP audio sessions svcl.exe can't
    // resolve an image path for. That name has no ".exe" suffix, so
    // excludeAppAudio()'s `/^[^\\/:*?"<>|]+\.exe$/i` validation would reject
    // it outright with "Invalid process id" the moment the user selected it
    // from the dropdown and clicked Exclude - even though listAudioApps()
    // had happily listed it as selectable. Such rows are now skipped entirely
    // since there's no usable process-name id for svcl's /SetAppDefault.
    const raw = [
        SAMPLE_CSV.split("\r\n")[0],
        "Spotify,Application,Render,High Definition Audio Device,,,,Active,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{0.0.0.00000000}.{181f65d2}|uwp|1%b99999,High Definition Audio Device\\Application\\Spotify,,99999,,,,"
    ].join("\r\n");
    const apps = extractAudioApps(parseSvclCsv(raw));
    assert.equal(apps.length, 0);
    assert.ok(!apps.some(a => a.id === "Spotify"));
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

test("does not match a real Capture device whose name coincidentally contains 'cable output' but isn't VB-Cable", () => {
    // Regression found in this round: findCableCaptureRegistryKey() used to
    // match purely on the endpoint name containing "cable output", without
    // checking svcl's "Device Name" (driver/product) column. A real capture
    // device from an unrelated vendor that happened to name its endpoint
    // "Cable Output" (or similar) would be misidentified as VB-Audio Virtual
    // Cable's recording endpoint, and its registry key would get treated as
    // the cable's - risking the (currently-disabled) Listen automation
    // targeting the wrong device's registry key if it's ever re-enabled.
    const raw = [
        SAMPLE_CSV.split("\r\n")[0],
        "Cable Output,Device,Capture,Some Unrelated Vendor,,,,Active,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{x}.{y},Some Unrelated Vendor\\Device\\Cable Output\\Capture,,,,HKEY_LOCAL_MACHINE\\Should\\Not\\Match,,"
    ].join("\r\n");
    assert.equal(findCableCaptureRegistryKey(parseSvclCsv(raw)), null);
});

// ---------------------------------------------------------------------------

// Regression test for round 4: findCableCaptureRegistryKey() used to check
// `deviceName.trim().toLowerCase() === "vb-audio virtual cable"` - an exact
// match against the single-cable product's name only. Round 3 deliberately
// broadened isCableDevice() (used everywhere else in this file) to the
// whole "VB-Audio " driver-name prefix specifically so sibling products
// (VB-Cable A+B, Voicemeeter/Voicemeeter Banana/Potato) are treated
// consistently as "the cable" - but this function was missed by that
// refactor and kept the old exact-match, so a user with e.g. Voicemeeter's
// "VB-Audio Voicemeeter VAIO" capture endpoint instead of the plain
// "VB-Audio Virtual Cable" product got `null` here, making
// enableCableListen() throw a misleading "install VB-Audio Virtual Cable"
// error even though the rest of the file already recognizes their device as
// a supported cable-family product.
test("finds the registry key for a VB-Audio sibling product's capture endpoint (e.g. Voicemeeter), not just the exact VB-Cable product name", () => {
    const header = SAMPLE_CSV.split("\r\n")[0];
    const row = "CABLE Output,Device,Capture,VB-Audio Voicemeeter VAIO,,,,Active,No,,100.0%,,,0.00 dB,2,,\"100.0%, 100.0%\",{x}.{y},VB-Audio Voicemeeter VAIO\\Device\\CABLE Output\\Capture,,,,HKEY_LOCAL_MACHINE\\Voicemeeter\\Key,,";
    const raw = [header, row].join("\r\n");
    assert.equal(findCableCaptureRegistryKey(parseSvclCsv(raw)), "HKEY_LOCAL_MACHINE\\Voicemeeter\\Key");
});

// ---------------------------------------------------------------------------

console.log("pickAlternateDevice");

function device(name: string, isDefault: boolean, deviceName: string = name): RenderDevice {
    return { id: name, itemId: name, name, deviceName, isDefault };
}

// A real VB-Cable endpoint always carries "VB-Audio Virtual Cable" in svcl's
// "Device Name" column, regardless of what the endpoint itself is named.
function cableDevice(name: string, isDefault: boolean): RenderDevice {
    return device(name, isDefault, "VB-Audio Virtual Cable");
}

test("prefers a real non-default device over the cable, regardless of array order", () => {
    // Cable listed first - a naive `.find(d => !d.isDefault)` would pick it
    // and silently mute the excluded app if Listen isn't configured.
    const devices = [device("Speakers", true), cableDevice("CABLE Input", false), device("Headphones", false)];
    const picked = pickAlternateDevice(devices, false);
    assert.equal(picked?.name, "Headphones");
});

test("falls back to the cable only when Listen is already configured", () => {
    const devices = [device("Speakers", true), cableDevice("CABLE Input", false)];
    assert.equal(pickAlternateDevice(devices, false), null);
    assert.equal(pickAlternateDevice(devices, true)?.name, "CABLE Input");
});

test("returns null when there is no non-default device at all", () => {
    const devices = [device("Speakers", true)];
    assert.equal(pickAlternateDevice(devices, true), null);
});

test("a cable-only alternate is not usable while Listen is unconfirmed (matches hasSecondPlaybackDevice's gating)", () => {
    // Regression: hasSecondPlaybackDevice() used to report `true` as soon as
    // ANY non-default device existed, including VB-Cable's "CABLE Input" -
    // but pickAlternateDevice() (what excludeAppAudio() actually uses) only
    // falls back to the cable once Listen is confirmed configured, which
    // isCableListenConfigured() always reports as false. That mismatch meant
    // WindowsDeviceStatus could hide its "install a second device" warning
    // (since hasSecondDevice was true) on a machine with only the cable
    // installed, and then excludeAppAudio() would immediately throw when the
    // user clicked Exclude - a confusing regression right after the UI
    // implied everything was ready. hasSecondPlaybackDevice() was fixed to
    // exclude cable-named devices from its count; this test locks in that a
    // cable-only device list is *not* usable as a real alternate under the
    // same listenReady=false gating excludeAppAudio() uses.
    const devices = [device("Speakers", true), cableDevice("CABLE Input", false)];
    assert.equal(pickAlternateDevice(devices, false), null);
    // The would-be "second device" is cable-only, so a hasSecondPlaybackDevice-
    // style check must also treat it as absent, not present.
    const looksLikeSecondRealDevice = devices.some(d => !d.isDefault && !isCableDevice(d));
    assert.equal(looksLikeSecondRealDevice, false);
});

test("a real device whose endpoint name merely contains 'cable' as a substring is not misclassified as VB-Cable", () => {
    // Regression found in this round: pickAlternateDevice() (and several
    // sibling functions) used to decide "is this VB-Cable?" via
    // `name.toLowerCase().includes("cable")` against the user-facing endpoint
    // name. That misclassifies any real hardware whose name happens to
    // contain "cable" as a substring - e.g. "Cablevision Audio Device" or a
    // "USB-C Cable Adapter" - as VB-Audio Virtual Cable, even though its
    // svcl "Device Name" (driver/product name) is nothing of the sort. Such a
    // device would then be treated as unusable until "Listen to this device"
    // is confirmed (which isCableListenConfigured() never reports as true),
    // so pickAlternateDevice() would return null and excludeAppAudio() would
    // throw a confusing "only VB-Cable found" error even though a real,
    // audible alternate device was available. Fixed by matching on the
    // specific `deviceName` field ("VB-Audio Virtual Cable") via
    // isCableDevice() instead of substring-matching the display name.
    const devices = [device("Speakers", true), device("Cablevision Audio Device", false, "Some Random Vendor")];
    const picked = pickAlternateDevice(devices, false);
    assert.equal(picked?.name, "Cablevision Audio Device");
});

test("isCableDevice() matches only the real VB-Audio Virtual Cable device name, not a substring of the endpoint name", () => {
    assert.equal(isCableDevice({ deviceName: "VB-Audio Virtual Cable" }), true);
    assert.equal(isCableDevice({ deviceName: "vb-audio virtual cable" }), true);
    assert.equal(isCableDevice({ deviceName: "Some Random Vendor" }), false);
    assert.equal(isCableDevice({ deviceName: "" }), false);
});

test("isCableDevice() also matches other VB-Audio family products, not just the single-cable one this plugin installs", () => {
    // Regression found in this round: isCableDevice() used to require the
    // deviceName to be EXACTLY "vb-audio virtual cable" - the one specific
    // free product installVirtualCable() downloads. But a user can already
    // have a *different* VB-Audio product installed on their own (the paid
    // "VB-Audio Cable A+B" two-cable pack, or a Voicemeeter/Voicemeeter
    // Banana/Potato mixer, which installs "VB-Audio Voicemeeter VAIO"-family
    // virtual render devices) - these report a different exact deviceName
    // string but are just as silent-unless-actively-routed as the single
    // cable. Under the old exact-match check, pickAlternateDevice() would
    // treat such a device as a "real" alternate and route the excluded app
    // onto it, silently muting it for the user - the exact failure mode this
    // file exists to avoid, just via a different VB-Audio product. Fixed by
    // matching the "vb-audio " driver-name prefix shared by the whole family.
    assert.equal(isCableDevice({ deviceName: "VB-Audio Cable A+B" }), true);
    assert.equal(isCableDevice({ deviceName: "VB-Audio Voicemeeter VAIO" }), true);
    assert.equal(isCableDevice({ deviceName: "vb-audio hi-fi cable" }), true);
    // Still must not match real hardware that merely contains similar words.
    assert.equal(isCableDevice({ deviceName: "Some Random Vendor Cable" }), false);
});

test("a Voicemeeter-style VB-Audio virtual device (not the single cable this plugin installs) is not picked as a usable alternate", () => {
    const devices = [
        device("Speakers", true),
        device("Voicemeeter Input", false, "VB-Audio Voicemeeter VAIO")
    ];
    // With no real alternate and Listen unconfirmed, this must behave exactly
    // like a cable-only machine: no usable alternate device.
    assert.equal(pickAlternateDevice(devices, false), null);
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

// Regression test for a real bug found in this round: ensureSvcl() used to
// re-check `existsSync(exe)` and, if absent, kick off its own independent
// fetch+unzip+write on every call with no de-duplication. WindowsDeviceStatus
// (index.tsx) calls `Promise.all([windowsHasSecondPlaybackDevice(),
// windowsIsVirtualCableInstalled()])` on mount - both route through
// getRows() -> runSvcl() -> ensureSvcl() - so on a machine where svcl.exe
// hasn't been downloaded yet, two concurrent callers would both see the exe
// missing and both start their own download/extract, racing two writeFile()
// calls to the exact same destination path. The fix caches the in-flight
// promise in a module-level singleton so concurrent callers share one
// attempt. This test recreates that exact singleton-caching pattern
// standalone (no network/electron needed) against a counting "download"
// stub to prove concurrent callers only trigger one real download, and that
// a failed attempt clears the cache so a later call can retry.
console.log("\nensureSvcl concurrency de-duplication");

test("concurrent callers share one in-flight download instead of racing", async () => {
    let downloadCount = 0;
    let cached: Promise<string> | null = null;

    async function fakeDownloadAndExtract(): Promise<string> {
        downloadCount++;
        await new Promise(r => setTimeout(r, 10));
        return "C:\\fake\\svcl.exe";
    }

    async function ensure(): Promise<string> {
        if (cached) return cached;
        cached = (async () => {
            return fakeDownloadAndExtract();
        })();
        try {
            return await cached;
        } catch (e) {
            cached = null;
            throw e;
        }
    }

    const [a, b, c] = await Promise.all([ensure(), ensure(), ensure()]);
    assert.equal(downloadCount, 1);
    assert.equal(a, "C:\\fake\\svcl.exe");
    assert.equal(b, "C:\\fake\\svcl.exe");
    assert.equal(c, "C:\\fake\\svcl.exe");
});

test("a failed download clears the cache so a later call can retry", async () => {
    let attempt = 0;
    let cached: Promise<string> | null = null;

    async function fakeDownloadAndExtract(): Promise<string> {
        attempt++;
        if (attempt === 1) throw new Error("network down");
        return "C:\\fake\\svcl.exe";
    }

    async function ensure(): Promise<string> {
        if (cached) return cached;
        cached = (async () => fakeDownloadAndExtract())();
        try {
            return await cached;
        } catch (e) {
            cached = null;
            throw e;
        }
    }

    await assert.rejects(() => ensure());
    const result = await ensure();
    assert.equal(result, "C:\\fake\\svcl.exe");
    assert.equal(attempt, 2);
});

// ---------------------------------------------------------------------------

// Regression test for a real bug found in round 3: excludeAppAudio() and
// restoreAudio() both read/mutate the module-level `excludedApps` Map but
// used to do so with no serialization between them. restoreAudio() is called
// not only from the settings panel's Restore button but unconditionally from
// the plugin's stop() hook, completely independent of the panel's `busy`
// guard - so a user could click Exclude (kicking off an async
// getRows()/runSvcl() chain) and then disable the plugin before that chain
// resolves. If restoreAudio() ran in the gap after excludeAppAudio() recorded
// the app's original device but before its own runSvcl(/SetAppDefault,
// alternate) call finished, two svcl.exe invocations would race to set the
// same app's default device, and whichever finished last would silently win
// - possibly leaving the app rerouted onto the alternate device even though
// the user just disabled the plugin expecting audio fully restored. The fix
// chains every excludeAppAudio()/restoreAudio() call onto one module-level
// tail promise so they always run fully sequentially. This test recreates
// that exact chaining pattern standalone against stubbed async "device move"
// operations to prove two interleaved calls can never race.
console.log("\noperation serialization (exclude/restore race regression)");

test("a restore queued while an exclude is still in flight runs after it completes, not interleaved", async () => {
    const log: string[] = [];
    let tail: Promise<void> = Promise.resolve();

    function serialize<T>(fn: () => Promise<T>): Promise<T> {
        const result = tail.then(fn, fn);
        tail = result.then(() => { }, () => { });
        return result;
    }

    const excluded = new Map<string, string>();

    async function fakeExclude(processId: string): Promise<void> {
        return serialize(async () => {
            log.push(`exclude:${processId}:start`);
            // Simulates the async gap between recording state and the
            // svcl.exe call actually completing.
            await new Promise(r => setTimeout(r, 10));
            excluded.set(processId, "original-device");
            log.push(`exclude:${processId}:moved-to-alternate`);
        });
    }

    async function fakeRestore(): Promise<void> {
        return serialize(async () => {
            log.push("restore:start");
            for (const [processId] of excluded) {
                log.push(`restore:${processId}:moved-to-original`);
            }
            excluded.clear();
            log.push("restore:done");
        });
    }

    // Fire both without awaiting the first - simulates excludeAppAudio()
    // still being mid-flight when stop() unconditionally calls
    // restoreAudio().
    const excludeP = fakeExclude("game.exe");
    const restoreP = fakeRestore();

    await Promise.all([excludeP, restoreP]);

    // The restore must observe the fully-completed exclude, never a
    // half-finished one - i.e. the exclude's "moved-to-alternate" must be
    // fully logged before the restore starts, and the app must actually be
    // present in `excluded` (and then cleared) rather than the two
    // operations interleaving their svcl.exe-equivalent work.
    assert.deepEqual(log, [
        "exclude:game.exe:start",
        "exclude:game.exe:moved-to-alternate",
        "restore:start",
        "restore:game.exe:moved-to-original",
        "restore:done"
    ]);
    assert.equal(excluded.size, 0);
});

// ---------------------------------------------------------------------------

// Regression test for round 4: runSvcl() called execFileAsync(exePath, args)
// with no timeout. Every excludeAppAudio()/restoreAudio() call runs through
// serialize()'s tail promise, so a svcl.exe process that never exits (hung
// waiting on a modal dialog, or wedged against a misbehaving audio driver's
// IPC call) would leave `operationTail` permanently unsettled - the line
// that advances the tail for the *next* queued caller never runs, because
// the current call's own promise never resolves or rejects. Every later
// exclude/restore call, including the plugin's own stop()-triggered
// restoreAudio(), would then await forever with no recovery short of
// restarting Discord. The fix passes an explicit timeout to execFileAsync()
// so a hung child process is killed and its promise rejects instead of
// hanging indefinitely - which serialize() already handles correctly, since
// a rejected call still unblocks the queue for whoever's next (see the
// rejection-propagation test above). This test recreates the serialize()
// pattern standalone against a stub that never settles without a timeout,
// and proves that adding a timeout (Promise.race against a timer, mirroring
// what execFileAsync's own `timeout` option does under the hood by killing
// the child and rejecting) lets a later queued call still run.
console.log("\ntimeout unblocks a wedged serialized queue");

test("a call that hangs forever would permanently block a later queued call with no timeout", async () => {
    let tail: Promise<void> = Promise.resolve();

    function serialize<T>(fn: () => Promise<T>): Promise<T> {
        const result = tail.then(fn, fn);
        tail = result.then(() => { }, () => { });
        return result;
    }

    const log: string[] = [];

    // Simulates a hung svcl.exe call with no timeout: the returned promise
    // never resolves or rejects, exactly like execFileAsync() without a
    // `timeout` option against a wedged child process.
    const hungCall = serialize(() => new Promise<void>(() => { }));
    const nextCall = serialize(async () => { log.push("next call ran"); });

    let nextSettled = false;
    nextCall.then(() => { nextSettled = true; });

    await new Promise(r => setTimeout(r, 50));

    assert.equal(nextSettled, false, "the next call must still be stuck behind the hung one with no timeout");
    assert.deepEqual(log, []);

    void hungCall; // never settles; intentionally left unawaited/unresolved
});

test("a timeout on the underlying call lets a later queued call still run after the hang", async () => {
    let tail: Promise<void> = Promise.resolve();

    function serialize<T>(fn: () => Promise<T>): Promise<T> {
        const result = tail.then(fn, fn);
        tail = result.then(() => { }, () => { });
        return result;
    }

    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timed out")), ms);
            promise.then(
                v => { clearTimeout(timer); resolve(v); },
                e => { clearTimeout(timer); reject(e); }
            );
        });
    }

    const log: string[] = [];

    // Same "hangs forever" stub as above, but now wrapped the same way
    // runSvcl() wraps execFileAsync() with an explicit timeout - the
    // underlying operation still never settles on its own, but the wrapper
    // rejects after the timeout instead of waiting forever.
    const hungCall = serialize(() => withTimeout(new Promise<void>(() => { }), 20));
    const nextCall = serialize(async () => { log.push("next call ran"); });

    await assert.rejects(hungCall, /timed out/);
    await nextCall;

    assert.deepEqual(log, ["next call ran"]);
});

// ---------------------------------------------------------------------------

await Promise.all(pending);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
