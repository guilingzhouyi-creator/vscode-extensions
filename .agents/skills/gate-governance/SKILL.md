---
name: gate-governance
description: >-
  【触发：门禁/全仓审查/提交门禁/脚本编写/跨平台/pwsh/bash/子进程】编写修改门禁脚本、运行全仓审查或处理跨平台脚本兼容时触发。落实 Tier 1 本地左移流式判定、工作目录隔离契约与零黑话规范。
---

# gate-governance — Three-Tier Isomorphic Gates & Cross-Platform Script Engineering

Defines the 3-tier gate architecture (Tier 1 Local Shift-Left $\to$ Tier 1.5 Remote Linux Sandbox $\to$ Tier 2 GitHub CI), impact-driven project routing, MicroVM sandbox isolation, and PowerShell / Bash / Node.js script contracts.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md)；并行支援 `coding-craft`、`constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`。
- **领域**：门禁与命令面基础设施（领域入口）；另 3 个领域支援
- **协作专员**：原型 `infra-tool`：`infra-construct`、`infra-review`、`infra-refactor`、`infra-explore`、`infra-guardian`
- **何时联动**：新增门禁步骤并登记语义标识 → `gate-governance` + `rule-catalog-governance` + `test-benchmark-engineering`；pwsh 与 bash 门禁语义漂移 → `gate-governance` + `coding-craft` + `debugging-and-error-recovery`
<!-- SKILL-LINKS:END -->

## 1. Three-Tier Isomorphic Gate Architecture

### 1.1 Tier 1: Local Shift-Left Gates (`< 250ms`)
- **`pre-commit` (`gate-fast-staged.js`)**: Single-process in-memory streaming audit over staged files:
  1. **Physical Hygiene**: Blocks 0-byte/blank files (`HYG-EMP-001`), enforces `.ps1` CRLF vs `.sh`/`.gd`/`.ts`/`.js`/`.md`/`.json` LF (`HYG-EOL-001`), and checks 4-space (TS) vs 2-space indentation.
  2. **Secrets & Path Hygiene**: Blocks hardcoded tokens/keys and absolute paths (`HC-ABS-PATH`).
  3. **Dual-Track Volume**: Enforces $\text{ELOC} \le 900$, $\text{LOC} \le 1400$, 1:3 dynamic ratio, and $\ge 8\%$ comment ratio when $\text{ELOC} \ge 600$.
  4. **AST Slice Complexity (`GUARD-AST-001`)**: Enforces $\text{CC} \le 15$ (flat dispatchers/probes 20–25), $\text{Depth} \le 4$, $\text{Noise} \le 4.0$.
  5. **5D ELOC Differential Bounds (`STAGED-DIFF-14` / `FGT-GAT-001`)**: Per-file micro envelope (add $\le 120/180$, del $\le 100$), batch macro envelope (add $\le 360$, del $\le 280$), and Jeffreys Beta admission threshold $\Theta_{\text{admission}} \in [3.0, 25.0]$ 5D ELOC ($\text{TSPR} \ge 0.40$).
- **`commit-msg` (`validate-commit-msg.js`)**:
  1. **Header**: `<type>(<scope>): <imperative summary>` (15–80 chars total, 10–70 chars subject, ASCII `): `, no trailing period, no BOM/zero-width chars, no emoji).
  2. **Controlled Project (`CMG-PRJ-001`)**: First body section `[Project]` must be one of `workspace-timing | auto-refactor | WebGames | fractal-git | governance`.
  3. **Mandatory Sections**: `[Why]` ($\ge 15$ chars), `[Verification]` ($\ge 12$ chars, qualitative assertions without raw execution counts), plus `[Added]` (`feat`), `[Fixed]` (`fix`), `[Changed]` (`refactor`/`perf`), or `[Breaking Changes]` (`!`); bullet items `- ` ($\ge 8$ chars); total body $\ge 30$ non-whitespace chars.
  4. **Forbidden Terms & Rule Closure**: Blocks `CMG-STY-001`~`008`, agile/sprint codenames, and unregistered rule IDs (`RCFG-RULE-DRIFT`).
- **`pre-push`**: Runs impact-routed unit tests, cross-module static audits, zero High/Critical debt verification, and baseline ratchets (`GUARD-BASE-001`).
- **Gate Telemetry (`gate-telemetry-logger.js`)**: Persists `.audit-logs/<gate>-latest.json` and SM3/SHA-256 hash-chained `.audit-logs/<gate>-history.jsonl` under `lib/file-lock.js` (30s TTL + `Atomics.wait`), archives resolved failures to `.audit-logs/resolved-failures/`, emits `AgentFailureEnvelope` (`last-failure.json`), strips ANSI/drive letters, and prunes stale `.tmp` files (`log-rotator.js --prune`).

### 1.2 Tier 1.5: Remote Linux Sandbox Gate (`remote-sandbox-gate.js`)
- Pre-validates changes in an Ubuntu environment matching GitHub Actions before pushing:
  - **Slices**: `hygiene`, `rust`, `timing`, `auto-refactor`, `webgames`, `staged`, or `all` (`pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice <name>`).
  - **MicroVM Isolation**: Confined to `/data/workspace/vscode-extensions/` (`GUARD-JAIL-001`); reserves 1 vCPU core (`-j 3`) against OOM; forbids binding reserved host ports (`8788`, `8789`, `10801`, `5901`); `staggered-push-orchestrator.js` enforces `preflightCheckpointAudit` + `--verify-remote`.

### 1.3 Tier 2: Remote CI Gate (`.github/workflows/`)
- Clean-room multi-OS verification and VSIX packaging; blocks any commit that bypassed local hooks (`GUARD-ISO-001`). Use `printf "%s\n"` instead of `echo -e` for multi-line generation.

---

## 2. Impact-Driven Routing & Script Discovery

`git diff --cached --name-only` maps staged paths to 5 controlled domains:
- `workspace-timing/**` $\to$ `npm run compile && npm run test:fast && npm run review`
- `auto-refactor/**` $\to$ <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> experts & <!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor --> self-audit (`npm run gate && npm test`)
- `WebGames/**` $\to$ `check-gdscript.sh`, `test-run.ps1`, config parity audit
- `fractal-git/**` $\to$ `cargo clippy --all-targets -- -D warnings`, `cargo test`, `audit-taxis.ps1`
- `scripts/**` / `.github/**` / `AGENTS.md` / `.agents/**` $\to$ `governance` domain (`audit-all.ps1`, `validate-skills.js`)
- Gate script discovery scans `scripts/`, `tools/`, `gate/`, `gates/` with `maxDepth = 2`.

---

## 3. Cross-Platform Script & Subprocess Contracts

1. **Explicit `WorkingDirectory` Isolation**: PowerShell must use `-WorkingDirectory` or `Push-Location`/`try`/`finally`/`Pop-Location`; Bash must use `(cd "<dir>" && ...)`. Never rely solely on `npm --prefix`.
2. **PowerShell 7+ (`pwsh`) & Linux Parity (`GUARD-SHELL-001`)**:
   - Require `Set-StrictMode -Version Latest`, `$ErrorActionPreference = 'Stop'`, `$PSNativeCommandUseErrorActionPreference = $true`, `$PSNativeCommandArgumentPassing = 'Standard'`, UTF-8 encoding, and `CRLF` line endings.
   - Load GNU/fallback command bindings from `scripts/ps1/lib/linux-parity.ps1` (see [linux-command-surface.md](references/linux-command-surface.md)). Isolate sandbox Git config via `$env:GIT_CONFIG_GLOBAL='NUL'; $env:GIT_CONFIG_SYSTEM='NUL'`.
3. **Bash Defensive Header & Block Chains (`GUARD-CHAIN-001`, `GUARD-ORD-001`)**: Require `#!/usr/bin/env bash`, `set -euo pipefail`, functions defined before invocation, and flat exit-code capture (`STATUS=0; cmd || STATUS=$?`).
4. **Trusted Binary Path & Quoting**: Resolve system binaries (`ssh.exe`, `git.exe`, `node.exe`) from trusted paths verified with `Test-Path -PathType Leaf` / `[ -x "$BIN" ]`; double-quote all path variables and prefer argument arrays.
5. **5D Script Rename Closure**: Renaming/retiring any script under `scripts/` must update: ① `.github/workflows/*.yml`, ② `.agents/subagents/archetypes/*.json`, ③ `scripts/common/rule-catalog.json`, ④ `AGENTS.md` & `docs/`, ⑤ `audit-all` & `scripts/README.md`.
6. **Destructive Operand Provenance (`validate-destructive-ops.js`)**:
   - `GUARD-DESTR-001`: Static taint tracking blocks recursive deletion on root/workspace/home paths or variables/loop aliases derived from them; `rm` in `linux-parity.ps1` enforces `Test-LinuxParityRemovalTarget` on both GNU and fallback paths.
   - `GUARD-VAR-001`: Blocks writes to read-only automatic variables (`$HOME`, `$PID`, `$Host`, `$Error`, `$IsWindows`, etc.).

---

## 4. Staged Diff Bounds & Exemption Policy (`STAGED-DIFF-14`)

Configured in `scripts/common/lib/diff-bounds-policy.js`:

| Rule ID | Scope | Enforcement |
| :--- | :--- | :--- |
| `GAT-BOUND-001` | Per-file added/deleted effective volume | Two-sided: below floor = invalid; above ceiling = blocked |
| `GAT-DENS-001` | Substantive line ratio & payload ratio (`TSPR`) | Floor is rigid; target relaxable via exemption |
| `GAT-BATCH-001` | Batch macro volume & admission turnover | Structural violation; non-exemptible |
| `GAT-EXMP-001` | Exemption eligibility, quota & audit (`diff-exemptions.json`) | Short new modules only; unlocks after 3 consecutive blocks; max 1 per batch |
| `GAT-STREAK-001` | Consecutive failure escalation (`.audit-logs/diff-streaks.json`) | Warn structural issue on 2nd hit; require human confirmation on 5th |

Only `SUBSTANTIVE_TARGET_DEFICIT` is exemptible; batch overflow requires splitting commits.

---

## 5. Verification & Scaffolding Assets

```powershell
pwsh -File scripts/ps1/pre-commit-gate.ps1
pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>
node scripts/common/generate-rule-catalog.js --check-only
node scripts/common/validate-skills.js
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```

- [cross-platform-subprocesses.md](references/cross-platform-subprocesses.md): Subprocess working-directory isolation, flat exit-code capture & environment hardening.
- [linux-command-surface.md](references/linux-command-surface.md): Alias precedence, GNU sentinel probe, selective fallback & wrapper rules.
- [gate-script-skeleton.ps1](templates/gate-script-skeleton.ps1) / [gate-script-skeleton.sh](templates/gate-script-skeleton.sh): Isomorphic gate script templates (step IDs must match `scripts/common/gate-step-registry.json` per `GUARD-STEP-001`).
