---
name: fractal-git-dev
description: >-
  【触发：build/hash/skew/panic/taxis/CAS/Oid/Pack】Govern fractal-git 10-crate topology, multi-hash Oid, PackWindowReader, CCD v2 poset merge, and taxis subcommands.
---

# fractal-git-dev — Taxis (`fractal-git`) 10-Crate Kernel & Plumbing

Governs `fractal-git/` 10-crate topology, multi-hash `Oid` (`Sha1`/`Sha256`/`Sm3`), windowed `PackFile`, 100% Git Plumbing parity (`105` subcommands), CCD v2, CAS worktrees, `fg-pools`, and <!-- METRICS:BEGIN rule-fractal-git -->**37 条规则**<!-- METRICS:END rule-fractal-git --> (`FGT-*`).

> See [rust-engineering](../rust-engineering/SKILL.md) for Rust invariants and [taxis-daemon-and-agent-control](../taxis-daemon-and-agent-control/SKILL.md) for daemon IPC, N-API, leases, quarantine, `FGT-MSG-*`, and TS UI.

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [taxis-daemon-and-agent-control](../taxis-daemon-and-agent-control/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Fractal-Git Kernel（领域入口）
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：Add or update taxis CLI subcommands and plumbing → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；taxis binary output differs byte-for-byte from git → `fractal-git-dev` + `taxis-daemon-and-agent-control` + `algorithmic-operator-engineering`
<!-- SKILL-LINKS:END -->

## 1. Ten-Crate Unidirectional Topology (`FGT-TOP-001` / `FGT-DEP-001`)

Guarded by `validate-crate-topology.js`:

| Layer | Crates | Scope | Allowed Deps |
| :--- | :--- | :--- | :--- |
| **L0** | `fg-core` | `Oid`, `thiserror`, `constants/`, Type-State, SM3 / `hmac_sm3` (`fg-core::crypto`) | None |
| **L1** | `fg-object`, `fg-pools` | Zero-copy Blob/Tree/Commit/Tag codec; epoch `BufferPool` & `WorktreePool` (`<20ms` reclaim) | `fg-core` |
| **L2** | `fg-index`, `fg-storage`, `fg-algorithms` | Lock-free tree & `DIRC`; CAS/Loose/TIPSE/WAL; SWAR diff, FastCDC, Bloom, CCD v2, weighted ELOC (`eloc_5d`) | `fg-core`, `fg-object`, `fg-pools` |
| **L3** | `fg-topology`, `fg-transport`, `fg-gate`, `fg-native` | `refs/fractal/*` DAG & quarantine; Smart v2 & IPC; TKCV/IKCE & diff bounds (`FGT-GAT-001`); TAXC & N-API/CLI (`FGT-BRG-001`) | L0–L2 |

## 2. Core Kernel Invariants (`FGT-*`)

1. **Git Plumbing & `Oid` (`FGT-ALG-001` / `FGT-OBJ-001` / `FGT-IDX-001`)**: Variable `Sha1(20)`/`Sha256(32)`/`Sm3(32)` with zero `unsafe` casts; `<type> <size>\0`, `Tree` trailing-`/` sort, and big-endian `DIRC` must match Git across 57 parity vectors (`validate-git-parity.js --require-git --require-taxis`).
2. **Pack, CAS & CCD v2 (`FGT-LCK-001` / `FGT-CAS-001` / `FGT-TRN-001` / `FGT-STO-001`)**: `PackWindowReader` with `checked_add` (never full-file loads); keep `projection/` & `git_hook/` decoupled; `AtomicU64`/`AtomicPtr` CAS + monotonic `epoch` (no hot `Mutex`/`RwLock`); `Path::components` traversal guards & idempotent `SandboxPool::release`; 3-tier CCD v2 (L1 Bloom $\to$ L2 poset hunks $\to$ L3A escalation, `FGT-COR-001`).
3. **Zero Loop Alloc, Facades & `// SAFETY:` (`FGT-PRF-001` / `FGT-FAC-001` / `FGT-SAF-001`)**: Reuse `fg-pools` (reject oversized keys in `ByteLruCache::insert`); `lib.rs` $\ge 15$ ELOC; 3-part `// SAFETY:` proofs.
4. **CLI (`105` Cmds) & Telemetry (`FGT-AUD-001` / `FGT-PYR-001` / `FGT-IMPACT-001`)**: Support `switch -c/-C/--detach/--orphan`, `commit --amend/--no-verify/--signoff`, `branch -a`, `cherry-pick --abort`, multi-slot `stash`; structured JSON `fallback_hint` for offline ops (`Edition::Engineering`); `OnceLock` templates in `cli_harness.rs`; clean fallback in `impact-slice-map.js`.

## 3. Verification & JIT Assets

```powershell
node fractal-git/scripts/common/validate-crate-topology.js && node fractal-git/scripts/common/validate-git-parity.js --require-git --build-taxis --require-taxis
cargo clippy --manifest-path fractal-git/Cargo.toml --all-targets -- -D warnings && cargo test --workspace --manifest-path fractal-git/Cargo.toml
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

- [crate-topology-and-plumbing-protocol.md](references/crate-topology-and-plumbing-protocol.md): 10-crate boundaries, `Oid`/Plumbing frames, windowed pack & CCD v2 poset math.
- [cell-cas-transaction-skeleton.rs](templates/cell-cas-transaction-skeleton.rs): Lock-free CAS promotion, epoch ABA guard & atomic rollback scaffold.
