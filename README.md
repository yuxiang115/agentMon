# agentMon

[![CI](https://github.com/yuxiang115/agentMon/actions/workflows/ci.yml/badge.svg)](https://github.com/yuxiang115/agentMon/actions/workflows/ci.yml)

A reference-first terminal V-Pet that lives inside your coding agent: the agent's real coding behavior (reads, edits, tests, task outcomes) raises, shapes, and evolves a pixel pet rendered as a classic 32×16 LCD using Unicode half-blocks.

> **Naming:** the implementation plan refers to the project as **CodePet**; this repo (`agentMon`) is its implementation home.

**Status: Coding Digivice prototype — Botamon → Koromon → Agumon, visible XP/rewards, evolution goals and partner collection.**

## Coding Digivice / 代码 Agent 的数码暴龙机

新存档默认领养 **黑球兽（Botamon）**，随 Pi 的工作活动切换思考、探索、编写、验证、开心、失落、睡眠动作。面板只保留精灵本体（形态行 + LCD + 短暂的奖励提示），XP 进度、任务状态和下一个进化条件改在 TUI 底部状态栏随事件实时更新（空闲入睡等纯时间变化也会同步）；升级有通知，进化播放蓄力 → 闪烁 → 显形。

| 阶段 | 进化条件（累计） |
| --- | --- |
| 黑球兽 → 滚球兽（Koromon） | Lv.2 / 100 XP，至少 3 个完成的任务 |
| 滚球兽 → 亚古兽（Agumon） | Lv.3 / 300 XP，至少 8 个完成的任务，其中 2 个通过验证 |

完成任务 +10 XP，验证过的任务额外 +5，首次通过再 +5；新改动测试通过 +3 / 构建通过 +2。同一代码重复测试不再给测试经验，任务结算重复事件不再计数，中断任务不给完成奖励。此处“任务”是 Pi 的一次请求结算；工具和退出状态用于判断验证，并非对代码正确性的独立审计。

```text
/pet                 完整成长面板、奖励日志
/pet journey         当前经验、全部进化条件、最近奖励
/pet hatch [name]    领养新黑球兽，保留已有伙伴与经验
/pet partners        列出伙伴及 ID
/pet partner <id>    切换伙伴（任务结束后）
/pet size 24         放大精灵
```

已有存档继续使用原来的宠物；用 `/pet hatch` 开始新路线。`/pet use <species>` 仍是手动形态覆盖，会跳过正常养成，请用 `hatch` 体验从幼年期开始的流程。亚古兽之后的阶段尚未加入，仍可继续升级。

本地加载当前代码：`pi -e ./packages/pi-extension/index.ts`。不改存档的完整演示：

```sh
npm run demo:device
npm run demo:device -- --export out/device-preview.html
```

导出的 HTML 有播放、暂停、拖动进度和进化阶段跳转，回放来自实际 reducer 与终端面板。精灵预览同时输出到 `out/agumon-line.png`。优化评估与后续功能建议见 [docs/digivice.md](docs/digivice.md)。

- Full plan: [`docs/plan.md`](docs/plan.md)
- Stage 0 deliverable: [`docs/reference-audit.md`](docs/reference-audit.md) — per-repo findings, reuse verdicts (COPY/PORT/ADAPT/ORIGINAL), and the design decisions they lock in
- Stage 1 deliverable: the renderer port (`packages/renderer/`) + **Byte**, the first original creature (`pets/sprites/byte.ts`) — run `npm install && npm run demo` (or `npm run demo:live`), all poses via `npm run preview`
- Stage 2 deliverable: the pet core (`packages/core/`, `packages/events/`, `packages/storage/`) — pure `reduceEvent`/`tick` with injected clock, atomic saves + batched catch-up, pet collection. See it live without Pi: `npm run session`
- Stage 3 deliverable: the Pi extension (`packages/adapters/pi/`, `packages/pi-extension/`) — normalized event adapter, below-editor LCD widget, `/pet` full view

## Install into Pi

```
pi install git:github.com/yuxiang115/agentMon
```

The pet lives like a real V-Pet: it **dozes off after 5 idle minutes** (any work event wakes it), **levels up and evolves with a toast**, and evolution plays a **2.4 s digivolve transform** on the panel (charge-to-white -> silhouette strobe -> colour reveal; single-image imports carry hi-res layers too). Then just work: reads/writes/tests drive the pet, the pet panel floats top-right, and `/pet` does everything: no args opens the full view; `list` / `use <id>` manage species, `size <16-60>` scales the sprite, `import <path>` installs packs, `ui` toggles the panel, `rename <name>` renames, `debug` shows the event trace. State lives in `<pi agent dir>/agentmon/state.json` (atomic saves; survives reloads).

## Pet packs — bring your own sprites

The repo includes original creatures and the requested hand-authored fan companion line. `/pet import <path> [name]` accepts a zip, pose-image folder, single PNG, `pack.json`, or tuipet sprite data. Imports are converted, validated, installed and activated. Use `/pet list` and `/pet use <id>` to inspect or change forms. Format reference: [docs/pet-packs.md](docs/pet-packs.md).

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

## Art provenance

The original Byte/Scout/Builder/Guardian artwork remains available. The requested Botamon/Koromon/Agumon companion uses newly hand-authored pixel arrays in `pets/sprites/agumon-line.ts`; no game sprites or extracted game data were copied. Digimon characters belong to their respective owners; the code's MIT license does not grant rights to those characters. The older original-creatures-only direction in the archived plan/audit is superseded for this requested fan companion.

## Repo layout (planned)

See plan §9. Structure may change based on the Stage 0 audit findings.
