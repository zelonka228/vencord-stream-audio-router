<div align="center">

# StreamAudioRouter

**A Vencord plugin: share one app/window's video while Discord captures a *different* app's audio.**
**Плагин для Vencord: транслируешь окно одного приложения — а звук Discord слышит от другого.**

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)](#how-it-works-per-os--как-это-работает-по-ос)

[Русский ниже ⤵](#-русская-версия)

</div>

---

## 🇬🇧 English

### The problem

When you share a specific window in Discord, its audio (if any) is what
gets shared. There's no built-in way to say "show *this* window, but send
*that* app's sound" — e.g. stream a game while Discord picks up your
browser's music instead of the game's SFX.

### The fix

This plugin decouples video and audio by rerouting audio **at the OS
level**, completely outside of Discord. You keep sharing whatever
window/screen you want in the normal Discord UI — the plugin only changes
which audio Discord's microphone input actually captures.

It does **not** patch Discord's own screen-share picker. That component is
built from obfuscated, frequently-changing internals, and injecting into it
would be fragile and unverifiable across updates. Routing audio outside of
Discord is more reliable and, frankly, the only part actually testable
without a live, unstable target to patch against.

### How it works, per OS

Audio APIs are not the same across operating systems, so this plugin does
not pretend they are — each backend automates exactly as much as the OS
actually allows.

| OS | Automation | What happens |
|---|---|---|
| **Linux** | Fully automatic | Uses `pactl` (PulseAudio / PipeWire-Pulse) to move the chosen app's stream into a virtual sink, points Discord's audio input at that sink's monitor, and loops the audio back to your speakers so you still hear it. |
| **Windows** | One click, native | Windows 10/11 already has per-app output device selection built in ("App volume and device preferences"). The plugin opens that exact page. No drivers, no installs. |
| **macOS** | Guided | Core Audio has no per-app routing API a script can drive silently. The plugin detects [BlackHole](https://github.com/ExistentialAudio/BlackHole) and opens Audio MIDI Setup / Sound Settings so you can finish the last manual step yourself. |

#### Linux walkthrough

1. Open **Vencord Settings → Plugins → StreamAudioRouter**.
2. Play audio in the app you want Discord to capture (e.g. a browser tab).
3. Click **Refresh app list**, pick that app, click **Route selected app's audio**.
4. In Discord's **Voice & Video → Input Device**, choose `Monitor of VencordStreamMix` (one-time setup).
5. Start your screen share as usual (share the game/window you actually want visible).
6. When done, click **Reset to normal audio**.

Under the hood: creates a `VencordStreamMix` null-sink → moves the chosen
app's stream into it → loops the sink's monitor back to your real output
(so you still hear it) → points the system default source at the monitor.
"Reset" looks modules up **by name**, not remembered IDs, so it recovers
correctly even after a Discord restart mid-session.

#### Windows walkthrough

Click **Open "App volume and device preferences"**. Pin your game to your
headphones and route the other app to a separate device (e.g. a virtual
cable) that you also select as Discord's Input Device.

#### macOS walkthrough

```bash
brew install blackhole-2ch
```

Then use the plugin's buttons to open Audio MIDI Setup (build a
Multi-Output Device with BlackHole + your speakers) and Sound Settings.
Point the source app's own output picker at BlackHole, set BlackHole as
Discord's Input Device.

### Installation

This is a Vencord **userplugin** — built from source, not from the plugin store.

```bash
git clone https://github.com/Vencord/Vencord
cd Vencord
mkdir -p src/userplugins
git clone https://github.com/zelonka228/vencord-stream-audio-router src/userplugins/streamAudioRouter

pnpm install
pnpm build
pnpm inject
```

Or grab `streamAudioRouter.zip` from [Releases](../../releases), extract it
into `Vencord/src/userplugins/`, then `pnpm build && pnpm inject`.

Restart Discord and enable **StreamAudioRouter** under Vencord Settings → Plugins.

### Repo layout

```
streamAudioRouter/
├── index.tsx              # renderer: settings UI, OS detection, buttons
├── native.ts               # Electron main-process bridge (IPC)
└── platform/
    ├── linux.ts            # pactl automation + pure, unit-tested parsers
    ├── windows.ts           # opens native Windows per-app audio settings
    └── macos.ts             # BlackHole detection + Audio MIDI Setup helpers
test/
├── linux.platform.test.ts   # unit tests for the pactl output parsers
├── route-validation.mjs      # rejects malformed/malicious sink input ids
└── syntax-check.mjs           # sanity-loads every platform module
```

### Verification

This code has been:
- Unit tested (18 tests covering the `pactl` output parsers: quoted names,
  missing properties, CRLF, multiple blocks, name-prefix collisions).
- Tested against 8 injection-style malformed ids to confirm they're
  rejected before any shell command runs.
- **Type-checked with `tsc --noEmit` against the real Vencord source tree**
  (zero errors) and **linted with Vencord's own ESLint config** (zero
  errors) — this caught two real bugs during review: an invalid
  `Forms.FormText.Types.DESCRIPTION` API call and an invalid plugin `tags`
  value, both fixed.
- **Built end-to-end with Vencord's real esbuild pipeline** and confirmed
  present in the compiled bundle.

What could *not* be verified here: actually running `pactl` against a live
PulseAudio/PipeWire server, or exercising the plugin inside a running
Discord client — that requires a real Linux/Windows/macOS desktop with
Discord installed. Test it end-to-end after installing, and open an issue
with the error message if something doesn't work as documented.

```bash
node test/linux.platform.test.ts
node test/route-validation.mjs
node test/syntax-check.mjs
```

### License

GPL-3.0-or-later, matching Vencord's own license.

---

## 🇷🇺 Русская версия

### Проблема

Когда ты демонстрируешь конкретное окно в Discord, вместе с ним передаётся
и его звук (если есть). Штатного способа сказать "покажи вот это окно, но
передай звук другого приложения" — нет. Например: транслируешь игру, а
Discord должен слышать музыку из браузера, а не звуки игры.

### Решение

Плагин разделяет видео и звук, перенаправляя звук **на уровне
операционной системы**, полностью в обход Discord. Ты продолжаешь
демонстрировать нужное окно/экран как обычно в интерфейсе Discord — плагин
меняет только то, какой звук реально попадает во "вход микрофона" Discord.

Плагин **не патчит** встроенное окно выбора демонстрации Discord — этот
компонент построен на обфусцированном коде, который часто меняется, и
патчить его без возможности живого тестирования было бы ненадёжно.
Маршрутизация звука в обход Discord надёжнее и, честно говоря, единственная
часть, которую вообще можно проверить без нестабильной цели для патчинга.

### Как это работает по ОС

Аудио-API в разных ОС устроены принципиально по-разному, поэтому плагин не
делает вид, что это не так — каждый бэкенд автоматизирует ровно столько,
сколько реально позволяет система.

| ОС | Автоматизация | Что происходит |
|---|---|---|
| **Linux** | Полностью автоматически | Через `pactl` (PulseAudio / PipeWire-Pulse) переносит поток выбранного приложения в виртуальный sink, направляет вход звука Discord на монитор этого sink, и зацикливает звук обратно на колонки, чтобы ты сам его тоже слышал. |
| **Windows** | Одна кнопка, штатная функция ОС | В Windows 10/11 уже есть выбор устройства вывода для каждого приложения ("Громкость приложений и параметры устройств"). Плагин просто открывает нужную страницу. Без драйверов и установок. |
| **macOS** | С подсказками | У Core Audio нет API для тихой маршрутизации звука по приложениям. Плагин определяет, установлен ли [BlackHole](https://github.com/ExistentialAudio/BlackHole), и открывает Audio MIDI Setup / настройки звука, чтобы ты сам завершил последний шаг вручную. |

#### Инструкция для Linux

1. Открой **Настройки Vencord → Plugins → StreamAudioRouter**.
2. Запусти воспроизведение звука в нужном приложении (например, вкладка браузера).
3. Нажми **Refresh app list**, выбери приложение, нажми **Route selected app's audio**.
4. В Discord → **Голос и видео → Устройство ввода** выбери `Monitor of VencordStreamMix` (нужно один раз).
5. Запусти демонстрацию экрана как обычно (то окно/игру, которую действительно хочешь показать).
6. По завершении нажми **Reset to normal audio**.

Под капотом: создаётся виртуальный sink `VencordStreamMix` → в него
переносится поток выбранного приложения → его монитор зацикливается
обратно на реальный вывод (чтобы звук не пропал у тебя) → системный
источник по умолчанию переключается на этот монитор. Кнопка "Reset" ищет
модули **по имени**, а не по запомненному ID — поэтому корректно
восстанавливает состояние даже после перезапуска Discord посреди сессии.

#### Инструкция для Windows

Нажми **Open "App volume and device preferences"**. Закрепи игру за
наушниками, а звук нужного приложения направь на отдельное устройство
(например, виртуальный кабель), которое также выбери как устройство ввода
в Discord.

#### Инструкция для macOS

```bash
brew install blackhole-2ch
```

Дальше через кнопки плагина открой Audio MIDI Setup (собери Multi-Output
Device из BlackHole + твоих колонок) и настройки звука. В самом приложении
выбери BlackHole как устройство вывода, а в Discord — как устройство ввода.

### Установка

Это **userplugin** для Vencord — собирается из исходников, не через магазин плагинов.

```bash
git clone https://github.com/Vencord/Vencord
cd Vencord
mkdir -p src/userplugins
git clone https://github.com/zelonka228/vencord-stream-audio-router src/userplugins/streamAudioRouter

pnpm install
pnpm build
pnpm inject
```

Либо скачай `streamAudioRouter.zip` со страницы [Releases](../../releases),
распакуй в `Vencord/src/userplugins/`, затем `pnpm build && pnpm inject`.

Перезапусти Discord и включи **StreamAudioRouter** в Vencord Settings → Plugins.

### Структура репозитория

```
streamAudioRouter/
├── index.tsx              # рендер: UI настроек, определение ОС, кнопки
├── native.ts               # мост в главный процесс Electron (IPC)
└── platform/
    ├── linux.ts            # автоматизация через pactl + чистые протестированные парсеры
    ├── windows.ts           # открывает штатные настройки звука Windows
    └── macos.ts             # проверка BlackHole + помощники Audio MIDI Setup
test/
├── linux.platform.test.ts   # юнит-тесты парсеров вывода pactl
├── route-validation.mjs      # отклоняет некорректные/вредоносные id
└── syntax-check.mjs           # проверяет, что все platform-модули загружаются
```

### Проверка

Код прошёл:
- Юнит-тесты (18 тестов на парсеры вывода `pactl`: кавычки в именах,
  отсутствующие поля, CRLF, несколько блоков, коллизии по префиксу имени).
- Проверку на 8 вариантах вредоносных/некорректных id — все отклоняются
  до того, как выполняется хоть одна команда в shell.
- **Проверку типов через `tsc --noEmit` на реальном исходном дереве
  Vencord** (0 ошибок) и **линтинг конфигом ESLint самого Vencord**
  (0 ошибок) — именно на этом этапе нашлись и были исправлены две реальные
  ошибки: несуществующий вызов `Forms.FormText.Types.DESCRIPTION` и
  недопустимое значение `tags` у плагина.
- **Полную сборку через реальный esbuild-пайплайн Vencord** с подтверждением,
  что плагин действительно попадает в собранный бандл.

Что проверить здесь было невозможно: реальный вызов `pactl` на живом
сервере PulseAudio/PipeWire и работу плагина внутри запущенного Discord —
для этого нужен настоящий десктоп с Linux/Windows/macOS и установленным
Discord. Проверь после установки, и если что-то работает не так, как
описано — открой issue с текстом ошибки.

```bash
node test/linux.platform.test.ts
node test/route-validation.mjs
node test/syntax-check.mjs
```

### Лицензия

GPL-3.0-or-later, как и у самого Vencord.
