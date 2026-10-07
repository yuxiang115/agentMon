# CodePet — Reference-First Implementation Plan

> Archived verbatim from the project kickoff (2026-10-07). Stray "(GitHub)" citation markers from the original research notes were removed; content is otherwise unchanged.

## Critical instruction

Do NOT implement CodePet from scratch.

Before writing substantial new code, inspect the open-source projects listed below and reuse or adapt existing implementations wherever licensing and architecture allow.

The goal is not to reinvent:

- coding-agent hooks
- agent lifecycle detection
- virtual-pet lifecycle
- evolution rules
- terminal sprite rendering
- half-block rendering
- terminal animation loops
- persistence patterns
- Pi extension UI
- Pi event handling

CodePet should primarily be an integration/recomposition project with a relatively small amount of original glue and coding-specific game logic.

---

## 1. Required reference repositories

### A. AgentPet — primary reference for coding-agent integration

Repository:

```
ntd4996/agentpet
```

This is the most important reference for the Agent → Pet event pipeline.

AgentPet already monitors multiple coding agents including Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Pi and others. It supports multiple concurrent agents, project awareness, per-project pets, XP/evolution concepts, and a universal wrapper for unsupported CLIs. Its architecture uses lightweight agent hooks feeding events into a local daemon/store.

#### Study from AgentPet

Inspect specifically:

- README
- `docs/specs/`
- agent hook installation
- agent detection
- session tracking
- working/waiting/done state model
- Unix socket event transport
- project detection
- per-project pet assignment
- pet-pack format

Do NOT blindly port its XP design.

AgentPet currently rewards things such as tokens consumed and completed sessions. CodePet should instead emphasize successful outcomes and coding quality, because rewarding token consumption would reward inefficient agents.

#### Reuse conceptually

```
Agent-specific hook
        ↓
small event payload
        ↓
central event receiver
        ↓
project/session identification
        ↓
pet state
```

#### Desired CodePet improvement

Expand AgentPet's relatively coarse agent states:

- working
- waiting
- done

into richer coding events:

- READ
- SEARCH
- THINK
- CODE_WRITE
- COMMAND
- TEST
- BUILD
- SUCCESS
- FAILURE
- USER_CORRECTION
- TASK_COMPLETE

AgentPet proves the adapter architecture.

CodePet makes those events gameplay-relevant.

---

## 2. tuipet — primary reference for Digimon/V-Pet gameplay and rendering

Repository:

```
joeltco/tuipet
```

This is the primary reference for the actual V-Pet feeling.

Do not redesign a Digimon-style terminal renderer without studying this repository first.

tuipet already implements terminal V-Pet rendering using 1-bit bitmap sprites + Unicode half-block rendering and includes classic V-Pet-style care, training, evolution conditions, battles, adventure systems and animation timelines.

### Study specifically

- `src/tuipet/`
- `tools/preview.py`
- `tools/allframes.py`
- sprite rendering code
- animation scheduler
- frame selection
- creature positioning
- screen transitions
- evolution rule implementation
- care mistake logic
- battle/win counters

Particularly inspect how this pipeline works:

```
1-bit sprite
    ↓
logical pixels
    ↓
half-block encoding
    ↓
terminal output
```

Its sprite tooling already supports previewing creatures as half-block terminal graphics.

### CodePet rendering should borrow this idea

Logical LCD:

```
32 × 16 pixels
```

Creature sprite:

```
16 × 16 pixels
```

Terminal encoding:

```
top bottom
0   0 → " "
1   0 → "▀"
0   1 → "▄"
1   1 → "█"
```

Thus:

```
16 logical vertical pixels
        ↓
8 terminal rows
```

### Evolution design reference

tuipet's evolution system uses combinations of:

- care mistakes
- overfeeding
- sleep disturbance
- weight
- battles
- wins
- generation

rather than simply `level >= N`.

CodePet should preserve that design philosophy but replace inputs with coding behavior:

```
care mistakes  → avoidable agent mistakes
training       → testing/validation
battles        → coding tasks/evals
win ratio      → successful task ratio
weight         → potentially efficiency/context behavior
care quality   → validation + instruction adherence
```

### VERY IMPORTANT licensing rule

tuipet's code is MIT, but its Digimon sprites/game data are NOT covered by that MIT license and belong to Bandai.

Therefore:

DO:

- reuse algorithms
- reuse rendering ideas
- reuse general code if license notices are preserved
- reuse architecture

DO NOT:

- ship Digimon sprites
- ship extracted Bandai data
- copy species names/designs
- copy `sprites.json.gz` into CodePet

Create original CodePet creatures.

---

## 3. tama96 — primary reference for game-core separation

Repository:

```
siegerts/tama96
```

Study this before deciding CodePet's process architecture.

tama96 cleanly separates:

- `tama-core`
- `tama-tui`
- `tama-tauri`
- `mcp-server`

with one shared game engine driving multiple frontends. It also handles persistent state and synchronization between frontend modes.

### Inspect specifically

- `tama-core/`
- `tama-tui/`
- `mcp-server/`
- `.kiro/specs/tama96/design.md`

### Architecture idea to adopt

CodePet should similarly have:

- `codepet-core`
- `codepet-renderer`
- `codepet-agent-adapters`
- `codepet-pi`
- `codepet-cli`

The game engine should know nothing about Pi.

Pi should merely emit events and render state.

Desired dependency direction:

```
Pi
 ↓
Pi Adapter
 ↓
CodePet Event
 ↓
CodePet Core
 ↓
Pet State
 ↓
Renderer
```

Never:

```
CodePet Core
 ↓
Pi APIs
```

Also study:

tama96 handles the concept of one process owning the simulation while another frontend can act as a client.

Do not necessarily implement a daemon in v0.1, but design the state layer so multiple agent processes can eventually report events safely.

This matters once several Code Agents run concurrently.

---

## 4. Pi itself — do not fork Pi

Official/current Pi repository:

```
earendil-works/pi
```

Use Pi's extension system.

Do NOT modify Pi core unless an extension API limitation makes it absolutely unavoidable.

Pi supports TypeScript extensions that can subscribe to lifecycle/tool events, register commands and create custom TUI elements.

Important APIs include:

- `pi.on(...)`
- `pi.registerCommand(...)`
- `ctx.ui.setStatus(...)`
- `ctx.ui.setWidget(...)`
- `ctx.ui.custom(...)`
- `ctx.ui.setFooter(...)`

Pi's `tool_call` event exposes tool names such as:

- `bash`
- `read`
- `write`
- `edit`

and their inputs, making it suitable for translating real agent activity into CodePet events.

### Read these Pi files first

- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/examples/extensions/`

Especially inspect examples corresponding to:

- `status-line.ts`
- `widget-placement.ts`
- `custom-footer.ts`
- `todo.ts`
- `event-bus.ts`
- `subagent/`
- `snake.ts`
- `space-invaders.ts`

Why:

- status-line → persistent compact pet status
- widget-placement → pet LCD near editor
- custom-footer → optional compact pet mode
- todo → stateful extension example
- event-bus → internal extension communication
- subagent → future multi-pet / side-agent integration
- snake / space-invaders → game loops + keyboard interaction inside Pi

Pi explicitly supports widgets above/below the editor as well as custom footer components.

Therefore the pet should initially be implemented entirely as a Pi extension/package.

---

## 5. usik/tamagotchi — secondary reference for pet/plugin integration

Repository:

```
usik/tamagotchi
```

This repository is useful because it combines:

- terminal pet
- pet core
- plugin system
- coding-agent integrations
- tmux integration
- shell integration
- persistent state

Its structure already separates:

```
src/tamagotchi/core/
src/tamagotchi/ui/
src/tamagotchi/plugins/
plugins/claude_code/
plugins/aider/
plugins/goose/
integrations/tmux/
integrations/starship/
```

and exposes agent events such as test success/failure and task completion into pet reactions.

Use it primarily as a reference for:

- agent plugin boundaries
- installation UX
- shell integrations
- pet lifecycle organization
- testing strategy

Do not use its ASCII rendering as the primary visual approach.

CodePet should use tuipet-style pixel/half-block rendering instead.

---

## 6. Optional reference: Pi community extensions

Repository:

```
kcosr/pi-extensions
```

This is useful for seeing how real third-party Pi extensions are packaged.

Particularly inspect:

```
toolwatch/
```

It already demonstrates observing Pi tool calls and persisting/auditing activity, including SQLite usage.

Do not necessarily depend on it.

Use it to avoid inventing a Pi-extension packaging pattern.

---

## 7. Before coding: mandatory repository audit

First task:

Clone/read the reference repositories.

Do NOT implement features yet.

Produce:

```
docs/reference-audit.md
```

The document must answer:

| Problem | Best reference | Reuse strategy |
| --- | --- | --- |
| Pi events | Pi official | direct API usage |
| Pi widget | Pi official examples | adapt |
| multi-agent detection | AgentPet | architecture/logic |
| project→pet mapping | AgentPet | adapt |
| V-Pet rendering | tuipet | port concept/code where appropriate |
| animation frames | tuipet | adapt |
| evolution mechanics | tuipet | adapt model |
| core/UI separation | tama96 | architecture |
| plugin boundaries | usik/tamagotchi | architecture |
| SQLite/tool logging | pi-extensions | reference |

For every useful module discovered, record:

- repository
- source path
- license
- what it does
- reuse directly? / port? / rewrite? / ignore?

---

## 8. Reuse policy

Classify existing implementation into four categories.

### COPY

Use largely unchanged if:

- license allows it
- language matches
- implementation already solves exact problem

Preserve required notices.

### PORT

Use when implementation solves the exact problem but is written in another language.

Example:

```
tuipet Python half-block renderer
        ↓
TypeScript equivalent
```

Do not redesign the algorithm unnecessarily.

### ADAPT

Use the same architecture but change domain logic.

Example:

```
AgentPet project pet assignment
        ↓
CodePet project pet assignment
```

### ORIGINAL

Only write new systems where CodePet is genuinely different.

Primary original areas should be:

- coding-event taxonomy
- coding XP rules
- coding behavioral traits
- coding-specific care mistakes
- coding-driven evolution conditions
- multi-pet deployment semantics

---

## 9. Revised architecture

After studying the repositories, implement approximately:

```
codepet/
│
├── packages/
│
│   ├── core/
│   │    pet.ts
│   │    evolution.ts
│   │    xp.ts
│   │    traits.ts
│   │    care.ts
│   │
│   ├── events/
│   │    types.ts
│   │    normalizer.ts
│   │
│   ├── renderer/
│   │    framebuffer.ts
│   │    halfblock.ts
│   │    animation.ts
│   │    lcd.ts
│   │
│   ├── storage/
│   │    sqlite.ts
│   │
│   ├── adapters/
│   │    pi/
│   │
│   └── pi-extension/
│
├── pets/
│    species/
│    sprites/
│
├── docs/
│    reference-audit.md
│    event-spec.md
│    evolution-spec.md
│
└── tests/
```

But adjust this structure if the reference audit shows a cleaner pattern.

---

## 10. First thing to reuse: renderer

Do NOT spend several hours inventing terminal pixel rendering.

Study tuipet's implementation.

Port its fundamental approach to TypeScript:

```
1-bit bitmap
      ↓
two bitmap rows
      ↓
Unicode half-block
      ↓
ANSI foreground/background
      ↓
terminal string
```

Build:

```
renderBitmap(bitmap): string[]
```

Input:

```
16×16 boolean bitmap
```

Output:

```
16 columns × 8 terminal rows
```

Tests must cover:

```
00 → space
10 → ▀
01 → ▄
11 → █
```

---

## 11. First pet

Do NOT create a large art library.

Create ONE original creature.

Required poses:

- idleA
- idleB
- think
- search
- codeA
- codeB
- testA
- testB
- happy
- sad
- sleep

Use the same small-frame philosophy as classic V-Pets/tuipet.

Once the pipeline works, adding species is data work rather than engineering work.

---

## 12. Agent event system

Use AgentPet as the architectural reference, but use Pi's native event API for the first adapter.

Normalized events:

- SESSION_START
- SESSION_END
- THINK_START
- THINK_END
- READ
- SEARCH
- CODE_WRITE
- COMMAND_RUN
- TEST_START
- TEST_PASS
- TEST_FAIL
- BUILD_START
- BUILD_PASS
- BUILD_FAIL
- TASK_COMPLETE
- TASK_FAILED
- USER_CORRECTION
- IDLE

Pi adapter example:

```
Pi read            → READ
Pi edit/write      → CODE_WRITE
Pi bash pytest/npm test/cargo test → TEST_START
    result success → TEST_PASS
    result failure → TEST_FAIL
```

Keep raw Pi event parsing inside:

```
adapters/pi/
```

The core must never see Pi tool names.

---

## 13. Animation semantics

Borrow the V-Pet animation model from tuipet rather than building a modern high-FPS animation engine.

Target:

```
2–4 FPS
```

Mostly two-frame loops.

Example:

```
CODE_WRITE
codeA
codeB
codeA
codeB
```

Pet events should interrupt animations through priorities:

1. EVOLUTION
2. SUCCESS
3. FAILURE
4. TEST
5. CODE
6. SEARCH
7. THINK
8. IDLE

---

## 14. Game-state architecture

Use tama96's separation philosophy.

Core function should behave roughly like:

```
nextState = reduceEvent(currentState, event)
```

Renderer receives:

```
render(nextState)
```

Persistence receives:

```
save(nextState)
```

Do not allow UI functions to mutate gameplay.

---

## 15. XP

This is one area we SHOULD build ourselves.

Do not copy AgentPet's token-based progression.

CodePet should reward useful outcomes.

Initial model:

- task success
- tests passed
- build passed
- validated completion
- first-pass completion

Raw tool calls should generally NOT award XP.

Example:

```
READ × 100          → 0 XP
EDIT × 30           → 0 XP
TEST_PASS tied to task → XP
TASK_COMPLETE       → XP
```

Add deduplication so repeatedly running:

```
npm test
npm test
npm test
```

cannot farm XP.

---

## 16. Behavioral evolution

Borrow tuipet's multi-condition evolution concept.

Replace V-Pet inputs with coding inputs.

Example:

```
             ByteBaby
                 │
       ┌─────────┼─────────┐
       │         │         │
     Scout     Builder   Guardian
```

Requirements:

- Scout: research/search dominant
- Builder: implementation dominant
- Guardian: testing/review/reliability dominant

Later:

```
Scout    → Seeker   → Oracle
Builder  → Engineer → Architect
Guardian → Auditor  → Sentinel
```

Evolution should use multiple gates:

- level
- trait profile
- task success
- care mistakes
- validation discipline

not only XP.

---

## 17. Multi-pet model

Borrow AgentPet's project-pet idea.

User owns:

```
Pet Box
```

Example:

```
★ Byte      Lv.12
  Scout     Lv.8
  Guard     Lv.9
```

One pet is globally active.

Optional project override:

```
default       → Byte
~/LongLens    → Scout
~/backend     → Guard
```

Selection:

```
project pet
if none:
default active pet
```

---

## 18. Pi UI

Do not invent terminal screen management manually.

Use Pi's TUI APIs.

Compact always-visible mode:

```
ctx.ui.setWidget(...)
```

or, if more appropriate:

```
ctx.ui.setFooter(...)
```

Example:

```
┌─ Byte Lv.12 ────────────────┐
│       ▄████▄                 │
│      ████████   ⚒ CODING    │
│       ▀████▀     821/900 XP  │
└──────────────────────────────┘
```

Full V-Pet interface:

```
/pet
```

should use:

```
ctx.ui.custom(...)
```

and keyboard handling.

Study Pi's existing game extensions before implementing this.

Pi documentation explicitly includes game extensions such as Snake and Space Invaders, so use those implementations as the model for event loops, keyboard handling and custom terminal drawing.

---

## 19. Implementation order

Do not implement the old plan from scratch.

Use this order:

### Stage 0 — Repository audit

Study:

- AgentPet
- tuipet
- tama96
- Pi
- usik/tamagotchi
- pi-extensions

Produce:

```
reference-audit.md
```

### Stage 1 — Extract/port renderer

From tuipet concepts:

- framebuffer
- half-block renderer
- animation timing
- sprite positioning

Create one original sprite.

Deliver:

```
codepet demo
```

### Stage 2 — Pet core

Use tama96 architecture as reference.

Implement:

- state
- persistence
- event reducer
- pet collection
- active pet

### Stage 3 — Pi integration

Use Pi official examples.

Implement:

- Pi event listener
- normalized event adapter
- widget
- `/pet`

### Stage 4 — coding progression

Original CodePet logic:

- XP
- traits
- care mistakes
- task boundaries

### Stage 5 — evolution

Use tuipet's gating philosophy.

Implement three first evolution branches.

### Stage 6 — project pets

Use AgentPet as reference.

Implement:

```
project → pet
```

### Stage 7 — multi-agent groundwork

Study AgentPet's daemon/event transport.

Only add a separate daemon/event bus if multiple independent Code Agent processes require it.

Do NOT introduce infrastructure before it is required.

---

## 20. What NOT to reinvent

Before implementing any of these, search the reference repos:

- terminal animation
- half-block conversion
- sprite frame handling
- Pi widget rendering
- Pi command registration
- Pi keyboard handling
- session detection
- project detection
- agent hook installation
- persistent pet state
- evolution condition evaluation
- pet lifecycle timer
- single-instance locking

If a reference implementation exists and is compatible with our requirements, reuse/port/adapt it.

---

## 21. What CodePet should actually invent

The differentiated IP/engineering should be concentrated here:

- **Code Agent Event Protocol** — agent event → pet action
- **Coding Outcome Engine** — successful work → XP
- **Behavior Profile** — how the agent works → traits
- **Care Quality** — agent mistakes → care mistakes
- **Evolution Mapping** — long-term coding behavior → creature evolution
- **Multi-Agent Deployment** — side agents → reserve pets

That is the real CodePet product.

Everything else is infrastructure that should be borrowed wherever possible.

---

## 22. v0.1 target

The first real version should demonstrate this exact vertical slice:

```
Start Pi
   ↓
active pet appears

Agent reads source
   ↓
pet searches

Agent edits source
   ↓
pet codes

Agent runs tests
   ↓
pet trains

Tests pass
   ↓
pet celebrates

Task completes
   ↓
XP awarded

Repeated sessions
   ↓
behavior traits emerge

Evolution requirement reached
   ↓
pet evolves
```

Plus:

```
/pet
```

opens a classic V-Pet-like terminal UI.

---

## 23. Success criterion

The project is successful when the majority of engineering effort is spent on:

- agent-event semantics
- pet behavior
- progression
- evolution
- multi-agent gameplay

and NOT on:

- inventing another terminal renderer
- inventing another Pi UI framework
- inventing another hook mechanism
- inventing another persistence system

Use existing open-source work aggressively and legally.

**First action:**

Do the repository audit. Do not begin implementing the full product until `docs/reference-audit.md` identifies exactly what will be copied, ported, adapted, and written from scratch.
