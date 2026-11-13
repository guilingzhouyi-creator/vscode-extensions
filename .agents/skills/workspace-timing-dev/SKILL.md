---
name: workspace-timing-dev
description: >-
  【触发：write/sync/crash/lost/timing/RingBuf/i18n/zh-CN】Govern workspace-timing 5-layer decoupling, RingBuffer+Journal crash safety, zh-CN/en i18n parity, and dark UI.
---

# workspace-timing-dev — VS Code Extension 5-Layer Architecture, Crash Safety & Bilingual i18n

Governs the `workspace-timing/` 5-layer unidirectional architecture, RingBuffer + Journal crash-safe persistence, cross-midnight natural-day splitting, 100% bilingual dictionary parity (`zh-CN`/`en`), and `L0`–`L5` review gates.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：VS Code Timing Extension（领域入口）
- **协作专员**：原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`
- **何时联动**：Webview jank, frame drops, or IME send glitch → `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering`；Buffer loss on process kill or journal replay divergence → `workspace-timing-dev` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Five-Layer Unidirectional Architecture & Headless Testability

Dependencies flow strictly downward: `UI (Webview/StatusBar) -> Engine (TimerEngine/TimeAggregator) -> Storage (StorageCoordinator/RingBuffer/Journal/HistoryFolder) -> Analytics -> Shared (i18n/DTO)`.
- **Zero Upward Imports (`LAY-IMPORT` / `LAY-CYCLE`)**: Storage, Engine, Analytics, and Shared must never import UI modules or `vscode.window`.
- **Host-Free Unit Tests**: Core timing and aggregation logic runs in-memory under Mock Clock across <!-- METRICS:BEGIN ws-test-case-count -->**246 项**<!-- METRICS:END ws-test-case-count --> unit test cases.

---

## 2. Three-Tier Crash Recovery & Cross-Midnight Duration Conservation

1. **Three-Tier Persistence**:
   - **In-Memory `RingBuffer`**: Aggregates second-level slices in memory with zero disk I/O jitter.
   - **Append-Only Journal (`[DELTA]`)**: Appends single-line NDJSON heartbeats for idempotent replay after crashes or power loss ([state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)).
   - **Atomic Checkpoint (`stagingUri`)**: Writes full snapshots to `stagingUri`, verifies integrity, and atomically renames over the target file (creating a safety snapshot before destructive resets).
2. **`HistoryFolder` Folding & Cross-Midnight Splitting (`segmentedSessions`)**:
   - Folds sessions exceeding 20 per day (FIFO) and prior weeks into `dailyTotals` while strictly conserving total duration.
   - On wake from sleep across midnight/week boundaries (`resumeFromSleep`), `TimeAggregator.splitByNaturalDay(startMs, endMs)` splits intervals into `segmentedSessions`; when `rawManual === 0 && rawAi === 0 && durationMs > 0`, attribute the full `segDuration` to `manualMs` rather than zeroing it out.

---

## 3. 100% Bilingual i18n (`HC-UI-STRING`) & High-Contrast Dark UI

1. **100% Bilingual Parity**: Route all user-visible strings through `i18n.t(key)` with 1:1 key parity between `src/i18n/zh-CN.ts` and `src/i18n/en.ts` (plus `package.nls*.json`); never hardcode UI literals or expose internal identifiers (`RingBuffer`, `NDJSON`, `dailyTotals`).
2. **Dark-First Visual Physics**: Bind colors to `var(--vscode-*)`, enforce `#ffffff` or high-contrast theme tokens on SVG/chart axis labels (WCAG AA+), apply `font-variant-numeric: tabular-nums` on live counters, and obey the 1-border rule and IME composition interlock ([interaction-design-physics](../interaction-design-physics/SKILL.md)).

---

## 4. Verification & JIT Assets

```bash
cd workspace-timing && npm run compile && npm run test:fast && npm run review
```

- [five-layer-architecture-and-i18n.md](references/five-layer-architecture-and-i18n.md): 5-layer boundary rules, `[DELTA]` journal replay equations, duration conservation theorem, and `L0`–`L5` review matrix.
- [i18n-dictionary-template.json](templates/i18n-dictionary-template.json) / [time-aggregator-test-skeleton.ts](templates/time-aggregator-test-skeleton.ts): Bilingual dictionary and cross-midnight duration conservation test templates.
