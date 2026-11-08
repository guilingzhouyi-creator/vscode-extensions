---
name: fractal-git-dev
description: >-
  【触发：taxis/版本控制内核/CAS/偏序集/实现子命令/字节等价/FGT规则】开发或修改 fractal-git (Taxis) 模块时必须使用。看守 10 大内核子系统分层拓扑、Git Plumbing 二进制等价、偏序集冲突检测与 CAS 无锁索引树。
---

# fractal-git-dev — Taxis (`fractal-git`) 10-Crate Kernel & Plumbing Specification

Governs the `fractal-git/` 10-crate unidirectional topology, 100% Git Plumbing byte parity, poset-homomorphic conflict detection (CCD v2), lock-free CAS worktree projection, `fg-pools` epoch buffers, and <!-- METRICS:BEGIN rule-fractal-git -->**37 条规则**<!-- METRICS:END rule-fractal-git --> (`FGT-*`).

> For general Rust idioms (Type-State, `thiserror`, `// SAFETY:` proofs), load [rust-engineering](../rust-engineering/SKILL.md).

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [rust-engineering](../rust-engineering/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：分形版本控制内核（领域入口）
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：新增或修改 taxis 子命令 → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；taxis 输出与 git 逐字节不一致 → `fractal-git-dev` + `debugging-and-error-recovery` + `algorithmic-operator-engineering`
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

1. **100% Git Plumbing Byte Parity (`FGT-ALG-001` / `FGT-OBJ-001` / `FGT-IDX-001`)**:
   - Loose object `<type> <size>\0<payload>` headers, SHA-1/SHA-256 digests, and zlib streams must match canonical Git byte-for-byte.
   - Sort `Tree` entries with directory names treated as having a trailing `/` (`git fsck` invariant).
   - Encode `.git/index` (`DIRC`) in network big-endian order with 8-byte alignment padding and trailing checksum (`FGT-IDX-001`).
2. **Lock-Free CAS Virtual Worktrees & Atomic Transactions (`FGT-LCK-001` / `FGT-CAS-001` / `FGT-TRN-001` / `FGT-STO-001`)**:
   - Forbid coarse-grained blocking `Mutex` / `RwLock` on concurrent Cell staging and index read paths (`FGT-LCK-001`).
   - Promote virtual worktree snapshots via `AtomicU64` / `AtomicPtr` compare-and-swap loops paired with monotonic epoch counters to prevent ABA (`FGT-CAS-001`).
   - Enforce `Staging -> Validated -> Committed` transactions with zero-residue rollback (`FGT-TRN-001`, `FGT-STO-001`). Delegate heavy worktree materialization to background async projection workers, recording fast mutations in the Dirty Ledger.
3. **Three-Tier Poset Conflict Detection — CCD v2 (`FGT-COR-001` / `FGT-POL-001`)**:
   - **L1 (Bloom Filter)**: Kirsch-Mitzenmacher dual-hash filter ($h_i(x) = (h_1(x) + i \cdot h_2(x)) \bmod m$) checks path-set disjointness in $O(1)$.
   - **L2 (Poset Homomorphism)**: Commutative hunks on intersecting files merge automatically without lock contention.
   - **L3A (Semantic Conflict Escalation)**: Non-commutative overlaps or contract breaches abort auto-merge and emit exact conflict slices.
4. **Zero Loop Allocation & Substantive Facades (`FGT-PRF-001` / `FGT-FAC-001` / `FGT-BRG-001`)**:
   - Borrow/return `Vec<u8>` and `String` buffers from `fg-pools` outside hot loops (`FGT-PRF-001`).
   - Every crate `lib.rs` and `fractal-git/ts/` facade must carry substantive validation or error mapping ($\text{ELOC} \ge 15$, `FGT-FAC-001`, `FGT-BRG-001`).
5. **Verification Zones, TKCV/IKCE & Cryptographic Telemetry (`FGT-BYP-001` / `FGT-QRN-001` / `FGT-VRF-001` / `FGT-MUT-001` / `FGT-TAU-001` / `FGT-AUD-001` / `FGT-PYR-001` / `FGT-IMPACT-001`)**:
   - Ephemeral tests use Direct-Bypass cache (`< 20ms` reclaim, `FGT-BYP-001`); high-risk violations quarantine to `refs/fractal/quarantine/*` (`FGT-QRN-001`).
   - Pre-Review Zone runs **TKCV** 5D static invariant checks (`< 5ms`, `FGT-VRF-001`), **IKCE** in-memory micro-mutation testing (kill rate $K \ge 60\%$, `FGT-MUT-001`, `FGT-TAU-001`), and `taxis gate-slice` 5D ELOC differential bounds (`FGT-GAT-001`).
   - Impact slice routing in `scripts/common/impact-slice-map.js` must never widen beyond registered targets and falls back to full suite on unknown crate paths (`FGT-IMPACT-001`).
   - Append-only `refs/fractal/telemetry/*` HMAC-SM3 hash chain with 4-tier time folding (`FGT-AUD-001`, `FGT-PYR-001`). Avoid exaggerated claims in docs (`DOC-TRM-001`, `CMG-STY-002`).

---

## 3. Kernel Commit Message Rules (`FGT-MSG-001` ~ `FGT-MSG-012`)

`fg-gate::commit_guard` enforces its own self-contained rule family (configured via `fractal-git/commit-policy.json` floor; `.git/config` may only tighten):
- **Format & Section Structure**: `FGT-MSG-001` (header shape, Unicode length, `!`, zero-width/emoji/period ban), `FGT-MSG-002` (section order, ASCII brackets, `- ` bullets), `FGT-MSG-003` (section minimums: Why $\ge 15$, Fixed $\ge 12$, Verification $\ge 12$, bullet $\ge 8$), `FGT-MSG-006` (non-empty sections).
- **Vocabulary & Hygiene**: `FGT-MSG-004` (vocabulary, imperative mood, zero first-person pronouns), `FGT-MSG-005` (no `TODO`/`FIXME`/`TBD` or template `<...>`), `FGT-MSG-007` (valid `[Project]` enum), `FGT-MSG-008` (no sprint/batch codenames).
- **Merge, Anchor & Policy Closure**: `FGT-MSG-009` (merge commit exemption by parent count $\ge 2$), `FGT-MSG-010` (`[Verification]` must cite a symbol or test name from the diff), `FGT-MSG-011` (CLI policy flag cannot weaken repo floor), `FGT-MSG-012` (all cited rule IDs registered in SSOT).

---

## 4. Verification & JIT Assets

```powershell
node fractal-git/scripts/common/validate-crate-topology.js
node .agents/skills/rust-engineering/scripts/validate-rust-conformance.js
cargo clippy --manifest-path fractal-git/Cargo.toml --all-targets -- -D warnings
cargo test --workspace --manifest-path fractal-git/Cargo.toml
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

- [crate-topology-and-plumbing-protocol.md](references/crate-topology-and-plumbing-protocol.md): 10-crate dependency matrix, Git Plumbing binary framing, CCD v2 poset math, and 3-tier conflict arbitration.
- [cell-cas-transaction-skeleton.rs](templates/cell-cas-transaction-skeleton.rs): Lock-free CAS snapshot promotion, epoch ABA guard, and atomic transaction rollback template.
