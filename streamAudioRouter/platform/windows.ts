/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Windows backend.
 *
 * Honest scope note: Windows has no public, dependency-free API that lets an
 * Electron/Node process silently reassign a single running app's audio
 * output device. Windows 10 (1803+) and Windows 11 DO ship this feature
 * natively though - "App volume and device preferences" - it lets you pin
 * any running app to a specific output/input device, and Windows remembers
 * the choice per-app afterwards. So instead of reimplementing that badly
 * with a bundled native addon, this backend just opens that exact settings
 * page for the user via the `ms-settings:` URI scheme, which every Windows
 * 10/11 install supports out of the box - no extra installs required.
 *
 * Same strategy as the Linux backend: move the app you DON'T want heard
 * (e.g. the game) to a non-default output device, leave everything you DO
 * want heard (e.g. the browser) on the system default, then use Discord's
 * own "Share Audio" screen-share toggle - it captures the default device.
 * The microphone is never touched, so voice chat is completely unaffected.
 */

import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

/** Opens Settings > System > Sound > "App volume and device preferences". */
export async function openAppVolumeSettings(): Promise<void> {
    try {
        // `start` is a cmd.exe builtin, not an executable, so it must be run through cmd.
        // The empty "" title argument avoids `start` misinterpreting the URI as a window title.
        await exec('start "" ms-settings:apps-volumes');
    } catch (e: any) {
        throw new Error(`Could not open Windows sound settings: ${e?.message ?? e}`);
    }
}

export async function isSupported(): Promise<boolean> {
    return process.platform === "win32";
}
