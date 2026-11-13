---
name: taxis-daemon-and-agent-control
description: >-
  【触发：lease/verify/corrupt/breach/daemon/IPC/N-API/FGT】Govern Taxis persistent daemon IPC, fg-native N-API, blackboard leases, quarantine, FGT-MSG/gate-slice, and TS UI.
---

# taxis-daemon-and-agent-control — Persistent IPC Daemon, Agent Leases, Gate Pipeline & TS Control Plane

Governs Taxis's multi-agent control plane and runtime boundaries in `fractal-git/`: persistent Named Pipe / Unix Socket `taxis daemon` IPC, `fg-native` N-API `cdylib`, `DiskBlackboardStore` lease enforcement, `refs/fractal/quarantine/*` replay, `AutoAuditHook` -> `Praxis` -> `PROM` receipts, `FGT-MSG-001..012` / `taxis gate-slice`, TS control plane, and real `taxis` vs `git` binary differential parity.

> For 10-crate plumbing, `Oid` multi-hash, `PackWindowReader`, CCD v2 poset merge, and Rust CLI subcommands, load [fractal-git-dev](../fractal-git-dev/SKILL.md).

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[fractal-git-dev](../fractal-git-dev/SKILL.md) → **本技能** → [rust-engineering](../rust-engineering/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Fractal-Git Kernel（链上第 2 步）
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：taxis binary output differs byte-for-byte from git → `fractal-git-dev` + `taxis-daemon-and-agent-control` + `algorithmic-operator-engineering`；Persistent daemon IPC, blackboard leases, or quarantine replay → `taxis-daemon-and-agent-control` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Persistent `daemon` IPC & `fg-native` N-API Bridge

1. **Resident `taxis daemon` (`src/bin/taxis_cmd/daemon.rs`)**:
   - Exposes framed IPC over Windows Named Pipes / Unix domain sockets, caching opened TAXC containers (`ContainerView`), hidden `PolicyVaultStore` state, and `InMemoryIndexTree` snapshots to eliminate CLI cold starts.
   - Binds daemon timeouts cleanly; rejects unbounded payloads before decoding.
2. **`fg-native` N-API `cdylib` (`crates/fg-native` & `fractal-git/ts/native-binding.ts`)**:
   - Exposes `fg-algorithms` & `fg-object` primitives via N-API (wrapped with `std::panic::catch_unwind`, `FGT-BRG-001`). Native addon artifacts stay out of Git tracking and share deterministic SHA-1/SHA-256/SM3 framing with the Rust kernel.
   - `fg-native/src/lib.rs` must maintain a substantive `NativeContainerContract` + const envelope bounds validators (`ARCH-FAC-001` / `FGT-FAC-001`).

## 2. Multi-Agent Leases, Quarantine & Branch Topology

1. **Write-Path Lease Mutex (`DiskBlackboardStore`)**:
   - Every mutating entry point (`taxis stage`, `commit`, `merge`, `worktree add/remove`) validates exclusive path leases on the active Cell blackboard and fails closed on cross-agent overlap.
   - `worktree add` projects from an explicit Commit/Tree OID (never cloning a dirty workspace), and `WorktreePool` enforces monotonic `epoch` + `Path::components` traversal guards.
2. **Isolation & Replay (`refs/fractal/quarantine/*`, `taxis undo`)**:
   - `quarantine isolate/restore` persists and replays `.patch` diffs deterministically; `undo` rolls back index/ref/worktree state atomically and prunes stale child branches (`FGT-QRN-001`, `FGT-TRN-001`).
   - Workspace branches enforce the 5-tier hierarchy (`main -> integration -> cell/<cell>/main -> cell/<cell>/card/<card>/main -> cell/<cell>/card/<card>/sub/<agent>`, `FGT-TOP-001`).

## 3. Kernel Gate Pipeline & TS Control Plane

1. **Live Audit Hook & `PROM` Receipts (`fg-gate`)**:
   - `AutoAuditHook` invokes `PraxisSliceAuditService` + incremental test execution (never stubbed `ReviewUnavailable`), routing violations to Quarantine and sealing clean gates into signed `PROM` ledger records (`evidence-validation.ts`).
   - `taxis gate-slice` evaluates `Index` vs `HEAD` line diffs (with real refactor-witness detection) against single-source `diff-bounds-contract.json` (`FGT-GAT-001`).
2. **Kernel Commit Guard (`FGT-MSG-001`~`FGT-MSG-012`)**:
   - Configured via `fractal-git/commit-policy.json` (`.git/config` or CLI flags can only tighten). Enforces header shape, section minimums (`Why >= 15`, `Fixed >= 12`, `Verification >= 12`), imperative tense, and symbol/test diff anchors (`FGT-MSG-010`).
   - Enforces full SSOT rule-ID closure (`FGT-MSG-012`) and rejects unregistered rule codes or placeholder prose.
3. **TypeScript Control Plane (`fractal-git/ts/`)**:
   - Keep `ts/client/praxis-client.ts` (`refs/fractal/cell/`, real parent commits, compliant messages), `ts/vfs/vfs-adapter.ts` (preserve empty files & deletion tombstones), `ts/orchestration/variant-evaluator.ts` (fail-closed when all variants fail), and `ts/tui/tree-renderer.ts` (`MAX_RENDER_DEPTH = 64`, `visited` cycle guard) hardened and clean (`tsc --noEmit`).

## 4. Verification & JIT Assets

```powershell
npm --prefix fractal-git test
node fractal-git/scripts/common/validate-git-parity.js --require-git --build-taxis --require-taxis
node scripts/common/validate-branch-governance.js
```

- [daemon-ipc-and-lease-protocol.md](references/daemon-ipc-and-lease-protocol.md): Daemon IPC framing, blackboard lease checks, quarantine replay, `FGT-MSG-*` rules, and binary `taxis` vs `git` parity harness.
- [taxis-control-plane-workflow.ts](templates/taxis-control-plane-workflow.ts): Type-safe TS workflow demonstrating `PraxisGitClient`, `VfsAdapter` tombstones, fail-closed variant evaluation, and cycle-safe tree rendering.
