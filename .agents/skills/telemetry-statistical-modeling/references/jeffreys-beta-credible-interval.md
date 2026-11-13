# Jeffreys Beta Posterior & Anti-Gaming Circuit Breaker (`BLOCK_GAMING_DETECTED`)

Mathematical specification for objective Bayesian confidence bounds, Popoviciu balance bounds, and anti-gaming enforcement.

---

## 1. Non-Informative Jeffreys Prior $\text{Beta}(0.5, 0.5)$

For binomial trials ($s$ successes, $f$ failures, $n = s + f$), Fisher information $I(\theta) = \frac{n}{\theta(1-\theta)}$ yields the reparameterization-invariant conjugate prior $p(\theta) \propto \theta^{-1/2}(1-\theta)^{-1/2} = \text{Beta}(0.5, 0.5)$:

$$\mu = \frac{s + 0.5}{n + 1}, \quad \sigma = \sqrt{\frac{(s + 0.5)(f + 0.5)}{(n + 1)^2(n + 2)}}, \quad \text{CI}_{95\%} = [\max(0, \mu - 1.95996\sigma),\; \min(1, \mu + 1.95996\sigma)]$$

Calibration outcomes feed `baselines/confidence-calibration.json` via `scripts/harvest-calibration-outcomes.js`. Small samples ($n < 5$) widen $\sigma$ honestly—never hardcode fixed `± 5%` error bars or inflate weights, and always route deductions through `effectiveApply(...)`.

---

## 2. Anti-Gaming Vectors & `BLOCK_GAMING_DETECTED`

Blocks three gaming patterns: whitespace/parameter churn, trivial local renames claimed as structural refactors, and comment stripping to fake lower LOC (`CMT-VMD-001`):

```typescript
if (semanticRatio <= 0.15 && netDebtEliminated <= 0) {
  return { status: 'FROZEN', code: 'BLOCK_GAMING_DETECTED' };
}
```

---

## 3. Popoviciu Variance & Hyperbolic Saturation Bounds

- **Popoviciu Bound (1935)**: For scores $S \in [0, 100]$, $\max \operatorname{Var}(S) = \frac{(100 - 0)^2}{4} \implies \sigma_{\max} = 50.0$. Setting $D = 1.0 - \frac{\sigma_S}{100}$ ($\gamma = 0.5$) bounds worst-case dispersion penalty cleanly at $0.5$.
- **Hyperbolic Scoring**: $S(D) = \frac{100H}{H + D}$ ($H = 30$) has $S'(D) < 0$ and $S''(D) > 0$ everywhere on $[0, \infty)$, guaranteeing strict monotonicity without vanishing gradients.
