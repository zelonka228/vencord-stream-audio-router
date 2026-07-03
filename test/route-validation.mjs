import assert from "node:assert/strict";
import { excludeAppAudio } from "../platform/linux.ts";

// Malicious/garbage ids must be rejected BEFORE any shell command runs,
// so even on a machine without pactl this must throw synchronously-ish
// (rejected promise) and never attempt to spawn a process.
const badIds = ["1; rm -rf /", "abc", "", " ", "12abc", "-1", "1.5", "$(whoami)"];

for (const id of badIds) {
    try {
        await excludeAppAudio(id);
        throw new Error(`Expected excludeAppAudio(${JSON.stringify(id)}) to reject`);
    } catch (e) {
        assert.match(e.message, /Invalid sink input id/);
        console.log(`  ok - rejected bad id ${JSON.stringify(id)}`);
    }
}

console.log("\nAll bad-id validation tests passed");
