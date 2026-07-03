# StreamAudioRouter (Vencord plugin)

Share one window (e.g. a game) while Discord captures a **different**
app's audio (e.g. your browser's music) - without Discord tying the shared
window's audio to your voice input.

## Why this exists

When you screen-share a specific window in Discord, its audio (if any) is
what gets shared - not audio from other apps. There's no built-in way to say
"show this window, but send that app's sound." This plugin works around it
by rerouting audio **at the OS level**, outside of Discord entirely, so the
two are fully decoupled: share whatever window you want, and Discord's
"microphone" input is whatever app's audio you pick.

## How it works, per OS

Audio APIs are not the same across operating systems, so this plugin does
not pretend they are. Each backend automates exactly as much as the OS
actually allows:

| OS | Automation level | What happens |
|---|---|---|
| **Linux** | Fully automatic | Uses `pactl` (PulseAudio / PipeWire-Pulse) to move the chosen app's audio stream into a virtual sink, sets that sink's monitor as Discord's audio input, and keeps the app audible locally via a loopback module. One click. |
| **Windows** | Native OS feature, one click to open it | Windows 10/11 already ships per-app output device selection ("App volume and device preferences"). The plugin just opens that exact settings page for you - no drivers, no extra installs. |
| **macOS** | Guided, needs a free driver | macOS has no per-app audio routing built in. The plugin detects whether [BlackHole](https://github.com/ExistentialAudio/BlackHole) is installed, and if so, opens Audio MIDI Setup / Sound settings so you can build the routing yourself (Apple gives no API to do this silently from a script). |

### Linux - the fully automatic path

1. Open **Vencord Settings → Plugins → StreamAudioRouter**.
2. Play audio in the app you want Discord to capture (e.g. a browser tab).
3. Click **Refresh app list**, select that app, click **Route selected app's audio**.
4. In Discord's **Voice & Video → Input Device**, choose `Monitor of VencordStreamMix` (only needs doing once).
5. Start your screen share as normal (share the game window/screen you actually want people to see).
6. When you're done, click **Reset to normal audio** to undo everything cleanly.

Under the hood this:
- Creates a virtual sink called `VencordStreamMix` (`module-null-sink`).
- Moves the selected app's PulseAudio/PipeWire stream into it.
- Loops that sink's monitor back to your real output device, so *you* still hear it too.
- Points the system default audio source at the sink's monitor.
- On "Reset", looks up and unloads those modules **by name**, not by remembered IDs - so it recovers correctly even if Discord was restarted or the plugin was reloaded in between.

### Windows

Click **Open "App volume and device preferences"**. From there you can pin
your game to your headphones and your browser to a virtual cable / separate
device of your choice. This is a native Windows feature; the plugin doesn't
(and can't, safely) auto-select devices for you, since there's no supported
API to do that reassignment invisibly from an Electron app.

### macOS

Install [BlackHole](https://github.com/ExistentialAudio/BlackHole) once:

```
brew install blackhole-2ch
```

Then use the plugin's buttons to open **Audio MIDI Setup** (to build a
Multi-Output Device combining BlackHole and your speakers) and **Sound
Settings**. From there, point the specific app's own output picker (many
apps like Spotify, VLC, or browsers with a device-picker extension expose
one) at BlackHole, and set BlackHole as Discord's Input Device.

## Installation

This is a Vencord **userplugin** - it needs to be built from source, it's
not part of the Vencord plugin store.

```bash
git clone https://github.com/Vencord/Vencord
cd Vencord
mkdir -p src/userplugins
git clone https://github.com/<your-username>/vencord-stream-audio-router src/userplugins/streamAudioRouter

pnpm install
pnpm build
pnpm inject
```

Or, download the plugin folder from this repo's
[Releases](../../releases) page and drop it directly into
`Vencord/src/userplugins/streamAudioRouter`, then run `pnpm build && pnpm inject`.

After building, restart Discord and enable **StreamAudioRouter** under
Vencord Settings → Plugins.

## Repo layout

```
streamAudioRouter/
├── index.tsx              # renderer: settings UI, OS detection, buttons
├── native.ts               # Electron main-process bridge (IPC)
└── platform/
    ├── linux.ts            # pactl automation (+ pure, unit-tested parsers)
    ├── windows.ts           # opens native Windows per-app audio settings
    └── macos.ts             # BlackHole detection + Audio MIDI Setup helpers
test/
├── linux.platform.test.ts   # unit tests for the pactl output parsers
├── route-validation.mjs      # rejects malformed/malicious sink input ids
└── syntax-check.mjs           # sanity-loads every platform module
```

## Testing

The Linux backend's parsing logic is pure (no side effects) and unit
tested against hand-built `pactl` output covering quoted names, missing
properties, multiple sink inputs, CRLF line endings, and name-prefix
collisions. Id validation is tested against injection-style garbage input
to confirm it's rejected before any shell command runs. Run:

```bash
node test/linux.platform.test.ts
node test/route-validation.mjs
node test/syntax-check.mjs
```

These tests do **not** require pactl, Discord, or Vencord to be installed -
they exercise pure logic and input validation only. The actual `pactl`
calls (creating sinks, moving streams, loopback routing) can only be
verified end-to-end on a real Linux machine with PulseAudio/PipeWire
running, since there is no way to fake a system audio server from this
environment.

## License

GPL-3.0-or-later, matching Vencord's own license.
