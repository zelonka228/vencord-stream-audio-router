/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Lets you screen-share one window/app (e.g. a game) while Discord's voice
 * "microphone" input is actually the audio of a *different* app (e.g. your
 * browser). Discord itself ties shared-window audio to the shared window, so
 * this plugin works around that by routing audio at the OS level instead of
 * patching Discord's screen share picker (which uses obfuscated internals
 * that change across Discord updates - routing audio outside of Discord is
 * far more reliable long-term).
 *
 * Workflow:
 *   1. Open Vencord Settings -> Plugins -> StreamAudioRouter (this panel).
 *   2. Pick the app whose audio you want Discord to hear, click "Route".
 *   3. Start your screen share as normal (share the game window/screen).
 *   4. In Discord's Voice & Video settings, set Input Device to the
 *      suggested virtual device (Linux does this automatically for you).
 *   5. When done, click "Reset" to undo the routing and go back to normal.
 *
 * Platform support is not equal, because the underlying OS audio APIs are
 * not equal - see platform/linux.ts, platform/windows.ts and
 * platform/macos.ts for a per-OS explanation of exactly what is and isn't
 * automated.
 */

import { definePluginSettings } from "@api/Settings";
import { Divider } from "@components/Divider";
import { Margins } from "@utils/margins";
import definePlugin, { PluginNative } from "@utils/types";
import { Button, Forms, Select, Toasts, useEffect, useState } from "@webpack/common";

import type { AudioApp } from "./platform/linux";

const Native = VencordNative.pluginHelpers.StreamAudioRouter as PluginNative<typeof import("./native")>;

const VIRTUAL_SINK_NAME = "VencordStreamMix";

function notifySuccess(message: string) {
    Toasts.show({
        message,
        id: Toasts.genId(),
        type: Toasts.Type.SUCCESS
    });
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function notifyError(err: unknown) {
    Toasts.show({
        message: errorMessage(err),
        id: Toasts.genId(),
        type: Toasts.Type.FAILURE
    });
}

function LinuxPanel() {
    const [apps, setApps] = useState<AudioApp[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    async function refresh() {
        setBusy(true);
        setLoadError(null);
        try {
            const list = await Native.linuxListAudioApps();
            setApps(list);
            setSelectedId(prev => {
                if (list.length === 0) return null;
                if (prev && list.some(a => a.id === prev)) return prev;
                return list[0].id;
            });
        } catch (e) {
            setLoadError(errorMessage(e));
            setApps([]);
            setSelectedId(null);
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => { refresh(); }, []);

    async function handleRoute() {
        if (!selectedId) return;
        setBusy(true);
        try {
            await Native.linuxRouteAppAudio(selectedId);
            notifySuccess(
                `Routed. In Discord's Voice & Video settings, set Input Device to "Monitor of ${VIRTUAL_SINK_NAME}" (only needs to be done once).`
            );
        } catch (e) {
            notifyError(e);
        } finally {
            setBusy(false);
        }
    }

    async function handleRestore() {
        setBusy(true);
        try {
            await Native.linuxRestoreAudio();
            notifySuccess("Audio routing reset back to normal.");
        } catch (e) {
            notifyError(e);
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Forms.FormText>
                Pick the app whose audio Discord should hear, then click Route. Share your game/window as normal afterwards - the audio stays independent of whatever window you share.
            </Forms.FormText>
            <Divider className={Margins.top16} />

            {loadError && (
                <Forms.FormText className={Margins.top8} style={{ color: "var(--text-danger)" }}>
                    {loadError}
                </Forms.FormText>
            )}

            {!loadError && apps.length === 0 && (
                <Forms.FormText className={Margins.top8}>
                    {busy ? "Loading audio apps..." : "No apps are currently playing audio. Start playback in the app you want (e.g. your browser), then click Refresh."}
                </Forms.FormText>
            )}

            {apps.length > 0 && (
                <Select
                    className={Margins.top8}
                    options={apps.map(a => ({ label: a.name, value: a.id }))}
                    isSelected={v => v === selectedId}
                    select={v => setSelectedId(v)}
                    serialize={v => v}
                />
            )}

            <Divider className={Margins.top16} />
            <Button onClick={refresh} disabled={busy} color={Button.Colors.PRIMARY} className={Margins.top8}>
                Refresh app list
            </Button>
            <Button onClick={handleRoute} disabled={busy || !selectedId} color={Button.Colors.GREEN} className={Margins.top8}>
                Route selected app's audio
            </Button>
            <Button onClick={handleRestore} disabled={busy} color={Button.Colors.RED} className={Margins.top8}>
                Reset to normal audio
            </Button>
        </>
    );
}

function WindowsPanel() {
    return (
        <>
            <Forms.FormText>
                Windows already supports per-app output devices natively - no extra software needed. Open the settings page below, then set your game to your headphones/speakers and point the app whose audio you want Discord to hear at a separate device (e.g. a virtual cable such as VB-Cable), and pick that same device as Discord's Input Device.
            </Forms.FormText>
            <Divider className={Margins.top16} />
            <Button
                onClick={() => Native.windowsOpenAppVolumeSettings().catch(notifyError)}
                color={Button.Colors.PRIMARY}
                className={Margins.top8}
            >
                Open "App volume and device preferences"
            </Button>
        </>
    );
}

function MacPanel() {
    const [installed, setInstalled] = useState<boolean | null>(null);

    useEffect(() => {
        Native.macosCheckBlackHole().then(r => setInstalled(r.installed)).catch(() => setInstalled(false));
    }, []);

    return (
        <>
            <Forms.FormText>
                macOS has no built-in per-app audio routing. The standard free solution is BlackHole, a virtual audio driver.
            </Forms.FormText>
            <Divider className={Margins.top16} />

            {installed === null && <Forms.FormText className={Margins.top8}>Checking for BlackHole...</Forms.FormText>}
            {installed === false && (
                <Forms.FormText className={Margins.top8}>
                    BlackHole not found. Install it with Homebrew, then restart Discord: <code>brew install blackhole-2ch</code>
                </Forms.FormText>
            )}
            {installed === true && (
                <Forms.FormText className={Margins.top8}>
                    BlackHole is installed. Open Audio MIDI Setup to build a Multi-Output Device (BlackHole + your speakers), then in the app whose audio you want to share, pick BlackHole as its output device. Set Discord's Input Device to BlackHole.
                </Forms.FormText>
            )}

            <Divider className={Margins.top16} />
            <Button
                onClick={() => Native.macosOpenAudioMidiSetup().catch(notifyError)}
                color={Button.Colors.PRIMARY}
                className={Margins.top8}
            >
                Open Audio MIDI Setup
            </Button>
            <Button
                onClick={() => Native.macosOpenSoundSettings().catch(notifyError)}
                color={Button.Colors.PRIMARY}
                className={Margins.top8}
            >
                Open Sound Settings
            </Button>
        </>
    );
}

function SettingsPanel() {
    const [platform, setPlatform] = useState<string | null>(null);

    useEffect(() => { Native.getPlatform().then(setPlatform); }, []);

    if (platform === null) return <Forms.FormText>Detecting platform...</Forms.FormText>;
    if (platform === "linux") return <LinuxPanel />;
    if (platform === "win32") return <WindowsPanel />;
    if (platform === "darwin") return <MacPanel />;

    return <Forms.FormText>Unsupported platform: {platform}</Forms.FormText>;
}

const settings = definePluginSettings({});

export default definePlugin({
    name: "StreamAudioRouter",
    description: "Screen-share one app/window while Discord captures a different app's audio (e.g. share a game, stream your browser's music).",
    tags: ["Voice", "Media"],
    authors: [
        { name: "zelonka228", id: 0n }
    ],

    settings,

    settingsAboutComponent: SettingsPanel,

    async stop() {
        // Best-effort cleanup so toggling the plugin off never leaves the
        // user's system audio silently rerouted.
        try {
            const platform = await Native.getPlatform();
            if (platform === "linux") await Native.linuxRestoreAudio();
        } catch {
            // Nothing useful to do here - surfacing an error on plugin
            // disable would be more confusing than silent best-effort cleanup.
        }
    }
});
