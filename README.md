# agentMon

A reference-first terminal V-Pet that lives inside your coding agent: the agent's real coding behavior (reads, edits, tests, task outcomes) raises, shapes, and evolves a pixel pet rendered as a classic 32×16 LCD using Unicode half-blocks.

> **Naming:** the implementation plan refers to the project as **CodePet**; this repo (`agentMon`) is its implementation home.

**Status: Stage 4 complete · next: Stage 5 (evolution — three branches from ByteBaby)**

- Full plan: [`docs/plan.md`](docs/plan.md)
- Stage 0 deliverable: [`docs/reference-audit.md`](docs/reference-audit.md) — per-repo findings, reuse verdicts (COPY/PORT/ADAPT/ORIGINAL), and the design decisions they lock in
- Stage 1 deliverable: the renderer port (`packages/renderer/`) + **Byte**, the first original creature (`pets/sprites/byte.ts`) — run `npm install && npm run demo` (or `npm run demo:live`), all poses via `npm run preview`
- Stage 2 deliverable: the pet core (`packages/core/`, `packages/events/`, `packages/storage/`) — pure `reduceEvent`/`tick` with injected clock, atomic saves + batched catch-up, pet collection. See it live without Pi: `npm run session`
- Stage 3 deliverable: the Pi extension (`packages/adapters/pi/`, `packages/pi-extension/`) — normalized event adapter, below-editor LCD widget, `/pet` full view

## Install into Pi

```
pi install git:github.com/yuxiang115/agentMon
```

Then just work: reads/writes/tests drive the pet, the LCD widget rides below the editor, `/pet` opens the full view. State lives in `<pi agent dir>/agentmon/state.json` (atomic saves; survives reloads).

## Rule #1 — do not reinvent

Before writing substantial new code, audit and reuse/port/adapt the reference projects:

| Concern | Primary reference |
| --- | --- |
| Coding-agent events, project→pet mapping | [ntd4996/agentpet](https://github.com/ntd4996/agentpet) |
| V-Pet rendering, half-block sprites, evolution gating | [joeltco/tuipet](https://github.com/joeltco/tuipet) |
| Core/UI separation, shared engine + frontends | [siegerts/tama96](https://github.com/siegerts/tama96) |
| Extension UI, widgets, game loops | [earendil-works/pi](https://github.com/earendil-works/pi) examples |
| Plugin boundaries, agent integrations | [usik/tamagotchi](https://github.com/usik/tamagotchi) |
| Pi extension packaging, SQLite tool logging | [kcosr/pi-extensions](https://github.com/kcosr/pi-extensions) |

Original engineering is reserved for the differentiated layer: the coding-event taxonomy, outcome-based XP, behavioral traits, care mistakes, coding-driven evolution, and multi-pet semantics — see plan §21.

## Licensing red line

tuipet's code is MIT, but its Digimon sprites/game data belong to Bandai and are NOT covered by that license. agentMon ships only original creatures — never Digimon sprites, species names/designs, or extracted game data.

## Repo layout (planned)

See plan §9. Structure may change based on the Stage 0 audit findings.
