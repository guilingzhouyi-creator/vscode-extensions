# Rule Family Map (Coding Guidelines Pointer Table)

> Human-readable projection of `scripts/common/rule-catalog.json`: one concise guideline and the complete ID set per family. Canonical definitions live in SSOT and project analyzers.
>
> **error** IDs block gates; `warning / info` IDs report advisories. Keep family headings and severity buckets synchronized with `validate-family-contract.js`.

---

## Naming, Comments & Docs

### `NAM` — Identifier-as-Contract

Contract: Self-explanatory file, type, member, and collection names; block cryptic abbreviations, single letters, vague shells (`data`/`res`/`tmp`), and bloated stacks.

- warning / info: `NAM-ABR-001`, `NAM-COL-001`, `NAM-DEC-001`, `NAM-DIR-001`, `NAM-FIL-001`, `NAM-GLB-001`,
  `NAM-GLB-002`, `NAM-JRG-002`, `NAM-LEN-001`, `NAM-LEN-002`, `NAM-MBR-001`, `NAM-RES-001`,
  `NAM-RES-002`, `NAM-RES-003`, `NAM-RES-004`, `NAM-RES-005`, `NAM-SGL-001`, `NAM-TYP-001`,
  `NAM-VAG-001`

### `CMT` — Comments State Why, Not What

Contract: 6-field file headers, export docs, contract alignment, zero mixed prose languages, width <= 100 cols; mechanical restatements penalize density.

- warning / info: `CMT-BAN-001`, `CMT-CON-001`, `CMT-DOC-001`, `CMT-DOC-002`, `CMT-HDR-001`, `CMT-HDR-002`,
  `CMT-HDR-003`, `CMT-HDR-004`, `CMT-INT-001`, `CMT-LNG-001`, `CMT-LNG-002`, `CMT-MOJI-001`,
  `CMT-SEP-001`, `CMT-TRM-001`, `CMT-VMD-001`, `CMT-WID-001`

### `DOC` — Document Structure & Reachability

Contract: Close code fences, keep relative links alive, forbid hype/sprint codenames, eliminate duplicate cross-doc paragraphs.

- **error**: `DOC-FEN-001`
- **error** (workspace-timing): `DOC-CL-001`, `DOC-CL-002`, `DOC-CL-003`, `DOC-CL-004`, `DOC-CL-005`, `DOC-CL-006`, `DOC-CL-007`, `DOC-CL-008`, `DOC-CL-009`, `DOC-RD-001`, `DOC-RD-002`, `DOC-RD-003`, `L3-DOC-LAYOUT`
- warning / info: `DOC-DUP-001`, `DOC-LNK-001`, `DOC-TRM-001`

### `ART` — WebGames Art Orders & Asset Specs

Contract: Bidirectional alignment between sprite/icon/VFX orders, dimensions, naming, and asset manifests; zero untracked assets.

- warning / info: `ART-AUD-005`, `ART-ICO-012`, `ART-REC-001`, `ART-REC-002`, `ART-REC-003`, `ART-REC-004`,
  `ART-REC-005`, `ART-REC-006`, `ART-REC-007`, `ART-REC-008`, `ART-REC-009`, `ART-SPEC-001`,
  `ART-SPEC-002`, `ART-SPEC-003`, `ART-SPEC-004`, `ART-SPEC-005`, `ART-SPEC-006`, `ART-SPEC-007`,
  `ART-SPEC-008`, `ART-UI-001`, `ART-VIG-003`

### `RES` — Resource & Shutdown Contracts

Contract: Structured resource stores stay enumerable and reclaimable; host shutdown paths release handles idempotently.

- **error** (workspace-timing): `L3-RESOURCE-TOPO`, `RES-TOPO-NAMING-DEPTH`, `RES-TOPO-OVER-DESCRIPTIVE`, `RES-TOPO-OVER-GENERIC`, `RES-TOPO-OVER-SPECIALIZED`, `RES-TOPO-RESP-MISMATCH`
- warning / info: `RES-SHUT-001`

---

## Errors, Types & Interfaces

### `ERR` — Explicit Failure Semantics

Contract: Fallible operations return discriminated results or typed errors; never swallow exceptions or encode failure as null.

- **error**: `FGT-ERR-001`
- warning / info: `ERR-FLT-001`, `ERR-MSG-001`, `ERR-PRP-001`

### `TSM` — TypeScript Idioms

Contract: Ban `any`, `var`, legacy `require`/`substr`/`includes` traps; declare constructor and spread semantics explicitly.

- warning / info: `TSM-ANY-001`, `TSM-ARGS-001`, `TSM-CTOR-001`, `TSM-DISP-001`, `TSM-INCLUDES-001`, `TSM-REPLACE-001`,
  `TSM-REQUIRE-001`, `TSM-SPREAD-001`, `TSM-SUBSTR-001`, `TSM-TYPE-001`, `TSM-VAR-001`

### `PYM` — Python Idioms

Contract: Use `collections.abc`, `with` context managers, `X | None`, built-in generics, `raise ... from`, `slots=True`; ban mutable defaults.

- **error**: `PYM-ABC-001`, `PYM-ASYNC-001`, `PYM-DATETIME-001`, `PYM-GENERIC-001`, `PYM-UNION-001`
- warning / info: `PYM-DEFAULT-001`, `PYM-FSTRING-001`, `PYM-IMPORT-001`, `PYM-OPEN-001`, `PYM-PATH-001`,
  `PYM-RAISE-001`, `PYM-SHADOW-001`, `PYM-SLOTS-001`

### `RSM` — Rust Idioms

Contract: Zero bare `panic`, `unsafe` with `// SAFETY:`, `let-else`, `&str` over `&String`, no locks across `.await`.

- **error**: `RSM-PNC-001`
- warning / info: `RSM-CAST-001`, `RSM-CLONE-001`, `RSM-ELSE-001`, `RSM-EXP-001`, `RSM-EXTERN-001`, `RSM-FIND-001`,
  `RSM-FORMAT-001`, `RSM-LOCK-001`, `RSM-MACRO-001`, `RSM-SAF-001`, `RSM-STR-001`, `RSM-TRY-001`,
  `RSM-UNWRAP-001`

### `GOM` — Go Idioms

Contract: Pass `context.Context` first, wrap errors via `%w`, comment exports, forbid bare `panic` in library code.

- warning / info: `GOM-CTX-001`, `GOM-ERR-001`, `GOM-STYLE-001`, `GOM-STYLE-002`, `GOM-STYLE-003`

### `NUM` — Numeric Bounds & Precision

Contract: Dual-bound recursion and loops; avoid silent precision loss in scaling or rounding.

- warning / info: `NUM-BND-001`, `NUM-PREC-001`

### `SIM` — Simplification & Clarity

Contract: Collapse >= 4 params into option objects; forbid boolean flags, empty shells, and deep nesting via guard returns.

- **error**: `SIM-INH-001`
- warning / info: `SIM-ARGS-001`, `SIM-ARGS-002`, `SIM-BOOL-001`, `SIM-CMP-001`, `SIM-COMC-001`, `SIM-DED-001`, `SIM-ELSE-001`, `SIM-EMPTY-001`,
  `SIM-FLAT-002`, `SIM-GUARD-001`, `SIM-IMM-001`, `SIM-INL-001`, `SIM-LONG-001`, `SIM-PRNT-001`,
  `SIM-TRN-001`, `SIM-WRP-001`

### `ARCH` — Architecture Boundaries & Facade Substance

Contract: Unidirectional layers, substantive facades (`ELOC >= 15` or frozen), dissolve `<= 3`-line forwarding trampolines.

- **error**: `ARCH-ABS-001`, `ARCH-DIR-003`, `ARCH-FAC-001`, `ARCH-HDL-001`, `clean-layer-violation`
- warning / info: `ARCH-BLR-001`, `ARCH-BND-001`, `ARCH-CFG-001`, `ARCH-CFG-002`, `ARCH-CFG-003`,
  `ARCH-CFG-004`, `ARCH-CFG-005`, `ARCH-CFG-006`, `ARCH-CFG-007`, `ARCH-CFG-008`, `ARCH-CFG-009`,
  `ARCH-DEC-002`, `ARCH-DIR-001`, `ARCH-DIR-002`, `ARCH-DISP-001`, `ARCH-DSP-002`, `ARCH-GLB-001`,
  `ARCH-LEAK-001`, `ARCH-LEAK-002`, `ARCH-PLM-001`, `ARCH-ROL-001`, `ARCH-ROL-002`, `ARCH-SKL-001`,
  `ARCH-TMP-001`, `ARCH-UTL-001`

### `MOD` — Module Boundaries

Contract: Block backward imports, flat cross-layer references, and bloated public surfaces.

- warning / info: `MOD-BWD-001`, `MOD-DEP-001`, `MOD-FLB-001`

---

## Dependencies, Constants & Volume

### `DEP` — Dependencies & Supply Chain

Contract: Infra never imports domain; block cycles, production `devDependency` leaks, phantom/unpinned/copyleft packages.

- **error**: `DEP-INV-001`, `DEP-VULN-001`, `disallowed-import`, `FGT-DEP-001`, `import-cycle`
- warning / info: `DEP-DEV-001`, `DEP-LAZ-001`, `DEP-LIC-001`, `DEP-OBS-001`, `DEP-ORD-001`, `DEP-ORD-002`,
  `DEP-PHANTOM-001`, `DEP-PIN-001`, `DEP-RES-001`, `DEP-WLD-001`, `unused-export`, `unused-module`

### `CONST` — Single-Source Constants & Layering

Contract: Extract repeated literals, keep cross-file synonyms synced, pin constant declaration zones, block kitchen-sink bags.

- warning / info: `CONST-CLU-001`, `CONST-DRF-001`, `CONST-LAY-001`, `CONST-LAY-002`, `CONST-LIB-001`, `CONST-OWN-001`,
  `CONST-SCP-001`, `CONST-SCP-002`, `duplicate-literal`, `hardcoded-string`, `magic-number`, `nested-constant`

### `VOL` — Dual-Track Volume Budget

Contract: Enforce ELOC and LOC caps, 1:3 dynamic envelope, and never strip comments to dodge line limits.

- **error**: `VOL-DIL-001`, `VOL-DOC-001`, `VOL-ELOC-001`, `VOL-LOC-001`
- warning / info: `VOL-POR-001`, `VOL-RATIO-001`, `VOL-TAU-001`, `VOL-TAU-002`

### `BIG` — Oversized Files

Contract: Split oversized files along cohesive domain boundaries instead of mechanical slicing.

- warning / info: `large-file`

### `CMP` — Expression & Statement Density

Contract: Block deep inline callback chains, bitwise/ternary stacks, and multi-statement lines.

- warning / info: `CMP-CAL-001`, `CMP-DEN-001`, `CMP-EXP-001`, `CMP-LIN-001`

### `CPX` — Complexity & Space Budgets

Contract: Enforce `CC <= 15`, `Depth <= 4`, zero loop heap allocations, and bounded recursion.

- **error**: `CPX-REC-001`
- warning / info: `CPX-AMP-001`, `CPX-BUD-001`, `CPX-HOP-001`, `CPX-JST-001`, `CPX-NEST-001`, `CPX-NEST-002`,
  `CPX-RED-001`, `CPX-SPACE-001`, `CPX-STM-001`, `CPX-TIME-001`, `CPX-TRV-001`, `high-complexity`

### `PRF` — Hot Paths & Memory

Contract: Hoist regex constants, block loop I/O, bound caches, and match algorithmic complexity to scale.

- **error**: `expensive-loop-operation`, `FGT-PRF-001`, `PRF-POL-002`
- warning / info: `high-algorithmic-complexity`, `loop-transient-allocation`, `PRF-ALG-001`, `PRF-ALG-002`,
  `PRF-DUP-001`, `PRF-IO-001`, `PRF-LEAK-001`, `PRF-MEM-001`, `PRF-MEM-002`, `PRF-POL-001`,
  `PRF-POL-003`, `PRF-POL-004`

### `LAY` — Layer Topology (layer: L2)

Contract: Unidirectional layers, zero cycles, resolvable imports.

- **error** (workspace-timing): `L2-LAYERS`, `LAY-CYCLE`, `LAY-IMPORT`, `LAY-UNRESOLVED`

### `HC` — Hardcode Audit (layer: L3)

Contract: Block absolute paths, CJK literals in source, magic numbers, secrets; route UI strings via dictionary keys.

- **error** (workspace-timing): `HC-ABS-PATH`, `HC-CJK-LITERAL`, `HC-MAGIC-NUM`, `HC-SECRET`, `HC-UI-STRING`, `L3-HARDCODE`

---

## Testing, UI & Platforms

### `TST` — Test Engineering

Contract: Isolate clocks and RNG, zero skipped or orphan specs, monotonic duration ratchets, source-isomorphic test layout.

- **error** (workspace-timing): `L0-TEST`
- warning / info: `TST-DBT-001`, `TST-DEN-001`, `TST-FLT-001`, `TST-ILS-001`, `TST-ORC-001`, `TST-SKP-001`,
  `TST-TAU-001`, `TST-TOP-001`

### `UI` — UI Engineering & Interaction Physics

Contract: Semantic lightness steps, single closed borders, damped second-order motion, power-law masks.

- warning / info: `UI-ENG-001`, `UI-ENG-002`, `UI-ENG-003`, `UI-ENG-004`, `UI-ENG-005`, `UI-ENG-006`, `UI-ENG-007`,
  `UI-ENG-008`

### `VSC` — VS Code Extension Contracts

Contract: 100% bilingual dictionaries, RingBuffer + Journal crash safety, bounded statusbar updates, strict memory budgets.

- **error**: `VSC-MEM-001`, `VSC-UI-002`
- warning / info: `VSC-I18N-001`, `VSC-PERF-001`, `VSC-PERF-002`, `VSC-UI-001`, `VSC-UI-003`, `VSC-UI-004`

### `PROD` — Production Build Hygiene

Contract: Zero `console`/TODO remnants, leaked sourcemaps, or server env exposure in client bundles.

- **error**: `PROD-HYG-001`, `PROD-HYG-002`, `PROD-HYG-003`

### `SEC` — Security & Exposure Surface

Contract: Keep internal endpoints out of client bundles, visual hiding is not auth, zero hardcoded secrets or test routes.

- **error**: `SEC-EXP-001`, `SEC-EXP-002`, `SEC-EXP-004`, `SEC-EXP-005`, `SEC-VUL-001`, `SEC-VUL-002`,
  `secret-detected`
- warning / info: `high-entropy-token`, `SEC-EXP-003`, `SEC-LEAK-001`, `SEC-VUL-003`, `SEC-VUL-004`, `SEC-VUL-005`,
  `SEC-VUL-006`

### `DAT` — Data Access

Contract: Block N+1 queries, unbounded table loads, and persistence driver leakage into business core.

- **error**: `DAT-NPL-001`
- warning / info: `DAT-DEF-001`, `DAT-LAY-001`, `DAT-QRY-001`, `DAT-RES-001`, `DAT-SER-001`

### `STDLIB` — Standard Library Discipline

Contract: Block panicking stdlib calls, require bounded allocations, wrap OS APIs portably, bound recursion.

- **error**: `STDLIB-ALLOC-001`, `STDLIB-UNSAFE-001`
- warning / info: `STDLIB-CONST-001`, `STDLIB-PANIC-001`, `STDLIB-PORT-001`, `STDLIB-RECURSION-001`

### `SH` — Bash Idioms

Contract: Enforce `set -euo pipefail`, quoted expansions/subshells, flat error capture, guarded interactive reads.

- **error**: `SH-EOL-001`, `SH-SAFE-001`, `SH-SEC-001`, `SH-TRAP-001`
- warning / info: `SH-ARRAY-001`, `SH-CMD-001`, `SH-COND-001`, `SH-DEPR-001`, `SH-DOC-001`, `SH-ECHO-001`, `SH-ERR-001`,
  `SH-EXIT-001`, `SH-INIT-001`, `SH-QUOTE-001`, `SH-READ-001`

### `PS` — PowerShell Idioms

Contract: Verb-Noun naming, `[CmdletBinding()]`, block `iex` dynamic eval, release handles via `try/finally`.

- **error**: `PS-SAFE-001`, `PS-SEC-001`
- warning / info: `PS-ALIAS-001`, `PS-CMDLET-001`, `PS-DOC-001`, `PS-ERROR-001`, `PS-PARAM-001`, `PS-TRAP-001`,
  `PS-VERB-001`

### `GDM` — GDScript Engine Contracts

Contract: Valid node paths and `@onready` ordering, paired signal connect/disconnect, zero-alloc pools, single-source i18n.

- **error**: `GDM-ISO-001`, `GDM-POL-001`, `GDM-PRF-001`
- warning / info: `GDM-BAR-001`, `GDM-BND-001`, `GDM-CONNECT-001`, `GDM-DEB-001`, `GDM-EXPORT-001`, `GDM-EXT-001`,
  `GDM-FSM-001`, `GDM-I18N-001`, `GDM-LOC-001`, `GDM-NOD-001`, `GDM-ONREADY-001`, `GDM-POOL-001`,
  `GDM-POOL-002`, `GDM-RES-001`, `GDM-RPC-001`, `GDM-SIG-001`, `GDM-TOK-001`, `GDM-TOOL-001`,
  `GDM-UNI-001`, `GDM-VRT-001`, `GDM-WEAK-001`, `GDM-YIELD-001`

### `ADV` — High-Performance Script & Engine Constraints

Contract: Zero loop heap allocs, contiguous buffers, `reset_state()` object pools, seedable RNG, bounded event dispatch.

- **error**: `ADV-BND-001`, `ADV-CFG-001`, `ADV-DEC-001`, `ADV-EVT-001`, `ADV-EVT-002`, `ADV-EVT-003`,
  `ADV-NAM-001`, `ADV-POOL-001`, `ADV-RNG-001`, `ADV-SIG-001`, `ADV-TYP-002`
- warning / info: `ADV-CFG-002`, `ADV-EVT-004`, `ADV-LAM-001`, `ADV-PRF-001`, `ADV-PRF-002`, `ADV-PRF-003`,
  `ADV-PRF-004`, `ADV-TYP-001`, `ADV-TYP-003`, `ADV-UI-001`

### `UUID` — Reentrancy & Idempotency

Contract: Reentrant paths must remain idempotent so repeated triggers never duplicate side effects.

- **error**: `UUID-REENTRANT-001`

### `ENG` — Analyzer Self-Fault Isolation

Contract: Degrade single-file analyzer exceptions into structured diagnostics without aborting batch runs.

- warning / info: `analyzer-error`

### `EXT` — External Directory Boundaries

Contract: Restrict scans and writes to controlled allowlisted directories; reject path escapes.

- **error**: `EXT-DIR-001`

### `BLD` — Compile Baseline (layer: L0)

Contract: Code must compile cleanly; never pass gates by skipping compilation.

- **error** (workspace-timing): `L0-COMPILE`

### `LINT` — Static Lint Baseline (layer: L1)

Contract: Zero lint/format warnings; never mask defects with ignore pragmas.

- **error** (workspace-timing): `L1-*`, `L1-LINT`

### `TB` — Test Budget & Ratchet (layer: L4)

Contract: Enforce suite time budgets, require baseline existence, and block runtime regressions.

- **error** (workspace-timing): `L4-TEST-BUDGET`, `TB-NO-BASELINE`, `TB-REGRESSION`

---

## Governance & Gates

### `GOV` — Runtime Governance Contracts

Contract: Never swallow exceptions, sanitize logs, keep single-source type contracts, trigger real anti-gaming circuit breakers.

- **error**: `GOV-AGN-001`, `GOV-EXC-001`, `GOV-EXC-003`, `GOV-MNT-002`, `GOV-PRF-003`, `GOV-RUL-001`,
  `GOV-SLC-001`, `GOV-TRJ-001`
- warning / info: `GOV-ARC-001`, `GOV-BLS-001`, `GOV-DAT-001`, `GOV-DBG-001`, `GOV-EXC-002`, `GOV-FIL-001`,
  `GOV-FIL-002`, `GOV-GAM-001`, `GOV-HOK-001`, `GOV-LOG-001`, `GOV-LOG-002`, `GOV-MNT-001`,
  `GOV-MSG-001`, `GOV-PRF-001`, `GOV-PRF-002`, `GOV-PRF-004`, `GOV-PRF-005`, `GOV-RTC-002`,
  `GOV-SAN-001`, `GOV-SAN-002`, `GOV-STD-001`, `GOV-STD-002`, `GOV-TYP-001`, `GOV-TYP-002`,
  `GOV-TYP-003`, `GOV-TYP-004`, `GOV-TYP-005`, `GOV-TYP-006`

### `GUARD` — Gates & Guards

Contract: Enforce AST slice budgets, registered steps, closed feedback status words, shell parity, sandbox jails, and SSOT sync.

- **error**: `GUARD-AST-001`, `GUARD-BASE-001`, `GUARD-CHAIN-001`, `GUARD-COUNT-001`, `GUARD-DESTR-001`,
  `GUARD-DOC-001`, `GUARD-ENT-001`, `GUARD-ERR-001`, `GUARD-FAC-001`, `GUARD-FBK-001`, `GUARD-HYG-001`,
  `GUARD-ISO-001`, `GUARD-JAIL-001`, `GUARD-MSG-001`, `GUARD-MSG-002`, `GUARD-MSG-003`, `GUARD-ORD-001`,
  `GUARD-PROC-001`, `GUARD-ROUTE-001`, `GUARD-SHELL-001`, `GUARD-SSOT-001`, `GUARD-STEP-001`,
  `GUARD-SYS-001`, `GUARD-VAR-001`
- warning / info: `GUARD-BUDGET-001`, `GUARD-HOOK-001`, `GUARD-PAIR-001`

### `HYG` — Physical Hygiene

Contract: Non-empty files, `.ps1` CRLF / others LF, UTF-8 no BOM, single EOF newline, spaces only, `kebab-case` paths.

- **error**: `HYG-BOM-001`, `HYG-CLT-001`, `HYG-DIR-001`, `HYG-EMP-001`, `HYG-EMP-002`, `HYG-EOL-001`,
  `HYG-IND-001`, `HYG-SUP-001`, `HYG-TRL-001`
- warning / info: `HYG-BLT-001`, `HYG-CLN-001`, `HYG-DED-001`, `HYG-EXC-001`, `HYG-NAM-001`, `HYG-SGL-001`,
  `HYG-STB-001`, `HYG-STB-002`, `HYG-WRAP-001`, `HYG-WRAP-002`

### `CMG` — Commit Message Specification

Contract: Require controlled `[Project]`, body floor, zero forbidden/exaggerated/pejorative/meta prose, and non-dump verification.

- **error**: `CMG-PRJ-001`, `CMG-STY-001`, `CMG-STY-002`, `CMG-STY-003`, `CMG-STY-004`, `CMG-STY-005`,
  `CMG-STY-006`, `CMG-STY-007`, `CMG-STY-008`

### `RCFG` — Rule Meta-Governance

Contract: Enforce bidirectional rule ID closure, metric-to-SSOT parity, and deduplicated presentation vs AST findings.

- **error**: `RCFG-COUNTS-001`
- **error** (workspace-timing): `L3-REVIEW-CONFIG`, `RCFG-GLOBS`, `RCFG-MATRIX`, `RCFG-RULE-DRIFT`, `RCFG-SCHEMA`, `RCFG-TOOL-PATH`

### `SCR` — Script Catalog Standard (layer: L3)

Contract: Maintain bidirectional script naming, headers, and registry completeness (zero orphans or dangling entries).

- **error** (workspace-timing): `L3-SCRIPT-STANDARD`, `SCR-DANGLING`, `SCR-HEADER`, `SCR-NAMING`, `SCR-ORPHAN`

### `ARF` — Refactor Gate (layer: L5)

Contract: Refactors require net quality improvement and behavioral equivalence; block superficial relocation.

- **error** (workspace-timing): `ARF-*`, `L5-REFACTOR`

---

## `fractal-git` Native Kernel

### `ALG` — Algorithm Equivalence

Contract: Native operators must remain differentially equivalent to Git/reference baselines.

- **error**: `FGT-ALG-001`

### `AUD` — Cryptographic Audit Telemetry Chain

Contract: Audit records must carry HMAC signatures and intact predecessor hash links.

- **error**: `FGT-AUD-001`

### `BRG` — Bridge / FFI Boundaries

Contract: FFI and N-API bridge layers must declare explicit ownership and lifetime contracts.

- **error**: `FGT-BRG-001`

### `BYP` — Test Bypass & Cache Reclamation

Contract: High-frequency test scratch workspaces reclaim atomically and never write unverified objects into Git ODB.

- **error**: `FGT-BYP-001`

### `CAS` — Lock-Free CAS

Contract: Compare-and-swap loops must guard against ABA races and specify exact memory ordering.

- warning / info: `FGT-CAS-001`

### `COR` — Core Invariants

Contract: Pre- and post-conditions of core kernel structures must be explicitly assertable.

- **error**: `FGT-COR-001`

### `FAC` — Facade Substance

Contract: Crate facades must bear real domain types/re-exports rather than empty pass-through wrappers.

- warning / info: `FGT-FAC-001`

### `GAT` — Kernel Self-Audit & Differential Bounds

Contract: Kernel gates prove self-detection and enforce batch/file ELOC envelopes, TSPR density, and streak escalation.

- **error**: `FGT-GAT-001`, `GAT-BATCH-001`, `GAT-BOUND-001`, `GAT-DENS-001`, `GAT-EXMP-001`, `GAT-STREAK-001`

### `IDX` — Index Bounds Safety

Contract: Index accesses must carry explicit bounds checks or formal range invariants.

- **error**: `FGT-IDX-001`

### `IMPACT` — Impact Slice Mapping Guard

Contract: Pre-test slicing narrows only registered crate paths and falls back to full tests for unknown paths.

- **error**: `FGT-IMPACT-001`

### `LCK` — Lock Discipline

Contract: Never hold locks across `.await`; keep critical sections minimal.

- warning / info: `FGT-LCK-001`

### `MSG` — Kernel Commit-Msg Guard

Contract: Enforce header format, sections, density floor, forbidden terms, placeholder checks, project scope, and rule closure.

- **error**: `FGT-MSG-001`, `FGT-MSG-002`, `FGT-MSG-003`, `FGT-MSG-004`, `FGT-MSG-005`, `FGT-MSG-006`, `FGT-MSG-007`, `FGT-MSG-008`, `FGT-MSG-009`, `FGT-MSG-010`, `FGT-MSG-011`, `FGT-MSG-012`

### `MUT` — Kernel Micro-Mutation Kill Rate

Contract: Micro-mutation kill rates inside the kernel gate must meet the minimum floor.

- **error**: `FGT-MUT-001`

### `OBJ` — Object Lifecycle

Contract: Object pool borrows and returns must remain symmetric and idempotent.

- **error**: `FGT-OBJ-001`

### `POL` — Policy Injection

Contract: Policies stay pluggable and free of hardcoded domain branches.

- **error**: `FGT-POL-001`

### `PYR` — 4-Tier Temporal Pyramid Fold

Contract: Historical telemetry folding preserves unidirectional aggregation fidelity and bounded footprint.

- **error**: `FGT-PYR-001`

### `QRN` — Physical Quarantine Isolation

Contract: Snapshots triggering critical defects route into quarantine refs and cannot promote to main.

- **error**: `FGT-QRN-001`

### `SAF` — `unsafe` Minimization

Contract: Keep `unsafe` scopes minimal and attach strict 3-part `// SAFETY:` proofs.

- **error**: `FGT-SAF-001`

### `STO` — Storage Atomicity

Contract: Persistent state writes must remain atomic and crash-recoverable.

- **error**: `FGT-STO-001`

### `TAU` — Anti-Tautology Test Guard

Contract: Reject empty or tautological assertions designed to bypass kernel mutation checks.

- **error**: `FGT-TAU-001`

### `TOP` — Layer Topology

Contract: Keep kernel module dependencies strictly unidirectional with zero back-edges.

- **error**: `FGT-TOP-001`

### `TRN` — Explicit Transactions

Contract: Mark transaction boundaries explicitly and roll back cleanly upon failure.

- **error**: `FGT-TRN-001`

### `VRF` — 5D Formal Kernel Verification

Contract: Staged snapshots must pass 5D invariant verification before trunk promotion.

- **error**: `FGT-VRF-001`

---
