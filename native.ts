/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Runs in Discord's Electron main process (full Node access). Every exported
 * function here becomes callable from the plugin's renderer code as
 * `VencordNative.pluginHelpers.StreamAudioRouter.<name>(...)`.
 * The first parameter (an IpcMainInvokeEvent) is injected automatically by
 * Vencord and is intentionally unused here, hence the leading underscore.
 */

import type { IpcMainInvokeEvent } from "electron";

import * as linux from "./platform/linux";
import * as macos from "./platform/macos";
import * as windows from "./platform/windows";

export async function getPlatform(_: IpcMainInvokeEvent) {
    return process.platform as "linux" | "win32" | "darwin" | string;
}

// ---- Linux ----------------------------------------------------------------

export async function linuxIsSupported(_: IpcMainInvokeEvent) {
    return linux.isSupported();
}

export async function linuxListAudioApps(_: IpcMainInvokeEvent) {
    return linux.listAudioApps();
}

export async function linuxExcludeAppAudio(_: IpcMainInvokeEvent, sinkInputId: string) {
    return linux.excludeAppAudio(sinkInputId);
}

export async function linuxRestoreAudio(_: IpcMainInvokeEvent) {
    return linux.restoreAudio();
}

// ---- Windows ----------------------------------------------------------------

export async function windowsOpenAppVolumeSettings(_: IpcMainInvokeEvent) {
    return windows.openAppVolumeSettings();
}

export async function windowsListAudioApps(_: IpcMainInvokeEvent) {
    return windows.listAudioApps();
}

export async function windowsExcludeAppAudio(_: IpcMainInvokeEvent, processId: string) {
    return windows.excludeAppAudio(processId);
}

export async function windowsRestoreAudio(_: IpcMainInvokeEvent) {
    return windows.restoreAudio();
}

export async function windowsHasSecondPlaybackDevice(_: IpcMainInvokeEvent) {
    return windows.hasSecondPlaybackDevice();
}

export async function windowsIsVirtualCableInstalled(_: IpcMainInvokeEvent) {
    return windows.isVirtualCableInstalled();
}

export async function windowsInstallVirtualCable(_: IpcMainInvokeEvent) {
    return windows.installVirtualCable();
}

export async function windowsIsCableListenConfigured(_: IpcMainInvokeEvent) {
    return windows.isCableListenConfigured();
}

export async function windowsEnableCableListen(_: IpcMainInvokeEvent) {
    return windows.enableCableListen();
}

// ---- macOS ----------------------------------------------------------------

export async function macosCheckBlackHole(_: IpcMainInvokeEvent) {
    return macos.checkBlackHole();
}

export async function macosGetInstallCommand(_: IpcMainInvokeEvent) {
    return macos.getInstallCommand();
}

export async function macosOpenAudioMidiSetup(_: IpcMainInvokeEvent) {
    return macos.openAudioMidiSetup();
}

export async function macosOpenSoundSettings(_: IpcMainInvokeEvent) {
    return macos.openSoundSettings();
}
