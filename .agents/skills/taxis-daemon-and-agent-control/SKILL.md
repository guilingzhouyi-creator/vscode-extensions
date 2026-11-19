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

## 1. Resident `daemon` IPC & `fg-native` Bridge

1. **`taxis daemon` (`src/bin/taxis_cmd/daemon.rs`)**: Framed IPC over Windows Named Pipes / Unix sockets caching `ContainerView`, `PolicyVaultStore`, and `InMemoryIndexTree` snapshots; enforces timeouts and rejects oversized payloads pre-decode.
2. **`fg-native` N-API (`crates/fg-native`, `fractal-git/ts/native-binding.ts`)**: Exposes `fg-algorithms`/`fg-object` via `std::panic::catch_unwind` (`FGT-BRG-001`) with SHA-1/SHA-256/SM3 framing; keep native artifacts untracked and retain `NativeContainerContract` + const validators (`ARCH-FAC-001` / `FGT-FAC-001`).

---

## 2. Leases, Quarantine & 5-Tier Branches

1. **Lease Mutex (`DiskBlackboardStore`)**: `stage`, `commit`, `merge`, `worktree add/remove` enforce exclusive Cell leases (fail closed on overlap); `worktree add` projects from Commit/Tree OID (`epoch` + `Path::components` guards).
2. **Quarantine, Undo & Branches**: `quarantine isolate/restore` replays `.patch` diffs deterministically; `undo` atomically restores index/ref/worktree and prunes stale children (`FGT-QRN-001`, `FGT-TRN-001`). Branches follow `main -> integration -> cell/<cell>/main -> cell/<cell>/card/<card>/main -> cell/<cell>/card/<card>/sub/<agent>` (`FGT-TOP-001`).

---

## 3. Kernel Gate Pipeline, Telemetry & TS Control Plane

1. **Audit Hook, `PROM` & `audit-taxis` Handoff (`fg-gate`)**: `AutoAuditHook` runs `PraxisSliceAuditService` + incremental tests (never `ReviewUnavailable`), quarantining failures and sealing `PROM` receipts (`evidence-validation.ts`). `taxis gate-slice` checks `Index` vs `HEAD` against `scripts/common/diff-bounds-contract.json` (`FGT-GAT-001`), logging turnover in `.taxis/telemetry/admission_ledger.ndjson`. `audit-taxis.{ps1,sh}` passes `[2/5]` test totals to `run-audit-report.js` via `--cargo-test-summary` to avoid re-running `cargo test --workspace`.
2. **Commit Guard (`FGT-MSG-001`~`FGT-MSG-012`)**: Configured via `fractal-git/commit-policy.json` (only tightenable); checks header, section floors (`Why >= 15`, `Fixed >= 12`, `Verification >= 12`), imperative tense, and diff anchors (`FGT-MSG-010`).
   - Enforces full SSOT rule-ID closure (`FGT-MSG-012`) and rejects unregistered codes or placeholder prose.
3. **TS Plane (`fractal-git/ts/`)**: Keep `praxis-client.ts`, `vfs-adapter.ts` (empty files/tombstones), `variant-evaluator.ts` (fail-closed), and `tree-renderer.ts` (`MAX_RENDER_DEPTH = 64`, `visited` guard) clean under `tsc --noEmit`.

---

## 4. Verification & JIT Assets

```powershell
npm --prefix fractal-git test
node fractal-git/scripts/common/validate-git-parity.js --require-git --build-taxis --require-taxis
node scripts/common/validate-branch-governance.js
```

- [daemon-ipc-and-lease-protocol.md](references/daemon-ipc-and-lease-protocol.md): Daemon IPC framing, lease checks, quarantine replay, `FGT-MSG-*`, and `taxis` vs `git` parity.
- [taxis-control-plane-workflow.ts](templates/taxis-control-plane-workflow.ts): Type-safe `PraxisGitClient`, `VfsAdapter`, fail-closed variant, and cycle-safe tree workflow.
