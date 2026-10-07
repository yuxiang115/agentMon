# agentMon (CodePet) — Stage 0 Reference Repository Audit

Date: 2026-10-07. Method: all six reference repos shallow-cloned to `reference/` (gitignored) and read directly. All source paths below are relative to each repo's root. This document is the gate required by the plan (§7): nothing gets implemented before it identifies exactly what is copied, ported, adapted, and written from scratch.

Verdict legend — **COPY** (reuse nearly unchanged, keep notices) · **PORT** (reuse the algorithm, translate language) · **ADAPT** (reuse the architecture, replace domain logic) · **ORIGINAL** (genuinely new code) · **IGNORE**.

---

## 0. Executive summary

The plan's hypothesis held up: every infrastructure layer has a proven MIT-licensed reference, and agentMon's original work can be confined to the coding-event → gameplay layer. Concretely:

1. **The whole event pipeline exists twice over.** In-process: Pi's `pi.on("tool_call"/"tool_result"/"tool_execution_end")` (official extension API) — toolwatch is a near-verbatim COPY template for ingesting it. Out-of-process: AgentPet's hook → Unix-socket → daemon pipeline (needed only from Stage 7).
2. **The renderer is a direct Python→TS port.** tuipet `render.py` (197 lines, dependency-light) is the half-block compositor; `grid.py` is pure LCD geometry; `anim.py` is the cadence/roam scheduler.
3. **The state core should be tama96-shaped:** injected clock, `tick(state, now)`, atomic save, elapsed-time catch-up on load — a daemonless v0.1 where the Pi extension does load → catch-up → event → save.
4. **The agent-behavior classifier already exists** in usik/tamagotchi (`AgentBehaviorClassifier`, ~50 lines, pure logic): BLOCKED / LOOPING / SHIPPING / EXPLORING / WORKING. PORT and re-target its inputs at coding events.
5. **Evolution gating is a port of tuipet's evaluator** (multi-gate conditions + probability roll + fulfilled/deviation selection) with our own species data; care mistakes port its "three canonical calls + 600 s response window" model.
6. **XP stays ORIGINAL** per plan §15. AgentPet's system (1 XP per 5,000 tokens, +25 per finished session) is explicitly NOT copied — described in §2.1.10 for the record only.

Corrections and watch items discovered by the audit:

- **C1 — LCD geometry.** tuipet's screen is 40×24 px with a **locked 32×16 play window** inside it (`grid.py`: `X0=4, X1=36, TOP=6, FLOOR=22`); sprites baseline 2 px above the bottom border. agentMon's planned 32×16 full LCD corresponds to tuipet's *inner window*, not the outer screen. Adopt: 32×16 LCD, floor baseline at y=13 (2 px margin), exit-by-walking-off-edge semantics.
- **C2 — two half-block encodings, not one.** tuipet's LCD path uses **only `▀`** with ANSI fg/bg (ink on LCD-grey, modeling dead pixels — `render.py::_paint_cells`); the four-glyph mapping (` `/`▀`/`▄`/`█`) is used by `render.py::bitmap_text` for icons. Plan §10's four-glyph `renderBitmap` is valid and simpler (works on any background); the `▀`-only themed path is the "authentic LCD" look. **Decision: implement both** — `bitmapText` (four-glyph, plan §10 + tests) and `lcdFrame` (`▀`-only + theme colors) for the widget.
- **C3 — tama96 has no LICENSE file.** MIT is declared only in README prose and an About screen. It's Rust anyway (everything we take is PORT-by-translation, not COPY); keep it architecture/reference-only and note the caveat.
- **C4 — pi-extensions targets the older package name.** toolwatch depends on `@mariozechner/pi-coding-agent` (badlogic/pi-mono); the plan's Pi repo (`earendil-works/pi`, `@earendil-works/pi-coding-agent`, MIT, Mario Zechman) is the same agent's current home. API names observed in both match (`pi.on("tool_call")`, `ctx.ui.setWidget`, …). Verify exact type names against the earendil package during Stage 3 before copying toolwatch code.
- **C5 — AgentPet already ships a Pi extension** (`HookInstaller.swift:217-241` generates `~/.pi/agent/extensions/agentpet.ts` mapping `session_start/agent_start/agent_end/session_shutdown` → registered/working/done). Confirms Pi's event API is the right integration point; agentMon does NOT need this hook (we live in-process) but it validates the escape hatch for Stage 7.
- **C6 — negative lesson from tamagotchi:** its agent reactivity was never wired up (`plugin_manager.discover()` is never called; `on_tick` never emitted; plugins missing from the wheel). agentMon must ship a startup smoke test asserting events actually reach the pet.

---

## 1. Problem → reference → reuse strategy (plan §7 mandated table)

| Problem | Best reference | Reuse strategy (verified) |
| --- | --- | --- |
| Pi events | Pi official (`packages/coding-agent/docs/extensions.md`, `src/core/extensions/types.ts`) | direct API usage: `pi.on("tool_call")` / `tool_result` / `tool_execution_end` (+ `session_start`, `turn_start/end`, `agent_settled`, `input`) |
| Pi widget | Pi official examples (`widget-placement.ts`, `snake.ts`, `space-invaders.ts`) | ADAPT — factory-component form of `ctx.ui.setWidget`, `setInterval` + `tui.requestRender()`, version-cached render |
| multi-agent detection | AgentPet (`AgentCatalog.swift`, `AgentHooks.swift`, `SessionStore.swift`) | architecture/logic — PORT `SessionStore` + state machine (TS twin already exists at `windows/src/state.ts`); not needed until Stage 7 |
| project→pet mapping | AgentPet (`ProjectPetResolver.swift`) | PORT — normalize + longest-prefix containment, `ProjectPetMapping` model |
| V-Pet rendering | tuipet (`src/tuipet/render.py`) | PORT (Python→TS): `fill_buf`/`_paint_cells`/`bitmap_text`; see C2 for the two encodings |
| animation frames | tuipet (`anim.py`, `arena.py`) | PORT — 10 Hz clock, hold counts, `Roamer` (step 2 px / beat 5, turn 30%, wall-pause), mood poses; ADAPT fx chaining from `arenafx.py` |
| evolution mechanics | tuipet (`evolution.py`) | PORT the evaluator ((cond,value) gates, all-pass + probability, fulfilled/deviation selection); species data ORIGINAL |
| core/UI separation | tama96 (`tama-core/src/{state,engine,actions,persistence}.rs`) | architecture — injected `now`, `tick`, command functions with typed errors, atomic save, catch-up load |
| plugin boundaries | usik/tamagotchi (`src/tamagotchi/plugins/base.py`) | architecture — PORT `AgentBehaviorClassifier`; event vocabulary (`on_agent_event`: `test_passed/test_failed/task_complete/loop_detected/…`) is a good naming cross-check |
| SQLite/tool logging | kcosr/pi-extensions (`toolwatch/`) | reference — COPY the extension-side event ingestion template; ADAPT the better-sqlite3 schema only if an event-history DB is added (deferred past v0.1) |

---

## 2. Per-repo findings

### 2.1 AgentPet (`ntd4996/agentpet`) — coding-agent integration reference

**License:** MIT (`LICENSE`, "Copyright (c) 2026 Nguyễn Thành Đạt"), no exceptions. Language: Swift 6 / SwiftUI (macOS), with a Rust+TS Windows port and an Astro web gallery. Design spec: `docs/specs/2026-05-29-agentpet-design.md` (Vietnamese).

**Architecture (ADAPT):** one binary, three roles (`Sources/App/AppEntry.swift`): `agentpet hook …` (hook CLI), `agentpet run … -- <cmd>` (universal wrapper), no args → menu-bar app whose process hosts the daemon. Data flow:

```
agent hook fires → "agentpet hook --agent <kind>" → payload decoded per-agent (CLI.swift)
  → AgentEvent (TerminalInfo tags) → newline-JSON to unix socket ~/.agentpet/agentpet.sock
  → (socket down: queue file ~/.agentpet/queue/<epoch>-<uuid>.json, replayed with ORIGINAL timestamps at daemon start)
  → EventSocketServer → AppDaemon.ingest → SessionStore.apply → StateMapper (event→state)
  → MoodResolver.aggregate → pet mood / per-project pet windows
```

Key modules:

| Module | What it does | Verdict |
| --- | --- | --- |
| `Sources/AgentPetCore/AgentEvent.swift`, `EventCoding.swift` | canonical event record (below) | PORT — define one canonical TS event type from this |
| `Sources/AgentPetCore/EventSender.swift`, `EventSocketServer.swift` | NDJSON unix-socket transport + offline queue drain | PORT (Node `net`+`fs`); **caveat:** `start()` unlinks-then-binds — a second daemon steals the socket; use exclusive bind / lockfile instead |
| `Sources/AgentPetCore/StateMapper.swift` | per-agent event → working/waiting/done table; `SubagentStop` deliberately ignored (anti-flicker) | PORT (cross-check `windows/src-tauri/src/statemap.rs`) |
| `Sources/AgentPetCore/SessionStore.swift` | in-memory session map + time-based pruning (done→idle 30 s, idle gone 600 s, stale-active 300 s) | PORT / COPY the TS twin `windows/src/state.ts` |
| `Sources/AgentPetCore/AgentHooks.swift`, `AgentCatalog.swift`, `HookInstaller.swift` | 13-agent hook catalog, per-agent config formats, idempotent atomic config edits ("ours" = command contains `agentpet`+`hook`) | PORT (data tables + pure transforms); **not needed until Stage 7** |
| `HookInstaller.piExtension` (lines 217-241) | generates a TS Pi extension emitting normalized states | COPY if Stage 7 wants out-of-process Pi support |
| `Sources/AgentPetCore/ProjectPetResolver.swift`, `ProjectPetMapping.swift` | project = raw cwd (no git-root resolution), normalized longest-prefix containment picks the pet | PORT (Stage 6) |
| `Sources/App/SpriteSlicer.swift` + `pet.json` | pet-pack format: `~/.agentpet/pets/<slug>/pet.json` `{id, displayName, description, spritesheetPath}`; frames auto-sliced by transparent gutters | ADAPT — we use authored 16×16 bitmaps, but keep manifest spirit |
| `Sources/AgentPetCore/PetCare.swift` + `AppDaemon` token feeding | **XP system — do NOT copy** (see below) | IGNORE (schema reference only) |
| `Sources/AgentPetCore/QuestionDetector.swift`, `PerKeyThrottle.swift`, `TranscriptReader.swift` | pure-string question detect; per-key throttle; incremental byte-offset transcript usage scan | PORT later (Stage 7 niceties) |
| macOS UI, `web/`, `landing/`, `cdn-proxy/` | — | IGNORE |

Event JSON schema (PORT this shape):

```json
{"sessionId":"…","agentKind":"claude","eventName":"Stop","project":"/path/cwd",
 "message":"…","model":"…","transcriptPath":"…","subagentId":null,"toolName":"Bash",
 "toolSummary":"…","terminalProgram":"…","timestamp":1760000000}
```

**XP system, for the record (IGNORE):** 1 XP per 5,000 tokens consumed (input+output deltas read incrementally from Claude/Codex transcripts, byte-offset tracked, 10 s throttle), +25 XP per session→done, level curve 60·n·(n−1). This rewards volume; agentMon replaces it entirely with outcome-based XP (plan §15, ORIGINAL).

**Security note:** no auth on the socket — any local process can inject events. If agentMon ever adds a daemon, require at least a shared-token check.

### 2.2 tuipet (`joeltco/tuipet`) — rendering + gameplay reference

**License — the critical split:** `LICENSE` = MIT ("Copyright (c) 2026 Joel Taylor") covering **source only**. `NOTICE` (root) + README state: the runtime game data/sprites are derived from DVPet and Digimon (© Bandai) and are **NOT licensed here**.

**OFF-LIMITS (never copy into agentMon):** everything under `src/tuipet/data/` — `sprites.json.gz`, `eggs.json.gz`, `effects.json.gz`, `icons.json.gz`, `backgrounds.json.gz`, `battle_fx.json.gz`, `orbs.json.gz`, `*.json` overlays, every CSV (`digimon.csv`, `evolutions.csv`, `lines.csv`, …), `sounds/*.wav`, `demo.gif`, `scratchpad_bg_*.png`, `server/raid_*.json` — plus species names/numbers/thresholds echoed in docs/tests. agentMon ships only original creatures.

**Rendering pipeline (PORT wholesale, `src/tuipet/render.py`, 197 lines):**
- Sprite frame = `list[str]` of `'0'`/`'1'` rows.
- `fill_buf()` builds an int pixel buffer (planes: 0 off, 1 sprite ink, 2 weather/free ink), center-x + floor-baseline (`oy = max(0, px_h - sh - 2)`), half-open clip rect = the locked window, "off-window ink is simply not displayed (which is also HOW things exit)".
- `_paint_cells()` pairs pixel rows 2y/2y+1 per character row. **LCD path: always `▀`**, ink color in fg, LCD-grey in bg (dead-pixel model). **Icon path `bitmap_text()`: the four-glyph mapping** `FULL "█" if top&bot, UPPER "▀" if top, LOWER "▄" if bot, " "` — pad to even height first. Constants at `render.py:138`.
- Helpers: `blit()` bitmap→point list; `downsample()` box-downsample (cell on iff `count*2 >= f*f`); `marquee()` hold-then-scroll.
- `menu.py::paint/scene_ink` adds silhouette-over-background + theme colors — PORT (10-line wrapper).

**Geometry (`grid.py`, PORT):** see C1. `CELL=16`, `roam_bounds`, `faceoff()` (battle placement, mirrored facing, collision squeeze), `_crop`/`fit` box-fit helpers.

**Animation (`anim.py`, `arena.py`; PORT):** single 10 Hz clock (`set_interval(0.1)`), pose held `hold = 5/6/7` intervals (restless+/normal/calm), `idx = frames[(frame_i // hold) % len]`; walk = re-pick pose 50/50 each `WALK_BEAT=5`, `STEP_PX=2`, `TURN_CHANCE=0.30`, `WALL_PAUSE=4`; `IDLE_EXPR_CHANCE=0.30` mood-pose substitution; state change restarts cadence at beat 0. Cutscene engine `arenafx.py`: per-kind step tables, chains (evolve→cheer etc.), roamer frozen during fx, **evolution waits for a quiet screen**. 1 Hz life tick and 10 s autosave run on separate timers.

**Evolution (`evolution.py`; PORT evaluator, ORIGINAL data):** gates declared as `(cond ∈ {None,GreaterThan,LessThan,EqualTo}, value)` over `mistakes/overeat/disturb/wins/battles/incarnations/weight/prob/priority/…`; `check()` = all gates pass + probability roll (`boost = evol_bonus + winrate*0.4`); `select()` ranks candidates by `fulfilled()` (1 + priority + weighted met-gate rates), ties by `deviation()` (distance from thresholds), never-stuck fallback. Trigger once per 1 Hz tick when `stage_seconds >= STAGE_DURATION`. This is exactly plan §16's multi-gate philosophy — port the mechanism, author our species/gates.

**Care mistakes (`petbody.py::_inc_mistake`; PORT the model):** exactly three canonical calls — hunger 0 unanswered 600 s; strength 0 unanswered 600 s; lights on while asleep (60 s first, +120 s repeats). 600 s real-time response window is their documented real-time↔game-time adaptation. agentMon's "avoidable agent mistakes" adopt the same shape: a defined window + counted misses + cooldown.

**Tick model (`petbody.py`; PORT the pattern):** 1 real s = 1 game minute; phase order clock→growth→egg→recovery→auto-care→sleep/awake branches→mortality→evolve; every decay = interval + remainder-carrying accumulator (hunger ≈ 45 s/calorie, strength 480 s, poop 360 s). Re-tune constants for coding-session timescales.

**Tools:** `tools/preview.py`, `tools/allframes.py` are the preview UX idea but **currently broken** (import removed `render.frame_text`/`PALETTES`) — ADAPT the idea, write our own sprite previewer. `tools/extract_sprites.py` exists to strip DVPet assets — IGNORE.

**Sprite format (ADAPT the format, not the data):** gzip-JSON array of `{num,name,stage,…,w:16,h:16,frames:[11 × 16-row strings]}`; an 11-frame strip per creature with a fixed role table (`ROLES`: 0 idle-A, 1 idle-B, 2/3 sleep, 4 refuse, 5 cheer, 6 attack, 7 chew, 8 eat, 9 weary, 10 collapse; roles map activity → frame index lists, `MIRROR_ROLES` for head-shakes). **The role grammar is reusable; the frame data is not.** Note: plan §11's pose list (idleA idleB think search codeA codeB testA testB happy sad sleep) is also exactly 11 — adopt an 11-slot strip with a coding-role table.

### 2.3 tama96 (`siegerts/tama96`) — core-separation + state-ownership reference

**License: MIT by README prose only — no LICENSE file (C3).** Treat as architecture reference; everything we take is a Rust→TS translation anyway. Rust workspace: `tama-core`, `tama-tui`, `tama-tauri/src-tauri`, plus non-Cargo `mcp-server/` (Node). Gold doc: `.kiro/specs/tama96/design.md` (1243 lines, 20 numbered correctness properties).

**Core (PORT the design):** one plain `PetState` struct (`state.rs:60-98`) with meters, counters, flags, **wall-clock timestamps** and `Option<DateTime>` deadlines; `engine::tick(state, now)` advances the whole sim by elapsed time; actions are imperative command functions (`actions.rs`) returning typed `ActionError` — preconditions are the whole error vocabulary. **`now` is injected into every time-sensitive function; the core never reads the clock, and random comes from `rand::thread_rng()` (their purity bug — agentMon injects a seeded RNG instead).**

**Persistence (PORT):** single JSON `~/.tama96/state.json`, **write-tmp-then-rename** atomic save, save-after-every-mutation; `load(path, now)` **replays `tick` minute-by-minute from `last_tick` to `now`** (clock skew clamped; corrupt file → `.corrupt` backup → fresh egg). Their minute-loop catch-up is O(minutes elapsed); the design doc's batching optimization was never implemented — agentMon ports the catch-up but **batches** it. Testing gem: `prop_catchup_convergence` (one big tick ≡ many small ticks) — steal as a fast-check property.

**Multi-frontend ownership (ADAPT):** (1) PID lockfile with stale-owner takeover — exactly one *writer*; (2) owner runs a localhost TCP socket (port written to `~/.tama96/mcp_port`), all mutations funneled through it under one mutex, every response carries a post-action state snapshot; (3) non-owners may **read the atomic state file + project with local catch-up + never write back** — safe for any number of observers with no daemon. This triad is agentMon's Stage-7 blueprint; v0.1 keeps only the "every mutation funnels through one function" seam (§3 below).

**mcp-server (ADAPT, relevant since we live inside an agent):** 7 tools mirroring core actions 1:1 + `get_status` + a **static strategy resource** (`pet://evolution-chart`) the agent can read to plan; MCP layer is a thin TCP proxy, authority stays with the state owner.

### 2.4 Pi (`earendil-works/pi`) — the host, used via extension API only

**License:** MIT (repo root, "Copyright (c) 2025 Mario Zechman"). The coding agent is `packages/coding-agent` (`@earendil-works/pi-coding-agent`); UI toolkit `packages/tui`. Canonical types: `packages/coding-agent/src/core/extensions/types.ts`. Docs: `docs/extensions.md`, `docs/configuration.md`, `docs/packages.md`, `docs/tui.md`, `docs/security.md`.

**Extension model:** `export default function (pi: ExtensionAPI) {}` TS module, loaded by jiti (no build step). Locations: `~/.pi/agent/extensions/` (user), `.pi/extensions/` (project, needs trust), `pi -e ./file.ts` (one-shot), or settings `extensions` array. **Don't start timers/processes in the factory** — some loads have no session; start on `session_start`, clean up idempotently in `session_shutdown`. Guard TUI-only APIs with `ctx.mode === "tui"` / `ctx.hasUI`.

**Events (direct API usage):** full catalog in `types.ts` overloads. The ones agentMon needs:
- `tool_call` — **before** execution; discriminated per-tool (`"bash"|"powershell"|"read"|"edit"|"write"|"grep"|"find"|"ls"` + custom), `event.input` shapes: bash `{command, timeout?}`, read `{path, offset?, limit?}`, write `{path, content}`, edit `{path, edits:[{oldText,newText}]}`. Use guards `isToolCallEventType("bash", e)` (plain `===` doesn't narrow).
- `tool_result` / `tool_execution_end` — after execution; `isError: boolean` is the success/failure signal; `tool_execution_end` additionally carries `durationMs` and fires for **every** tool incl. custom/MCP — the simplest single subscription for the pet activity feed.
- Session/turn lifecycle: `session_start`, `turn_start`, `turn_end`, `agent_start`, `agent_end`, `agent_settled`, `input` (user typing → USER_CORRECTION candidate), `session_shutdown`.
- Tool-input inspection makes plan §12's TEST_START detection feasible: match `command` against pytest/npm test/cargo test/etc., then pair with the result's `isError`.

**UI APIs:** `ctx.ui.setStatus(key, text?)` (footer status segment); `ctx.ui.setWidget(key, content, {placement:"aboveEditor"|"belowEditor"})` — string-array form capped at **10 lines**, or a live factory `(tui, theme) => Component` (`render(width): string[]`, optional `handleInput`, `invalidate`, `dispose`, call `tui.requestRender()` after state change); `ctx.ui.custom<T>(factory, {overlay?})` — full-screen/overlay takeover with keyboard focus until the component calls `done(result)`; also `setFooter`, `setHeader`, dialogs, `notify`, `onTerminalInput`.

**Commands:** `pi.registerCommand("pet", { description, handler })` — handler gets `(args, ctx)` with `waitForIdle()`, `newSession()`, `fork()`, `reload()`, …; `registerShortcut` also exists.

**Game-loop pattern (ADAPT — this is the `/pet` skeleton):** from `snake.ts` / `space-invaders.ts` / `doom-overlay/`: `setInterval` tick (100/50/~28 ms) → mutate → `version++` → `tui.requestRender()`; render cache keyed `(width, version)`; `handleInput(data)` with `matchesKey(data,"up"|"escape")`; `wantsKeyRelease = true` for Kitty press/release; ESC → `dispose()` (idempotent, clears interval) → `pi.appendEntry(SAVE_TYPE, state)` → `done()`; resume scans `ctx.sessionManager.getEntries()` backwards for the custom entry type. snake uses 2-char cells for square aspect; doom already renders half-block `▀` with 24-bit ANSI per cell.

**State persistence:** no KV store. In-session: tool-result `details` (todo.ts pattern) or `pi.appendEntry(customType, data)` (excluded from model context). Cross-session: **own file I/O** — e.g. JSON under `getAgentDir()/agentMon/`; `withFileMutationQueue(path, fn)` is exported for serialized read-modify-write. Peer deps (`pi-coding-agent`, `pi-tui`, …) must be `"*"` and never bundled.

**Packaging (direct usage):** a pi-package = directory/npm package exposing `extensions/` etc., or `package.json` `"pi": { "extensions": ["./src/extension.ts"] }`; install via `pi install git:github.com/yuxiang115/agentMon` — this is agentMon's distribution path.

**Gotchas:** hot reload (`/reload`) and session replacement stale captured `pi`/`ctx`; handler errors are reported but Pi continues; sibling tool calls run in parallel (never assume ordering); every rendered line must measure `visibleWidth` ≤ `width`.

### 2.5 usik/tamagotchi — plugin boundaries + behavior classifier

**License:** MIT (`LICENSE`, "Copyright (c) 2026 Yusik Kim"). Python 3.12 + Textual/Rich/pydantic. Layout as the plan expected (`src/tamagotchi/{core,ui,plugins,sprites,cli}`, top-level `plugins/{claude_code,aider,goose,cursor}`, `integrations/{tmux,starship}`).

**Worth taking:**
- `src/tamagotchi/plugins/base.py::AgentBehaviorClassifier` — **PORT** (~50 lines, pure): rolling `deque(maxlen=20)` of `{tool, ts, exit}`; error counter (decays on success), consecutive-per-tool counter, read/write tool name sets; `classify()` → `BLOCKED` (errors ≥ 5) / `LOOPING` (any tool ≥ 5 consecutive) / `SHIPPING` (writes > reads in window) / `EXPLORING` (reads > 5, no writes) / `WORKING`. This is plan §21 "Behavior Profile" in miniature — re-target at normalized coding events and extend.
- `plugins/claude_code/plugin.py::BEHAVIOR_REACTIONS` — **ADAPT**: data-driven table behavior → stat deltas + message (e.g. DONE_SUCCESS +2 happy, TESTS_PASSED +2/−, LOOPING −1/−). Concept maps to our trait/care system.
- `src/tamagotchi/core/pet.py` tick/actions — PORT-adjacent reference: elapsed-time tick with per-decay timestamps **persisted as fields** (reload replays naturally), 0–4 stat scales, action guards where wrong care = care mistake, `tick()` returns event strings the UI renders. Overlaps tama96's model; tama96's injected-clock version is cleaner, take that one.
- `src/tamagotchi/cli/install.py` — **ADAPT** the UX later: `shutil.which` detection, per-tool flags, `--dry-run`, marker-based idempotent config patching.
- `integrations/tmux/`, `integrations/starship/` — both are read-only consumers of a `tama status --json` command. Design agentMon's state exportable the same way → free future integrations.
- Testing shape — ADAPT: actions ± mistake paths, decay via injected clocks, persistence round-trips, classifier cases.

**Explicitly IGNORE:** JSONL-polling agent plugins (we get events natively in-process; and see C6 — the polling was never wired up anyway), ASCII sprite rendering (replaced by half-block), PluginManager (Pi's ExtensionAPI is our bus), share cards, npm wrapper/homebrew.

### 2.6 kcosr/pi-extensions — packaging + tool-event ingestion template

**License:** MIT (`LICENSE`, "Copyright (c) 2026 Kevin"). Monorepo of independent extensions (`codemap`, `apply-patch-tool`, `assistant`, `skill-picker`, `toolwatch`, …), lockstep versioning, vitest, "tests for every behavior change" in AGENTS.md.

**toolwatch/ — the pieces to take:**
- `toolwatch/extension/index.ts` (133 lines) — **COPY template**: `pi.on("tool_call")` builds `{ts, toolCallId, session, cwd, model, tool, params}`; `pi.on("tool_result")` pairs by `toolCallId` with `isError`, duration from an in-memory timestamp map, `exitCode` via `isBashToolResult(event) && event.details?.exitCode`. This is agentMon's `adapters/pi/ingest.ts` almost verbatim (minus the approval/veto logic).
- `extension/src/utils.ts::filterParams` — **COPY**: per-tool param whitelisting before any logging/persistence (bash→command, read→path, write/edit→path only, …) — the hygiene layer for our event log.
- `extension/src/config.ts` — **COPY**: config.json-next-to-entry with bundled-vs-src dir resolution.
- `extension/package.json` — **COPY recipe**: esbuild `--bundle --format=esm --external:<pi packages> --external:node:*`, optional peer dep, 2-file deploy (`dist/index.js` + `config.json`) into `~/.pi/agent/extensions/`. No npm publish needed.
- `collector/src/db.ts` — **ADAPT later**: better-sqlite3 + WAL, one `tool_calls` row per call with update-on-result keyed by `tool_call_id`, indexes on ts/tool. Only if/when agentMon adds an event-history DB (deferred past v0.1; v0.1 = JSON state file).
- `collector/` HTTP+WS+web UI, rules engine, approval plugins — IGNORE.

**C4 compat note:** peer dep is `@mariozechner/pi-coding-agent` (older name; same author). Re-verify imports/type names against `@earendil-works/pi-coding-agent` in Stage 3 before copying.

---

## 3. Synthesis — design decisions locked in by the audit

1. **Event pipeline (v0.1):** entirely in-process. `pi.on("tool_call" + "tool_result"/"tool_execution_end" + session/turn lifecycle + input)` → `adapters/pi/` translates to normalized events (plan §12) → core reducer. No hooks, no socket, no daemon. The adapter owns all Pi-specific names; core never sees them (plan §12 rule).
2. **Core shape (tama96):** single state object; `reduceEvent(state, event, now)` / `tick(state, now)` pure functions with **injected clock and injected RNG**; typed precondition errors; atomic tmp+rename JSON save; **batched** elapsed-time catch-up on load; `.corrupt` backup + fresh-egg fallback. Fast-check property: catch-up convergence.
3. **Multi-process seam (deferred machinery, reserved shape):** every mutation funnels through one function that today does load→catch-up→apply→save (wrapped in Pi's `withFileMutationQueue`); readers may project without writing. Adding an AgentPet-style socket or tama96-style lockfile later is a wrapper change, not a core change.
4. **Renderer (tuipet):** port `render.py`→TS as two functions — `bitmapText()` (four-glyph, plan §10 + unit tests `00→" " 10→"▀" 01→"▄" 11→"█"`) and `lcdFrame()` (`▀`-only, theme fg/bg) — plus `grid.ts` geometry (32×16 LCD, floor baseline y=13, window clipping, roam bounds) and `animation.ts` (10 Hz clock, holds, Roamer, fx chaining). 2–4 FPS apparent motion comes from hold counts, exactly as tuipet does.
5. **Sprites/species:** ORIGINAL only. 16×16, 11-frame strips, coding role table (idleA idleB think search codeA codeB testA testB happy sad sleep); our own sprite-preview dev tool (tuipet's are broken).
6. **Progression:** XP outcome-based only + dedup (plan §15, ORIGINAL). Traits from a ported+extended `AgentBehaviorClassifier`. Care mistakes in tuipet's shape (defined window, counted misses, cooldown) with coding inputs. Evolution = ported tuipet gate evaluator + our Scout/Builder/Guardian data.
7. **UI:** `setWidget` live factory component (belowEditor) for the always-on pet; `/pet` = `ctx.ui.custom` full-screen using the snake/invaders loop pattern; `setStatus` for a compact mood line. Cross-session stats persisted to `getAgentDir()/agentMon/*.json`.
8. **Wiring smoke test (C6):** Stage 3 acceptance includes an automated test that emits a synthetic Pi tool event through the real extension entry and asserts pet state changed.

## 4. Adjusted repo structure (plan §9, deltas only)

```
agentMon/
├── packages/
│   ├── core/          # pet.ts evolution.ts xp.ts traits.ts care.ts  — pure, injected now/RNG (tama96 shape)
│   ├── events/        # types.ts (normalized events + canonical record, AgentPet-shaped) normalizer.ts
│   ├── renderer/      # framebuffer.ts halfblock.ts (bitmapText + lcdFrame) animation.ts lcd.ts (grid)
│   ├── storage/       # json.ts (atomic save + batched catch-up)   ← sqlite.ts DEFERRED (was in plan §9)
│   ├── adapters/
│   │   └── pi/        # ingest.ts (toolwatch template) map.ts (tool→event) config.ts
│   └── pi-extension/  # widget.ts /pet command lifecycle wiring — the only file that imports Pi APIs
├── pets/species/ pets/sprites/   # ORIGINAL art + role tables (never Bandai data)
├── tools/            # sprite-preview dev tool (original)
├── docs/             # plan.md reference-audit.md (this file) → later: event-spec.md evolution-spec.md
├── tests/
└── reference/        # gitignored clones
```

Deltas vs plan §9: `storage/sqlite.ts` deferred until an event-history DB is justified; `tools/` added for the sprite previewer; `pi-extension` renamed responsibility = "the only Pi-importing package" (plan's dependency direction preserved: Pi → adapter → event → core → state → renderer).

## 5. Stage 1 kickoff — open these files first

1. `reference/tuipet/src/tuipet/render.py` (whole file) — port `fill_buf`, `_paint_cells`, `bitmap_text`, `blit`, `downsample`, `marquee`.
2. `reference/tuipet/src/tuipet/grid.py` — geometry, rescaled to 32×16 full-LCD.
3. `reference/tuipet/src/tuipet/anim.py` — cadence constants + `Roamer`.
4. `reference/tuipet/src/tuipet/arena.py::Screen.paint` + `arenafx.py` (fx chaining concept only).
5. Draw ONE original 16×16 creature, 11 poses (plan §11), as `'0'/'1'` string rows.

Deliverable per plan: a standalone `codepet demo` (node script printing the LCD) + unit tests for the four half-block cases.

## 6. Attribution & compliance

- All six repos are MIT. When code is **copied near-verbatim** (toolwatch `index.ts`/`utils.ts`/`config.ts`; anything from AgentPet's TS windows port), carry the upstream copyright line in a header comment: AgentPet © 2026 Nguyễn Thành Đạt; tuipet © 2026 Joel Taylor; Pi examples © 2025 Mario Zechman; tamagotchi © 2026 Yusik Kim; pi-extensions © 2026 Kevin. Ports/adaptations note origin in the file header.
- tama96: no LICENSE file — reference-only (architecture), no verbatim copying possible across languages anyway.
- **Bandai red line:** nothing from `reference/tuipet/src/tuipet/data/` (or species names/designs anywhere) may enter this repo — see §2.2 off-limits list.

## 7. Open questions (non-blocking)

1. Exact current type/guard names in `@earendil-works/pi-coding-agent` vs toolwatch's older `@mariozechner/*` imports (resolve in Stage 3; C4).
2. THINK_START/THINK_END source in Pi — `message_start/end` exist but thinking-detection semantics need a Stage-3 spike; plan §12 already allows the event set to be trimmed for v0.1.
3. Whether the pet state file lives per-project (AgentPet-style) or global-with-override (plan §17) — decide at Stage 6 with the mapping port.
4. Windows terminal half-block rendering quality (this machine is Windows; Pi runs in Git Bash/Windows Terminal) — verify ▀/▄/█ aspect and colors during Stage 1 demo.
