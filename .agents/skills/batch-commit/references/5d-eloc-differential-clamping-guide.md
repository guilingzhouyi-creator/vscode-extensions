# 5D ELOC Differential Bounds & Jeffreys Posterior Admission Spec

Deep specification for the two-tier decoupled 5D ELOC differential clamping system deployed in `auto-refactor` and `fractal-git`.

---

## 1. First Principles: Blocking Gaming & Monolithic Commits

Raw physical LOC checks encourage padding comments/trampolines, bulk deletions to inflate churn, or coupling file size caps with batch limits. The workspace enforces decoupled micro (per-file) and macro (batch) differential envelopes on 5D ELOC.

---

## 2. 5D ELOC Weighting Model

$$\mathbf{D}(L) = [D_{\text{line}}, D_{\text{col}}, D_{\text{reuse}}, D_{\text{shared}}, D_{\text{payload}}]$$

Weight $\omega(L)$ is `0.0` for blank lines, pure doc/inline comments, and $\le 3$-line pass-through trampolines, and `1.0` for substantive control flow, data operations, type definitions, and contracts:
- Substantive line ratio: $R_{\text{sub}} = \frac{\text{LOC}_{\text{total}} - \text{LOC}_{\text{blank}} - \text{LOC}_{\text{comment}}}{\text{LOC}_{\text{total}}} \ge 0.60$
- True payload retention: $\text{TSPR} = \frac{\text{ELOC}_{\text{5D}}}{\text{LOC}_{\text{total}}} \ge 0.40$

---

## 3. Two-Tier Differential Envelopes

| Tier | Bounds |
| :--- | :--- |
| **Layer A: Per-File Micro** | New file $E_{\text{add}} \le 180.0$ ELOC; existing file $E_{\text{add}} \le 120.0$ ELOC; $E_{\text{del}} \le 100.0$ ELOC (unless Verified Refactor); $R_{\text{sub}} \ge 0.60$, $\text{TSPR} \ge 0.40$ |
| **Layer B: Batch Macro** | $\sum E_{\text{add}} \le 360.0$ 5D ELOC; $\sum E_{\text{del}} \le 280.0$ 5D ELOC; $E_{\text{turnover}} \ge \Theta_{\text{admission}}$ |

---

## 4. Jeffreys Posterior Adaptive Admission Floor

$$E_{\text{turnover}} = \sum E_{\text{add}} + 0.8 \times \sum E_{\text{del}}$$

Using recent $N$ valid commits $\mathcal{H} = \{T_1, \dots, T_N\}$ under uninformative $\text{Beta}(0.5, 0.5)$ prior:
$$\mu_{\text{Jeffreys}} = \frac{0.5 + \sum_{i=1}^N T_i}{1.0 + N}, \quad \Theta_{\text{admission}} = \text{clamp}(\mu_{\text{Jeffreys}} - 0.5 \sigma, 3.0, 25.0)$$

Cold start ($N < 3$) falls back to floor $3.0$ 5D ELOC; cap $25.0$ prevents deadlocking subsequent batches.

---

## 5. Dual-Beat Alternating Commit Cadence

```text
[Code Beat] ---> [Local Audit / Telemetry Run] ---> [Telemetry Beat] ---> [Next Cycle]
(prod + tests)   (generate audit reports/ledgers)   (reports + ledgers)
```

Separate production+test commits from audit/telemetry report commits so each production change has an immediately trailing tamper-evident quality witness in Git history.
