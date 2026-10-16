# 📂 scripts — 仓库级脚本库

> 仓库级共享脚本的统一归属地。按**语言域**分目录组织（`sh/` / `ps1/` / `py/`），
> 各脚本在文件头注明**职能域**（gate / release / package / validate / ci）与用途。
> 项目内私有脚本（如 `auto-refactor/scripts/*.js` 的 validate/bench 系列）不在此库，
> 保留在各项目内部，由各自 `package.json` 引用。

---

## 一、目录分类矩阵（语言域 × 职能域）

| 目录 | 语言 | 脚本 | 职能域 | 调用方 |
|------|------|------|--------|--------|
| `sh/` | Bash | `audit-all.sh` | audit / review（全工作区跨项目统一审查中枢） | 本地 CLI、CI |
| `ps1/` | PowerShell | `audit-all.ps1` | audit / review（audit-all.sh 同构双实现） | 本地 CLI（Windows） |
| `common/` | Node.js | `validate-no-empty-files.js` | audit / hygiene（全工作区零物理空文件与空包跳板守卫） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-script-isomorphism.js` | audit / isomorphism（跨平台同构脚本 ps1/sh 结构对应性、换行与防御契约守卫） | `audit-all`、CI |
| `common/` | Node.js | `validate-skills.js` | audit / skills（全工作区 24 项研发技能规范、死链与镜像等价性守卫） | `audit-all`、CI |
| `common/` | Node.js | `sync-skills.js` | tooling / skills（根目录技能集与 workspace-governance 插件双向同步工具） | 本地 CLI |
| `common/` | Node.js | `gate-fast-staged.js` | gate / fast-staged（暂存区文件单遍内存流式前置 6 大门禁判定，<90ms） | `pre-commit-gate` |
| `common/` | Node.js | `validate-staged-slice.js` | gate / complexity（平台级增量 AST 切片圈复杂度/嵌套/噪声比审查器） | `pre-commit-gate`、CI |
| `common/` | Node.js | `validate-code-density.js` | gate / density（多维代码密度、接线率 POR<=60% 与列密度审查器） | `pre-commit-gate`、`pre-push-gate`、CI |
| `common/` | Node.js | `validate-gitignore-governance.js` | audit / hygiene（全仓 .gitignore 换行、安全底线守卫与防误伤断言门禁） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `evaluate-eloc-budget.js` | audit / complexity（双轨体积 ELOC<=900/LOC<=1400 与 1:3 动态包络评估器） | `pre-commit-gate`、CI |
| `common/` | Node.js | `generate-rule-catalog.js` | audit / ssot（全工作区 428 条规则单源目录聚合与零漂移核验器） | 本地 CLI、pre-push 门禁、CI |
| `common/` | Node.js | `validate-commit-msg.js` | gate / commit（生产级结构化提交信息格式、区块与有效字数综合调度器） | `commit-msg-gate` |
| `common/` | Node.js | `validate-commit-msg-rules.js` | gate / ssot（提交信息规则 ID 反虚构校验器） | `commit-msg-gate` |
| `common/` | Node.js | `validate-commit-msg-style.js` | gate / style（提交信息文本风格与四维禁词核验器） | `commit-msg-gate`、`pre-push-gate`、CI |
| `common/` | Node.js | `record-workspace-trajectory.js` | telemetry / ledger（全工作区审查轨迹账本记录与版本增量追加工具） | `audit-all` |
| `common/` | Node.js | `validate-trajectory-ledger.js` | audit / ledger（全工作区演化轨迹账本哈希单调性与完整性校验器） | 本地 CLI、CI |
| `common/` | Node.js | `log-rotator.js` | tooling / hygiene（门禁失败快照保留、尾部截断 <=100KB 与 FIFO <=2MB 轮转清理管理器） | `pre-commit-gate`、`commit-msg-gate`、`pre-push-gate`、`audit-all` |
| `common/` | JSON | `commit-msg-forbidden-terms.json` | data / ssot（提交信息四维禁词与白名单单源字典） | `validate-commit-msg-style` |
| `common/` | JSON | `rule-catalog.json` | data / ssot（全工作区规则事实真源聚合目录） | 静态审查与门禁工具链 |
| `sh/` | Bash | `gate-common.sh` | gate（冲突分级单源规则库，被 source） | `pr-gate.sh` / `auto-merge-gate.sh` |
| `sh/` | Bash | `pre-commit-gate.sh` | gate（本地提交物理卫生与多项前置检查，含 AST 切片） | `.githooks/pre-commit`、本地 CLI |
| `ps1/` | PowerShell | `pre-commit-gate.ps1` | gate（pre-commit-gate.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `commit-msg-gate.sh` | gate（生产工程级结构化提交信息格式、区块、字数、反虚构与风格求实 8 项门禁） | `.githooks/commit-msg`、本地 CLI |
| `ps1/` | PowerShell | `commit-msg-gate.ps1` | gate（commit-msg-gate.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `pre-push-gate.sh` | gate（本地推送前置全量多项前置检查、提交历史风格扫描与基线核验） | `.githooks/pre-push`、本地 CLI |
| `ps1/` | PowerShell | `pre-push-gate.ps1` | gate（pre-push-gate.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `install-hooks.sh` | gate（一键激活仓库级 Git Hooks） | 本地 CLI |
| `ps1/` | PowerShell | `install-hooks.ps1` | gate（install-hooks.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `check-display-assets.sh` | ci（打包资产校验） | `.github/workflows/ci.yml`、`package.sh` |
| `ps1/` | PowerShell | `check-display-assets.ps1` | ci（check-display-assets.sh 同构双实现） | `package.ps1`、本地 CLI（Windows） |
| `sh/` | Bash | `package.sh` | package（扩展打包，联动展示资产校验） | 本地 CLI（README） |
| `ps1/` | PowerShell | `package.ps1` | package（package.sh 同构双实现，联动资产校验与热同步） | 本地 CLI（Windows） |
| `sh/` | Bash | `release-tag.sh` | release（Git 语义化标签创建与自动化推送发布） | 本地 CLI |
| `ps1/` | PowerShell | `release-tag.ps1` | release（release-tag.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `version-bump.sh` | release（全工作区版本号一致性递增工具） | 本地 CLI |
| `ps1/` | PowerShell | `version-bump.ps1` | release（version-bump.sh 同构双实现） | 本地 CLI（Windows） |
| `py/` | Python | （预留，暂无脚本） | — | — |

> 职能域语义：`gate`=协作门禁（CNB 流水线触发）、`release`=发布流程、
> `package`=本地打包、`ci`=CI 辅助校验、`validate`=脚本自测/回归用例。

---

## 二、语言域选择约定

| 场景 | 推荐语言 | 说明 |
|------|---------|------|
| 流水线触发 / CI / 跨平台 | Bash（`sh/`） | Git Bash / Linux runner 直接可跑 |
| Windows 本地交互（参数提示、错误高亮） | PowerShell（`ps1/`） | `package.ps1` 为 `package.sh` 的同构双实现 |
| 复杂文本/数据/多步骤分析 | Python（`py/`） | 预留域；需要 stdlib 或轻量依赖时启用 |

**双实现约定**：同一职能若同时提供 sh 与 ps1 双实现（如 `package.sh` / `package.ps1`），
两份文件放各自语言域目录，文件名保持一致（仅扩展名不同），且文件头互相注明「同构双实现」。

---

## 三、命名规范

- **小写 kebab-case**，动词开头：`auto-label.sh`、`check-display-assets.sh`、`package.ps1`
- 职能前缀建议：`auto-*`（自动判定）、`check-*`（校验）、`pr-*` / `merge-*`（门禁）、`release-*` / `test-release-*`（发布与自测）
- 语言以目录归属表达（不再用 `*.sh` / `*.ps1` 后缀重复标注目录层级）

---

## 四、脚本头注释模板（新脚本必须遵守）

```bash
#!/usr/bin/env bash
# =============================================================================
# <脚本名> — <一句话职责>
# -----------------------------------------------------------------------------
# 职能域：<gate|release|package|ci|validate>
# 触发方：<流水线事件 / 本地 CLI / CI workflow>
# 用法：
#   bash scripts/sh/<script>.sh <args...>
# 依赖：<环境变量 / 外部命令 / 前置脚本>
# 退出码：0=成功；非 0=<失败语义>
# =============================================================================
set -euo pipefail
```

PowerShell 版使用 `# <# ... #>` 注释块（SYNOPSIS/DESCRIPTION/EXAMPLE），同结构字段。
Python 版使用 docstring + `if __name__ == "__main__":` 守卫。

---

## 五、错误处理与健壮性规范

| 规则 | 要求 |
|------|------|
| 严格模式 | Bash：必须声明 `set -euo pipefail`，预期允许失败的指令必须通过 `STATUS=0; cmd || STATUS=$?` 平铺捕获或 `if cmd; then` 守卫分支 |
| 参数校验 | 必需参数用 `${1:?用法提示}` 或显式判断并 `exit 2` |
| 退出码语义 | `0`=成功；`1`=业务失败；`2`=用法错误；门禁类脚本按职能定义 `0`=放行 / 非 `0`=阻断 |
| 幂等 | 可重复执行不产生副作用（打标签/发布/合并前先查重） |
| 破坏性操作 | 禁止 `git reset --hard` / 静默清空；回退用 `git merge --abort` 并 `|| true` 兜底 |
| 临时目录 | 用完即清；流水线内产物不入库（统一 `dist/`、`*.vsix`、`*.tgz` 已 ignore） |
| 日志 | 结论类输出打 `echo "【xxx】"` 标记，便于流水线/巡检检索 |

---

## 六、新增脚本 Checklist

1. 确定职能域与语言域，放入对应目录（`sh/` `ps1/` `py/`）
2. 按第四节模板补全头注释
3. 遵循第五节错误处理规范
4. 更新本文件「目录分类矩阵」表
5. 若被流水线/CI 调用，同步更新 `.github/workflows/*.yml` 中的路径

---

## 七、历史归属说明

- `scripts/sh/` 下的 gate/release 系列脚本 2026-08-28 按「仓库级脚本库按语言分域」归入本库，
  可作为独立工具手动执行或接入 CI（`.github/workflows/*.yml`）。
- 2026-09-09 补齐发布工具链：`version-bump.sh`（语义递增 + CHANGELOG 迁移，干净树/版本单调/扩展身份三门禁）
  与 `release-tag.sh`（本地发布闭环，与 `release.yml` 同规），修复 `package.sh`/`package.ps1`
  在语言分域重构后的根路径失效与 `check-display-assets.sh` 的 icon 校验静默禁用，
  并在 `.github/workflows/ci.yml` 增补 hygiene 作业永久看守三类回归。
- 各脚本详细设计文档见 [`scripts/sh/README.md`](./sh/README.md)。

---

## 八、面向自主 Agent 的门禁协议规范 (Agent-Native Gate Protocol v1.0.0)

工作区门禁系统（`pre-commit-gate`、`commit-msg-gate`、`pre-push-gate`、`gate-fast-staged`、`validate-staged-slice`、`validate-commit-msg`）原生支持**双轨运行界面**：
1. **人类交互模式 (默认)**：保留高对比度彩色终端、清晰横幅进度与步骤摘要；
2. **Agent 原生消费模式 (`-Agent` / `--agent` / `--json`)**：彻底剥离控制台彩色散文与非必要输出，在标准输出 (stdout) 仅发射单份确定性、机器可读的结构化 JSON 协议包。

### 1. 协议包 Schema 契约 (`AgentFailureEnvelope`)

```json
{
  "protocolVersion": "1.0.0",
  "status": "PASS | BLOCK",
  "gate": "pre-commit | commit-msg | pre-push",
  "step": "失败步骤名称",
  "failedCommand": "触发失败的精确命令",
  "exitCode": 1,
  "summary": "纯客观技术事实摘要",
  "logFile": ".audit-logs/last-failure.log",
  "violations": [
    {
      "ruleId": "SSOT登记规则ID (如 HYG-EOL-001, CMG-PRJ-001, CPX-BUD-001)",
      "severity": "BLOCK | WARN",
      "file": "违规目标相对路径",
      "line": 42,
      "column": 5,
      "actual": "当前实际值 (如 CC=22, CRLF, 未声明项目归属)",
      "expected": "预期合规值 (如 CC<=15, LF, [Project: governance])",
      "message": "精确违规描述",
      "actionableFix": "明确且唯一的自愈建议",
      "verificationCommand": "针对本违规项的快速单点验证命令"
    }
  ],
  "agentDirectives": {
    "targetFiles": ["待修复的绝对或相对文件路径列表"],
    "remediationPriority": ["优先修复的规则ID列表"],
    "verificationCommand": "单点验证命令",
    "fastRecheckCommand": "极速重测命令 (如 pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent)"
  }
}
```

### 2. 核心调度与快照自愈指令

| 门禁与工具 | 人类模式命令 | Agent 原生模式命令 | 诊断快照查看 |
|:---|:---|:---|:---|
| **提交前置门禁** | `pwsh scripts/ps1/pre-commit-gate.ps1` | `pwsh scripts/ps1/pre-commit-gate.ps1 -Agent` | `pwsh scripts/ps1/pre-commit-gate.ps1 -ViewLog` |
| **提交信息门禁** | `pwsh scripts/ps1/commit-msg-gate.ps1 <msg>` | `pwsh scripts/ps1/commit-msg-gate.ps1 <msg> -Agent` | `pwsh scripts/ps1/commit-msg-gate.ps1 -ViewLog` |
| **推送前置门禁** | `pwsh scripts/ps1/pre-push-gate.ps1` | `pwsh scripts/ps1/pre-push-gate.ps1 -Agent` | `pwsh scripts/ps1/pre-push-gate.ps1 -ViewLog` |
| **失败快照轮转器** | `node scripts/common/log-rotator.js --view` | `node scripts/common/log-rotator.js --agent` | 自动保留最近一次失败至 `.audit-logs/last-failure.json` |

