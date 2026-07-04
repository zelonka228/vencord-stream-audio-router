/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Lets you screen-share one window/app (e.g. a game) while Discord's
 * "Share Audio" stream captures a *different* app's audio (e.g. your
 * browser's music) instead of the game's own sound.
 *
 * This works entirely through Discord's own built-in "Share Audio" /
 * "Stream With Audio" toggle (shown when you start a screen share) - that
 * toggle captures whatever plays through your system's default audio
 * output. So instead of patching Discord's screen share picker (which uses
 * obfuscated internals that change across updates, and can't be tested
 * without a live Discord instance), this plugin just makes sure the app you
 * DON'T want heard (e.g. the game) is moved off the default output, onto a
 * separate device it still plays through locally. Whatever's left on the
 * default output (e.g. your browser) is what Discord ends up streaming.
 *
 * Crucially, this never touches the microphone/voice input. Your voice and
 * the shared audio are two completely separate channels on Discord's side,
 * so the routed audio can never drown out or interfere with you talking.
 *
 * Workflow:
 *   1. Open Vencord Settings -> Plugins -> StreamAudioRouter (this panel).
 *   2. Pick the app you DON'T want Discord to hear (e.g. your game), click
 *      Exclude.
 *   3. Start your screen share as normal (share the game window/screen).
 *   4. Enable Discord's own "Share Audio" / "Stream With Audio" checkbox in
 *      the share settings - it now only captures your browser (or whatever
 *      else is still on the default output).
 *   5. When done, click "Include back" to undo and go back to normal.
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
import { RenderModalProps } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, Forms, Modal, openModal, Select, Toasts, useEffect, useState } from "@webpack/common";

import type { AudioApp } from "./platform/linux";

// The round icon button used next to Mute/Deafen in the account panel -
// same lookup used by Vencord's own GameActivityToggle plugin.
const AccountPanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const Native = VencordNative.pluginHelpers.StreamAudioRouter as PluginNative<typeof import("./native")>;

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

    async function handleExclude() {
        if (!selectedId) return;
        setBusy(true);
        try {
            await Native.linuxExcludeAppAudio(selectedId);
            notifySuccess(
                "Done. Enable Discord's own \"Share Audio\" toggle when you start your screen share - it'll only pick up whatever's left on your default output. Your mic is untouched."
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
                Pick the app you DON'T want Discord to hear (e.g. your game), then click Exclude. It keeps playing normally through your speakers - it's just taken off the system default output, which is what Discord's "Share Audio" screen-share toggle captures. Everything else (e.g. your browser) is what gets streamed. Your microphone is never touched.
            </Forms.FormText>
            <Divider className={Margins.top16} />

            {loadError && (
                <Forms.FormText className={Margins.top8} style={{ color: "var(--text-danger)" }}>
                    {loadError}
                </Forms.FormText>
            )}

            {!loadError && apps.length === 0 && (
                <Forms.FormText className={Margins.top8}>
                    {busy ? "Loading audio apps..." : "No apps are currently playing audio. Start playback in the app you want to exclude (e.g. your game), then click Refresh."}
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
            <Button onClick={handleExclude} disabled={busy || !selectedId} color={Button.Colors.GREEN} className={Margins.top8}>
                Exclude selected app from stream audio
            </Button>
            <Button onClick={handleRestore} disabled={busy} color={Button.Colors.RED} className={Margins.top8}>
                Include back / reset to normal
            </Button>
        </>
    );
}

function WindowsPanel() {
    return (
        <>
            <Forms.FormText>
                Windows already supports per-app output devices natively - no extra software needed. Open the settings page below, pin your game to your headphones/speakers directly (choose a specific device instead of "Default"), and leave the app you want Discord to hear (e.g. your browser) on "Default". Then, when you start your screen share, enable Discord's own "Share Audio" / "Stream With Audio" checkbox - it captures the default device, which is now just your browser. Your microphone is untouched, so voice chat keeps working normally.
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
                macOS has no per-app default output device, and most games don't expose their own output picker - so the reliable lever here is redirecting the app you DO want Discord to hear (usually your browser, since many browsers let you pick a playback device). The standard free tool for that is BlackHole, a virtual audio driver.
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
                    BlackHole is installed. Open Audio MIDI Setup to build a Multi-Output Device (BlackHole + your speakers) so you still hear it locally, then in your browser's own output picker choose that Multi-Output Device. Finally, make that same device your Mac's system default output (Sound Settings), and enable Discord's "Share Audio" toggle when screen sharing - it captures the default output, i.e. your browser. Your microphone stays completely separate.
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

function RouterIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm-2.5-9v2.06A7.002 7.002 0 0 1 19 12a7 7 0 0 1-5 6.94V21a9 9 0 0 0 0-17Z"
            />
        </svg>
    );
}

function RouterModal(props: RenderModalProps) {
    return (
        <Modal {...props} title="StreamAudioRouter">
            <SettingsPanel />
        </Modal>
    );
}

function openRouterModal() {
    openModal(props => <RouterModal {...props} />);
}

/** Quick-access button shown next to Mute/Deafen - opens the same panel as Settings, without navigating there. */
function AccountPanelToolButton(props: { nameplate?: any; }) {
    return (
        <AccountPanelButton
            tooltipText="StreamAudioRouter"
            icon={RouterIcon}
            role="button"
            plated={props?.nameplate != null}
            onClick={openRouterModal}
        />
    );
}

const settings = definePluginSettings({});

export default definePlugin({
    name: "StreamAudioRouter",
    description: "Screen-share one app/window while Discord's Share Audio captures a different app's sound (e.g. share a game, stream your browser's music) - without touching your mic.",
    tags: ["Voice", "Media"],
    authors: [
        { name: "zelonka228", id: 0n }
    ],

    settings,

    settingsAboutComponent: SettingsPanel,

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.AccountPanelToolButton(arguments[0]),"
            }
        }
    ],

    AccountPanelToolButton,

    toolboxActions: {
        "Open StreamAudioRouter": openRouterModal
    },

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
