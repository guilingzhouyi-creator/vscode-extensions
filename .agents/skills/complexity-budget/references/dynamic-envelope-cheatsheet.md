# AST Slice Complexity & Dual-Track Volume Envelope Cheatsheet

Reference thresholds enforced by `scripts/common/evaluate-eloc-budget.js` and `scripts/common/validate-code-density.js`.

---

## 1. AST Slice Metrics (`GUARD-AST-001`)

| Metric | Symbol | Baseline Cap | Elastic Tolerances | Remediation |
| :--- | :---: | :---: | :--- | :--- |
| **Cyclomatic Complexity** | CC | $\le 15$ | Flat dispatchers (no loops, $\text{Depth} \le 2$): $\le 25$; probes/tests: $\le 20$ | Extract pure helpers; table-driven dispatch |
| **Nesting Depth** | Depth | $\le 4$ | Production target $\le 2..3$; hard ceiling $4$ | Guard clauses; loop `continue` early skip |
| **Line Noise** | Noise | $\le 4.0$ | Ratio of non-identifier chars to identifier chars | Split stacked ternaries; name intermediates |

---

## 2. Single-File Dual-Track Volume Thresholds

| Metric Constant | Threshold | Enforcement |
| :--- | :---: | :--- |
| `DEFAULT_MAX_ELOC` / `DEFAULT_WARN_ELOC` | `900` / `750` | Pure non-blank/non-comment semantic lines; >900 blocks |
| `DEFAULT_MAX_LOC` / `DEFAULT_WARN_LOC` | `1400` / `1100` | Physical line ceiling; >1400 blocks |
| `DEFAULT_TARGET_DENSITY_RATIO` | `3.0` | Dynamic envelope multiplier: $\min(1400, \max(150, \lceil \text{ELOC} \times 3.0 \rceil))$ |
| `MIN_REPRESENTATIVE_LOC` | `250` | When $\text{LOC} \ge 250$, require $\text{ELOC} \ge \lfloor \text{LOC} / 3.0 \rfloor$ |
| `MIN_CONTRACT_COMMENT_RATIO` | `8%` | When $\text{ELOC} \ge 600$, comment ratio must be $\ge 8\%$ |

---

## 3. Loop Allocation & Anti-Gaming Rules

- **Zero loop heap allocation (`CPX-SPACE-001`)**: Forbid closures, `{}` objects, `[]` arrays, `+=` string concatenation, and `map.entries()` array spreads inside hot loops; use pre-allocated scratch buffers and `for (const [k, v] of map)`.
- **Anti-gaming circuit breaker (`BLOCK_GAMING_DETECTED`)**: Reject changes with $\text{ELOC}_{\text{semantic}} \le 15\%$ and zero net defect removal; never pad blank lines, strip comments, or reorder imports to game budgets.
