# Trajectory Recipe Learning & `ReviewGateChain` (`GAT-*`) Specification

> **Parent Skill**: [praxis-vfs-and-trajectory-learning](../SKILL.md)  
> **Source of Truth**: `auto-refactor/src/core/trajectory/recipeExtractor.ts`, `auto-refactor/src/core/praxis/trajectoryLearningService.ts`, `auto-refactor/src/core/praxis/diffGovernance.ts`, `auto-refactor/src/core/review/`

---

## 1. `ReviewGateChain` Five-Rule Governance Matrix (`GAT-*`)

| Rule ID | Dimension | Mathematical / Structural Criterion | Exemption Policy |
| :--- | :--- | :--- | :--- |
| **`GAT-BOUND-001`** | Per-File 5D ELOC Envelope | New file $E_{\text{add}} \le 360$; existing file $E_{\text{add}} \le 120$ (or $\le 180$ with $\ge 10$ refactored del lines); deletion $E_{\text{del}} \le 100$ (max $280$ with witness) | Floor is non-exemptible; ceiling overflow requires module deconstruction |
| **`GAT-DENS-001`** | Substantive & Payload Density | Substantive line ratio $\ge 0.60$; Token Stream Payload Ratio $\text{TSPR} \ge 0.40$; token density $\tau \in [2.5, 22.0]$ | Only `SUBSTANTIVE_TARGET_DEFICIT` is eligible for exemption |
| **`GAT-BATCH-001`** | Batch Macro Turnover | $\sum E_{\text{add}} \le 360$, $\sum E_{\text{del}} \le 280$, $\sum E_{\text{add}} + 0.8\sum E_{\text{del}} \ge \Theta_{\text{admission}} \in [3.0, 25.0]$ | Strictly non-exemptible; split large batches across 6-layer topology |
| **`GAT-EXMP-001`** | Exemption Quota & Audit | Applies only to short new modules after 3 consecutive blocks; max 1 exemption per batch; persisted in `diff-exemptions.json` | Audited by `ReviewGateChain` |
| **`GAT-STREAK-001`** | Consecutive Block Escalation | Tracks per-session retry streaks in `.audit-logs/diff-streaks.json`; 2nd block emits structural hint, 5th requires human confirmation | Resets automatically upon a clean `PASS` |

---

## 2. Trajectory Recipe Extraction & Bayesian Calibration

1. **Recipe Extraction Pipeline (`recipeExtractor.ts`)**:
   - Observes before/after file pairs from accepted commits and MCTS tournament winners.
   - Extracts structural AST diff signatures, eliminated rule IDs (`resolvedRules`), 5D ELOC churn, and net quality gain ($\Delta Q > 0$).
2. **Bayesian Prior Recalibration (`review-verdicts.json`)**:
   - True-positive / false-positive verdicts from `auto-refactor review` update Jeffreys $\text{Beta}(s + 0.5, f + 0.5)$ posterior weights for both rule confidence and recipe ranking.
3. **Compact Ledger Storage (`.refactor-trajectory/`)**:
   - Every trajectory record is capped at `< 350 bytes` with `*Ms` nominal timestamps (`validate-compact-ledger.js`).
