---
name: rule-catalog-governance
description: >-
  【触发：新增规则/修改规则/SSOT/规则目录/规则登记/规则漂移/命名拓扑】增删改规则 ID、治理跨项目规则元数据或维护单源规则目录时触发。看守 3-3-3 命名拓扑与 RCFG-RULE-DRIFT 防虚构闭包。
---

# rule-catalog-governance — Single-Source Rule Catalog (SSOT) & Meta-Governance

Governs `scripts/common/rule-catalog.json` (SSOT), the 3-3-3 naming topology, the <!-- METRICS:BEGIN glossary-count -->**113 项**<!-- METRICS:END glossary-count --> canonical 3-letter glossary, the 3-tier alias network, diagnostic/presentation decoupling, cross-project namespace boundaries, and the `RCFG-RULE-DRIFT` anti-fabrication gate.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[skill-governance](../skill-governance/SKILL.md) → **本技能** → [docs-archive-governance](../docs-archive-governance/SKILL.md)；并行支援 `coding-craft`、`constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`。
- **领域**：技能与规则元治理（链上第 2 步）；另 3 个领域支援
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`
- **何时联动**：新增规则标识并闭合登记 → `rule-catalog-governance` + `skill-governance` + `gate-governance`；新增分析器或规则 → `auto-refactor-dev` + `sparse-moe-and-ast-routing` + `rule-catalog-governance` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Single-Source Rule Catalog (`scripts/common/rule-catalog.json`)

Aggregated by `scripts/common/generate-rule-catalog.js` across 5 controlled scopes totaling <!-- METRICS:BEGIN rule-total -->**534 条规则**<!-- METRICS:END rule-total -->:
1. **`auto-refactor`** (<!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor -->): <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> analyzers across <!-- METRICS:BEGIN rule-family-count -->**34 个规则族**<!-- METRICS:END rule-family-count --> (`ARCH`, `BIG`, `CMP`, `CMT`, `CONST`, `CPX`, `DAT`, `DEP`, `DOC`, `ENG`, `ERR`, `EXT`, `GDM`, `GOM`, `GOV`, `GUARD`, `HYG`, `MOD`, `NAM`, `NUM`, `PRF`, `PROD`, `PS`, `PYM`, `RSM`, `SEC`, `SH`, `SIM`, `STDLIB`, `TSM`, `TST`, `UI`, `VOL`, `VSC`) — <!-- METRICS:BEGIN rule-auto-refactor-canonical -->**360 条**<!-- METRICS:END rule-auto-refactor-canonical --> canonical + <!-- METRICS:BEGIN rule-auto-refactor-legacy -->**15 条**<!-- METRICS:END rule-auto-refactor-legacy --> legacy aliases (`ARCH-FAC-001`, `CPX-BUD-001`, `VOL-ELOC-001`, etc.).
2. **`workspace-timing`** (<!-- METRICS:BEGIN rule-workspace-timing -->**49 条规则**<!-- METRICS:END rule-workspace-timing -->): 11 families (`ARF`, `BLD`, `DOC`, `HC`, `LAY`, `LINT`, `RCFG`, `RES`, `SCR`, `TB`, `TST`) in `workspace-timing/scripts/config/review-rules.json`, each annotated with `layer` (`L0`–`L5`) and distinct English `ruleTitles`.
3. **`WebGames`** (<!-- METRICS:BEGIN rule-webgames -->**50 条规则**<!-- METRICS:END rule-webgames -->): `ADV-`, `ART-`, `GOV-`, `PRF-`, `RES-`, `UUID-`, `SIM-` in `scripts/common/rule-sources/webgames-rules.json` with per-rule `title`, `summary`, and boolean `enforced`.
4. **`fractal-git`** (<!-- METRICS:BEGIN rule-fractal-git -->**37 条规则**<!-- METRICS:END rule-fractal-git -->): `FGT-` kernel rules (`ALG`, `AUD`, `BRG`, `BYP`, `CAS`, `COR`, `DEP`, `ERR`, `FAC`, `GAT`, `IDX`, `LCK`, `MUT`, `OBJ`, `POL`, `PRF`, `PYR`, `QRN`, `SAF`, `STO`, `TAU`, `TOP`, `TRN`, `VRF`) in `scripts/common/rule-sources/fractal-git-rules.json`.
5. **`global-tooling`** (<!-- METRICS:BEGIN rule-global-tooling -->**23 条规则**<!-- METRICS:END rule-global-tooling -->): `CMG-STY-001`~`008`, `CMG-PRJ-001`, `RCFG-COUNTS-001`, `RCFG-RULE-DRIFT`, `GUARD-BASE-001`, `GUARD-CHAIN-001`, `GUARD-DOC-001`, `GUARD-ISO-001`, `GUARD-JAIL-001`, `GUARD-ORD-001`, `GUARD-SHELL-001`, `GUARD-STEP-001` in `scripts/common/rule-sources/global-rules.json` & `commit-msg-forbidden-terms.json`.

### Summary & Enforcement Metadata Contract
- **Objective English `summary`**: Every catalog `summary` must state what is checked and why in plain English (no Chinese, no `(source: ...)` wrappers, no `[documentation-defined]` prose tags).
- **Per-Rule Distinctness**: Every rule ID under a multi-rule checker must have its own distinct title/summary.
- **Structured `enforced` Flag**: Rules not yet wired to an active checker must set `enforced: false`.

---

## 2. 3-3-3 Naming Topology, Alias Network & Presentation Decoupling

1. **3-3-3 Grammar**: $\text{Family (2–5 chars)}-\text{Topic (3 chars)}-\text{Sequence (3 digits)}$ starting at `001` (only 5 locked historical rules start at `002`: `ARCH-DEC-002`, `ARCH-DSP-002`, `GOV-RTC-002`, `NAM-JRG-002`, `SIM-FLAT-002`).
2. **Canonical 3-Letter Glossary**: `auto-refactor/src/core/rules/topic-catalog.ts` maps <!-- METRICS:BEGIN glossary-count -->**113 项**<!-- METRICS:END glossary-count --> across <!-- METRICS:BEGIN topic-count -->**33 个**<!-- METRICS:END topic-count --> canonical topic families via `normalizeTopicCode` and `toCanonicalRuleId`.
3. **3-Tier Alias Network (`aliases.ts`)**: Tier 1 exact match $\to$ Tier 2 `LEGACY_RULE_ALIASES` (maps legacy kebab-case names to canonical IDs) $\to$ Tier 3 `toCanonicalRuleId` (`DISP` $\leftrightarrow$ `DSP`).
4. **Two-Layer Diagnostic Decoupling**: Stage 0–3 analyzers emit 100% of raw AST issues; presentation adapters (`semantic-correlation.ts`) deduplicate <!-- METRICS:BEGIN overlap-cluster-count -->**11 个**<!-- METRICS:END overlap-cluster-count --> overlap clusters via union-find (`block > warn > info > pass`).

---

## 3. Anti-Fabrication (`RCFG-RULE-DRIFT`) & Doc Metrics (`GUARD-DOC-001`)

1. **Bidirectional Rule Closure**: `validate-rule-id-closure.js` and `validate-commit-msg.js` reject any unregistered rule ID across code, scripts, skills, and commit messages (exempting standard tokens like `UTF-8`, `SHA-256`, `RFC-7231`, `IEEE-754`).
2. **10D Scoring Closure**: `validate-scoring-rule-closure.js` verifies 100% of catalog rules map to one of the 10 scoring dimensions in `dimensionRuleTable.ts` ($\text{AxesPerFinding} \le 4$).
3. **Single-Source Scale Metrics (`GUARD-DOC-001`)**: All scale figures in docs are declared in `scripts/common/doc-metrics.json`, rendered into `<!-- METRICS:BEGIN <id> -->...<!-- METRICS:END <id> -->` via `sync-doc-metrics.js --write`, and audited by `validate-docs-consistency.js` (historical paragraphs require `<!-- METRICS:IGNORE-HISTORICAL commit=<hash> -->`; planned targets require `<!-- METRICS:IGNORE-PLAN reason=<why> -->`).

---

## 4. Verification & References

```powershell
node scripts/common/generate-rule-catalog.js --write
node scripts/common/generate-rule-catalog.js --check-only
node scripts/common/validate-rule-id-closure.js
node scripts/common/validate-scoring-rule-closure.js
node scripts/common/sync-doc-metrics.js --write
```

- [rule-family-taxonomy.md](references/rule-family-taxonomy.md): Family prefix matrix and `[FAMILY]-[TOPIC]-[NNN]` taxonomy (note: aggregate by catalog `family` field, not string splitting).
- [rule-declaration-boilerplate.json](templates/rule-declaration-boilerplate.json): Standard rule metadata declaration template.
