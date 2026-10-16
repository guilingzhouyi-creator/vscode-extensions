# 📂 scripts/sh — 跨平台同构自动化脚本集（Bash）

> 仓库级共享自动化配套脚本集（Bash 语言域），与 `scripts/ps1/` 构成严格 1:1 的**跨平台同构双实现**体系。
> 遵循 JIT 渐进披露、工作目录显式隔离与 `set -euo pipefail` 防御契约。
> 历史 CNB 流水线脚本已整体封存至 [`archive/scripts-cnb/`](../../archive/scripts-cnb/README.md)。

---

## 一、同构脚本清单（9 对同构脚本）

| 脚本名 | 对应 PowerShell 脚本 | 职能域 | 核心职责 | 调用方 |
| :--- | :--- | :--- | :--- | :--- |
| `audit-all.sh` | `scripts/ps1/audit-all.ps1` | audit / review | 全工作区跨项目统一质量审查中枢（五大支柱 100% 绿色通行） | 本地 CLI、CI |
| `check-display-assets.sh` | `scripts/ps1/check-display-assets.ps1` | ci / package | VS Code 扩展打包资产健全性校验（图标、展示图与 README） | `package.sh`、CI |
| `commit-msg-gate.sh` | `scripts/ps1/commit-msg-gate.ps1` | gate / commit | 生产工程级结构化提交信息格式、区块、反虚构与风格求实 8 项门禁 | `.githooks/commit-msg`、本地 CLI |
| `install-hooks.sh` | `scripts/ps1/install-hooks.ps1` | tooling / git | 一键激活与初始化仓库级 Git 钩子（pre-commit, commit-msg, pre-push） | 本地 CLI |
| `package.sh` | `scripts/ps1/package.ps1` | package | 扩展打包、展示资产校验与产物自动化轮转 | 本地 CLI |
| `pre-commit-gate.sh` | `scripts/ps1/pre-commit-gate.ps1` | gate / staged | 本地提交前置物理卫生、AST 切片圈复杂度与代码密度流式门禁 | `.githooks/pre-commit`、本地 CLI |
| `pre-push-gate.sh` | `scripts/ps1/pre-push-gate.ps1` | gate / push | 本地推送前置全量多项前置检查、提交历史风格扫描与基线核验 | `.githooks/pre-push`、本地 CLI |
| `release-tag.sh` | `scripts/ps1/release-tag.ps1` | release | 本地发布闭环（版本递增、构建验证、打包、提交、Tag 打标与推送） | 本地 CLI |
| `version-bump.sh` | `scripts/ps1/version-bump.ps1` | release | 语义化版本单调递增与 CHANGELOG `[Unreleased]` 段落原子迁移工具 | 本地 CLI |

---

## 二、使用规范与执行约定

1. **环境与解释器**：全量脚本以 `#!/usr/bin/env bash` 为头部声明，需要 Bash 4+ 运行时（Linux, macOS, Git Bash on Windows）。
2. **防御指令契约**：严格声明 `set -euo pipefail`，预期允许失败的指令必须通过 `STATUS=0; cmd || STATUS=$?` 进行平铺捕获。
3. **换行符约束（`HYG-EOL-001`）**：全量 `.sh` 脚本在磁盘必须保持 POSIX LF 换行，末尾有且仅有 1 个标准换行符（`HYG-TRL-001`）。
4. **工作目录显式隔离**：跨目录调用子项目命令时，一律通过 `(cd "$subproject" && ...)` 隔离上下文，防止相对路径漂移。
