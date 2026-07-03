/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Linux backend. Uses `pactl` (PulseAudio / PipeWire-Pulse, both share the same
 * CLI) to move a single application's audio stream into a dedicated virtual
 * sink, then points Discord's audio input at that sink's monitor. A loopback
 * module keeps the routed app audible locally, so the user doesn't lose sound
 * on their own end.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export interface AudioApp {
    /** pactl sink-input index, e.g. "42" */
    id: string;
    /** Human readable app/media name, e.g. "Firefox" or "Spotify" */
    name: string;
}

export const VIRTUAL_SINK_NAME = "VencordStreamMix";

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

        const nameMatch =
            block.match(/application\.name\s*=\s*"([^"]*)"/) ??
            block.match(/media\.name\s*=\s*"([^"]*)"/);

        const name = nameMatch?.[1]?.trim();

        apps.push({
            id: idMatch[1],
            name: name && name.length > 0 ? name : `Unknown app (#${idMatch[1]})`
        });
    }

    return apps;
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
 * module whose "Argument:" line contains the given needle.
 * Pure function.
 */
export function findModuleIdsByArgument(raw: string, needle: string): string[] {
    if (!raw) return [];

    const blocks = raw.split(/\r?\n(?=Module #)/g);
    const ids: string[] = [];

    for (const block of blocks) {
        const argMatch = block.match(/Argument:\s*(.*)/);
        if (!argMatch) continue;
        if (!argMatch[1].includes(needle)) continue;

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

/** Remembers the source that was active before we started routing, so we can restore it later. */
let savedDefaultSource: string | null = null;

export async function listAudioApps(): Promise<AudioApp[]> {
    const raw = await pactl(["list", "sink-inputs"]);
    return parseSinkInputs(raw);
}

async function sinkExists(): Promise<boolean> {
    const raw = await pactl(["list", "short", "sinks"]);
    return raw.split("\n").some(line => line.includes(VIRTUAL_SINK_NAME));
}

async function ensureVirtualSink(): Promise<void> {
    if (await sinkExists()) return;

    await pactl([
        "load-module",
        "module-null-sink",
        `sink_name=${VIRTUAL_SINK_NAME}`,
        `sink_properties=device.description=${VIRTUAL_SINK_NAME}`
    ]);
}

async function ensureLoopback(): Promise<void> {
    const modulesRaw = await pactl(["list", "modules"]);
    const existing = findModuleIdsByArgument(modulesRaw, `source=${VIRTUAL_SINK_NAME}.monitor`);
    if (existing.length > 0) return;

    const defaultSink = (await pactl(["get-default-sink"])).trim();
    if (!defaultSink) throw new Error("Could not determine the default output sink.");

    await pactl([
        "load-module",
        "module-loopback",
        `source=${VIRTUAL_SINK_NAME}.monitor`,
        `sink=${defaultSink}`,
        "latency_msec=1"
    ]);
}

/**
 * Moves the given app's audio stream into the virtual sink and points
 * Discord's audio input (default source) at that sink's monitor.
 * Safe to call multiple times / for multiple apps in a row.
 */
export async function routeAppAudio(sinkInputId: string): Promise<void> {
    assertNumericId(sinkInputId, "sink input id");

    if (savedDefaultSource === null) {
        savedDefaultSource = (await pactl(["get-default-source"])).trim() || null;
    }

    await ensureVirtualSink();
    await ensureLoopback();

    await pactl(["move-sink-input", sinkInputId, VIRTUAL_SINK_NAME]);
    await pactl(["set-default-source", `${VIRTUAL_SINK_NAME}.monitor`]);
}

/**
 * Undoes everything: restores the previous default audio source and tears
 * down the virtual sink + loopback module. Looks modules up by name/argument
 * instead of relying on in-memory state, so it still works correctly after
 * a Discord restart or plugin reload.
 */
export async function restoreAudio(): Promise<void> {
    if (savedDefaultSource) {
        await pactl(["set-default-source", savedDefaultSource]).catch(() => { });
        savedDefaultSource = null;
    }

    const modulesRaw = await pactl(["list", "modules"]).catch(() => "");
    const loopbackIds = findModuleIdsByArgument(modulesRaw, `source=${VIRTUAL_SINK_NAME}.monitor`);
    for (const id of loopbackIds) {
        await pactl(["unload-module", id]).catch(() => { });
    }

    const sinksRaw = await pactl(["list", "sinks"]).catch(() => "");
    const nullSinkModuleId = findOwnerModuleOfSink(sinksRaw, VIRTUAL_SINK_NAME);
    if (nullSinkModuleId) {
        await pactl(["unload-module", nullSinkModuleId]).catch(() => { });
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
