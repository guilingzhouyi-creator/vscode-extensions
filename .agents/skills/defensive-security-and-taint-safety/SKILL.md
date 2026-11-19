---
name: defensive-security-and-taint-safety
description: >-
  【触发：clean/guard/bypass/corrupt/rm/taint/path/secrets】Guard recursive deletes (GUARD-DESTR-001), read-only auto vars (GUARD-VAR-001), junctions, and taint boundaries.
---

# defensive-security-and-taint-safety — Taint Dataflow, Destructive-Op Guards & Exposure Isolation

Enforces recursive-delete taint guards (`GUARD-DESTR-001`), read-only auto-var protection (`GUARD-VAR-001`), subprocess injection defense, and client/bundle isolation (`SEC-EXP-*` / `PROD-HYG-*`).

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[gate-governance](../gate-governance/SKILL.md) → **本技能** → [coding-craft](../coding-craft/SKILL.md)；并行支援 `constraint-driven-development`、`debugging-and-error-recovery`、`test-benchmark-engineering`、`algorithmic-operator-engineering`。
- **领域**：Gate & Shell Infrastructure（链上第 2 步）；另 2 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Audit recursive delete or path-traversal taint risks → `defensive-security-and-taint-safety` + `gate-governance` + `coding-craft`；Concurrent index tree write crash recovery or unsafe proofs → `fractal-git-dev` + `state-concurrency-and-crash-recovery` + `defensive-security-and-taint-safety`
<!-- SKILL-LINKS:END -->

## 1. Three-Step Recursive Delete Guard (`GUARD-DESTR-001` / `EXT-DIR-001`)

`shell-safety` and `validate-destructive-ops.js` trace taint across **assignments and loop aliases**. Every `rm -rf`, `Remove-Item -Recurse`, `fs.rmSync`, or `shutil.rmtree` must prove:

| Step | Mandatory Precondition | Blocked Anti-Pattern |
| :--- | :--- | :--- |
| **1. Non-Empty & Non-Root** | Non-empty, non-whitespace, $\notin \{\texttt{/}, \texttt{\\}, \texttt{\~}, \texttt{\$HOME}, \texttt{\$env:USERPROFILE}, \text{drive root}\}$ | `rm -rf "$TARGET_DIR/"` with unset var |
| **2. Canonical Resolution** | `path.resolve` / `Resolve-Path` / `realpath -m` stripping `..` | `fs.rmSync(path.join(base, userInput), { recursive: true })` |
| **3. Sandbox Prefix & Depth $\ge 1$** | Starts with `REPO_ROOT/` or `os.tmpdir()/` with relative depth $\ge 1$ | Deleting `$HOME`-derived loop alias (`$d = $HOME; foreach ($x in $d)`) |

- **Dual-Path `rm`**: In `linux-parity.ps1`, both GNU `rm.exe` and fallback `Remove-Item` invoke `Test-LinuxParityRemovalTarget`. Never run global resets (`git checkout -- .`, `git restore .`, `git clean -fd`, `git reset --hard`) in shared worktrees.

## 2. Auto-Variables, Injection & Client Exposure (`GUARD-VAR-001` / `SEC-*` / `PROD-HYG-*`)

- **PowerShell Auto-Vars (`GUARD-VAR-001`)**: Never assign, `param()`-declare, or loop/catch-bind `$HOME`, `$PID`, `$PSHOME`, `$Host`, `$Error`, `$ExecutionContext`, `$ShellId`, `$PSVersionTable`, `$IsWindows`, `$IsLinux`, `$IsMacOS`, `$PSCulture`, `$PSUICulture`, `$PSEdition`.
- **Zero Dynamic Eval (`SEC-VUL-001` / `PS-SEC-001` / `SH-SEC-001`)**: Ban `eval`, `new Function()`, `Invoke-Expression` (`iex`), and unescaped `exec` interpolation; pass arg arrays (`execFile` / `spawn`).
- **Client & Bundle Hygiene (`SEC-EXP-001` ~ `SEC-EXP-005`, `SEC-LEAK-001`, `PROD-HYG-001` ~ `PROD-HYG-003`, `HC-SECRET`)**: Never ship secrets/keys/DB URLs/admin routes (`SEC-EXP-001`/`SEC-LEAK-001`), CSS-only auth (`SEC-EXP-002`), `__debug` stubs (`SEC-EXP-004`/`005`), debug `console.log`/`TODO` (`PROD-HYG-001`), inline sourcemaps (`PROD-HYG-002`), raw `process.env` (`PROD-HYG-003`), or high-entropy tokens (`HC-SECRET` — use `test-placeholder-token-0000`).

---

## 3. Verification & JIT Assets

```powershell
node scripts/common/validate-destructive-ops.js && node scripts/common/validate-shell-parity.js
node .agents/skills/defensive-security-and-taint-safety/templates/safe-sandbox-cleanup.js
```

- [taint-dataflow-and-exposure-boundaries.md](references/taint-dataflow-and-exposure-boundaries.md): Assignment/loop-alias taint rules, sandbox guards & exposure checklist.
- [safe-sandbox-cleanup.js](templates/safe-sandbox-cleanup.js): 3-step taint-verified sandbox cleanup scaffold with `runSelfProbes()`.
