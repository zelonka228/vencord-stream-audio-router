/*
 * StreamAudioRouter for Vencord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Minimal EN/RU dictionary for the plugin's own UI text. Discord's own
 * strings (buttons, menus, etc.) already localize themselves - this only
 * covers text this plugin renders itself. Locale is picked up from
 * Discord's own LocaleStore, so switching Discord's language switches this
 * plugin's UI too, with no user-facing setting of its own.
 */

export type Locale = "en" | "ru";

export const strings = {
    en: {
        detectingPlatform: "Detecting platform...",
        unsupportedPlatform: "Unsupported platform: {platform}",

        linuxDescription: "Pick the app you DON'T want Discord to hear (e.g. your game), then click Exclude. It keeps playing normally through your speakers - it's just taken off the system default output, which is what Discord's \"Share Audio\" screen-share toggle captures. Everything else (e.g. your browser) is what gets streamed. Your microphone is never touched.",
        linuxLoadingApps: "Loading audio apps...",
        linuxNoApps: "No apps are currently playing audio. Start playback in the app you want to exclude (e.g. your game), then click Refresh.",
        linuxRefreshButton: "Refresh app list",
        linuxExcludeButton: "Exclude selected app from stream audio",
        linuxRestoreButton: "Include back / reset to normal",
        linuxExcludeSuccess: "Done. Enable Discord's own \"Share Audio\" toggle when you start your screen share - it'll only pick up whatever's left on your default output. Your mic is untouched.",
        linuxRestoreSuccess: "Audio routing reset back to normal.",

        windowsDescription: "Pick the app you DON'T want Discord to hear (e.g. your game), then click Exclude. Windows has no built-in virtual audio device, so this only works if you have at least two real playback devices (e.g. speakers + a headset) - it moves the app to whichever one isn't your current default, so you can still hear it on that device. Your microphone is never touched.",
        windowsLoadingApps: "Loading audio apps...",
        windowsNoApps: "No apps are currently playing audio. Start playback in the app you want to exclude (e.g. your game), then click Refresh.",
        windowsRefreshButton: "Refresh app list",
        windowsExcludeButton: "Exclude selected app from stream audio",
        windowsRestoreButton: "Include back / reset to normal",
        windowsExcludeSuccess: "Done. Enable Discord's own \"Share Audio\" toggle when you start your screen share - it'll only pick up whatever's left on your default device. Your mic is untouched.",
        windowsRestoreSuccess: "Audio routing reset back to normal.",
        windowsManualFallbackLabel: "Prefer to do it yourself instead? Open Windows' own settings page:",
        windowsOpenSettingsButton: "Open \"App volume and device preferences\"",
        windowsCheckingDevices: "Checking your playback devices...",
        windowsOnlyOneDevice: "Only one playback device found - there's nowhere to move an excluded app while still letting you hear it. Install a free virtual audio cable to get a second destination:",
        windowsVirtualCableInstalled: "VB-Audio Virtual Cable is installed and ready to use as the second device.",
        windowsInstallVirtualCableButton: "Download and install VB-Audio Virtual Cable",
        windowsInstallingVirtualCable: "Downloading and launching the installer - approve the Windows admin prompt, then follow the setup wizard...",
        windowsVirtualCableInstallStarted: "Installer launched. Finish the setup wizard, then restart your PC - VB-Cable needs a reboot to fully register.",
        windowsManualListenHeading: "One remaining step so you can still hear an excluded app - this has to be done by hand, since its registry format couldn't be reliably verified: open Windows Sound Settings → Recording tab → \"CABLE Output\" → Properties → Listen tab → check \"Listen to this device\" → set the playback device to your real headphones/speakers.",

        macDescription: "macOS has no per-app default output device, and most games don't expose their own output picker - so the reliable lever here is redirecting the app you DO want Discord to hear (usually your browser, since many browsers let you pick a playback device). The standard free tool for that is BlackHole, a virtual audio driver.",
        macChecking: "Checking for BlackHole...",
        macNotFoundPrefix: "BlackHole not found. Install it with Homebrew, then restart Discord: ",
        macNotFoundNoCommand: "BlackHole not found. Install it with Homebrew (run \"brew install blackhole-2ch\" in Terminal), then restart Discord.",
        macInstalled: "BlackHole is installed. Open Audio MIDI Setup to build a Multi-Output Device (BlackHole + your speakers) so you still hear it locally, then in your browser's own output picker choose that Multi-Output Device. Finally, make that same device your Mac's system default output (Sound Settings), and enable Discord's \"Share Audio\" toggle when screen sharing - it captures the default output, i.e. your browser. Your microphone stays completely separate.",
        macOpenAudioMidiButton: "Open Audio MIDI Setup",
        macOpenSoundSettingsButton: "Open Sound Settings",

        toolboxAction: "Open StreamAudioRouter"
    },
    ru: {
        detectingPlatform: "Определение платформы...",
        unsupportedPlatform: "Платформа не поддерживается: {platform}",

        linuxDescription: "Выбери приложение, звук которого НЕ должен попасть в трансляцию (например, игру), и нажми «Исключить». Оно продолжит нормально играть через твои колонки — оно просто убирается с системного вывода по умолчанию, а именно его захватывает тумблер Discord «Share Audio» при демонстрации экрана. Всё остальное (например, браузер) попадёт в трансляцию. Микрофон никогда не трогается.",
        linuxLoadingApps: "Загрузка списка приложений...",
        linuxNoApps: "Сейчас ни одно приложение не воспроизводит звук. Запусти звук в приложении, которое хочешь исключить (например, в игре), затем нажми «Обновить список».",
        linuxRefreshButton: "Обновить список приложений",
        linuxExcludeButton: "Исключить выбранное приложение из звука трансляции",
        linuxRestoreButton: "Вернуть как было",
        linuxExcludeSuccess: "Готово. Включи штатный тумблер Discord «Share Audio», когда начнёшь демонстрацию экрана — он захватит только то, что осталось на выводе по умолчанию. Микрофон не тронут.",
        linuxRestoreSuccess: "Маршрутизация звука сброшена к обычному состоянию.",

        windowsDescription: "Выбери приложение, звук которого НЕ должен попасть в трансляцию (например, игру), и нажми «Исключить». В Windows нет встроенного виртуального аудио-устройства, поэтому это работает только если у тебя есть минимум два реальных устройства вывода (например, колонки + гарнитура) — приложение переносится на то, которое сейчас не является устройством по умолчанию, так что ты всё ещё услышишь его через него. Микрофон никогда не трогается.",
        windowsLoadingApps: "Загрузка списка приложений...",
        windowsNoApps: "Сейчас ни одно приложение не воспроизводит звук. Запусти звук в приложении, которое хочешь исключить (например, в игре), затем нажми «Обновить список».",
        windowsRefreshButton: "Обновить список приложений",
        windowsExcludeButton: "Исключить выбранное приложение из звука трансляции",
        windowsRestoreButton: "Вернуть как было",
        windowsExcludeSuccess: "Готово. Включи штатный тумблер Discord «Share Audio», когда начнёшь демонстрацию экрана — он захватит только то, что осталось на устройстве по умолчанию. Микрофон не тронут.",
        windowsRestoreSuccess: "Маршрутизация звука сброшена к обычному состоянию.",
        windowsManualFallbackLabel: "Предпочитаешь сделать вручную? Открой штатную страницу настроек Windows:",
        windowsOpenSettingsButton: "Открыть «Громкость приложений и параметры устройств»",
        windowsCheckingDevices: "Проверка устройств воспроизведения...",
        windowsOnlyOneDevice: "Найдено только одно устройство воспроизведения — переносить исключённое приложение некуда так, чтобы ты его всё ещё слышал. Поставь бесплатный виртуальный аудио-кабель, чтобы получить второе устройство:",
        windowsVirtualCableInstalled: "VB-Audio Virtual Cable установлен и готов к использованию как второе устройство.",
        windowsInstallVirtualCableButton: "Скачать и установить VB-Audio Virtual Cable",
        windowsInstallingVirtualCable: "Скачиваю и запускаю установщик — подтверди запрос Windows на права администратора, затем пройди мастер установки...",
        windowsVirtualCableInstallStarted: "Установщик запущен. Заверши мастер установки, затем перезагрузи ПК — VB-Cable требует перезагрузку, чтобы полностью зарегистрироваться.",
        windowsManualListenHeading: "Остался один шаг, чтобы ты продолжал слышать исключённое приложение — сделать его нужно руками, так как формат реестра не удалось достоверно проверить: открой настройки звука Windows → вкладка «Запись» → «CABLE Output» → Свойства → вкладка «Прослушать» → включи «Прослушать с данного устройства» → выбери в качестве устройства воспроизведения свои реальные наушники/колонки.",

        macDescription: "В macOS нет вывода по умолчанию для отдельных приложений, а у большинства игр нет собственного выбора устройства вывода — поэтому надёжнее перенаправить именно то приложение, звук которого нужен Discord (обычно браузер, так как у браузеров чаще есть свой выбор устройства воспроизведения). Стандартный бесплатный инструмент для этого — BlackHole, виртуальный аудио-драйвер.",
        macChecking: "Проверка наличия BlackHole...",
        macNotFoundPrefix: "BlackHole не найден. Установи его через Homebrew, затем перезапусти Discord: ",
        macNotFoundNoCommand: "BlackHole не найден. Установи его через Homebrew (выполни \"brew install blackhole-2ch\" в Terminal), затем перезапусти Discord.",
        macInstalled: "BlackHole установлен. Открой Audio MIDI Setup и собери Multi-Output Device (BlackHole + твои колонки), чтобы всё ещё слышать звук локально, затем в собственном селекторе вывода браузера выбери это устройство. Наконец, сделай это же устройство системным выводом по умолчанию (настройки звука) и включи тумблер Discord «Share Audio» при демонстрации экрана — он захватит вывод по умолчанию, то есть браузер. Микрофон остаётся полностью отдельным.",
        macOpenAudioMidiButton: "Открыть Audio MIDI Setup",
        macOpenSoundSettingsButton: "Открыть настройки звука",

        toolboxAction: "Открыть StreamAudioRouter"
    }
} as const satisfies Record<Locale, Record<string, string>>;

export function format(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
