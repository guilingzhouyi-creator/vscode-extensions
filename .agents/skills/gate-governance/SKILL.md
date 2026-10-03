---
name: gate-governance
description: >-
  通用双层门禁架构与跨平台脚本工程化治理。指导 Agent 在任何代码库中建立 Tier 1 本地左移
  Git Hooks 与 Tier 2 远端 CI 工作流的双层同构防线，实施受限递归脚本探测、Shell/PowerShell
  跨平台安全规范与子进程显式工作目录隔离。
---

# gate-governance — 通用双层门禁架构与跨平台脚本治理

本技能规定了跨项目通用的门禁系统架构标准、跨平台脚本编写规范及执行上下文隔离原则。

---

## 一、 双层同构门禁架构体系 (Two-Tier Isomorphic Gates)

门禁系统严禁仅依赖单层防线，必须实施双层纵深防御：

1. **第一层：本地左移防御 (Tier 1 Local Gate)**：
   - `pre-commit`：执行零空文件守卫、换行契约（ps1 CRLF，其余 LF）、密钥防泄漏、行数红线预算及 AST 切片复杂度；
   - `commit-msg`：执行 Conventional Commits 格式、零施工批次黑话、结构化区块（`[Why]` / `[Added]` / `[Changed]` / `[Fixed]` / `[Verification]`）与单源规则反虚构；
   - `pre-push`：执行全量单元测试、跨模块静态审查与十维质量基线 Ratchet。
2. **第二层：远端主干看守 (Tier 2 Remote CI Gate)**：
   - 镜像运行本地 Tier 1 的全套门禁（Hygiene + Lint + Test + Audit）；
   - 防止因 `--no-verify` 绕过本地门禁的代码合入主干（触发 `GATE-ISO-001` 防御）；
   - 远端 CI 步骤中如需动态生成多行文件，统一使用 `printf "%s\n"` 语法。

---

## 二、 受限递归门禁脚本探测规范

在项目治理分析器中检索门禁脚本时，严禁仅做顶层单级扫描：
1. **探测目录**：覆盖 `scripts/`、`tools/`、`gate/`、`gates/` 等标准路径；
2. **受限递归深度**：设置 `maxDepth = 2`，精准检出多级子目录（如 `scripts/ps1/`、`scripts/sh/`、`scripts/common/`）；
3. **特征正则收口**：匹配 `/gate|audit|check|verify|lint|hygiene|commit|push|catalog|review-rules/i` 及对应脚本后缀。

---

## 三、 跨平台脚本与子进程工程契约

1. **子进程显式 WorkingDirectory 绑定**：
   - **PowerShell**：调用子项目流水线必须使用 `-WorkingDirectory (Join-Path $repoRoot "<subproject>")`；
   - **Bash**：调用子项目必须使用 `(cd "<subproject>" && ...)` 子 Shell 隔离；
   - **严禁仅依赖 `--prefix`**：防止 Prettier、ESLint、Jest 等工具读取错误的父目录配置或失配相对 glob 模式。
2. **PowerShell 7+ 优先与 UTF-8 编码安全**：
   - 严禁裸调 `powershell.exe`（Windows PS 5.1 解析无 BOM UTF-8 会发生乱码）；
   - 统一路由至跨平台 `pwsh`，非 Windows 环境优雅回退至 Bash；
   - 脚本开头必须显式声明 `$ErrorActionPreference = 'Stop'` 与 `Set-StrictMode -Version Latest`；
   - 换行符契约：PowerShell 脚本（`.ps1`）在磁盘必须严格保持 CRLF 换行。
3. **Shell 严格错误标志**：
   - Bash 脚本开头必须声明 `set -euo pipefail`；
   - 预期允许非 0 退出码的探测指令，必须使用 `STATUS=0; cmd || STATUS=$?` 平铺捕获或 `if cmd; then` 守卫，杜绝未捕获熔断。
