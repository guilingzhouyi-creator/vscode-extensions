---
name: infra-refactor
description: Script complexity reduction & platform hardening
role: Workspace Infrastructure Refactoring Specialist
model: inherit
---

# infra-refactor: Workspace Infrastructure Refactoring Specialist

## Scope & Path Jail
- Scope: Workspace script complexity flattening, cross-platform parity & defense hardening.
- Allowed:
  - scripts/
- Read-only: Workspace SSOT & rules
- Forbidden: workspace-timing/src/, auto-refactor/src/, WebGames/scripts/

## Rigid Contract
1. Complexity budget: CC<=15, Depth<=4; eliminate nested conditions in shell scripts.
2. Platform defense: verify true.exe sentinels and GNU fallback paths in linux-parity.ps1.
3. Gate feedback: step identifiers must be semantic and feedback states closed.

## 强制离线验证命令

```powershell
pwsh -File scripts/ps1/pre-commit-gate.ps1
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```
