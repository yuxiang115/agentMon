# Pet packs — bring your own sprites

agentMon ships **original creatures only** (Byte/Scout/Builder/Guardian). Pet packs let YOU use other sprites **on your own machine, at your own responsibility** — the agentMon repository never contains them.

> **Legal note.** If you extract sprites from a game (DVPet/Digimon etc.), those assets belong to their rights holder (Digimon sprites and creature designs are © Bandai). Keeping them in a private local directory for personal use is the same model tuipet documents; **committing them to agentMon or any public repository is not**. The loader exists so the code and the data stay cleanly separated.

## Where packs live

```
<pi agent dir>/agentmon/pets/       (default ~/.pi/agent/agentmon/pets, override with PI_CODING_AGENT_DIR)
  <pack-slug>/
    pack.json
```

## pack.json format

One file per pack. `species` is required; `evolutions` is optional.

```json
{
  "name": "My creatures",
  "species": [
    {
      "id": "my-pet",
      "name": "My Pet",
      "stage": "branch",
      "description": "optional flavor text",
      "poses": {
        "idleA": ["................", ".......#........", "... 16 rows of 16 chars ..."],
        "... all 11 poses are required: idleA idleB think search codeA codeB testA testB happy sad sleep"
      },
      "roles": { "optional": ["idleA"] }
    }
  ],
  "evolutions": [
    {
      "from": "my-pet",
      "to": "byte",
      "gates": {
        "minLevel": 3,
        "axis": "research",
        "minTraitShare": 0.45,
        "minTasks": 5,
        "maxCareMistakes": 3,
        "minValidatedRatio": 0.6
      }
    }
  ]
}
```

Rules:

- **Poses**: each pose is exactly 16 rows of 16 characters, ink `1` or `#`, blank `0` or `.`. Ground the feet on row 13 (rows 14–15 empty) so the pet lines up with the built-ins.
- **Pose names are free-form** when you declare `roles` — use as many frames per activity as you like (`idle1..idle4`, `code1..code3`, ...); the animator cycles each activity's loop at ~3 switches/sec. Without `roles`, the default coding table applies and all 11 canonical poses (`idleA idleB think search codeA codeB testA testB happy sad sleep`) are required.
- **roles** must reference pose names that exist and must include `idle` (the renderer's fallback for unknown activities). `walk` defaults to the idle loop if omitted.
- **id** must be lowercase letters/digits/dashes. A pack id may intentionally **reskin a built-in** (e.g. replace `byte`); the pack wins.
- **evolutions** use the same multi-gate system as the built-ins (`packages/core/evolution.ts`). `from`/`to` may reference built-in or pack species; `axis` is one of `research` / `implementation` / `validation`; `minValidatedRatio` is optional (Guardian-style discipline gate).
- A broken pack is skipped with a warning — it can never crash the host agent.

## Using a pack

```
/pet import <path> [name]     # zip (or zip\inner path) / image folder / PNG / pack.json / tuipet sprites.json(.gz)
/pet import <sprites.json> Agumon,Greymon   # tuipet extraction: pick creatures (auto-chains evolutions)
/pet list                     # every species (built-ins + packs)
/pet use my-pet               # your active pet becomes that species (keeps XP/traits/history)
/pet size 32                  # sprite size 16-60 (pixels); the panel grows with it
/pet                           # full view (also size-aware)

`/pet import` accepts a `pack.json` file, a directory containing one, a tuipet `sprites.json(.gz)` extraction (followed by comma-separated creature names), a single PNG (11 poses auto-derived), a folder of pose-named images (the colour pipeline: full-colour poses + 32/64 hi-res layers), or a zip archive — including 7-Zip style inner paths like `mon.zip\source_crops`. Image folders may sit any depth inside the archive. The imported species is activated automatically; pass a trailing name to name it. The pack is installed into the pets directory, validated immediately (broken packs are rolled back with the error shown), registered on the spot — no restart needed — and stays installed across sessions. Manual copying into the pets directory still works too.

## Checking a pack without Pi

```
npm run packs                    # scans the default directory
npm run packs -- --dir ./test-packs
```

It prints loaded species, evolution rules, and every validation error.

## Getting Digimon-style sprites (your responsibility)

tuipet's README documents extracting sprites from your own copy of DVPet (`tools/extract_sprites.py` — their MIT tooling, your DVPet data). The extracted frames are 16×16 `'0'/'1'` rows — exactly this pack format — but keep the results in your local pets directory only.

### One-command import from a tuipet extraction

A full template lives at [`examples/pet-pack/`](../examples/pet-pack/README.md) (original art — copy freely). To convert a tuipet `sprites.json`/`.json.gz` you extracted yourself:

```
npm run pack:from-tuipet -- --sprites path/to/sprites.json --names "Agumon,Greymon" --chain
```

- writes `<pets dir>/<pack-slug>/pack.json` and validates it immediately
- `--chain` wires `byte -> first -> second ...` evolution hops with gentle default gates (axes rotate research/implementation/validation along the chain)
- `--map "think=3,codeA=7"` remaps frame indices if you dislike the defaults

### From any PNG image (no hand-assembling grids)

Skip the character grids entirely — feed an image. **Have GPT (or any generator) draw the frames?** See [`docs/gpt-image-spec.md`](gpt-image-spec.md) for the ready-to-paste prompt and the numbered file list (`idle1.png idle2.png ... code1.png code2.png ...`) — any number of frames per state:

```
npm run pack:from-image -- --img pose-folder/ --name 亚古兽 --id agumon --chain
npm run pack:from-image -- --img agumon.png --name 亚古兽 --id agumon --chain
npm run pack:from-image -- --img sheet.png --frames 11 --name Agumon
```

- **pose folder**: images named `<activity><N>.png` (idle1..idle4, code1..code3, think1...; only `idle` is required — missing activities fall back to the idle loop); legacy names (idleA/codeB/think.png...) also accepted
- **single PNG**: all 11 poses auto-derived (bounces/mirror/slump) — any illustration becomes a living pet in seconds
- **`--frames N`**: horizontal sprite sheet; an 11-frame strip maps with the tuipet pose table below
- ink = auto-detected: transparent backgrounds mean "any opaque pixel"; opaque (e.g. white GPT) backgrounds mean "colour far enough from the background" — `--threshold` is that distance (default 60; lower it if art comes out blank)
- images are area-averaged into 16×14 and grounded like the built-ins
- `--out` defaults to the real pets directory, so after generating you only need `/reload` — or `/pet import <generated pack.json>` for instant registration

Default frame mapping (tuipet's 11-frame strip → agentMon poses):

| pose | frame | tuipet role | pose | frame | tuipet role |
| --- | --- | --- | --- | --- | --- |
| idleA | 0 | idle/walk-A | testA | 6 | attack |
| idleB | 1 | idle/walk-B | testB | 0 | stance |
| think | 4 | refuse (head down) | happy | 5 | cheer |
| search | 6 | attack/jeer (scanning) | sad | 9 | weary |
| codeA | 7 | chew | sleep | 2 | sleep-A |
| codeB | 8 | eat | | | |

Then `/pet list`, `/pet use agumon` — or let the wired evolution gates grow into it naturally.
