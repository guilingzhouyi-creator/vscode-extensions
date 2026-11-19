---
name: telemetry-statistical-modeling
description: >-
  【触发：score/model/gaming/skew/Bayes/CAI/Beta/QED】Enforce zero-padded telemetry, Jeffreys Beta(0.5,0.5) posteriors, CAI 2.0, and BLOCK_GAMING_DETECTED circuit breaking.
---

# telemetry-statistical-modeling — Objective Telemetry, Bayesian Posteriors & Anti-Gaming

Enforces zero-base quality scoring, CAI 2.0, Jeffreys $\text{Beta}(0.5, 0.5)$ intervals, polyglot balance, trajectory yield, and `BLOCK_GAMING_DETECTED` circuit breaking.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：Auto-Refactor Engine（链上第 6 步）
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Detect score padding, gaming, or telemetry boundary failures → `telemetry-statistical-modeling` + `constraint-driven-development` + `auto-refactor-dev`
<!-- SKILL-LINKS:END -->

## 1. Zero-Base Telemetry & Mathematical Models

- **Zero-Base Counting**: Start counters at 0; ban $\times 1.2$ inflation, baseline padding, hardcoded `± 5%` bars, and regex blind scans over AST `symbolIndex` tracing; clamp probabilities to $[0.0, 1.0]$.

| Model | Equations & Bounds | Purpose |
|---|---|---|
| **Jeffreys $\text{Beta}(0.5, 0.5)$** ($n=s+f$) | $\mu=\frac{s+0.5}{n+1}$, $\sigma^2=\frac{(s+0.5)(f+0.5)}{(n+1)^2(n+2)}$, 95% CI ($z\approx 1.95996$): $[\max(0,\mu-z\sigma),\min(1,\mu+z\sigma)]$ | Posterior & CI |
| **Popoviciu** (`calculatePolyglotGeneralizationIndex`) | $S_i\in[0,100]$, $w_i=\ln(\text{LOC}_i+10)$, $\sigma_{\max}=50.0$ ($\gamma=0.5$): $D=\max(0,1-\frac{\sigma}{100})$, $S_{\text{balanced}}=\mu\times D$ | Cross-stack balance |
| **Hyperbolic & Geom Mean** | $S_i=100\cdot\frac{H}{H+\text{density}}$ ($H=30$); $S_{\text{composite}}=\exp\left(\frac{\sum w_i\ln(\max(15,S_i))}{\sum w_i}\right)$ | Axis & SQALE TDR A $\le 5\%$..E $>50\%$ ($30\text{ min/ELOC}$) |

---

## 2. Anti-Gaming, Trajectory Ledger & Elastic Debt

1. **`BLOCK_GAMING_DETECTED`**: Fires when $\text{Ratio}_{\text{semantic}}=\frac{\text{ELOC}_{\text{changed}}}{\text{ELOC}_{\text{total}}}\le 15\%$ and $\Delta_{\text{Debt}}\le 0$.
2. **Trajectory Ledger**: Keep 6 decimals on $\text{QED}=\Delta Q/\text{ELOC}$ (`Math.round(x*1e6)/1e6`) and $k\text{Mean}=\text{mQED}/1\text{k ELOC}$. Divide `netYield` by $\max(0.1,\text{semanticTotal}/1000)$ (fallback `uniqueTotal/1000`) and `densityYield` by $\max(1,\text{uniqueTotal}/1000)$ — never cumulative `processedTotal`. Diff `.refactor-trajectory/baseline-signatures.json` (`rule#file`) before AAS `files` fallback; churn via `git diff --numstat HEAD` excluding `reports/`, `.refactor-trajectory/`, `dist/`, `node_modules/`.
3. **Elastic Debt (`elastic-debt-budget.ts`)**: $\text{scaleFactor}=\max(1.0,\operatorname{round}_2(\sqrt{N_{\text{files}}/200}))$, $\text{combinedFactor}=\text{scaleFactor}\times\text{healthFactor}$, $\text{effectiveGrowthLimit}=\max(10,\lfloor\text{DEFAULT\_LIMIT}\times\text{combinedFactor}\rfloor)$; scales `baseCritical=2`, `baseHigh=5` (`PERMITTED_ELASTIC` vs `BLOCKED_EXCEEDED_BUDGET`).

---

## 3. Verification & Assets

```powershell
node auto-refactor/scripts/validate-autonomy-scorer.js && node auto-refactor/scripts/validate-project-neutrality.js
node auto-refactor/scripts/validate-trajectory-accumulator.js && node auto-refactor/scripts/validate-compact-ledger.js
```

- [jeffreys-beta-credible-interval.md](references/jeffreys-beta-credible-interval.md): Fisher derivation & `BLOCK_GAMING_DETECTED` vectors.
- [bayesian-confidence-evaluator.ts](templates/bayesian-confidence-evaluator.ts): Credible interval & anti-gaming template.
