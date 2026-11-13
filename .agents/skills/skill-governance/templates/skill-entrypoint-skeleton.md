---
name: sample-domain-workflow
description: >-
  【触发：domain/sample/contract/gate/test/review】Standard domain engineering workflow skeleton enforcing architectural boundaries and verification gates.
---

# sample-domain-workflow — Domain Engineering & Quality Contract

Defines core architectural invariants, boundary rules, and gate verification for `<domain>`.

---

## 1. Activation Scope

Activate when modifying `<domain>` modules, boundary contracts, or gate suites:
1. **Scenario 1**: `<feature or module change>`;
2. **Scenario 2**: `<boundary refactor or bugfix>`;
3. **Scenario 3**: `<gate verification or release check>`.

---

## 2. Core Invariants & Red Lines

1. **Invariant 1**: `<unidirectional dependency or state contract>`;
2. **Invariant 2**: `<failure handling and resource ownership>`;
3. **Hard Block**: Never `<forbidden anti-pattern>`.

---

## 3. Complexity & Physical Hygiene

- **Per-function**: $\text{CC} \le 15$, $\text{Depth} \le 4$;
- **Per-file**: $\text{ELOC} \le 900$ / $\text{LOC} \le 1400$;
- **EOL**: Strict `LF` (`CRLF` for `.ps1`), UTF-8 no BOM, single trailing newline.

---

## 4. Verification Commands

```bash
npm run test:fast
cd <subproject> && npm run review
```
