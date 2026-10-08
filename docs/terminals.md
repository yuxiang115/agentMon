# Terminal guide — getting the pet looking right

agentMon renders the pet as per-pixel half-block ANSI: `▀` cells carrying two
vertical pixels each, 24-bit colour (`38;2;r;g;b`) when the terminal supports
it. What that needs from a terminal:

1. **Truecolour (best)** — the extension checks `COLORTERM` at startup.
   Terminals that set it keep full 24-bit colour.
2. **Everything else** — automatically falls back to the nearest xterm-256
   palette index (`38;5;n`). Slightly quantized, still fully coloured.
   Force a mode with `AGENTMON_COLOR=true|256`.
3. **Unicode blocks** — `▀ ▄ █` must render as solid blocks. Any mainstream
   monospace font does; avoid exotic pixel fonts that leave gaps.
4. **Window size** — the panel is `pet size + 16` columns of walking room
   plus 4 of chrome. `/pet size 32` needs ~52 columns; size 60 needs 80.

Check what your terminal negotiated: `echo $COLORTERM` (`truecolor` = best).

| Terminal | out of the box | notes |
|---|---|---|
| Ghostty | ✅ truecolour | nothing to configure |
| iTerm2 | ✅ truecolour | Profiles → Text → tick *Terminal may report 24-bit color* for `COLORTERM` detection; colour works regardless |
| kitty / WezTerm / Alacritty | ✅ truecolour | nothing to configure |
| Windows Terminal | ✅ truecolour | nothing to configure |
| macOS Terminal.app | ⚠️ 256 fallback | no truecolour, no `COLORTERM` — agentMon auto-quantizes; for full fidelity use Ghostty/iTerm2 |

## Installing on a new machine (macOS)

```bash
npm install -g @earendil-works/pi-coding-agent   # Pi itself
gh auth login                                     # GitHub auth (repo is private)
pi install git:github.com/yuxiang115/agentMon
```

Pet packs live per machine. To bring a pet over, copy its zip and:

```
/pet import ~/Downloads/agumon.zip        # installs + activates
/pet size 32                              # tune to the window
```

The pet itself (XP, level, history) starts fresh on the new machine — state
is intentionally per-device.

## Font suggestions

Any of: SF Mono, JetBrains Mono, Menlo, Cascadia Code, Iosevka. Turn font
size down a notch for a denser pet; the sprite is `size` pixels tall rendered
at two pixels per terminal row, so a smaller font = a physically smaller,
crisper pet.
