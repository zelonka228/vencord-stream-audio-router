<div align="center">

# StreamAudioRouter

**A Vencord plugin: share one app/window's video while Discord's "Share Audio" captures a *different* app's sound — without ever touching your mic.**
**Плагин для Vencord: транслируешь окно одного приложения — а "Share Audio" Discord передаёт звук другого. Микрофон и голос при этом не трогаются.**

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

Discord already has a "Share Audio" / "Stream With Audio" toggle in the
screen-share settings — it's a **separate channel from your microphone**,
so it can never talk over or interfere with your voice. The catch: it
captures whatever plays through your system's **default** audio output,
not a specific app.

So this plugin doesn't touch your mic at all. It just makes sure the app
you *don't* want heard (e.g. your game) is moved off the default output
onto its own device — still playing normally through your speakers, just
no longer part of what "Share Audio" picks up. Whatever's left on the
default output (e.g. your browser) is what gets streamed.

### Why not patch Discord's screen-share picker directly?

We looked into this. Discord's own picker is closed-source and changes
between releases, so a hand-written patch can't be verified without a live
Discord instance. We also checked whether [Vesktop](https://github.com/Vencord/Vesktop)
(Vencord's own official desktop client) solves this out of the box — it
does, but **only on Linux**, via [venmic](https://github.com/Vencord/venmic),
a PipeWire-based virtual mic. On Windows and macOS, even Vesktop just has
the same plain "Stream With Audio" toggle as regular Discord. Since the
goal here is one plugin that behaves the same way on all three OSes,
without asking you to trust and install a whole alternate Discord client,
we standardized on driving Discord's *existing* native toggle instead.

### How it works, per OS

Audio APIs are not the same across operating systems, so this plugin does
not pretend they are — each backend automates exactly as much as the OS
actually allows.

| OS | Automation | What happens |
|---|---|---|
| **Linux** | Fully automatic | Uses `pactl` (PulseAudio / PipeWire-Pulse) to move the excluded app's stream into a dedicated sink, loops it back to your real output so you still hear it, and leaves everything else on the system default. |
| **Windows** | One click, native | Windows 10/11 already has per-app output device selection built in ("App volume and device preferences"). The plugin opens that exact page so you can pin the noisy app to a non-default device. No drivers, no installs. |
| **macOS** | Guided | macOS has no per-app output device at all, and most games can't be redirected. The plugin detects [BlackHole](https://github.com/ExistentialAudio/BlackHole) and opens Audio MIDI Setup / Sound Settings so you can route the app you *want* heard (usually the browser, since browsers are more likely to expose an output picker) through it. |

In every case, **your microphone/voice input is never touched.** Talking
and hearing other people in the call works exactly as it always has.

#### Linux walkthrough

1. Open the plugin (see [Interface](#interface) below for three ways to get there - Settings, a button next to Mute/Deafen, or Vencord's Toolbox menu).
2. Play audio in the app you *don't* want Discord to hear (e.g. start your game).
3. Click **Refresh app list**, select that app, click **Exclude selected app from stream audio**.
4. Start your screen share as usual (share the game window/screen).
5. Enable Discord's own **Share Audio** checkbox in the share settings.
6. When done, click **Include back / reset to normal**.

Under the hood: creates a `VencordExcludedAudio` null-sink → moves the
excluded app's stream into it → loops the sink's monitor back to your real
output (so you still hear it locally). "Reset" looks modules up **by
name**, not remembered IDs, so it recovers correctly even after a Discord
restart mid-session — and PulseAudio automatically reassigns the excluded
app back to the default output the moment the sink is torn down.

### Interface

There are three ways to reach the plugin's panel - pick whichever is fastest for you:

1. **Vencord Settings → Plugins → StreamAudioRouter** - click the plugin's name/gear icon (the full panel described below).
2. **A round button next to Mute/Deafen**, at the bottom-left of the Discord window, right by your account row. One click opens the same panel in a small popup, without leaving whatever you're doing.
3. **Vencord's own Toolbox menu** (the icon that looks like a grid/funnel in the top titlebar, if you have the `VencordToolbox` plugin enabled) - an "Open StreamAudioRouter" entry appears there too.

The panel itself, on Linux, has:
- A **dropdown** listing every app currently playing audio (refreshes on open).
- **Refresh app list** - re-scans for apps playing audio right now (PulseAudio only reports apps that are *actively* producing sound, so if the app you want isn't listed, make sure it's actually playing something first).
- **Exclude selected app from stream audio** (green) - moves the selected app off the default output, as described above.
- **Include back / reset to normal** (red) - undoes it, whether you excluded one app or several in a row.

On Windows and macOS the panel instead shows OS-specific buttons that open the relevant system settings (see the per-OS walkthroughs above) - there's no dropdown there, since routing on those OSes has to be done in the OS's own settings, not through PulseAudio.

The panel's text automatically follows **Discord's own display language** - if Discord is set to Russian, the plugin's UI shows in Russian; any other language shows English. There's no separate language setting for the plugin itself.

#### Windows walkthrough

Click **Open "App volume and device preferences"**. Pin the noisy app
(e.g. your game) to a specific device instead of "Default" — leave the app
you want streamed on "Default". Then enable Discord's **Share Audio**
toggle when you start your screen share.

#### macOS walkthrough

```bash
brew install blackhole-2ch
```

Use the plugin's buttons to open Audio MIDI Setup (build a Multi-Output
Device with BlackHole + your speakers) and Sound Settings. Point your
browser's own output picker at that device, make it your system default,
then enable Discord's **Share Audio** toggle.

### Installation

This is a Vencord **userplugin** — built from source, not from the plugin store.

#### 1. Prerequisites (per OS)

**Linux (Debian/Kali/Ubuntu):**
```bash
sudo apt install git nodejs npm pulseaudio-utils
sudo npm install -g pnpm
```
If you're on PipeWire instead of PulseAudio, swap `pulseaudio-utils` for `pipewire-pulse` (most modern distros already have `pactl` available either way — run `pactl --version` to check).

**Windows:**
1. Install [Git for Windows](https://git-scm.com/download/win).
2. Install [Node.js LTS](https://nodejs.org/) (includes npm).
3. In a terminal: `npm install -g pnpm`.

**macOS:**
```bash
xcode-select --install
brew install git node
npm install -g pnpm
```

#### 2. Install Discord itself, then Vencord

Discord has to already be installed and have been launched at least once
(so its actual app folder exists) before running the Vencord installer.

**Linux / macOS:**
```bash
sh -c "$(curl -sS https://vencord.dev/install.sh)"
```

**Windows (PowerShell):**
```powershell
iwr -useb https://vencord.dev/install.ps1 | iex
```

If the installer doesn't find Discord automatically, point it at your real
install folder:

| OS | Typical Discord install path |
|---|---|
| Linux | `~/.config/discord/app-<version>` (after Discord's first launch - **not** `/usr/share/discord`, that's just a launcher stub) |
| macOS | `~/Library/Application Support/discord/app-<version>` |
| Windows | `%localappdata%\Discord\app-<version>` |

#### 3. Build Vencord from source with this plugin included

```bash
git clone https://github.com/Vencord/Vencord
cd Vencord
mkdir -p src/userplugins
git clone https://github.com/zelonka228/vencord-stream-audio-router src/userplugins/streamAudioRouter

pnpm install
pnpm build
pnpm inject
```

`pnpm inject` downloads a small CLI tool and asks which Discord install to
patch (arrow keys + Enter). Pick the one matching what you actually use
(Stable/PTB/Canary). It's safe to run again any time - it detects an
existing patch and reapplies it.

Or grab `streamAudioRouter.zip` from [Releases](../../releases), extract it
into `Vencord/src/userplugins/`, then `pnpm build && pnpm inject`.

#### 4. Restart Discord and enable the plugin

A normal window close isn't enough - Discord needs to fully reload the
patched code:

```bash
killall Discord        # or: killall DiscordCanary / DiscordPTB, matching what you patched
discord                # relaunches it (or open it from your app menu)
```

Then: **Settings → Vencord → Plugins**, search for `StreamAudioRouter`,
flip the toggle on. If Discord asks for a restart to apply it, let it -
that's normal for plugins that patch Discord's own UI (this one adds a
button next to Mute/Deafen, which needs a reload to attach).

**Troubleshooting - plugin not appearing in the list at all:** double-check
`src/userplugins/streamAudioRouter/index.tsx` actually exists (not nested
one level deeper, e.g. `.../streamAudioRouter/streamAudioRouter/index.tsx`
- that would mean the wrong thing got cloned into the wrong folder), then
re-run `pnpm build && pnpm inject` and fully restart Discord again.

### Repo layout

The repo root **is** the plugin folder - that's deliberate, so `git clone`ing
this repo straight into `Vencord/src/userplugins/streamAudioRouter` works
with no extra steps, no nested subfolder to flatten by hand.

```
index.tsx                   # renderer: settings UI, OS detection, buttons
native.ts                    # Electron main-process bridge (IPC)
platform/
├── linux.ts                # pactl automation + pure, unit-tested parsers
├── windows.ts               # opens native Windows per-app audio settings
└── macos.ts                 # BlackHole detection + Audio MIDI Setup helpers
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
  value, both fixed before release.
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

У Discord уже есть тумблер "Share Audio" / "Stream With Audio" в
настройках демонстрации экрана — это **отдельный от микрофона канал**, он
физически не может перебивать или мешать твоему голосу. Загвоздка в том,
что он захватывает звук **системного вывода по умолчанию** целиком, а не
конкретного приложения.

Поэтому плагин вообще не трогает микрофон. Он просто следит, чтобы
приложение, звук которого ты **не** хочешь передавать (например, игра),
было убрано с вывода по умолчанию на отдельное устройство — при этом оно
продолжает нормально играть через твои колонки, просто больше не попадает
в то, что захватывает "Share Audio". Всё, что осталось на выводе по
умолчанию (например, браузер) — это то, что уйдёт в трансляцию.

### Почему не патчим окно демонстрации Discord напрямую?

Мы это рассматривали. Собственное окно выбора демонстрации в Discord —
закрытый код, который меняется от релиза к релизу, и написанный вслепую
патч невозможно проверить без живого запущенного Discord. Мы также
проверили, решает ли это [Vesktop](https://github.com/Vencord/Vesktop)
(официальный альтернативный клиент от самой команды Vencord) из коробки —
решает, но **только на Linux**, через [venmic](https://github.com/Vencord/venmic)
— их собственный виртуальный микрофон на базе PipeWire. На Windows и macOS
даже у Vesktop точно такой же простой тумблер "Stream With Audio", как и в
обычном Discord. Поскольку цель — один плагин, который одинаково работает
на всех трёх ОС, и не просит тебя доверять и ставить целый альтернативный
клиент Discord — мы остановились на управлении уже существующим штатным
тумблером Discord.

### Как это работает по ОС

Аудио-API в разных ОС устроены принципиально по-разному, поэтому плагин не
делает вид, что это не так — каждый бэкенд автоматизирует ровно столько,
сколько реально позволяет система.

| ОС | Автоматизация | Что происходит |
|---|---|---|
| **Linux** | Полностью автоматически | Через `pactl` (PulseAudio / PipeWire-Pulse) переносит поток исключаемого приложения в отдельный sink, зацикливает его обратно на реальный вывод (чтобы ты сам его слышал), а всё остальное остаётся на выводе по умолчанию. |
| **Windows** | Одна кнопка, штатная функция ОС | В Windows 10/11 уже есть выбор устройства вывода для каждого приложения ("Громкость приложений и параметры устройств"). Плагин открывает нужную страницу, чтобы ты закрепил шумное приложение за отдельным устройством. Без драйверов и установок. |
| **macOS** | С подсказками | У macOS вообще нет вывода по умолчанию для отдельных приложений, а большинство игр нельзя перенаправить. Плагин определяет, установлен ли [BlackHole](https://github.com/ExistentialAudio/BlackHole), и открывает Audio MIDI Setup / настройки звука, чтобы направить через него именно то приложение, звук которого нужен (обычно браузер — у браузеров чаще есть свой выбор устройства вывода). |

В любом случае **микрофон/голосовой вход не трогается никогда.** Разговор
и звук собеседников в канале работают ровно как обычно.

#### Инструкция для Linux

1. Открой панель плагина (см. раздел [Интерфейс](#интерфейс) ниже — есть три способа туда попасть: настройки, кнопка у микрофона/наушников, или меню Toolbox).
2. Запусти звук в приложении, которое **не** хочешь, чтобы слышал Discord (например, запусти игру).
3. Нажми **Refresh app list**, выбери это приложение, нажми **Exclude selected app from stream audio**.
4. Запусти демонстрацию экрана как обычно (окно/экран игры).
5. Включи штатный чекбокс **Share Audio** в настройках демонстрации Discord.
6. По завершении нажми **Include back / reset to normal**.

Под капотом: создаётся виртуальный sink `VencordExcludedAudio` → в него
переносится поток исключаемого приложения → его монитор зацикливается
обратно на реальный вывод (чтобы звук не пропал у тебя). Кнопка "Reset"
ищет модули **по имени**, а не по запомненному ID — поэтому корректно
восстанавливает состояние даже после перезапуска Discord посреди сессии, а
PulseAudio сам возвращает исключённое приложение обратно на вывод по
умолчанию в момент удаления sink.

### Интерфейс

Есть три способа открыть панель плагина — выбирай, что быстрее:

1. **Настройки Vencord → Plugins → StreamAudioRouter** — клик по названию плагина/значку шестерёнки (полная панель, описана ниже).
2. **Круглая кнопка рядом с микрофоном/наушниками** внизу слева окна Discord, прямо у твоего профиля. Один клик открывает ту же панель во всплывающем окне, не отвлекаясь от того, чем занят.
3. **Собственное меню Toolbox от Vencord** (значок в виде сетки/воронки в верхней панели окна, если у тебя включён плагин `VencordToolbox`) — там тоже появляется пункт "Open StreamAudioRouter".

Сама панель на Linux состоит из:
- **Выпадающего списка** со всеми приложениями, которые сейчас воспроизводят звук (обновляется при открытии).
- **Refresh app list** — заново сканирует, какие приложения играют звук прямо сейчас (PulseAudio показывает только те, что **активно** производят звук в данный момент — если нужного приложения нет в списке, убедись, что в нём реально сейчас что-то играет).
- **Exclude selected app from stream audio** (зелёная) — убирает выбранное приложение с вывода по умолчанию, как описано выше.
- **Include back / reset to normal** (красная) — откатывает всё обратно, независимо от того, исключил ты одно приложение или несколько подряд.

На Windows и macOS вместо этого показываются кнопки, специфичные для ОС, которые открывают нужные системные настройки (см. инструкции выше по каждой ОС) — там нет выпадающего списка, поскольку маршрутизация на этих системах делается через настройки самой ОС, а не через PulseAudio.

Текст в панели автоматически подстраивается под **язык интерфейса самого Discord** — если в Discord выбран русский, плагин тоже покажет русский текст; при любом другом языке — английский. Отдельной настройки языка у самого плагина нет.

#### Инструкция для Windows

Нажми **Open "App volume and device preferences"**. Закрепи шумное
приложение (например, игру) за конкретным устройством вместо "По
умолчанию" — приложение, звук которого нужен в трансляции, оставь на "По
умолчанию". Затем включи штатный тумблер **Share Audio** Discord при
демонстрации экрана.

#### Инструкция для macOS

```bash
brew install blackhole-2ch
```

Через кнопки плагина открой Audio MIDI Setup (собери Multi-Output Device
из BlackHole + твоих колонок) и настройки звука. В собственном селекторе
вывода браузера выбери это устройство, сделай его системным выводом по
умолчанию, затем включи тумблер **Share Audio** Discord.

### Установка

Это **userplugin** для Vencord — собирается из исходников, не через магазин плагинов.

#### 1. Предварительные требования (по ОС)

**Linux (Debian/Kali/Ubuntu):**
```bash
sudo apt install git nodejs npm pulseaudio-utils
sudo npm install -g pnpm
```
Если у тебя PipeWire вместо PulseAudio — вместо `pulseaudio-utils` поставь `pipewire-pulse` (на большинстве современных дистрибутивов `pactl` уже есть в любом случае — проверь командой `pactl --version`).

**Windows:**
1. Поставь [Git for Windows](https://git-scm.com/download/win).
2. Поставь [Node.js LTS](https://nodejs.org/) (npm идёт вместе с ним).
3. В терминале: `npm install -g pnpm`.

**macOS:**
```bash
xcode-select --install
brew install git node
npm install -g pnpm
```

#### 2. Установи сам Discord, затем Vencord

Discord должен быть уже установлен и хотя бы раз запущен (чтобы появилась
его реальная папка с приложением) до запуска установщика Vencord.

**Linux / macOS:**
```bash
sh -c "$(curl -sS https://vencord.dev/install.sh)"
```

**Windows (PowerShell):**
```powershell
iwr -useb https://vencord.dev/install.ps1 | iex
```

Если установщик не найдёт Discord автоматически — укажи путь вручную:

| ОС | Типичный путь установки Discord |
|---|---|
| Linux | `~/.config/discord/app-<версия>` (после первого запуска Discord — **не** `/usr/share/discord`, это просто скрипт-запускалка) |
| macOS | `~/Library/Application Support/discord/app-<версия>` |
| Windows | `%localappdata%\Discord\app-<версия>` |

#### 3. Собери Vencord из исходников вместе с этим плагином

```bash
git clone https://github.com/Vencord/Vencord
cd Vencord
mkdir -p src/userplugins
git clone https://github.com/zelonka228/vencord-stream-audio-router src/userplugins/streamAudioRouter

pnpm install
pnpm build
pnpm inject
```

`pnpm inject` скачает небольшую CLI-утилиту и спросит, какую установку
Discord патчить (стрелки + Enter) — выбери ту версию, которой реально
пользуешься (Stable/PTB/Canary). Команду можно безопасно запускать
повторно в любой момент — она сама определит, что патч уже стоит, и
переустановит его.

Либо скачай `streamAudioRouter.zip` со страницы [Releases](../../releases),
распакуй в `Vencord/src/userplugins/`, затем `pnpm build && pnpm inject`.

#### 4. Перезапусти Discord и включи плагин

Обычного закрытия окна недостаточно — Discord должен полностью
перезагрузить пропатченный код:

```bash
killall Discord         # или killall DiscordCanary / DiscordPTB — смотря что патчил
discord                 # запускает заново (или через меню приложений)
```

Дальше: **Настройки → Vencord → Plugins**, найди `StreamAudioRouter` через
поиск, включи тумблер. Если Discord попросит перезапуск, чтобы применить
изменения — соглашайся, это нормально для плагинов, которые патчат UI
самого Discord (этот добавляет кнопку рядом с микрофоном/наушниками, для
которой нужна перезагрузка, чтобы она прикрепилась).

**Если плагин вообще не появляется в списке:** проверь, что
`src/userplugins/streamAudioRouter/index.tsx` лежит именно там (а не на
уровень глубже, например
`.../streamAudioRouter/streamAudioRouter/index.tsx` — это значит, что не
туда склонировалось не то), затем заново `pnpm build && pnpm inject` и
полный перезапуск Discord.

### Структура репозитория

Корень репозитория **и есть** папка плагина — это сделано специально, чтобы
`git clone` этого репозитория сразу в `Vencord/src/userplugins/streamAudioRouter`
работал без дополнительных шагов, без вложенной папки, которую нужно
разворачивать вручную.

```
index.tsx                   # рендер: UI настроек, определение ОС, кнопки
native.ts                    # мост в главный процесс Electron (IPC)
platform/
├── linux.ts                # автоматизация через pactl + чистые протестированные парсеры
├── windows.ts               # открывает штатные настройки звука Windows
└── macos.ts                 # проверка BlackHole + помощники Audio MIDI Setup
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
  недопустимое значение `tags` у плагина, ещё до релиза.
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
