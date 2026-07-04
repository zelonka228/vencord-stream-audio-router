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

        windowsDescription: "Windows already supports per-app output devices natively - no extra software needed. Open the settings page below, pin your game to your headphones/speakers directly (choose a specific device instead of \"Default\"), and leave the app you want Discord to hear (e.g. your browser) on \"Default\". Then, when you start your screen share, enable Discord's own \"Share Audio\" / \"Stream With Audio\" checkbox - it captures the default device, which is now just your browser. Your microphone is untouched, so voice chat keeps working normally.",
        windowsOpenSettingsButton: "Open \"App volume and device preferences\"",

        macDescription: "macOS has no per-app default output device, and most games don't expose their own output picker - so the reliable lever here is redirecting the app you DO want Discord to hear (usually your browser, since many browsers let you pick a playback device). The standard free tool for that is BlackHole, a virtual audio driver.",
        macChecking: "Checking for BlackHole...",
        macNotFoundPrefix: "BlackHole not found. Install it with Homebrew, then restart Discord: ",
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

        windowsDescription: "В Windows уже есть встроенный выбор устройства вывода для каждого приложения — ничего дополнительно ставить не нужно. Открой страницу настроек ниже, закрепи игру за наушниками/колонками напрямую (выбери конкретное устройство вместо «По умолчанию»), а приложение, звук которого должен слышать Discord (например, браузер), оставь на «По умолчанию». Затем при демонстрации экрана включи штатный чекбокс Discord «Share Audio» / «Demonstrate audio» — он захватит устройство по умолчанию, то есть теперь только браузер. Микрофон не трогается, голосовой чат работает как обычно.",
        windowsOpenSettingsButton: "Открыть «Громкость приложений и параметры устройств»",

        macDescription: "В macOS нет вывода по умолчанию для отдельных приложений, а у большинства игр нет собственного выбора устройства вывода — поэтому надёжнее перенаправить именно то приложение, звук которого нужен Discord (обычно браузер, так как у браузеров чаще есть свой выбор устройства воспроизведения). Стандартный бесплатный инструмент для этого — BlackHole, виртуальный аудио-драйвер.",
        macChecking: "Проверка наличия BlackHole...",
        macNotFoundPrefix: "BlackHole не найден. Установи его через Homebrew, затем перезапусти Discord: ",
        macInstalled: "BlackHole установлен. Открой Audio MIDI Setup и собери Multi-Output Device (BlackHole + твои колонки), чтобы всё ещё слышать звук локально, затем в собственном селекторе вывода браузера выбери это устройство. Наконец, сделай это же устройство системным выводом по умолчанию (настройки звука) и включи тумблер Discord «Share Audio» при демонстрации экрана — он захватит вывод по умолчанию, то есть браузер. Микрофон остаётся полностью отдельным.",
        macOpenAudioMidiButton: "Открыть Audio MIDI Setup",
        macOpenSoundSettingsButton: "Открыть настройки звука",

        toolboxAction: "Открыть StreamAudioRouter"
    }
} as const satisfies Record<Locale, Record<string, string>>;

export function format(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
