<div align="center">

# StreamAudioRouter

### A Vencord plugin: screen-share as usual, but exclude one app's sound (e.g. your game) from Discord's "Share Audio" — everything else keeps streaming through. Your mic is never touched.
### Плагин для Vencord: демонстрируешь экран как обычно, но исключаешь звук одного приложения (например, игры) из "Share Audio" в Discord — всё остальное по-прежнему передаётся. Микрофон не трогается.

<br>

[![License](https://img.shields.io/badge/license-GPL--3.0-4B3D89?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-2C3E50?style=for-the-badge)](#how-it-works-per-os)
[![Release](https://img.shields.io/github/v/release/zelonka228/vencord-stream-audio-router?style=for-the-badge&label=release&color=1F6FEB)](../../releases)

<br>

![Discord](https://img.shields.io/badge/Discord-zelonka228-5865F2?style=for-the-badge&logo=discord&logoColor=white)
[![guns.lol](https://img.shields.io/badge/guns.lol-zelonka228-0B0B0F?style=for-the-badge)](https://guns.lol/zelonka228)

</div>

<br>

<div align="center">

### Built with

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)
![Vencord](https://img.shields.io/badge/Vencord-plugin-6E7BFA?style=flat-square)
![PulseAudio](https://img.shields.io/badge/PulseAudio%2FPipeWire-Linux%20backend-orange?style=flat-square)
![NirSoft](https://img.shields.io/badge/svcl.exe-Windows%20backend-lightgrey?style=flat-square)
![VB--Cable](https://img.shields.io/badge/VB--Audio%20Cable-optional-lightgrey?style=flat-square)
![BlackHole](https://img.shields.io/badge/BlackHole-macOS%20backend-lightgrey?style=flat-square)

</div>

---

<div align="center">

### Navigation · Навигация

| English | Русский |
|---|---|
| [The problem](#the-problem) | [Проблема](#проблема) |
| [The fix](#the-fix) | [Решение](#решение) |
| [Why not patch the picker?](#why-not-patch-discords-screen-share-picker-directly) | [Почему не патчим окно демонстрации?](#почему-не-патчим-окно-демонстрации-discord-напрямую) |
| [How it works, per OS](#how-it-works-per-os) | [Как это работает по ОС](#как-это-работает-по-ос) |
| [Interface](#interface) | [Интерфейс](#интерфейс) |
| [Windows: VB-Cable setup](#windows-setting-up-vb-audio-virtual-cable) | [Windows: установка VB-Cable](#windows-установка-vb-audio-virtual-cable) |
| [Windows: svcl.exe dependency](#windows-the-svclexe-dependency) | [Windows: зависимость svcl.exe](#windows-зависимость-от-svclexe) |
| [Installation](#installation) | [Установка](#установка) |
| [Repo layout](#repo-layout) | [Структура репозитория](#структура-репозитория) |
| [Verification](#verification) | [Проверка](#проверка) |
| [License](#license) | [Лицензия](#лицензия) |

</div>

---

## English

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
| **Windows** | Automatic (needs 2 output devices) | Windows has no scriptable public API for this, so the plugin drives [SoundVolumeCommandLine (svcl.exe)](https://www.nirsoft.net/utils/sound_volume_command_line.html) - a small, long-standing free (but closed-source) utility from NirSoft, downloaded on first use directly from nirsoft.net. It moves the excluded app to whichever real output device isn't your current default. If you only have one playback device, there's nowhere to move it while still hearing it, so the plugin shows a clear error instead of silently muting your game - manually pinning devices via the built-in "App volume and device preferences" page is always available as a fallback. |
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

On **Linux and Windows**, the panel has:
- A **dropdown** listing every app currently playing audio (refreshes on open).
- **Refresh app list** - re-scans for apps playing audio right now (only apps *actively* producing sound are reported, so if the app you want isn't listed, make sure it's actually playing something first).
- **Exclude selected app from stream audio** (green) - moves the selected app off the default output, as described above.
- **Include back / reset to normal** (red) - undoes it, whether you excluded one app or several in a row.
- Windows additionally shows a manual fallback button at the bottom, opening the OS's own settings page, for when there's no second output device to automate with.

On **macOS**, the panel instead shows BlackHole detection and buttons that open the relevant system settings (see the macOS walkthrough below) - there's no dropdown there, since macOS has no per-app routing to automate at all.

The panel's text automatically follows **Discord's own display language** - if Discord is set to Russian, the plugin's UI shows in Russian; any other language shows English. There's no separate language setting for the plugin itself.

#### Windows walkthrough

1. Play audio in the app you *don't* want Discord to hear.
2. Click **Refresh app list**, select that app, click **Exclude selected app from stream audio**. First run downloads `svcl.exe` from nirsoft.net (a few hundred KB, one-time).
3. Start your screen share, enable Discord's **Share Audio** checkbox.
4. When done, click **Include back / reset to normal**.

If you only have one playback device (e.g. just a headset - very common),
the panel detects this on load and walks you through getting a second one
for free. See **Windows: setting up VB-Audio Virtual Cable** below for the
full step-by-step guide (what each button does, what to expect, and how
to do every step by hand if you'd rather not use the buttons, or if
something doesn't work).

#### Windows: setting up VB-Audio Virtual Cable

This section is only relevant if the panel told you it only found one
playback device. If you already have two (e.g. speakers + a headset),
skip this - Exclude/Restore already work with no further setup.

VB-Audio Virtual Cable is a free virtual audio driver: a fake "device"
Windows treats like a real speaker, except nothing physical is attached to
it. That's exactly the second destination Windows itself doesn't provide
for free - the plugin moves the excluded app there instead of your real
device, and loops the sound back to your real headphones so you don't
lose it.

**Step 1 - install the driver.**
Click **Download and install VB-Audio Virtual Cable** in the panel. This:
- Downloads `VBCABLE_Driver_Pack45.zip` (~1.3 MB) directly from `download.vb-audio.com`.
- Extracts it to a temporary folder.
- Launches `VBCABLE_Setup_x64.exe` **elevated** - Windows will show its own admin/UAC prompt. This is unavoidable for any audio driver install, on any tool, and isn't something a script should skip past.
- Waits for you to click through the installer's own wizard (just "Next" a couple of times, no configuration needed).

If you'd rather do this yourself instead of clicking the button:
1. Download <https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip> manually.
2. Extract the zip.
3. Right-click `VBCABLE_Setup_x64.exe` → **Run as administrator**.
4. Click through the setup wizard.

**Step 2 - reboot.** VB-Cable's own installer and NirSoft's documentation
both say a restart is required for the driver to fully register with
Windows. Don't skip this even if things look like they're working -
half-registered audio drivers cause weird, hard-to-debug glitches.

**Step 3 - one remaining setting: "Listen to this device".**
After installing VB-Cable (and this is genuinely new territory - once the
excluded app's audio arrives at the cable, nothing plays it out loud
anywhere unless you tell Windows to also send it to your real headphones).
Reopen the plugin panel after rebooting - it now shows a **Configure
automatically** button:
- Click it - one more (final) elevated prompt appears, because this
  setting lives under a part of the registry only an administrator can
  write to.
- It finds VB-Cable's recording device ("CABLE Output") and turns on
  "Listen to this device", pointed at whichever device is currently your
  real default output.

If you'd rather configure this by hand instead (or the automatic button
reports an error):
1. Right-click the speaker icon in your taskbar → **Sounds** (or open
   **Control Panel → Sound**).
2. Go to the **Recording** tab.
3. Find **CABLE Output**, right-click it → **Properties**.
4. Open the **Listen** tab.
5. Check **Listen to this device**.
6. In the dropdown below it, pick your real headphones/speakers (not
   another cable device).
7. Click **OK**.

**That's it - after Steps 1-3, everything else is automatic**, exactly
like Linux: pick the app to exclude, click Exclude, share your screen,
enable Discord's Share Audio, done. You only do the cable setup once,
ever, on that PC.

**If sound still doesn't come through after all this:** double-check the
device selected in the Listen tab is your actual current output device
(not a leftover selection from a device you no longer use), and that
Windows' overall volume for "CABLE Output" (Recording tab) isn't muted.

#### Windows: the svcl.exe dependency

The Windows backend needs [SoundVolumeCommandLine (svcl.exe)](https://www.nirsoft.net/utils/sound_volume_command_line.html)
to work - a small, free command-line tool from NirSoft, built specifically
for scripting per-app audio device changes on Windows (there's no public
Microsoft API for this, so this is effectively the only well-established
tool for it). It is **not open source**, but it's a long-standing, widely
used utility with no known history of bundled malware or telemetry.

**Normal case - you don't need to do anything.** The first time you click
**Exclude selected app from stream audio**, the plugin automatically
downloads `svcl.exe` straight from `nirsoft.net` and saves it to:

```
%APPDATA%\<discord-folder>\StreamAudioRouter\svcl.exe
```

where `<discord-folder>` depends on which Discord branch you patched -
`discord` for Stable, `discordcanary` for Canary, `discordptb` for PTB.
For example, on Canary: `%APPDATA%\discordcanary\StreamAudioRouter\svcl.exe`.
This only happens once; later clicks reuse the same file.

**If the automatic download fails** (e.g. no internet access at that
moment, a firewall/antivirus blocking the request, or a corporate network
that blocks nirsoft.net), install it yourself:

1. Download the tool directly: <https://www.nirsoft.net/utils/svcl.zip>
2. Extract the zip - you'll get `svcl.exe`, `svcl.chm`, and `readme.txt`.
3. Create the folder if it doesn't exist yet, then copy all three files into it:
   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:APPDATA\discordcanary\StreamAudioRouter"
   Copy-Item "path\to\extracted\*" "$env:APPDATA\discordcanary\StreamAudioRouter\"
   ```
   (swap `discordcanary` for `discord` or `discordptb` to match the branch you patched)
4. Restart Discord and try **Exclude selected app from stream audio** again - it'll find the file and skip the download step.

**To verify it's working / debug it yourself from a terminal:**

```powershell
# List every app currently playing audio, and every playback device, in CSV form:
& "$env:APPDATA\discordcanary\StreamAudioRouter\svcl.exe" /scomma "$env:TEMP\sessions.csv"
Get-Content "$env:TEMP\sessions.csv"

# Manually move one app's audio to a specific device (same command the plugin runs):
& "$env:APPDATA\discordcanary\StreamAudioRouter\svcl.exe" /Stdout /SetAppDefault "<Command-Line Friendly ID from the CSV above>" all "SomeApp.exe"
```

If svcl.exe reports "1 item found" for that last command, it worked. If it
reports "0 item found", double-check the exact process name (case
sensitive, must end in `.exe`) and the device ID string.

#### macOS walkthrough

```bash
brew install --cask blackhole-2ch
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
strings.ts                    # EN/RU dictionary, follows Discord's own language
platform/
├── linux.ts                # pactl automation + pure, unit-tested parsers
├── windows.ts               # svcl.exe automation + pure, unit-tested parsers
└── macos.ts                 # BlackHole detection + Audio MIDI Setup helpers
test/
├── linux.platform.test.ts   # unit tests for the pactl output parsers
├── windows.platform.test.ts  # unit tests for the svcl.exe CSV parsers
├── route-validation.mjs       # rejects malformed/malicious sink input ids
└── syntax-check.mjs            # sanity-loads every platform module
```

### Verification

This code has been:
- Unit tested (18 tests covering the `pactl` output parsers: quoted names,
  missing properties, CRLF, multiple blocks, name-prefix collisions).
- Unit tested (13 tests covering the `svcl.exe` CSV parsers) against a
  **real CSV export captured live from a Windows machine**, and the
  `/scomma` + `/SetAppDefault` commands themselves were run live against a
  real running Discord/game/Steam session during development - not just
  guessed from documentation. That live run is what caught two real
  column-index bugs (the CSV parser was off by one column, and device
  names were read from the wrong field) before release.
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
PulseAudio/PipeWire server (no Linux machine available during that part of
development), or exercising the full plugin UI inside a running Discord
client on every OS. Test it end-to-end after installing, and open an issue
with the error message if something doesn't work as documented.

```bash
node test/linux.platform.test.ts
node test/windows.platform.test.ts
node test/route-validation.mjs
node test/syntax-check.mjs
```

### License

GPL-3.0-or-later, matching Vencord's own license.

---

## Русская версия

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
| **Windows** | Автоматически (нужно 2 устройства вывода) | У Windows нет публичного скриптуемого API для этого, поэтому плагин управляет [SoundVolumeCommandLine (svcl.exe)](https://www.nirsoft.net/utils/sound_volume_command_line.html) — небольшой давно существующей бесплатной (но closed-source) утилитой от NirSoft, которая скачивается при первом использовании прямо с nirsoft.net. Она переносит исключаемое приложение на то реальное устройство вывода, которое сейчас не является устройством по умолчанию. Если устройство вывода всего одно — переносить звук некуда так, чтобы ты его всё ещё слышал, поэтому плагин показывает понятную ошибку вместо того, чтобы молча заглушить игру — ручная привязка через штатную страницу "Громкость приложений и параметры устройств" всегда доступна как запасной вариант. |
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

На **Linux и Windows** панель состоит из:
- **Выпадающего списка** со всеми приложениями, которые сейчас воспроизводят звук (обновляется при открытии).
- **Refresh app list** — заново сканирует, какие приложения играют звук прямо сейчас (показываются только те, что **активно** производят звук в данный момент — если нужного приложения нет в списке, убедись, что в нём реально сейчас что-то играет).
- **Exclude selected app from stream audio** (зелёная) — убирает выбранное приложение с вывода по умолчанию, как описано выше.
- **Include back / reset to normal** (красная) — откатывает всё обратно, независимо от того, исключил ты одно приложение или несколько подряд.
- На Windows внизу дополнительно есть кнопка ручного способа — открывает штатную страницу настроек ОС, на случай если второго устройства вывода нет и автоматизировать нечем.

На **macOS** вместо этого показывается проверка наличия BlackHole и кнопки, которые открывают нужные системные настройки (см. инструкцию по macOS ниже) — там нет выпадающего списка, поскольку в macOS вообще нет маршрутизации по приложениям, которую можно было бы автоматизировать.

Текст в панели автоматически подстраивается под **язык интерфейса самого Discord** — если в Discord выбран русский, плагин тоже покажет русский текст; при любом другом языке — английский. Отдельной настройки языка у самого плагина нет.

#### Инструкция для Windows

1. Запусти звук в приложении, которое **не** хочешь, чтобы слышал Discord.
2. Нажми **Refresh app list**, выбери это приложение, нажми **Exclude selected app from stream audio**. При первом запуске скачается `svcl.exe` с nirsoft.net (несколько сотен КБ, один раз).
3. Запусти демонстрацию экрана, включи чекбокс **Share Audio**.
4. По завершении нажми **Include back / reset to normal**.

Если у тебя только одно устройство вывода (например, просто гарнитура —
частый случай), панель сама это определит при открытии и проведёт тебя
через получение второго бесплатно. Смотри полную пошаговую инструкцию
ниже: **Windows: установка VB-Audio Virtual Cable** — что делает каждая
кнопка, чего ожидать, и как сделать каждый шаг руками, если не хочется
пользоваться кнопками, или если что-то не сработало.

#### Windows: установка VB-Audio Virtual Cable

Этот раздел актуален, только если панель сказала, что нашла всего одно
устройство воспроизведения. Если у тебя уже есть два (например, колонки
+ гарнитура) — пропусти этот раздел, Exclude/Restore уже работают без
дополнительной настройки.

VB-Audio Virtual Cable — это бесплатный виртуальный аудио-драйвер:
"устройство", которое Windows воспринимает как настоящую колонку, хотя
физически к нему ничего не подключено. Это именно то второе устройство,
которого Windows сама по себе бесплатно не даёт — плагин переносит туда
звук исключённого приложения вместо реального устройства, и зацикливает
звук обратно на твои настоящие наушники, чтобы ты его не потерял.

**Шаг 1 — установить драйвер.**
Нажми **Скачать и установить VB-Audio Virtual Cable** в панели. Это:
- Скачивает `VBCABLE_Driver_Pack45.zip` (~1.3 МБ) напрямую с `download.vb-audio.com`.
- Распаковывает во временную папку.
- Запускает `VBCABLE_Setup_x64.exe` **с повышенными правами** — Windows покажет свой запрос на права администратора. Это неизбежно для установки любого аудио-драйвера, любым инструментом, и не то, что скрипт должен обходить.
- Ждёт, пока ты пройдёшь мастер установки самого установщика (просто пара нажатий "Далее", настраивать ничего не нужно).

Если хочешь сделать это сам, а не нажимать кнопку:
1. Скачай <https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip> вручную.
2. Распакуй архив.
3. Правой кнопкой по `VBCABLE_Setup_x64.exe` → **Запуск от имени администратора**.
4. Пройди мастер установки.

**Шаг 2 — перезагрузка.** И сам установщик VB-Cable, и документация
NirSoft прямо говорят, что для полной регистрации драйвера в Windows
требуется перезагрузка. Не пропускай этот шаг, даже если кажется, что
всё уже работает — наполовину зарегистрированные аудио-драйверы дают
странные, трудноотлаживаемые глюки.

**Шаг 3 — последняя настройка: "Прослушать с данного устройства".**
После установки VB-Cable (и это правда важный нюанс — как только звук
исключённого приложения попадает на кабель, никуда вслух он не
воспроизводится, пока не сказать Windows дублировать его на настоящие
наушники). Снова открой панель плагина после перезагрузки — теперь там
появится кнопка **Настроить автоматически**:
- Нажми её — появится ещё один (последний) запрос повышенных прав,
  потому что эта настройка живёт в части реестра, куда может писать
  только администратор.
- Плагин найдёт записывающее устройство кабеля ("CABLE Output") и
  включит "Прослушать с данного устройства", указав то устройство,
  которое сейчас является твоим настоящим выводом по умолчанию.

Если предпочитаешь настроить вручную (или кнопка автоматической
настройки выдаст ошибку):
1. Правой кнопкой по значку динамика в трее → **Звуки** (или открой
   **Панель управления → Звук**).
2. Перейди на вкладку **Запись**.
3. Найди **CABLE Output**, правой кнопкой → **Свойства**.
4. Открой вкладку **Прослушать**.
5. Поставь галочку **Прослушать с данного устройства**.
6. В выпадающем списке ниже выбери свои реальные наушники/колонки (не
   ещё одно устройство-кабель).
7. Нажми **ОК**.

**На этом всё — после шагов 1-3 всё остальное работает автоматически**,
точно как на Linux: выбираешь приложение для исключения, жмёшь
Exclude, демонстрируешь экран, включаешь Share Audio в Discord, готово.
Настройку кабеля делаешь один раз за всё время на этом ПК.

**Если звук всё равно не идёт после всего этого:** перепроверь, что на
вкладке "Прослушать" выбрано именно твоё текущее реальное устройство
вывода (а не оставшийся выбор от устройства, которым ты больше не
пользуешься), и что громкость "CABLE Output" на вкладке "Запись" не
выключена (не Mute).

#### Windows: зависимость от svcl.exe

Windows-часть плагина нуждается в [SoundVolumeCommandLine (svcl.exe)](https://www.nirsoft.net/utils/sound_volume_command_line.html)
— небольшой бесплатной консольной утилите от NirSoft, созданной именно
для скриптового управления звуковым устройством по приложениям в Windows
(у Microsoft нет публичного API для этого, так что это фактически
единственный устоявшийся инструмент). Это **не open source**, но давно
существующая, широко используемая утилита без известной истории
встроенного вредоносного кода или телеметрии.

**Обычный случай — делать ничего не нужно.** При первом нажатии
**Exclude selected app from stream audio** плагин сам скачивает
`svcl.exe` напрямую с `nirsoft.net` и сохраняет его сюда:

```
%APPDATA%\<папка-discord>\StreamAudioRouter\svcl.exe
```

где `<папка-discord>` зависит от того, какую ветку Discord ты патчил —
`discord` для Stable, `discordcanary` для Canary, `discordptb` для PTB.
Например, для Canary: `%APPDATA%\discordcanary\StreamAudioRouter\svcl.exe`.
Скачивание происходит только один раз, дальше используется тот же файл.

**Если автоматическое скачивание не удалось** (например, в этот момент
не было интернета, файрвол/антивирус заблокировал запрос, или
корпоративная сеть блокирует nirsoft.net) — поставь вручную:

1. Скачай утилиту напрямую: <https://www.nirsoft.net/utils/svcl.zip>
2. Распакуй архив — получишь `svcl.exe`, `svcl.chm` и `readme.txt`.
3. Создай папку, если её ещё нет, и скопируй туда все три файла:
   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:APPDATA\discordcanary\StreamAudioRouter"
   Copy-Item "путь\к\распакованным\файлам\*" "$env:APPDATA\discordcanary\StreamAudioRouter\"
   ```
   (замени `discordcanary` на `discord` или `discordptb`, смотря какую ветку патчил)
4. Перезапусти Discord и снова нажми **Exclude selected app from stream audio** — плагин найдёт файл и пропустит шаг скачивания.

**Чтобы проверить работу / отладить самостоятельно из терминала:**

```powershell
# Список всех приложений, которые сейчас играют звук, и всех устройств вывода, в CSV:
& "$env:APPDATA\discordcanary\StreamAudioRouter\svcl.exe" /scomma "$env:TEMP\sessions.csv"
Get-Content "$env:TEMP\sessions.csv"

# Вручную перенести звук приложения на конкретное устройство (та же команда, что выполняет плагин):
& "$env:APPDATA\discordcanary\StreamAudioRouter\svcl.exe" /Stdout /SetAppDefault "<Command-Line Friendly ID из CSV выше>" all "SomeApp.exe"
```

Если `svcl.exe` в ответ на последнюю команду пишет "1 item found" — всё
сработало. Если "0 item found" — перепроверь точное имя процесса
(регистр важен, должно заканчиваться на `.exe`) и строку ID устройства.

#### Инструкция для macOS

```bash
brew install --cask blackhole-2ch
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
strings.ts                    # словарь EN/RU, следует языку самого Discord
platform/
├── linux.ts                # автоматизация через pactl + чистые протестированные парсеры
├── windows.ts               # автоматизация через svcl.exe + чистые протестированные парсеры
└── macos.ts                 # проверка BlackHole + помощники Audio MIDI Setup
test/
├── linux.platform.test.ts   # юнит-тесты парсеров вывода pactl
├── windows.platform.test.ts  # юнит-тесты парсеров CSV от svcl.exe
├── route-validation.mjs       # отклоняет некорректные/вредоносные id
└── syntax-check.mjs            # проверяет, что все platform-модули загружаются
```

### Проверка

Код прошёл:
- Юнит-тесты (18 тестов на парсеры вывода `pactl`: кавычки в именах,
  отсутствующие поля, CRLF, несколько блоков, коллизии по префиксу имени).
- Юнит-тесты (13 тестов на парсеры CSV от `svcl.exe`) на основе **реального
  CSV-экспорта, снятого вживую с настоящей Windows-машины**, а сами команды
  `/scomma` и `/SetAppDefault` реально выполнялись на живой системе с
  запущенными Discord/игрой/Steam во время разработки — не просто угаданы
  по документации. Именно этот живой прогон нашёл две реальные ошибки в
  индексах колонок (парсер CSV был сдвинут на одну колонку, а имена
  устройств читались не из того поля) ещё до релиза.
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
сервере PulseAudio/PipeWire (на момент этой части разработки под рукой не
было Linux-машины), а также работу всего интерфейса плагина внутри
запущенного Discord на каждой ОС. Проверь после установки, и если
что-то работает не так, как описано — открой issue с текстом ошибки.

```bash
node test/linux.platform.test.ts
node test/windows.platform.test.ts
node test/route-validation.mjs
node test/syntax-check.mjs
```

### Лицензия

GPL-3.0-or-later, как и у самого Vencord.
