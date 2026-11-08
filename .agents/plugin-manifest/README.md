# Workspace Governance & Engineering Suite (`workspace-governance`)

Unified workspace governance, multi-agent orchestration, and engineering plugin bundle consolidating <!-- METRICS:BEGIN skill-count -->**27 项**<!-- METRICS:END skill-count --> engineering skills, `AGENTS.md` rules, <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count --> SubAgent preset templates, the 4-posture DSH preset family, and isolated MCP server bindings.

> **Asset Ownership Boundary**: `.agents/plugins/workspace-governance/` is a **workspace documentation & prompt asset bundle**, not a DSH runtime plugin. DSH loads only npm packages declared in `dsh.profile.bundles` (`$DSH_HOME/.agent-presets/<preset-id>/`), sourced from [`../../dsh/bundle/`](../../dsh/bundle/).

---

## 1. Bundle Layout

```
.agents/plugins/workspace-governance/
├── plugin.json                 # Bundle metadata & activation manifest
├── README.md                   # Bundle architecture & lifecycle guide
├── mcp_config.json             # Namespace-isolated MCP server config (context7, github)
├── assets/logo.svg             # Vector badge (128x128)
├── rules/AGENTS.md             # Workspace governance pointer hub (byte-mirrored from root AGENTS.md)
├── agents/*.md                 # 27 orthogonal (Archetype × Posture) SubAgent presets
└── skills/*/SKILL.md           # 27 engineering skills (byte-mirrored from .agents/skills/)
```

> Both `.agents/skills/` and `.agents/plugins/workspace-governance/skills/` hold <!-- METRICS:BEGIN skill-count -->**27 项**<!-- METRICS:END skill-count --> `SKILL.md` directories, verified for 100% byte parity by `validate-skills.js`.

---

## 2. Core Components

1. **Governance Axiom Index (`AGENTS.md`)**:
   - Task routing matrix, 8D physical hygiene, AST complexity & density budgets ($\text{CC}\le 15$, $\text{Depth}\le 4$, $\text{ELOC}\le 900$, $\text{LOC}\le 1400$), AAS v1.0 reporting, and non-negotiable axioms.
2. **Engineering Skills (`skills/`)**: <!-- METRICS:BEGIN skill-count -->**27 项**<!-- METRICS:END skill-count --> domain and cross-cutting skills (`auto-refactor-dev`, `sparse-moe-and-ast-routing`, `praxis-vfs-and-trajectory-learning`, `fractal-git-dev`, `webgames-workflow`, `workspace-timing-dev`, `subagent-orchestration`, `gate-governance`, `rule-catalog-governance`, `skill-governance`, `docs-archive-governance`, `complexity-budget`, `coding-craft`, `facade-discipline`, `batch-commit`, `test-benchmark-engineering`, `debugging-and-error-recovery`, `defensive-security-and-taint-safety`, `state-concurrency-and-crash-recovery`, `tiered-cache-and-wal-persistence`, `telemetry-statistical-modeling`, `algorithmic-operator-engineering`, `rust-engineering`, `interaction-design-physics`, `release-package-workflow`, `spec-driven-development`, `constraint-driven-development`).
3. **SubAgent Presets (`agents/`)**: <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count --> presets across `workspace`, `infra`, `wt`, `ar`, `wg`, `fg`, and `skill` archetypes (`construct`, `refactor`, `review`, `explore`, `guardian`).
4. **MCP Services (`mcp_config.json`)**: `context7` (documentation retrieval) and `github` (repository collaboration).

---

## 3. DSH Governance Preset Family

Sinks `AGENTS.md` Path Jail and tool-surface constraints from the prompt layer into the DSH runtime layer ([`../../dsh/bundle/`](../../dsh/bundle/) & [`.agents/dsh/README.md`](../../dsh/README.md)):

| Preset ID | UI Label | Order | Posture | Terminal | Path Jail Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `wg-construct` | 治理·施工 | 10 | `construct` | Enabled | `mode: write` on `workspace-timing`, `auto-refactor`, `WebGames`, `.agents` |
| `wg-refactor` | 治理·重构 | 11 | `refactor` | Stripped | `mode: write` on controlled projects |
| `wg-review` | 治理·审查 | 12 | `review` | Stripped | `mode: read` (all write tools rejected) |
| `wg-explore` | 治理·探索 | 13 | `explore` | Stripped | `mode: read`; delegation & plan modes stripped |

- **SSOT**: [`../../dsh/bundle/`](../../dsh/bundle/) (`package.json`, `cordis.patch.yml`, `guard-plugin.js`, `jail-policy.json`) + [sync-presets.js](../../dsh/sync-presets.js).
- **Dynamic Identity Resolution**: `guard-plugin.js` resolves caller posture per invocation via `agentPresets.composedPreset(agent.ctx)` $\to$ `POLICY_TABLE`, preventing cross-session scope contamination.

---

## 4. Verification Commands

```powershell
pwsh -File scripts/ps1/audit-all.ps1 -Fast
node scripts/common/sync-agents-mirror.js --check
node scripts/common/validate-skills.js
node .agents/dsh/sync-presets.js --check-only
```
