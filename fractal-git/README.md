# Fractal Git (`fractal-git` / Taxis) — Agent-Native Lock-Free Version Control Kernel

> **Module**: `fractal-git` (Workspace Core Subsystem #4)  
> **Mission**: Eliminate `.git/index.lock` contention and eager worktree I/O bottlenecks under high-concurrency multi-agent exploration via a 10-crate Rust lock-free CAS kernel, poset-homomorphic DAG algorithms, and LayerVFS progressive projection.  
> **Directory & Extension Contract**: [`docs/DIRECTORY_SPEC.md`](docs/DIRECTORY_SPEC.md)

---

## 1. Core Architectural Invariants

1. **Plumbing-Level Decoupling**: Decouples Git object serialization and ODB storage from legacy single-worktree `.git/index.lock` contention.
2. **Lock-Free In-Memory Virtual Index (`FGT-LCK-001`)**: Concurrent agents mutate isolated in-memory trees and flush immutable CAS objects directly.
3. **Dual Automated Verification Zones**:
   - **Direct-Bypass Test Cache Zone**: Sub-20ms ephemeral reclamation.
   - **Pre-Review Zone**: Embeds the **TKCV** 5D formal invariant verifier and **IKCE** micro-mutation testing engine (kill rate $K \ge 60\%$).
4. **4-Layer Fractal Reference Topology (`refs/fractal/*`)**: SubAgents merge only into parent worktrees; department and system trunks act as human-governed strategic gates with dual-surface (machine instruction + bilingual card) payloads.
5. **Cryptographic Telemetry Chain (`refs/fractal/telemetry/*`)**: Append-only hash chain hardened via OS-level immutability locks (Win32 read-only / Linux `chattr +a`).

---

## 2. Directory & 10-Crate Kernel Topology

```
fractal-git/
├── Cargo.toml                       # Rust workspace manifest (10 kernel crates)
├── package.json / tsconfig.json     # TypeScript orchestration & gate scripts
├── baselines/                       # Frozen benchmark baselines (taxis-{perf,e2e}.{release,debug}.baseline.json)
├── docs/                            # Technical specifications & ALGORITHMIC_OPTIMIZATION_SURVEY.md
├── crates/                          # 10-Crate Kernel Matrix (L1 -> L3 unidirectional layering)
│   ├── fg-core/                     # L1: OID, identity credentials, clearance model & core traits
│   ├── fg-object/                   # L1: Git object binary codec (Blob / Tree / Commit) & zlib
│   ├── fg-index/                    # L1: Lock-free in-memory virtual tree index
│   ├── fg-algorithms/               # L1: CCD v2 poset pruning, SWAR diff, FastCDC, SpacePlan, 3-way merge
│   ├── fg-pools/                    # L2: Thread-local FreeList pools, WorktreePool (<20ms reclaim), LRU
│   ├── fg-storage/                  # L2: CAS store, Loose ODB, TIPSE in-place object engine & WAL
│   ├── fg-native/                   # L2: TAXC sectioned container (META/HEAD/REFS/INDX/OPLG/PROM/WKTR)
│   ├── fg-topology/                 # L3: 4-layer fractal refs, quarantine state machine & telemetry chain
│   ├── fg-transport/                # L3: Git Smart Protocol v2 (pkt-line) & local agent IPC
│   └── fg-gate/                     # L3: TKCV 5D verifier, IKCE mutation engine & Bayesian credit gate
├── src/                             # Unified Rust facade (lib.rs), benchmarks (bench/) & CLI (bin/taxis)
├── ts/                              # TypeScript orchestration, LayerVFS adapter & Praxis SDK bridge
├── scripts/                         # Cross-platform build & gate scripts (audit-taxis.ps1 / build.sh)
└── tests/                           # Deterministic Rust & TS regression suites (1,400+ tests)
```

---

## 3. Subsystem Boundary Matrix

| Module | Primary Responsibility | Strict Prohibition |
| :--- | :--- | :--- |
| `crates/fg-core/` | OID, credentials, clearance levels, core traits | Zero I/O or network calls |
| `crates/fg-object/` | Git object binary serialization & zlib codec | Zero topology state machines or gate rules |
| `crates/fg-index/` | Lock-free in-memory tree assembly & virtual staging | Zero upward service imports or blocking worktree I/O |
| `crates/fg-algorithms/` | CCD v2, SWAR diff, FastCDC, SpacePlan, 3-way merge | Zero transient heap allocations inside hot loops (`FGT-PRF-001`) |
| `crates/fg-pools/` | Thread-local FreeList buffers, `< 20ms` test cache pool, LRU | Zero unbounded memory growth |
| `crates/fg-storage/` | CAS backend, Loose ODB, TIPSE in-place store, WAL & repack | Zero non-atomic in-place overwrites |
| `crates/fg-native/` | TAXC 7-section native container & repo layout | Zero Git-wire-specific parsing (delegated to projection layer) |
| `crates/fg-topology/` | 4-layer ref topology, quarantine FSM, telemetry hash chain | Zero cross-tier bypass merges |
| `crates/fg-transport/` | Smart Protocol v2 & local IPC | Zero ref writes bypassing `pre-receive` gate |
| `crates/fg-gate/` | TKCV 5D verifier, IKCE mutation testing, Bayesian credit | Zero blocking external network calls |
| `src/bench/` | `TB-REGRESSION` micro-benchmarks & Level 4 E2E clone harness | Zero uncontrolled I/O jitter inside timed loops |
| `src/bin/` | `taxis` CLI entrypoint & 105 modular subcommands (`taxis_cmd/`) | Zero reverse dependencies from `crates/*` |
| `ts/orchestration/` | Multi-card scheduling, variant evaluation & promotion | Zero raw Git binary pack/unpack manipulation |

---

## 4. Extension Routing (`docs/DIRECTORY_SPEC.md`)

- **New Core Algorithm** $\to$ `crates/fg-algorithms/src/<domain>/`
- **New Wire/IPC Protocol** $\to$ `crates/fg-transport/src/<protocol>.rs`
- **New Gate Rule** $\to$ Microsecond checks in `crates/fg-gate/`; deep AST checks in `ts/gate-bridge.ts`
- **New Storage Backend** $\to$ `crates/fg-storage/src/`
- **New E2E Benchmark Dimension** $\to$ `src/bench/e2e/`
- **New CLI Subcommand** $\to$ `src/bin/taxis_cmd/<subcommand>.rs`
