# 📂 scripts — 仓库级脚本库

> 仓库级共享脚本的统一归属地。按**语言域**分目录组织（`sh/` / `ps1/` / `py/`），
> 各脚本在文件头注明**职能域**（gate / release / package / validate / ci）与用途。
> 项目内私有脚本（如 `auto-refactor/scripts/*.js` 的 validate/bench 系列）不在此库，
> 保留在各项目内部，由各自 `package.json` 引用。

---

## 一、目录分类矩阵（语言域 × 职能域）

| 目录 | 语言 | 脚本 | 职能域 | 调用方 |
|------|------|------|--------|--------|
| `sh/` | Bash | `gate-common.sh` | gate（冲突分级单源规则库，被 source） | `pr-gate.sh` / `auto-merge-gate.sh` |
| `sh/` | `check-display-assets.sh` | ci（打包资产校验） | `.github/workflows/ci.yml`、`release.yml` |
| `sh/` | Bash | `package.sh` | package（扩展打包） | 本地 CLI（README） |
| `sh/` | Bash | `version-bump.sh` | release（语义递增 + CHANGELOG 迁移） | 本地 CLI / `release-tag.sh` |
| `sh/` | Bash | `release-tag.sh` | release（bump→构建→打包→提交→Tag→推送） | 本地 CLI |
| `sh/` | Bash | `auto-label.sh` | gate（Issue/PR 自动打标签） | 手动 / CI |
| `sh/` | Bash | `pr-gate.sh` | gate（PR 前置门禁：冲突检测+Diff 初筛） | 手动 / CI |
| `sh/` | Bash | `auto-merge-gate.sh` | gate（合入安全门禁 C0-C3） | 手动 / CI |
| `sh/` | Bash | `release.sh` | release（打标后发布自动化骨架） | 手动 / CI |
| `sh/` | Bash | `test-release.sh` | validate（release.sh 异常兜底用例） | 本地 CLI |
| `ps1/` | PowerShell | `package.ps1` | package（扩展打包，与 package.sh 同约定） | 本地 CLI（Windows） |
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
set -uo pipefail
```

PowerShell 版使用 `# <# ... #>` 注释块（SYNOPSIS/DESCRIPTION/EXAMPLE），同结构字段。
Python 版使用 docstring + `if __name__ == "__main__":` 守卫。

---

## 五、错误处理与健壮性规范

| 规则 | 要求 |
|------|------|
| 严格模式 | Bash：`set -uo pipefail`（**禁用 `set -e`**——流水线脚本需显式处理预期失败分支，靠退出码语义而非隐式中断；局部可 `set -e` 于子 shell） |
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
  在语言分域重构后的根路径失效（P1）与 `check-display-assets.sh` 的 icon 校验静默禁用（P2），
  并在 `.github/workflows/ci.yml` 增补 hygiene 作业永久看守三类回归。
- 各脚本详细设计文档见 [`scripts/sh/README.md`](./sh/README.md)。
