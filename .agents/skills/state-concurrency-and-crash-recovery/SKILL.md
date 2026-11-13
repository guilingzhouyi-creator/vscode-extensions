---
name: state-concurrency-and-crash-recovery
description: >-
  【触发：drain/isolate/leak/crash/async/mutex/atomic/handle】Enforce symmetric resource disposal, bounded queues, idempotent journal replay, and atomic temp-rename durability.
---

# state-concurrency-and-crash-recovery — Bounded Concurrency, Symmetric Lifecycles & Crash-Safe Persistence

Governs stateful lifecycles, async dispatchers, and crash-safe persistence across `workspace-timing` (RingBuffer + Journal), `auto-refactor` (Daemon & Worker Pool), `WebGames` (`AgentAsyncDispatcher`), and `fractal-git` (CAS + WAL).

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[rust-engineering](../rust-engineering/SKILL.md)、[workspace-timing-dev](../workspace-timing-dev/SKILL.md) → **本技能** → [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：Fractal-Git Kernel（链上第 4 步）；另 2 个领域支援；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Persistent daemon IPC, blackboard leases, or quarantine replay → `taxis-daemon-and-agent-control` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`；Concurrent index tree write crash recovery or unsafe proofs → `fractal-git-dev` + `state-concurrency-and-crash-recovery` + `defensive-security-and-taint-safety`
<!-- SKILL-LINKS:END -->

## 1. Four Axioms of Concurrency & Crash Recovery

### 1.1 Symmetric Resource Lifecycle (`PRF-LEAK-001` / `RES-*` / `ADV-EVT-*`)
Write the symmetric release path in the same module at the moment any resource is acquired:

| Acquisition | Mandatory Symmetric Release | Consequence & Rule ID |
| :--- | :--- | :--- |
| `emitter.on(evt, fn)` / Godot `.connect()` | `emitter.off(evt, fn)` / `.disconnect()` | Closure retains AST/scene graph (`PRF-LEAK-001`, `GDM-CONNECT-001`) |
| `setInterval` / `setTimeout` | `clearInterval` / `clearTimeout` in `dispose()` | Orphan timer fires after host shutdown (`L3-RESOURCE-TOPO`, `VSC-MEM-001`) |
| `Start-Process` / `child_process.spawn` | Bounded `WaitForExit(timeoutMs)` + `try/finally` `Kill($true)` | Hung child process deadlocks gate/CI (`PS-TRAP-001`) |
| Async dispatcher `dispatch()` | Expose `pump()`, `flush()`, and `teardown()` | Headless test runner hangs on exit (`ADV-EVT-001`) |

### 1.2 Staging Verification & Atomic Rename (`GOV-PRF-004` / `FGT-STO-001` / `DAT-RES-001`)
Never overwrite critical state files in place:
1. Write full payload to a same-volume staging path (`stagingPath`, `compactStagingPath`, or `stagingUri`).
2. Verify non-zero byte length and structural validity (JSON parse or checksum).
3. Execute atomic rename (`fs.rename` / `FileAccess`), guaranteeing zero torn or 0-byte files on crash or power loss.

### 1.3 Bounded `RingBuffer` & Idempotent Journal Replay (`UUID-REENTRANT-001` / `VSC-MEM-001`)
1. **Bounded In-Memory Queues**: Use fixed-capacity `RingBuffer` (32/64 slots) or bounded LRU containers instead of unbounded arrays.
2. **Dual-Write Append-Only Journal**: Pair in-memory aggregation with an append-only NDJSON journal; on dirty shutdown recovery, replay the journal to reconstruct state.
3. **Reentrant Idempotency (`UUID-REENTRANT-001`)**: Tag every journal entry and init hook with an idempotent key (`checkpointId` / `sequenceId`) so repeated replay never double-counts.

### 1.4 Non-Blocking Hot-Path I/O & Explicit FSM (`PRF-IO-001`)
1. **Zero Sync I/O on Event Loops (`PRF-IO-001`)**: Forbid `fs.readFileSync`, `fs.writeFileSync`, and `fs.unlinkSync` inside daemon request handlers, extension activation hot paths, or UI frame loops.
2. **Discriminated State Machine**: Replace scattered boolean flags (`isLoading`, `isFailed`, `isClosed`) with a single discriminated union (`Idle | Running | Draining | Closed`) that rejects new tasks in `Draining | Closed`.

---

## 2. Verification & JIT Assets

```powershell
cd workspace-timing && npm run test:fast
cd auto-refactor && node scripts/gate-self.js
node scripts/common/validate-skills.js
```

- [crash-safe-journal-and-dispatcher-lifecycle.md](references/crash-safe-journal-and-dispatcher-lifecycle.md): 4-step atomic staging state machine, idempotent journal deduplication, and `pump/flush/teardown` dispatcher protocol.
- [atomic-journal-store.ts](templates/atomic-journal-store.ts): Bounded `RingBuffer`, atomic staging rename, and idempotent journal replay template.
