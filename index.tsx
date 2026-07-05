/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Lets you screen-share as usual, but exclude one app's audio (e.g. a
 * game) from Discord's "Share Audio" stream - whatever's left (e.g. your
 * browser) keeps streaming through.
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
import { Button, Forms, LocaleStore, Menu, Modal, openModal, Select, Toasts, useEffect, useState, useStateFromStores } from "@webpack/common";

import type { AudioApp as LinuxAudioApp } from "./platform/linux";
import type { AudioApp as WindowsAudioApp } from "./platform/windows";
import { format, Locale, strings } from "./strings";

// The round icon button used next to Mute/Deafen in the account panel -
// same lookup used by Vencord's own GameActivityToggle plugin.
const AccountPanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const Native = VencordNative.pluginHelpers.StreamAudioRouter as PluginNative<typeof import("./native")>;

/** Follows Discord's own display language - switches this plugin's UI the moment the user changes it in Discord. */
function useT() {
    const locale = useStateFromStores([LocaleStore], () => LocaleStore.locale);
    const key: Locale = locale?.toLowerCase().startsWith("ru") ? "ru" : "en";
    return strings[key];
}

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
    const t = useT();
    const [apps, setApps] = useState<LinuxAudioApp[]>([]);
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
            notifySuccess(t.linuxExcludeSuccess);
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
            notifySuccess(t.linuxRestoreSuccess);
        } catch (e) {
            notifyError(e);
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Forms.FormText>
                {t.linuxDescription}
            </Forms.FormText>
            <Divider className={Margins.top16} />

            {loadError && (
                <Forms.FormText className={Margins.top8} style={{ color: "var(--text-danger)" }}>
                    {loadError}
                </Forms.FormText>
            )}

            {!loadError && apps.length === 0 && (
                <Forms.FormText className={Margins.top8}>
                    {busy ? t.linuxLoadingApps : t.linuxNoApps}
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
                {t.linuxRefreshButton}
            </Button>
            <Button onClick={handleExclude} disabled={busy || !selectedId} color={Button.Colors.GREEN} className={Margins.top8}>
                {t.linuxExcludeButton}
            </Button>
            <Button onClick={handleRestore} disabled={busy} color={Button.Colors.RED} className={Margins.top8}>
                {t.linuxRestoreButton}
            </Button>
        </>
    );
}

/**
 * There used to be an automatic "Configure" button here that wrote the
 * "Listen to this device" registry properties for VB-Cable's recording
 * endpoint. A code review that actually inspected the live Windows
 * registry found the assumed property scheme doesn't match reality and
 * couldn't be reliably distinguished from other unrelated properties -
 * see the long comment above `enableCableListen` in platform/windows.ts.
 * Automating it was disabled rather than risk writing wrong values to a
 * live audio device's registry key, so this is manual-only, honestly.
 */
function WindowsListenStatus() {
    const t = useT();
    return (
        <Forms.FormText className={Margins.top8}>{t.windowsManualListenHeading}</Forms.FormText>
    );
}

function WindowsDeviceStatus() {
    const t = useT();
    const [hasSecondDevice, setHasSecondDevice] = useState<boolean | null>(null);
    const [cableInstalled, setCableInstalled] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [installStarted, setInstallStarted] = useState(false);

    async function check() {
        setHasSecondDevice(null);
        try {
            const [hasSecond, cable] = await Promise.all([
                Native.windowsHasSecondPlaybackDevice(),
                Native.windowsIsVirtualCableInstalled()
            ]);
            setHasSecondDevice(hasSecond);
            setCableInstalled(cable);
        } catch (e) {
            notifyError(e);
            setHasSecondDevice(true); // don't block the rest of the panel on a failed check
        }
    }

    useEffect(() => { check(); }, []);

    async function handleInstall() {
        setInstalling(true);
        try {
            await Native.windowsInstallVirtualCable();
            setInstallStarted(true);
            notifySuccess(t.windowsVirtualCableInstallStarted);
        } catch (e) {
            notifyError(e);
        } finally {
            setInstalling(false);
        }
    }

    if (hasSecondDevice === null) {
        return <Forms.FormText className={Margins.top8}>{t.windowsCheckingDevices}</Forms.FormText>;
    }

    if (hasSecondDevice) return null;

    return (
        <>
            <Forms.FormText className={Margins.top8} style={{ color: "var(--text-danger)" }}>
                {t.windowsOnlyOneDevice}
            </Forms.FormText>
            {cableInstalled ? (
                <Forms.FormText className={Margins.top8}>{t.windowsVirtualCableInstalled}</Forms.FormText>
            ) : (
                <Button onClick={handleInstall} disabled={installing} color={Button.Colors.GREEN} className={Margins.top8}>
                    {t.windowsInstallVirtualCableButton}
                </Button>
            )}
            {(cableInstalled || installStarted) && <WindowsListenStatus />}
            <Divider className={Margins.top16} />
        </>
    );
}

function WindowsPanel() {
    const t = useT();
    const [apps, setApps] = useState<WindowsAudioApp[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    async function refresh() {
        setBusy(true);
        setLoadError(null);
        try {
            const list = await Native.windowsListAudioApps();
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
            await Native.windowsExcludeAppAudio(selectedId);
            notifySuccess(t.windowsExcludeSuccess);
        } catch (e) {
            notifyError(e);
        } finally {
            setBusy(false);
        }
    }

    async function handleRestore() {
        setBusy(true);
        try {
            await Native.windowsRestoreAudio();
            notifySuccess(t.windowsRestoreSuccess);
        } catch (e) {
            notifyError(e);
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Forms.FormText>
                {t.windowsDescription}
            </Forms.FormText>
            <Divider className={Margins.top16} />

            <WindowsDeviceStatus />

            {loadError && (
                <Forms.FormText className={Margins.top8} style={{ color: "var(--text-danger)" }}>
                    {loadError}
                </Forms.FormText>
            )}

            {!loadError && apps.length === 0 && (
                <Forms.FormText className={Margins.top8}>
                    {busy ? t.windowsLoadingApps : t.windowsNoApps}
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
                {t.windowsRefreshButton}
            </Button>
            <Button onClick={handleExclude} disabled={busy || !selectedId} color={Button.Colors.GREEN} className={Margins.top8}>
                {t.windowsExcludeButton}
            </Button>
            <Button onClick={handleRestore} disabled={busy} color={Button.Colors.RED} className={Margins.top8}>
                {t.windowsRestoreButton}
            </Button>

            <Divider className={Margins.top16} />
            <Forms.FormText className={Margins.top8}>
                {t.windowsManualFallbackLabel}
            </Forms.FormText>
            <Button
                onClick={() => Native.windowsOpenAppVolumeSettings().catch(notifyError)}
                color={Button.Colors.PRIMARY}
                className={Margins.top8}
            >
                {t.windowsOpenSettingsButton}
            </Button>
        </>
    );
}

function MacPanel() {
    const t = useT();
    const [installed, setInstalled] = useState<boolean | null>(null);
    // undefined = still loading, null = the native call failed/threw, string = loaded successfully.
    const [installCommand, setInstallCommand] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        Native.macosCheckBlackHole().then(r => setInstalled(r.installed)).catch(() => setInstalled(false));
        Native.macosGetInstallCommand().then(setInstallCommand).catch(() => setInstallCommand(null));
    }, []);

    // Only block the "not found" UI on installCommand while it's genuinely
    // still in flight (undefined). If the native call already failed
    // (null), don't hang on "Checking..." forever - fall through and show
    // the not-found message anyway, just without the exact command text.
    const isChecking = installed === null || (installed === false && installCommand === undefined);
    const notFoundReady = installed === false && installCommand !== undefined;

    return (
        <>
            <Forms.FormText>
                {t.macDescription}
            </Forms.FormText>
            <Divider className={Margins.top16} />

            {isChecking && (
                <Forms.FormText className={Margins.top8}>{t.macChecking}</Forms.FormText>
            )}
            {notFoundReady && (
                <Forms.FormText className={Margins.top8}>
                    {installCommand
                        ? <>{t.macNotFoundPrefix}<code>{installCommand}</code></>
                        : t.macNotFoundNoCommand}
                </Forms.FormText>
            )}
            {installed === true && (
                <Forms.FormText className={Margins.top8}>
                    {t.macInstalled}
                </Forms.FormText>
            )}

            <Divider className={Margins.top16} />
            <Button
                onClick={() => Native.macosOpenAudioMidiSetup().catch(notifyError)}
                color={Button.Colors.PRIMARY}
                className={Margins.top8}
            >
                {t.macOpenAudioMidiButton}
            </Button>
            <Button
                onClick={() => Native.macosOpenSoundSettings().catch(notifyError)}
                color={Button.Colors.PRIMARY}
                className={Margins.top8}
            >
                {t.macOpenSoundSettingsButton}
            </Button>
        </>
    );
}

function SettingsPanel() {
    const t = useT();
    const [platform, setPlatform] = useState<string | null>(null);

    useEffect(() => { Native.getPlatform().then(setPlatform); }, []);

    if (platform === null) return <Forms.FormText>{t.detectingPlatform}</Forms.FormText>;
    if (platform === "linux") return <LinuxPanel />;
    if (platform === "win32") return <WindowsPanel />;
    if (platform === "darwin") return <MacPanel />;

    return <Forms.FormText>{format(t.unsupportedPlatform, { platform: platform ?? "" })}</Forms.FormText>;
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
    description: "Screen-share as usual, but exclude one app's sound (e.g. your game) from Discord's Share Audio - everything else keeps streaming through, and your mic is never touched.",
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

    toolboxActions() {
        const t = useT();
        return (
            <Menu.MenuItem
                id="stream-audio-router-open"
                label={t.toolboxAction}
                action={openRouterModal}
            />
        );
    },

    async stop() {
        // Best-effort cleanup so toggling the plugin off never leaves the
        // user's system audio silently rerouted.
        try {
            const platform = await Native.getPlatform();
            if (platform === "linux") await Native.linuxRestoreAudio();
            if (platform === "win32") await Native.windowsRestoreAudio();
        } catch {
            // Nothing useful to do here - surfacing an error on plugin
            // disable would be more confusing than silent best-effort cleanup.
        }
    }
});
