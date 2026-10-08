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

- **Poses**: every species needs all 11 poses; each pose is exactly 16 rows of 16 characters, ink `1` or `#`, blank `0` or `.`. Ground the feet on row 13 (rows 14–15 empty) so the pet lines up with the built-ins.
- **roles** is optional — omit it to get the standard coding role table.
- **id** must be lowercase letters/digits/dashes. A pack id may intentionally **reskin a built-in** (e.g. replace `byte`); the pack wins.
- **evolutions** use the same multi-gate system as the built-ins (`packages/core/evolution.ts`). `from`/`to` may reference built-in or pack species; `axis` is one of `research` / `implementation` / `validation`; `minValidatedRatio` is optional (Guardian-style discipline gate).
- A broken pack is skipped with a warning — it can never crash the host agent.

## Using a pack

```
/pets import <path>            # install from a pack.json / folder / tuipet sprites.json(.gz)
/pets import <sprites.json> Agumon,Greymon   # tuipet extraction: pick creatures (auto-chains evolutions)
/pets list                     # every species (built-ins + packs)
/pets use my-pet               # your active pet becomes that species (keeps XP/traits/history)
/pet                           # full view
```

`/pets import` accepts a `pack.json` file, a directory containing one, or a tuipet `sprites.json(.gz)` extraction (followed by comma-separated creature names). The pack is installed into the pets directory, validated immediately (broken packs are rolled back with the error shown), registered on the spot — no restart needed — and stays installed across sessions. Manual copying into the pets directory still works too.

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

Default frame mapping (tuipet's 11-frame strip → agentMon poses):

| pose | frame | tuipet role | pose | frame | tuipet role |
| --- | --- | --- | --- | --- | --- |
| idleA | 0 | idle/walk-A | testA | 6 | attack |
| idleB | 1 | idle/walk-B | testB | 0 | stance |
| think | 4 | refuse (head down) | happy | 5 | cheer |
| search | 6 | attack/jeer (scanning) | sad | 9 | weary |
| codeA | 7 | chew | sleep | 2 | sleep-A |
| codeB | 8 | eat | | | |

Then `/pets list`, `/pets use agumon` — or let the wired evolution gates grow into it naturally.
