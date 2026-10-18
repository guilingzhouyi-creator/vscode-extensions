# Fractal Git 工程构建与门禁维护脚本集

> **所属模块**：`fractal-git/scripts/`  
> **核心使命**：提供跨平台（Windows pwsh / Linux bash）双轨构建、测试与门禁验证自动化工具链。

---

## 脚本速查表

| 脚本名称 | 平台/Shell | 换行契约 | 核心职责 | 调用示例 |
| :--- | :--- | :---: | :--- | :--- |
| **`build.ps1`** | Windows (pwsh 7+) | **CRLF** | 执行 Rust 内核与 TypeScript 门面构建与测试闭环 | `pwsh -File scripts/build.ps1` |
| **`build.sh`** | Linux / WSL (bash) | **LF** | 遵循 `set -euo pipefail` 的 CI / WSL 双轨编译验证 | `bash scripts/build.sh` |

---

## 跨平台执行契约与子进程规则
1. **工作目录显式隔离**：脚本内部一律使用相对于项目根目录的绝对路径或 `$PSScriptRoot` / `$(dirname "$0")` 定位，防止跨目录漂移；
2. **非交互模式守卫**：脚本默认以非交互静默模式运行，适合 CI 流水线或 Agent 自动化调用；
3. **零黑话纪律**：输出信息一律为纯客观技术事实，严禁堆砌执行数字流水账或情感形容词。
