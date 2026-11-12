# System Specifications & Mathematical Axioms (`docs/system-spec/README.md`)

> Authoritative index for workspace-wide mathematical models, static scoring theory, cross-platform script governance, and subsystem architectural contracts. Parent hub: [docs/README.md](../README.md).

---

## 1. Specification Matrix

| Document | Core Subject | Architectural Scope | Authoritative Source |
| :--- | :--- | :--- | :--- |
| [**`quality-scoring-model.md`**](./quality-scoring-model.md) | **10D Quality Scoring Model** | 10 orthogonal dimensions, hyperbolic density decay, weighted geometric mean, Jeffreys Beta(0.5, 0.5) posterior, tech-debt penetration, and anti-gaming axioms | `auto-refactor/src/core/scoring/` |
| [**`script-governance-architecture.md`**](./script-governance-architecture.md) | **Workspace Script Governance** | Language × domain matrix, PowerShell / Bash / Node.js contracts, isomorphic dual implementations, Tier 1 in-memory streaming gates (`< 250ms`), and 8 KB short-circuiting | `scripts/`, [scripts/README.md](../../scripts/README.md) |
| [**`rule-catalog-architecture.md`**](./rule-catalog-architecture.md) | **SSOT Rule Catalog & Meta-Governance** | SSOT axiom, 3-3-3 naming topology, canonical 3-letter glossary, 3-tier alias network, <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total --> closure, and diagnostic/presentation decoupling | `scripts/common/rule-catalog.json` |
| [**`token-frugal-sentence-and-diagnostic-spec.md`**](./token-frugal-sentence-and-diagnostic-spec.md) | **Token-Frugal Diagnostic Spec** | 5-principle compression protocol (`P1`–`P5`), approved CS abbreviation boundaries (`NAM-ABR-001`), `DIAGNOSTIC_CATALOG` schema, and $\ge 70\%$ token reduction | `auto-refactor/src/core/reporting/` |
| [**`workspace-timing-architecture.md`**](./workspace-timing-architecture.md) | **VS Code Extension 5-Layer Architecture** | UI / Application / Domain / Infrastructure / Utils unidirectional layering, RingBuffer + WAL Journal + JSON crash recovery, and interaction physics | `workspace-timing/` |
| [**`webgames-architecture-spec.md`**](./webgames-architecture-spec.md) | **WebGames Config-Driven Decoupling Spec** | Godot 4 headless logic separation, `GameConfig` SSOT, `apply_snapshot` unidirectional view injection, object-pool zero loop allocation, and 4-stage workflow | `WebGames/` |
| [**`jit-context-and-moe-routing-spec.md`**](./jit-context-and-moe-routing-spec.md) | **JIT Context & 5-Tier Sparse MoE Routing Spec** | Dual-plane on-demand loading (4-tier prompt JIT + 5-tier Sparse MoE bitmask dispatch, lazy multi-language IR projection, LayerVFS sandbox, and L1/L2/L3 WAL cache) | `auto-refactor/src/core/pipeline/`, `.agents/skills/` |
| [**`gate-audit-checklist.md`**](./gate-audit-checklist.md) | **Quarterly Gate Audit Checklist** | Pre-commit, pre-push, and `audit-all` structural/behavioral checks, bypass probes, and audit record template | `scripts/common/gate-step-registry.json` |
| [**`agent-native-system-blueprint.md`**](../agent-native-system-blueprint.md) | **Agent-Native Autonomous Blueprint** | Peer Cell topology, 3-layer topological Diff, R1–R5 memory distillation pipeline, and fractal Git gate network | `AGENTS.md` |
| [**`fractal-git/docs/README.md`**](../../fractal-git/docs/README.md) | **Taxis (`fractal-git`) Kernel Dossier** | 10-crate kernel, poset-homomorphic CCD v2, Kirsch-Mitzenmacher Bloom filter, SWAR diff, TIPSE storage, and E2E benchmark harness | `fractal-git/`, `fractal-git/docs/` |

---

## 2. Core Engineering Axioms

1. **Zero-Inflation Telemetry**: All static analysis and quality metrics start from 0 without baseline padding, multiplier inflation, or fixed bonuses.
2. **Bottleneck Sensitivity**: Composite health uses a Weighted Geometric Mean (`Floor = 15.0`) so any single-axis collapse logarithmically penalizes the composite score.
3. **Cross-Platform Isomorphism**: Core gate and packaging scripts provide 1:1 PowerShell (`ps1/`) and Bash (`sh/`) implementations with identical flags, exit codes, and status tokens.
4. **Tiered Shift-Left Gates**: Tier 1 local in-memory streaming gates (`< 250ms`) mirror Tier 1.5 remote Linux slice gates and Tier 2 CI gates.
5. **SSOT Rule Closure**: Every rule ID is registered in `scripts/common/rule-catalog.json`; unregistered rule IDs trigger `RCFG-RULE-DRIFT`.
