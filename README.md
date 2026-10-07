# agentMon

A reference-first terminal V-Pet that lives inside your coding agent: the agent's real coding behavior (reads, edits, tests, task outcomes) raises, shapes, and evolves a pixel pet rendered as a classic 32×16 LCD using Unicode half-blocks.

> **Naming:** the implementation plan refers to the project as **CodePet**; this repo (`agentMon`) is its implementation home.

**Status: Stage 0 complete · next: Stage 1 (renderer port + first original sprite)**

- Full plan: [`docs/plan.md`](docs/plan.md)
- Stage 0 deliverable: [`docs/reference-audit.md`](docs/reference-audit.md) — per-repo findings, reuse verdicts (COPY/PORT/ADAPT/ORIGINAL), and the design decisions they lock in

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
