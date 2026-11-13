---
name: defensive-security-and-taint-safety
description: >-
  【触发：clean/guard/bypass/corrupt/rm/taint/path/secrets】Guard recursive deletes (GUARD-DESTR-001), read-only auto vars (GUARD-VAR-001), junctions, and taint boundaries.
---

# defensive-security-and-taint-safety — Taint Dataflow, Destructive-Op Guards & Exposure Isolation

Enforces zero-trust taint tracking for recursive file deletion (`GUARD-DESTR-001`), read-only host variable protection (`GUARD-VAR-001`), subprocess injection defense, and client/bundle exposure isolation (`SEC-EXP-*` / `PROD-HYG-*`).

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[gate-governance](../gate-governance/SKILL.md) → **本技能** → [coding-craft](../coding-craft/SKILL.md)；并行支援 `constraint-driven-development`、`debugging-and-error-recovery`、`test-benchmark-engineering`、`algorithmic-operator-engineering`。
- **领域**：Gate & Shell Infrastructure（链上第 2 步）；另 2 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Audit recursive delete or path-traversal taint risks → `defensive-security-and-taint-safety` + `gate-governance` + `coding-craft`；Concurrent index tree write crash recovery or unsafe proofs → `fractal-git-dev` + `state-concurrency-and-crash-recovery` + `defensive-security-and-taint-safety`
<!-- SKILL-LINKS:END -->

## 1. Three-Step Taint Guard for Recursive Deletion (`GUARD-DESTR-001` / `EXT-DIR-001`)

`shell-safety` and `scripts/common/validate-destructive-ops.js` trace taint across **assignment chains and loop iterator aliases**. Every recursive delete (`rm -rf`, `Remove-Item -Recurse`, `fs.rmSync`, `shutil.rmtree`) must prove three preconditions:

| Step | Mandatory Precondition | Blocked Fatal Anti-Pattern |
| :--- | :--- | :--- |
| **1. Non-Empty & Non-Root** | Target is non-empty, non-whitespace, and $\notin \{ \texttt{/}, \texttt{\\}, \texttt{\~}, \texttt{\$HOME}, \texttt{\$env:USERPROFILE}, \text{drive root} \}$ | `rm -rf "$TARGET_DIR/"` when `$TARGET_DIR` is unset |
| **2. Canonical Path Resolution** | Resolve via `path.resolve` / `Resolve-Path` / `realpath -m` to strip `..` traversal segments | `fs.rmSync(path.join(base, userInput), { recursive: true })` without prefix verification |
| **3. Sandbox Prefix & Depth $\ge 1$** | Resolved path starts with `REPO_ROOT/` or `os.tmpdir()/` and has relative depth $\ge 1$ | Deleting a loop alias derived from `$HOME` (`$d = $HOME; foreach ($x in $d) { rm -rf $x }`) |

- **Dual-Path `rm` Guard**: In `scripts/ps1/lib/linux-parity.ps1`, both GNU `rm.exe` and fallback `Remove-Item` bindings must invoke `Test-LinuxParityRemovalTarget` before execution.
- **Parallel Session Protection**: Never run global destructive resets (`git checkout -- .`, `git restore .`, `git clean -fd`, `git reset --hard`) in shared worktrees.

---

## 2. Read-Only Auto-Variables & Command Injection Defense (`GUARD-VAR-001` / `SH-SEC-001` / `PS-SEC-001`)

1. **No Writes or Shadowing on PowerShell Read-Only Variables (`GUARD-VAR-001`)**:
   - Never assign to, declare as `param()`, or bind in `foreach` / `catch`: `$HOME`, `$PID`, `$PSHOME`, `$Host`, `$Error`, `$ExecutionContext`, `$ShellId`, `$PSVersionTable`, `$IsWindows`, `$IsLinux`, `$IsMacOS`, `$PSCulture`, `$PSUICulture`, `$PSEdition`.
2. **Zero Dynamic Code Evaluation (`SEC-VUL-001` / `PS-SEC-001` / `SH-SEC-001`)**:
   - Forbid `eval`, `new Function()`, `Invoke-Expression` (`iex`), and unescaped string interpolation in `child_process.exec`. Always pass argument arrays (`execFile` / `spawn(cmd, args)`).

---

## 3. Client Exposure & Production Bundle Hygiene (`SEC-EXP-*` / `PROD-HYG-*`)

1. **Client Exposure Boundary (`SEC-EXP-001` ~ `SEC-EXP-005`)**:
   - Never bundle server secrets, private keys, DB connection strings, or internal admin endpoints into Webviews or frontend assets (`SEC-EXP-001` / `SEC-LEAK-001`).
   - Never rely on CSS hiding or client-side conditional rendering for access control (`SEC-EXP-002`).
   - Strip `__debug` routes, test stubs, and unauthenticated diagnostic endpoints from production builds (`SEC-EXP-004` / `SEC-EXP-005`).
2. **Production Bundle Hygiene (`PROD-HYG-001` ~ `PROD-HYG-003`) & Secrets (`HC-SECRET`)**:
   - Strip debug `console.log` / `TODO` (`PROD-HYG-001`), externalize/strip sourcemaps (`PROD-HYG-002`), and never serialize raw `process.env` into client bundles (`PROD-HYG-003`).
   - Never hardcode high-entropy tokens (`secret-detected` / `high-entropy-token` / `HC-SECRET`); use low-entropy placeholders (`test-placeholder-token-0000`) in fixtures.

---

## 4. Verification & JIT Assets

```powershell
node scripts/common/validate-destructive-ops.js
node .agents/skills/defensive-security-and-taint-safety/templates/safe-sandbox-cleanup.js
node scripts/common/validate-shell-parity.js
```

- [taint-dataflow-and-exposure-boundaries.md](references/taint-dataflow-and-exposure-boundaries.md): Assignment/loop-alias taint propagation rules, cross-language sandbox guards, and client exposure audit checklist.
- [safe-sandbox-cleanup.js](templates/safe-sandbox-cleanup.js): 3-step taint-verified recursive sandbox cleanup template with built-in `runSelfProbes()`.
