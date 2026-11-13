---
name: fractal-git-dev
description: >-
  【触发：build/hash/skew/panic/taxis/CAS/Oid/Pack】Govern fractal-git 10-crate topology, multi-hash Oid, PackWindowReader, CCD v2 poset merge, and taxis subcommands.
---

# fractal-git-dev — Taxis (`fractal-git`) 10-Crate Kernel & Plumbing Specification

Governs the `fractal-git/` 10-crate unidirectional topology, multi-hash `Oid` (`Sha1`/`Sha256`/`Sm3`), windowed `PackFile` reading, 100% Git Plumbing byte parity (`105` subcommands), CCD v2 poset conflict detection, lock-free CAS worktree projection, `fg-pools` epoch reuse, and <!-- METRICS:BEGIN rule-fractal-git -->**37 条规则**<!-- METRICS:END rule-fractal-git --> (`FGT-*`).

> Load [rust-engineering](../rust-engineering/SKILL.md) for Rust invariants, and [taxis-daemon-and-agent-control](../taxis-daemon-and-agent-control/SKILL.md) for persistent daemon IPC, N-API, blackboard leases, quarantine, `FGT-MSG-*`, and TS control plane.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [taxis-daemon-and-agent-control](../taxis-daemon-and-agent-control/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Fractal-Git Kernel（领域入口）
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：Add or update taxis CLI subcommands and plumbing → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；taxis binary output differs byte-for-byte from git → `fractal-git-dev` + `taxis-daemon-and-agent-control` + `algorithmic-operator-engineering`
<!-- SKILL-LINKS:END -->

## 1. Ten-Crate Four-Layer Unidirectional Topology (`FGT-TOP-001` / `FGT-DEP-001`)

Verified on every `Cargo.toml` edit by `node fractal-git/scripts/common/validate-crate-topology.js`:

| Layer | Crates | Scope & Boundaries | Allowed Dependencies |
| :--- | :--- | :--- | :--- |
| **L0: Core Primitives** | `fg-core` | OID hashes, typed error enums, SSOT constants (`constants/`), Type-State markers, SM3 / `hmac_sm3` (`fg-core::crypto`) | Zero internal crates |
| **L1: Objects & Pools** | `fg-object`, `fg-pools` | Zero-copy Git Blob/Tree/Commit/Tag codec; epoch-counted `BufferPool` & `WorktreePool` (`< 20ms` reclaim) | `fg-core` |
| **L2: Index, Storage & Algos** | `fg-index`, `fg-storage`, `fg-algorithms` | Lock-free in-memory tree & DIRC codec; CAS / Loose ODB / TIPSE / WAL; SWAR diff, FastCDC, Bloom filter, CCD v2 & 5D ELOC (`eloc_5d`) | `fg-core`, `fg-object`, `fg-pools` |
| **L3: Topology, Wire & Gate** | `fg-topology`, `fg-transport`, `fg-gate`, `fg-native` | `refs/fractal/*` DAG & quarantine FSM; Smart Protocol v2 & IPC; TKCV/IKCE & diff bounds (`FGT-GAT-001`); TAXC container & N-API/CLI bridge (`FGT-BRG-001`) | L0–L2 |

---

## 2. Core Kernel Invariants (`FGT-*`)

1. **100% Git Plumbing & Multi-Hash `Oid` (`FGT-ALG-001` / `FGT-OBJ-001` / `FGT-IDX-001`)**:
   - `fg-core::Oid` represents variable `Sha1(20)` / `Sha256(32)` / `Sm3(32)` digests with zero `unsafe` casts and lossless tagged binary serialization.
   - Loose object `<type> <size>\0<payload>`, `Tree` trailing-`/` sorting, and big-endian `DIRC` index checksums must match canonical Git across all 57 differential vectors (`validate-git-parity.js --require-git --require-taxis`).
2. **Windowed Pack Storage, CAS & CCD v2 (`FGT-LCK-001` / `FGT-CAS-001` / `FGT-TRN-001` / `FGT-STO-001`)**:
   - `PackFile` uses windowed `PackWindowReader` with `checked_add` bounds (never full-file heap loads); `projection/` (`refs`/`index`/`export`/`import`) and `git_hook/` (`config`/`shell`/`process`) stay cleanly decoupled.
   - Promote virtual worktrees via lock-free `AtomicU64`/`AtomicPtr` CAS + monotonic `epoch` (banning hot-path `Mutex`/`RwLock`), `WorktreePool` `Path::components` traversal guards, and idempotent `SandboxPool::release`.
   - Resolve parallel edits via 3-tier CCD v2: L1 Bloom disjointness ($O(1)$) $\to$ L2 commutative poset hunks $\to$ L3A semantic conflict escalation (`FGT-COR-001`).
3. **Zero Loop Allocation, Facades & `// SAFETY:` (`FGT-PRF-001` / `FGT-FAC-001` / `FGT-SAF-001`)**:
   - Reuse `fg-pools` buffers (rejecting oversized keys upfront in `ByteLruCache::insert`).
   - Enrich every crate `lib.rs` with substantive capability/bounds contracts ($\ge 15$ ELOC) and document every `unsafe` block with 3-part `Preconditions / Invariants / Postconditions` proofs.
4. **Drop-In CLI (`105` Subcommands) & Telemetry (`FGT-AUD-001` / `FGT-PYR-001` / `FGT-IMPACT-001`)**:
   - Support `switch -c/-C/--detach/--orphan`, `commit --amend/--no-verify/--signoff`, `branch -a` remotes, `cherry-pick --abort` rollback, and multi-slot `stash`; return structured JSON `fallback_hint` errors for restricted offline network ops (`Edition::Engineering`).
   - Use `OnceLock` baseline template caching in `cli_harness.rs`; ensure `impact-slice-map.js` falls back cleanly on unknown crate paths (`FGT-IMPACT-001`).

---

## 3. Verification & JIT Assets

```powershell
node fractal-git/scripts/common/validate-crate-topology.js
node fractal-git/scripts/common/validate-git-parity.js --require-git --build-taxis --require-taxis
cargo clippy --manifest-path fractal-git/Cargo.toml --all-targets -- -D warnings
cargo test --workspace --manifest-path fractal-git/Cargo.toml
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

- [crate-topology-and-plumbing-protocol.md](references/crate-topology-and-plumbing-protocol.md): 10-crate boundaries, multi-hash `Oid` & Plumbing frames, windowed pack protocol, and CCD v2 poset math.
- [cell-cas-transaction-skeleton.rs](templates/cell-cas-transaction-skeleton.rs): Lock-free CAS snapshot promotion, epoch ABA guard, and atomic transaction rollback template.
