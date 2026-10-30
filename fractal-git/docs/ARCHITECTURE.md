# Fractal Git Architecture Specification

> **Subsystem**: Fractal Git (`fractal-git/` / Taxis)  
> **Target Role**: Core Versioning, Concurrent Spatial Time-Machine & In-Kernel Quality Verifier for Agent-Native Systems  
> **Source Pointer**: [`docs/agent-native-system-blueprint.md`](../../docs/agent-native-system-blueprint.md) §4.2~§4.3  
> **Detailed Docs Index**: [`docs/README.md`](README.md)

---

## 1. Topological Hierarchy & Promotion Gates

Fractal Git organizes worktrees, branches, and verification traces into a strict topological promotion lattice:

```mermaid
flowchart TD
  TRUNK["Trunk / Main<br/>Permanent SSOT | Composite Quality Gate (Score >= 85, Error = 0)"]
  CELL_MAIN["Cell Main (Integration Branch)<br/>Semi-permanent | L2 Cross-Agent & Topology Gating"]
  CARD_WT["Card Worktree (Parent Agent Private)<br/>Ephemeral (Card Scope) | L1 Slice Gate (<10ms)"]
  SUB_WT["SubAgent Worktree (Exploration Probes)<br/>Transient (Minutes/Seconds) | MCTS Tournament"]

  TRUNK === CELL_MAIN
  CELL_MAIN --- CARD_WT
  CARD_WT -.- SUB_WT

  subgraph TELEMETRY_CHAIN["Shadow Audit Namespace (refs/fractal/telemetry/*)"]
    AUDIT_ROOT["Global Telemetry Chain Root"]
    AGENT_CHAIN["Per-Agent Monotonic Hash Chain"]
    AUDIT_ROOT --- AGENT_CHAIN
  end

  CARD_WT -.->|"Pre-Review Audit Attestation"| AGENT_CHAIN
  SUB_WT -.->|"Canary Verification Report"| AGENT_CHAIN
```

### 1.1 Promotion & Reclamation Axioms
1. **Isolation Axiom**: `SubAgent` can only merge into its direct parent `Card` worktree; direct promotion to `CellMain` or `Trunk` triggers a fatal `TopologyBreach`.
2. **Dual-Faced Gate Authority**:
   - `CellMain`: Tactical domain integration overseen by domain coordinators via dual-faced commit metadata summaries;
   - `Trunk`: Strategic production release overseen by system architects via architectural impact matrices.
3. **On-Demand Microsecond Reclamation**: Upon merging upstream, temporary scratch directories are physically unmounted and pruned within `<50ms` (and `<20ms` for Direct-Bypass test caches), while Git commit DAG objects remain permanently indexed in `.git/objects/`.

---

## 2. Dual-Zone Architecture: Test Caching vs Pre-Review Verification

Fractal Git partitions high-frequency automated execution into two orthogonal physical and logical zones:

```mermaid
flowchart LR
  DIRTY["Working Tree Modifications"] --> DISPATCHER{"Zone Execution Dispatcher"}
  
  subgraph ZONE_A["Zone A: Direct-Bypass Test Cache"]
    RAM_DISK["LayerVFS Memory Staging"] --> TEST_EXEC["High-Frequency Local Unit Tests"]
    TEST_EXEC --> QUICK_CLEAN["Direct-Bypass SSD Inode Reclamation (<20ms)"]
  end

  subgraph ZONE_B["Zone B: Kernel-Verified Pre-Review Zone"]
    TKCV["TKCV 5-Dimension Formal Invariants (<5ms)"] --> IKCE["IKCE Hidden Mutation Canary (K >= 60%)"]
    IKCE --> CREDIT["Bayesian Credit Update (Jeffreys Beta)"]
  end

  DISPATCHER -->|"Local Test Loop / Scratch"| ZONE_A
  DISPATCHER -->|"Candidate Commit Request"| ZONE_B

  ZONE_B -->|"Mutation Kill Failed / Deception"| QUARANTINE[".taxis/quarantine/ (ACL Locked)"]
  ZONE_B -->|"Formal + Canary Verified"| APPROVE["GateApproved State"]
```

1. **Direct-Bypass Test Cache (Zone A)**:
   - Dedicated scratch workspace for high-frequency unit testing;
   - Uses zero-copy memory staging with Direct-Bypass recycling under `<20ms`;
   - Never writes partial or failing states to Git ODB DAG.
2. **Kernel-Verified Pre-Review Zone (Zone B)**:
   - Strict gatekeeper for all promotion-bound candidate commits;
   - Enforces TKCV formal invariant proofs and IKCE blind mutation killing;
   - Isolates deceptive or defective code into `.taxis/quarantine/` with operating system write locks.

---

## 3. Worktree Deterministic Lifecycle State Machine

Worktrees progress through an explicit type-state state machine, guaranteeing deterministic transitions and eliminating phantom states:

```mermaid
stateDiagram-v2
  [*] --> Spawned: createWorkspace() from baseline OID
  Spawned --> InPreReview: enter_pre_review()
  
  state InPreReview {
    [*] --> InvariantCheck: evaluate_tkcv()
    InvariantCheck --> CanaryTesting: invariants_valid (TKCV <5ms)
    InvariantCheck --> Rejected: invariant_breached
    CanaryTesting --> GateApproved: canary_killed (K >= 60%)
    CanaryTesting --> Quarantined: deceptive_pass / kill_insufficient
  }

  InPreReview --> Spawned: Rework requested (gate rejected)
  InPreReview --> Quarantined: enter_quarantine() (isolated to .taxis/quarantine/)
  
  GateApproved --> Materialized: record_materialization() [Commit written to ODB]
  Materialized --> Reclaimed: mark_reclaimed() [Directory pruned <50ms]
  Quarantined --> Reclaimed: audit_resolved()
  Reclaimed --> [*]
```

### Lifecycle Transition Invariants
- `Spawned -> InPreReview`: Allocates private LayerVFS layer and assigns task jail;
- `InPreReview -> GateApproved`: Must satisfy both TKCV 5D invariants and IKCE canary kill ratio ($K \ge 60\%$);
- `InPreReview -> Quarantined`: Triggered when mutation kill falls below critical threshold or deceptive code is detected;
- `GateApproved -> Materialized`: Atomically writes Commit object, updates branch ref, and appends telemetry hash chain;
- `Materialized -> Reclaimed`: Prunes physical workspace directory within `<50ms`.

---

## 4. In-Kernel Quality & Shadow Verification Subsystems

### 4.1 TKCV (Taxis Kernel Correctness Verifier)
- **Execution Overhead**: Linear AST inspection executed in $<5\text{ms}$;
- **5-Dimension Formal Invariants**:
  1. *AST Closure & Balance*: Structural node integrity;
  2. *Symbol Reachability & Liveness*: Detection of dead functions and hollow stub exports;
  3. *Pure Function Equivalence*: Zero undeclared side-effects in critical paths;
  4. *Memory Lifecycle Unidirectionality*: Paired handle allocations and zero orphan descriptors;
  5. *Type & Error Exhaustiveness*: 100% pattern matching and absence of swallow-all catch blocks.

### 4.2 IKCE (In-Kernel Canary Engine)
- **Blind Mutation Killing**: Injects micro-mutations (operator flipping, boundary shifts, statement elimination);
- **Kill Threshold**: Requires $K = \frac{D_{\text{killed}}}{D_{\text{total}}} \ge 60\%$;
- **Zero-Assertion Defense**: Automatically catches tests that pass regardless of core logic destruction.

### 4.3 Bayesian Dynamic Credit Controller
- **Conjugate Posterior Updating**:
  $$\alpha_{t+1} = \alpha_t + \mathbb{I}(\text{Pass}), \quad \beta_{t+1} = \beta_t + \mathbb{I}(\text{Fail})$$
  $$\text{Credit} = 100 \times \frac{\alpha}{\alpha + \beta} \quad (\text{Prior: } \text{Beta}(0.5, 0.5))$$
- **Adaptive Gate Scheduling**: Automatically bypasses deep canary rounds for high-credit agents ($\text{Credit} \ge 90$) while enforcing full isolation for low-credit agents ($\text{Credit} < 60$).

### 4.4 Cryptographic Shadow Audit Chain (`refs/fractal/telemetry/*`)
- **Isolation**: Stored under isolated reference namespace `refs/fractal/telemetry/*` outside regular branch graphs;
- **Hash-Linked Immutable Trail**: Each verification event references previous telemetry block hash via SHA-256;
- **OS-Level Tamper Resistance**: Enforces read-only ACL on Windows and `chattr +a` (append-only) attributes on Linux.

---

## 5. Lockless In-Memory Virtual Index

Traditional Git serializes concurrent access via `.git/index.lock`. Fractal Git eliminates this bottleneck:
- Each agent receives an isolated in-memory index builder;
- Staged entries are compiled in memory and flushed directly as loose objects (`blob` and `tree`);
- Achieves **0% file lock contention** and `<3ms` commit tree assembly across 100+ concurrent worker subagents.

---

## 6. Dual-Faced Commit Data Layout

```
+------------------------------------------------------------------+
| tree <40-char-sha1>                                              |
| parent <40-char-sha1>                                            |
| author <agent_uid> <<agent_uid>@<cell_id>.praxis.local> <ts> +0000|
| committer <agent_uid> <<agent_uid>@<cell_id>.praxis.local> <ts>   |
|                                                                  |
| feat(core): atomic task implementation                           |
|                                                                  |
| [Project: fractal-git]                                           |
| [Why] Resolves domain requirement card-101                       |
| [Changed] Added AST-verified parsing logic                       |
| [Verification] Verified AST invariant assertion with zero cycle  |
|                                                                  |
| Praxis-Agent-Meta: {"card_id":"...","score":100.0,...}           |
+------------------------------------------------------------------+
```

---

## 7. In-Place Storage Engine & Reversibility (TIPSE)

```
PeakDiskUsage = max(S_archive, S_extracted) + Delta_batch
```

TIPSE eliminates the classic $S_{\text{archive}} + S_{\text{extracted}}$ 2x disk space bottleneck during large archive imports and git unbundling:
- **Discrete Event SpacePlan**: Simulates minimum trough water-level using `i128` wide arithmetic before touching disk;
- **Reverse Tail-Truncation**: Extracts archive members from high to low physical offsets and commits batched file truncations (`SetEndOfFile` / `ftruncate`);
- **Forward Hole-Punching**: Sparse file punch hole (`FSCTL_SET_SPARSE` / `FALLOC_FL_PUNCH_HOLE`) for streaming `.tar.gz`;
- **Micro-Pack Progressive Repack**: Slices large repository repacks into 64MB~256MB micro-packs, immediately verifying each slice and pruning redundant loose objects;
- **Crash Recovery & Restorer**: Write-Ahead Logging (`InPlaceJournal`) guarantees crash consistency; `ArchiveRestorer` synthesizes valid Central Directory & EOCD headers upon abortion.

Detailed specification: [`08-taxis-in-place-storage-engine.md`](08-taxis-in-place-storage-engine.md).

---

## 8. Crate Topology & Architectural Dependency Matrix

Fractal Git is strictly architected as 10 focused micro-crates with a unidirectional acyclic dependency graph:

```
[Layer 5: Presentation & CLI]
       fg-cli
         │
[Layer 4: Verification & Gating]
       fg-gate ◄────────────────────────┐
         │                              │
[Layer 3: Worktrees & Topology]         │
       fg-worktree                      │
         │                              │
       fg-topology ─────────────────────┤
         │                              │
[Layer 2: Protocols, Packs & Pools]     │
   ┌─────┴──────────────┐               │
fg-protocol          fg-pack         fg-pools
   │                    │               │
   └──────────┬─────────┴───────────────┘
              │
[Layer 1: Storage & In-Place Engine]
          fg-storage ◄──── fg-tipse
              │
[Layer 0: Core Primitives]
           fg-core
```

| Crate | Responsibilities | Key Types / Modules |
| :--- | :--- | :--- |
| **`fg-core`** | OID, ObjectType, Error, Hash, Zero-Alloc slices | `ObjectId`, `ObjectType`, `Span`, `TaxisError` |
| **`fg-storage`** | Loose objects, Packfile read, Memory ODB | `LooseStorage`, `MemoryOdb`, `ObjectHeader` |
| **`fg-tipse`** | In-place storage extraction, Sparse puncture | `SpacePlanner`, `ReverseTruncator`, `HolePuncher` |
| **`fg-pack`** | Pack delta decoding, Pack index v2, Micro-pack | `PackResolver`, `DeltaEngine`, `PackIndexV2` |
| **`fg-protocol`** | Git wire protocol, Smart HTTP, Framing | `PktLineReader`, `UploadPackHandler`, `Capabilities` |
| **`fg-pools`** | Reusable byte buffers, Fast caches, Recyclers | `BytePool`, `ObjectPool`, `DirectBypassPool` |
| **`fg-topology`** | DAG traversal, Reference management, Telemetry | `RefDatabase`, `AuditHashChain`, `TelemetryEntry` |
| **`fg-worktree`** | LayerVFS, Virtual Index, Quarantine | `WorktreeManager`, `LayerVfs`, `QuarantineBox` |
| **`fg-gate`** | TKCV AST verifier, IKCE canary engine, Credit | `KernelAstVerifier`, `CanaryEngine`, `AgentCredit` |
| **`fg-cli`** | Unified user & agent CLI entry point | Subcommands: `init`, `commit`, `quality`, `quarantine` |

---

## 9. Command Surface Reference

| Command | Synopsis | Verification & Gating Action |
| :--- | :--- | :--- |
| `taxis init <path>` | Initializes Taxis repository | Establishes `.taxis/`, ODB layout, and telemetry refs |
| `taxis commit -m <msg>` | Automated pre-review commit | Runs TKCV and IKCE; materializes commit upon gate approval |
| `taxis quality trace` | Audits agent telemetry chain | Traverses `refs/fractal/telemetry/*` and validates hash chain |
| `taxis quality audit` | Runs comprehensive inspection | Evaluates TKCV 5D invariants and micro-mutation kill ratios |
| `taxis quarantine list` | Lists quarantined candidates | Inspects locked workspaces under `.taxis/quarantine/` |
| `taxis quarantine resolve` | Resolves or discards quarantine | Unlocks OS ACL and executes clean physical reclamation |
