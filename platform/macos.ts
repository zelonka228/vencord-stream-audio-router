/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * macOS backend.
 *
 * Honest scope note: Core Audio has no per-app default output device concept
 * at the OS level (unlike Windows), and Apple does not expose a public API
 * for silently rerouting another process's audio without a virtual audio
 * driver. The standard, widely used, free solution is BlackHole - a virtual
 * audio driver you install once via Homebrew. This backend can detect
 * whether it's installed and open the relevant system panels, but the actual
 * "route this one app's output to BlackHole" step has to happen in that
 * app's own audio output picker (many apps, e.g. Chrome via a device
 * picker extension, Spotify, VLC, QuickTime, expose one) or via macOS's
 * built-in Audio MIDI Setup for system-wide routing - there is no
 * general-purpose per-app switch macOS will let a third-party script flip.
 */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";

const exec = promisify(execFile);

const BLACKHOLE_DRIVER_PATHS = [
    "/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver",
    "/Library/Audio/Plug-Ins/HAL/BlackHole16ch.driver"
];

export async function checkBlackHole(): Promise<{ installed: boolean; }> {
    const installed = BLACKHOLE_DRIVER_PATHS.some(p => existsSync(p));
    return { installed };
}

export function getInstallCommand(): string {
    return "brew install blackhole-2ch";
}

/** Opens Audio MIDI Setup, where the user can build a Multi-Output Device combining BlackHole + their speakers. */
export async function openAudioMidiSetup(): Promise<void> {
    try {
        await exec("open", ["-a", "Audio MIDI Setup"]);
    } catch (e: any) {
        throw new Error(`Could not open Audio MIDI Setup: ${e?.message ?? e}`);
    }
}

/** Opens System Settings > Sound, as a fallback entry point. */
export async function openSoundSettings(): Promise<void> {
    try {
        await exec("open", ["x-apple.systempreferences:com.apple.preference.sound"]);
    } catch (e: any) {
        throw new Error(`Could not open Sound settings: ${e?.message ?? e}`);
    }
}

export async function isSupported(): Promise<boolean> {
    return process.platform === "darwin";
}
