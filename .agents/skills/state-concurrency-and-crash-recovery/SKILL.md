---
name: state-concurrency-and-crash-recovery
description: >-
  【触发：drain/isolate/leak/crash/async/mutex/atomic/handle】Enforce symmetric resource disposal, bounded queues, idempotent journal replay, and atomic temp-rename durability.
---

# state-concurrency-and-crash-recovery — Bounded Concurrency & Crash-Safe Persistence

Governs lifecycles, dispatchers, and crash-safe stores across `workspace-timing` (RingBuffer+Journal), `auto-refactor` (Daemon/Pool), `WebGames` (`AgentAsyncDispatcher`), and `fractal-git` (CAS+WAL).

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[rust-engineering](../rust-engineering/SKILL.md)、[workspace-timing-dev](../workspace-timing-dev/SKILL.md) → **本技能** → [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：Fractal-Git Kernel（链上第 4 步）；另 2 个领域支援；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Persistent daemon IPC, blackboard leases, or quarantine replay → `taxis-daemon-and-agent-control` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`；Concurrent index tree write crash recovery or unsafe proofs → `fractal-git-dev` + `state-concurrency-and-crash-recovery` + `defensive-security-and-taint-safety`
<!-- SKILL-LINKS:END -->

## 1. Concurrency & Recovery Axioms

### 1.1 Symmetric Lifecycle (`PRF-LEAK-001` / `RES-*` / `ADV-EVT-*`)

| Acquisition | Mandatory Release | Rule ID & Impact |
|---|---|---|
| `emitter.on()` / `.connect()` | `emitter.off()` / `.disconnect()` | Retains AST/scene (`PRF-LEAK-001`, `GDM-CONNECT-001`) |
| `setInterval` / `setTimeout` | `clearInterval` / `clearTimeout` in `dispose()` | Post-shutdown fires (`L3-RESOURCE-TOPO`, `VSC-MEM-001`) |
| `Start-Process` / `spawn` | `WaitForExit(timeoutMs)` + `try/finally` `Kill($true)` | Deadlocks gate/CI (`PS-TRAP-001`) |
| Async `dispatch()` | Expose `pump()`, `flush()`, `teardown()` | Runner hangs on exit (`ADV-EVT-001`) |

### 1.2 Staging, Bounded Replay & Hot-Path FSM
- **Atomic Rename (`GOV-PRF-004` / `FGT-STO-001` / `DAT-RES-001`)**: Write to same-volume `stagingPath`/`compactStagingPath`/`stagingUri` $\to$ verify non-zero bytes & JSON/checksum $\to$ rename (`fs.rename`/`FileAccess`).
- **Bounded `RingBuffer` & Idempotent Replay (`UUID-REENTRANT-001` / `VSC-MEM-001`)**: Cap queues via fixed `RingBuffer` (32/64) or bounded LRU; append NDJSON journal entries keyed by `checkpointId`/`sequenceId`.
- **Zero Hot Sync I/O (`PRF-IO-001`) & FSM**: Ban `fs.readFileSync`/`writeFileSync`/`unlinkSync` in daemon/activation/frame loops. Replace `isLoading`/`isFailed`/`isClosed` flags with `Idle | Running | Draining | Closed`.

---

## 2. Verification & Assets

```powershell
cd workspace-timing && npm run test:fast
cd auto-refactor && node scripts/gate-self.js
node scripts/common/validate-skills.js
```

- [crash-safe-journal-and-dispatcher-lifecycle.md](references/crash-safe-journal-and-dispatcher-lifecycle.md): 4-step staging FSM, journal dedup & `pump/flush/teardown`.
- [atomic-journal-store.ts](templates/atomic-journal-store.ts): Bounded `RingBuffer`, atomic rename & idempotent replay template.
