---
name: telemetry-statistical-modeling
description: >-
  【触发：评分/度量/跑分/统计模型/贝叶斯/CAI/注水/反刷分】开发评分器、重构度量算法或反刷分时触发。落实从 0 纯客观统计、Jeffreys Beta(0.5,0.5) 共轭后验估计与 BLOCK_GAMING_DETECTED 虚假重构熔断。
---

# telemetry-statistical-modeling — Objective Telemetry, Bayesian Posteriors & Anti-Gaming

Establishes the mathematical foundation for workspace quality scoring, Code Autonomy Index (CAI 2.0), Jeffreys $\text{Beta}(0.5, 0.5)$ credible intervals, polyglot balance, trajectory yield accounting, and `BLOCK_GAMING_DETECTED` circuit breaking.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：自动重构内核（链上第 6 步）
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：评分口径被注水或刷分 → `telemetry-statistical-modeling` + `constraint-driven-development` + `auto-refactor-dev`
<!-- SKILL-LINKS:END -->

## 1. Zero-Inflation Telemetry & Mathematical Models

1. **Zero-Base Objective Counting**: Start all counters at 0; forbid multiplier inflation ($\times 1.2$), baseline padding, hardcoded error bars (`± 5%`), or regex blind scans in place of AST `symbolIndex` tracing. Clamp probability measures to $[0.0, 1.0]$.
2. **Jeffreys $\text{Beta}(0.5, 0.5)$ Conjugate Posterior** ($s$ successes, $f$ failures, $n = s + f$):
   $$\theta \mid s, f \sim \text{Beta}(s + 0.5, f + 0.5), \quad \mu = \frac{s + 0.5}{n + 1}, \quad \sigma^2 = \frac{(s + 0.5)(f + 0.5)}{(n + 1)^2 (n + 2)}$$
   95% credible interval ($z \approx 1.95996$): $[\max(0.0, \mu - z\sigma),\; \min(1.0, \mu + z\sigma)]$.
3. **Popoviciu Polyglot Balance (`calculatePolyglotGeneralizationIndex`)**:
   With stack scores $S_i \in [0, 100]$, log weights $w_i = \ln(\text{LOC}_i + 10)$, weighted mean $\mu$, weighted std $\sigma$, and Popoviciu bound $\sigma_{\max} = 50.0$ ($\gamma = 0.5$):
   $$D = \max\left(0.0,\; 1.0 - \frac{\sigma}{100}\right), \quad S_{\text{balanced}} = \mu \times D$$
4. **Hyperbolic Saturation & Weighted Geometric Mean**:
   - Per-axis score: $S_i = 100 \times \frac{H}{H + \text{density}}$ ($H = 30$), strictly convex and monotonically decreasing without premature zero clipping.
   - Composite score: $S_{\text{composite}} = \exp\left(\frac{\sum w_i \ln(\max(15, S_i))}{\sum w_i}\right)$ (penalizes single-axis bottlenecks; SQALE TDR grades A $\le 5\%$ to E $> 50\%$ at $30\text{ min/ELOC}$).

---

## 2. Anti-Gaming (`BLOCK_GAMING_DETECTED`), Trajectory Ledger & Elastic Debt

1. **Anti-Gaming Circuit Breaker (`BLOCK_GAMING_DETECTED`)**: Fires when both $\text{Ratio}_{\text{semantic}} = \frac{\text{ELOC}_{\text{changed}}}{\text{ELOC}_{\text{total}}} \le 15\%$ and net debt reduction $\Delta_{\text{Debt}} \le 0$.
2. **Trajectory Ledger Precision**:
   - Retain 6 decimals on $\text{QED} = \Delta Q / \text{ELOC}$ (`Math.round(x * 1e6) / 1e6`) and project $k\text{Mean} = \text{mQED} / 1\text{k ELOC}$.
   - Compute `netYield` over $\max(0.1, \text{semanticTotal}/1000)$ (fallback $\text{uniqueTotal}/1000$) and `densityYield` over $\max(1, \text{uniqueTotal}/1000)$ — never divide by cumulative multi-run `processedTotal`.
   - Diff defect signatures against `.refactor-trajectory/baseline-signatures.json` (`rule#file`) before falling back to truncated AAS `files` payloads; derive line churn from `git diff --numstat HEAD` excluding `reports/`, `.refactor-trajectory/`, `dist/`, and `node_modules/`.
3. **Elastic Debt Budget (`elastic-debt-budget.ts`)**:
   $$\text{scaleFactor} = \max\left(1.0, \operatorname{round}_2\left(\sqrt{N_{\text{files}} / 200}\right)\right), \quad \text{combinedFactor} = \text{scaleFactor} \times \text{healthFactor}$$
   $$\text{effectiveGrowthLimit} = \max\left(10, \lfloor \text{DEFAULT\_LIMIT} \times \text{combinedFactor} \rfloor\right)$$
   Scales `baseCritical = 2` and `baseHigh = 5` by $\text{combinedFactor}$ (`PERMITTED_ELASTIC` vs `BLOCKED_EXCEEDED_BUDGET`).

---

## 3. Verification & JIT Assets

```powershell
node auto-refactor/scripts/validate-autonomy-scorer.js && node auto-refactor/scripts/validate-project-neutrality.js
node auto-refactor/scripts/validate-trajectory-accumulator.js && node auto-refactor/scripts/validate-compact-ledger.js
```

- [jeffreys-beta-credible-interval.md](references/jeffreys-beta-credible-interval.md): Fisher information derivation of Jeffreys prior and `BLOCK_GAMING_DETECTED` attack vector analysis.
- [bayesian-confidence-evaluator.ts](templates/bayesian-confidence-evaluator.ts): Bayesian credible interval and anti-gaming evaluator template.
