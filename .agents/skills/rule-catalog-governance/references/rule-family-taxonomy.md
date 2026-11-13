# Rule Family Taxonomy & Naming Specification

Workspace rules follow semantic prefix encoding `[FAMILY]-[TOPIC]-[NNN]`.

---

## 1. Core Rule Family Prefix Matrix

Grouped identically to [rule-family-map.md](../../coding-craft/references/rule-family-map.md), covering <!-- METRICS:BEGIN rule-family-count-all -->**70 个规则族**<!-- METRICS:END rule-family-count-all -->. Family names match the topic prefix segment (or second segment under project namespaces like `FGT-ALG-001`; legacy single-segment IDs declare their family explicitly in SSOT). Family names are globally unique and reusable across projects.

### Naming, Comments & Docs (5 Families)

| Family | Domain Responsibility | Scope & Scale | Representative Rule |
| :--- | :--- | :--- | :--- |
| **`NAM`** | Identifier-as-contract | Self-explanatory names for files, types, members, collections; no vague shells (`data`/`res`/`tmp`) or bloated stacks. 19 IDs, auto-refactor only | `NAM-ABR-001` |
| **`CMT`** | Comments state why, not what | 6-field file headers, export docs, contract parity, zero mixed languages, width <= 100 cols; mechanical restatements penalize density. 16 IDs, auto-refactor only | `CMT-BAN-001` |
| **`DOC`** | Doc structure & reachability | Closed code fences, live relative links, zero hype/sprint prose, zero cross-doc duplicate paragraphs. 17 IDs, across 2 projects (`workspace-timing`, `auto-refactor`), layer L3 | `DOC-CL-001` |
| **`ART`** | WebGames art orders & specs | Two-way alignment of sprites, icons, VFX orders, dimensions, and manifests; no unregistered assets. 21 IDs, WebGames only | `ART-AUD-005` |
| **`RES`** | Resource & shutdown contracts | Enumerable structured resource pools; idempotent handle cleanup on host shutdown. 7 IDs, across 2 projects (`workspace-timing`, `WebGames`), layer L3 | `L3-RESOURCE-TOPO` |

### Errors, Types & Interfaces (9 Families)

| Family | Domain Responsibility | Scope & Scale | Representative Rule |
| :--- | :--- | :--- | :--- |
| **`ERR`** | Explicit failure semantics | Fallible operations return discriminated results or typed errors; never swallow exceptions or return null for errors. 4 IDs, across 2 projects (`auto-refactor`, `fractal-git`) | `FGT-ERR-001` |
| **`TSM`** | TypeScript idioms | No `any`, `var`, legacy `require`/`substr`/`includes` traps; explicit constructor and spread semantics. 11 IDs, auto-refactor only | `TSM-ANY-001` |
| **`PYM`** | Python idioms | `collections.abc`, `with` guards, `X | None`, built-in generics, `raise ... from`, `slots=True`, no mutable defaults. 13 IDs, auto-refactor only | `PYM-ABC-001` |
| **`RSM`** | Rust idioms | Zero bare `panic`, `unsafe` with `// SAFETY:`, `let-else`, `&str` over `&String`, no locks held across `.await`. 14 IDs, auto-refactor only | `RSM-PNC-001` |
| **`GOM`** | Go idioms | Leading `context.Context`, `%w` error wrapping, doc comments on exports, zero library `panic`. 5 IDs, auto-refactor only | `GOM-CTX-001` |
| **`NUM`** | Numeric bounds & precision | Dual-bounded recursion/loops; no silent precision loss during scaling or rounding. 2 IDs, auto-refactor only | `NUM-BND-001` |
| **`SIM`** | Simplification & clarity | Group >= 4 params into option objects; no boolean flags, empty shells, or deep nesting; prefer guard clauses. 17 IDs, across 2 projects (`auto-refactor`, `WebGames`) | `SIM-CMP-001` |
| **`ARCH`** | Architecture & facade substance | Unidirectional layers, substantive facades (`ELOC >= 15` or frozen), dissolve `<= 3`-line forwarding trampolines. 30 IDs, auto-refactor only | `ARCH-DIR-003` |
| **`MOD`** | Module boundaries | No backward dependencies, flat cross-layer imports, or bloated public exports. 3 IDs, auto-refactor only | `MOD-BWD-001` |

### Dependencies, Constants & Volume (9 Families)

| Family | Domain Responsibility | Scope & Scale | Representative Rule |
| :--- | :--- | :--- | :--- |
| **`DEP`** | Dependencies & supply chain | Infra never imports domain; block cycles, `devDependency` leaks, phantom/unpinned/copyleft packages. 17 IDs, across 2 projects (`auto-refactor`, `fractal-git`) | `DEP-INV-001` |
| **`CONST`** | Single-source constants | Extract repeated literals, zero cross-file semantic drift, fixed declaration zone, no kitchen-sink bags. 12 IDs, auto-refactor only | `CONST-CLU-001` |
| **`VOL`** | Dual-track volume budgets | Dual ELOC/LOC ceilings, 1:3 dynamic envelope, never delete comments to dodge line caps. 8 IDs, auto-refactor only | `VOL-DOC-001` |
| **`BIG`** | Oversized files | Split oversized files cleanly by domain cohesion rather than mechanical chopping. 1 IDs, auto-refactor only | `large-file` |
| **`CMP`** | Expression & statement density | No deep inline callback chains, bit-twiddling/ternary stacks, or multi-statement lines. 4 IDs, auto-refactor only | `CMP-CAL-001` |
| **`CPX`** | Complexity & space budgets | `CC <= 15`, `Depth <= 4`, zero transient heap allocs in loops, bounded recursion. 13 IDs, auto-refactor only | `CPX-REC-001` |
| **`PRF`** | Hot paths & memory | Hoist regex constants, block loop I/O, bound caches, align algorithmic complexity to data size. 15 IDs, across 3 projects (`auto-refactor`, `fractal-git`, `WebGames`) | `expensive-loop-operation` |
| **`LAY`** | Layer topology (layer: L2) | Unidirectional layers, zero cycles, resolvable imports. 4 IDs, workspace-timing only, layer L2 | `L2-LAYERS` |
| **`HC`** | Hardcode audit (layer: L3) | Block absolute paths, CJK literals in code, magic numbers, secrets; enforce UI dictionary keys. 6 IDs, workspace-timing only, layer L3 | `HC-ABS-PATH` |

### Testing, UI & Platforms (17 Families)

| Family | Domain Responsibility | Scope & Scale | Representative Rule |
| :--- | :--- | :--- | :--- |
| **`TST`** | Test engineering | Deterministic clock/RNG, zero skipped/orphan specs, duration ratchets, source-isomorphic topology. 9 IDs, across 2 projects (`workspace-timing`, `auto-refactor`), layer L0 | `L0-TEST` |
| **`UI`** | UI engineering & motion | Semantic lightness ladder, single closed border, damped spring motion, power-law masks. 8 IDs, auto-refactor only | `UI-ENG-001` |
| **`VSC`** | VS Code extension contracts | 100% bilingual dictionaries, RingBuffer + Journal crash safety, bounded statusbar refresh, memory budgets. 8 IDs, auto-refactor only | `VSC-MEM-001` |
| **`PROD`** | Production bundle hygiene | Zero `console`/TODO artifacts, sourcemaps, or server env leaks in client builds. 3 IDs, auto-refactor only | `PROD-HYG-001` |
| **`SEC`** | Security & exposure surface | Keep internal endpoints out of client bundles, visual hiding is not auth, zero hardcoded keys. 14 IDs, auto-refactor only | `SEC-EXP-001` |
| **`DAT`** | Data access | Block N+1 queries, unbounded table scans, and persistence driver leakage into core. 6 IDs, auto-refactor only | `DAT-NPL-001` |
| **`STDLIB`** | Standard library discipline | No panicking stdlib calls, bounded allocations, portable abstractions, bounded recursion. 6 IDs, auto-refactor only | `STDLIB-ALLOC-001` |
| **`SH`** | Bash idioms | `set -euo pipefail`, double-quoted expansions/subshells, flat error capture, guarded reads. 15 IDs, auto-refactor only | `SH-EOL-001` |
| **`PS`** | PowerShell idioms | Verb-Noun naming, `[CmdletBinding()]`, no `iex` eval, `try/finally` handle cleanup. 9 IDs, auto-refactor only | `PS-SAFE-001` |
| **`GDM`** | GDScript engine contracts | Valid node paths & `@onready` ordering, paired signal connect/disconnect, zero-alloc pools, single-source i18n. 25 IDs, auto-refactor only | `GDM-ISO-001` |
| **`ADV`** | High-perf script constraints | Zero loop heap allocs, contiguous buffers, `reset_state()` pools, seedable RNG, bounded dispatch. 21 IDs, WebGames only | `ADV-BND-001` |
| **`UUID`** | Reentrancy & idempotency | Reentrant paths must remain idempotent without duplicate side effects. 1 IDs, WebGames only | `UUID-REENTRANT-001` |
| **`ENG`** | Analyzer self-fault isolation | Single-file analyzer faults degrade to diagnostics instead of aborting scans. 1 IDs, auto-refactor only | `analyzer-error` |
| **`EXT`** | External directory bounds | Confine scans and writes to allowlisted directories; reject boundary escapes. 1 IDs, auto-refactor only | `EXT-DIR-001` |
| **`BLD`** | Build baseline (layer: L0) | Code must compile cleanly without skipping build verification. 1 IDs, workspace-timing only, layer L0 | `L0-COMPILE` |
| **`LINT`** | Static lint baseline (layer: L1) | Zero lint/format warnings; never mask violations via ignore directives. 2 IDs, workspace-timing only, layer L1 | `L1-*` |
| **`TB`** | Test budget ratchet (layer: L4) | Enforce suite time budgets, require baseline presence, fail on regression. 3 IDs, workspace-timing only, layer L4 | `L4-TEST-BUDGET` |

### Governance & Gates (7 Families)

| Family | Domain Responsibility | Scope & Scale | Representative Rule |
| :--- | :--- | :--- | :--- |
| **`GOV`** | Runtime governance contracts | Never swallow exceptions, sanitize logs, single-source types, enforce anti-gaming circuit breakers. 36 IDs, across 2 projects (`auto-refactor`, `WebGames`) | `GOV-AGN-001` |
| **`GUARD`** | Gates & safety guards | AST slice budgets, registered step IDs, closed feedback status words, shell parity, sandbox jail, SSOT sync. 27 IDs, across 2 projects (`auto-refactor`, `global-tooling`) | `GUARD-AST-001` |
| **`HYG`** | Physical hygiene | Non-empty files, `.ps1` CRLF / others LF, UTF-8 no BOM, single EOF newline, spaces only, `kebab-case`. 19 IDs, auto-refactor only | `HYG-BOM-001` |
| **`CMG`** | Commit message spec | Mandatory `[Project]`, minimum substance, zero hype/exaggeration/pejorative/meta dumps. 9 IDs, global-tooling only | `CMG-PRJ-001` |
| **`RCFG`** | Rule meta-governance | Bidirectional rule ID closure, metric-to-SSOT parity, deduplicated diagnostic presentation. 7 IDs, across 2 projects (`workspace-timing`, `global-tooling`), layer L3 | `L3-REVIEW-CONFIG` |
| **`SCR`** | Script catalog standard (layer: L3) | Bidirectional script naming, header contracts, and registry completeness. 5 IDs, workspace-timing only, layer L3 | `L3-SCRIPT-STANDARD` |
| **`ARF`** | Refactor gate (layer: L5) | Require net quality gain and equivalence proof; reject superficial code motion. 2 IDs, workspace-timing only, layer L5 | `ARF-*` |

### `fractal-git` Native Kernel (23 Families)

| Family | Domain Responsibility | Scope & Scale | Representative Rule |
| :--- | :--- | :--- | :--- |
| **`ALG`** | Algorithm equivalence | Native operators must be differentially equivalent to Git/reference baselines. 1 IDs, fractal-git only | `FGT-ALG-001` |
| **`AUD`** | Cryptographic audit telemetry | Audit records must carry HMAC signatures and unbroken predecessor hash chains. 1 IDs, fractal-git only | `FGT-AUD-001` |
| **`BRG`** | Bridge / FFI boundaries | FFI/N-API boundaries must declare explicit ownership and lifetimes. 1 IDs, fractal-git only | `FGT-BRG-001` |
| **`BYP`** | Test bypass & cache cleanup | Fast-path test workspaces reclaim atomically and never pollute Git ODB with unverified objects. 1 IDs, fractal-git only | `FGT-BYP-001` |
| **`CAS`** | Lock-free CAS | Compare-and-swap loops must handle ABA hazards and explicit memory ordering. 1 IDs, fractal-git only | `FGT-CAS-001` |
| **`COR`** | Core invariants | Pre/post-conditions on core data structures must be assertable. 1 IDs, fractal-git only | `FGT-COR-001` |
| **`FAC`** | Facade substance | Crate facades must carry substantive re-exports/types rather than empty pass-throughs. 1 IDs, fractal-git only | `FGT-FAC-001` |
| **`GAT`** | Kernel self-audit & diff bounds | Kernel gates prove defect detection and enforce batch/file ELOC bounds, TSPR density, and streak escalation. 6 IDs, across 2 projects (`fractal-git`, `global-tooling`) | `FGT-GAT-001` |
| **`IDX`** | Index bounds safety | Index lookups must be bounds-checked or formally proven safe. 1 IDs, fractal-git only | `FGT-IDX-001` |
| **`IMPACT`** | Impact slice mapping guard | Pre-test slicing may narrow only registered crate paths; unknown paths fall back to full test suites. 1 IDs, fractal-git only | `FGT-IMPACT-001` |
| **`LCK`** | Lock discipline | Never hold locks across `.await`; minimize critical-section granularity. 1 IDs, fractal-git only | `FGT-LCK-001` |
| **`MSG`** | Kernel commit-msg guard | Enforce header, sections, density floor, forbidden terms, placeholder detection, project scope, anchor/rule closure. 12 IDs, fractal-git only | `FGT-MSG-001` |
| **`MUT`** | Micro-mutation kill-rate guard | Kernel mutation testing kill rate must stay above the gate floor. 1 IDs, fractal-git only | `FGT-MUT-001` |
| **`OBJ`** | Object lifecycle | Pool borrow/return pairs must remain symmetric and idempotent. 1 IDs, fractal-git only | `FGT-OBJ-001` |
| **`POL`** | Policy injection | Policies must be injectable/pluggable without hardcoded domain branches. 1 IDs, fractal-git only | `FGT-POL-001` |
| **`PYR`** | 4-tier temporal pyramid fold | Historical telemetry folding preserves exact unidirectional aggregation and memory budgets. 1 IDs, fractal-git only | `FGT-PYR-001` |
| **`QRN`** | Physical quarantine isolation | Snapshots triggering critical violations are routed to `refs/fractal/quarantine/*` and blocked from promotion. 1 IDs, fractal-git only | `FGT-QRN-001` |
| **`SAF`** | `unsafe` minimization | Every `unsafe` block requires strict 3-part `// SAFETY:` proof and minimal scope. 1 IDs, fractal-git only | `FGT-SAF-001` |
| **`STO`** | Storage atomicity | Persistent writes (ODB/ARC/WAL/blackboard) must be atomic and crash-recoverable. 1 IDs, fractal-git only | `FGT-STO-001` |
| **`TAU`** | Anti-tautology test guard | Block empty or tautological assertions meant to dodge mutation checks. 1 IDs, fractal-git only | `FGT-TAU-001` |
| **`TOP`** | Layer topology | Module topology stays strictly acyclic and unidirectional. 1 IDs, fractal-git only | `FGT-TOP-001` |
| **`TRN`** | Explicit transactions | Transaction boundaries must be explicit and roll back cleanly on error. 1 IDs, fractal-git only | `FGT-TRN-001` |
| **`VRF`** | 5D formal kernel verification | Staged snapshots pass 5D invariant verification before main promotion. 1 IDs, fractal-git only | `FGT-VRF-001` |

---

## 2. Rule Naming & Metadata Contracts

1. **Canonical Pattern (`RULE_ID_PATTERN`)**: `[FAMILY]-[TOPIC]-[NNN]` validated by `auto-refactor/src/core/rules/types.ts` (`^[A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{2,10}){1,3}-\d{3}$`). Two-segment (`L0-COMPILE`, `HC-ABS-PATH`) and legacy slug IDs (`high-complexity`) must carry `canonical: false` and a concrete `legacyReason` in SSOT; renames require an alias transition window.
2. **Global Uniqueness**: Every rule ID is globally unique across `scripts/common/rule-catalog.json`.
3. **Summary Field**: SSOT projects concise imperative descriptions in `summary` (distinct from internal analyzer `RuleDefinition.title`).
4. **Closed Severity Set**: Allowed values are strictly `error` (blocking non-zero exit), `warning` (advisory report), and `info` (metric/hint only). `warn` is invalid.
5. **Dimension Scope**: `dimension` belongs exclusively to `auto-refactor` `RuleDefinition`s (`MAX_AXES_PER_FINDING <= 4`); never fabricate dimensions for other projects.
6. **Measurement Truth**: Deductions map strictly to declared `dimension`s with zero multiplier inflation or baseline padding.
