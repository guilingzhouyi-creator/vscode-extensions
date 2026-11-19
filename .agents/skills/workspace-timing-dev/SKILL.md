---
name: workspace-timing-dev
description: >-
  【触发：write/sync/crash/lost/timing/RingBuf/i18n/zh-CN】Govern workspace-timing 5-layer decoupling, RingBuffer+Journal crash safety, zh-CN/en i18n parity, and dark UI.
---

# workspace-timing-dev — 5-Layer Architecture, Crash Safety & i18n

Governs `workspace-timing/` 5-layer flow, RingBuffer+Journal persistence, cross-midnight splits, `zh-CN`/`en` parity, and `L0`–`L5` gates.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：VS Code Timing Extension（领域入口）
- **协作专员**：原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`
- **何时联动**：Webview jank, frame drops, or IME send glitch → `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering`；Buffer loss on process kill or journal replay divergence → `workspace-timing-dev` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Five-Layer Flow & Headless Tests

`UI (Webview/StatusBar) -> Engine (TimerEngine/TimeAggregator) -> Storage (StorageCoordinator/RingBuffer/Journal/HistoryFolder) -> Analytics -> Shared (i18n/DTO)`
- **Zero Upward Imports (`LAY-IMPORT` / `LAY-CYCLE`)**: Non-UI layers never import UI or `vscode.window`.
- **Host-Free Tests**: In-memory Mock Clock across <!-- METRICS:BEGIN ws-test-case-count -->**246 项**<!-- METRICS:END ws-test-case-count --> unit cases.

---

## 2. Crash Recovery & Duration Conservation

| Mechanism | Contract |
|---|---|
| **`RingBuffer`** | Aggregates second-level slices in memory with zero disk jitter |
| **Journal (`[DELTA]`)** | Append-only NDJSON heartbeats for idempotent replay ([state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)) |
| **Checkpoint (`stagingUri`)** | Write $\to$ verify $\to$ atomic rename (save safety snapshot before destructive resets) |
| **`HistoryFolder` & Split** | FIFO-fold $>20$/day + prior weeks into `dailyTotals` conserving duration; `resumeFromSleep` calls `TimeAggregator.splitByNaturalDay(startMs, endMs)` $\to$ `segmentedSessions` (if `rawManual === 0 && rawAi === 0 && durationMs > 0`, attribute `segDuration` to `manualMs`) |

---

## 3. Bilingual i18n (`HC-UI-STRING`) & Dark UI

- **1:1 Parity**: Route UI strings via `i18n.t(key)` across `src/i18n/{zh-CN,en}.ts` + `package.nls*.json`; never leak `RingBuffer`, `NDJSON`, or `dailyTotals`.
- **Visual Physics**: Bind `var(--vscode-*)`, `#ffffff`/WCAG AA+ axis labels, `tabular-nums`, 1-border rule, and IME lock ([interaction-design-physics](../interaction-design-physics/SKILL.md)).

---

## 4. Verification & Assets

```bash
cd workspace-timing && npm run compile && npm run test:fast && npm run review
```

- [five-layer-architecture-and-i18n.md](references/five-layer-architecture-and-i18n.md): 5-layer boundaries, `[DELTA]` replay, duration conservation & `L0`–`L5` gates.
- [i18n-dictionary-template.json](templates/i18n-dictionary-template.json) / [time-aggregator-test-skeleton.ts](templates/time-aggregator-test-skeleton.ts): i18n & cross-midnight test templates.
