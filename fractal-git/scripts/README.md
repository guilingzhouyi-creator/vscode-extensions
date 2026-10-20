# Fractal Git 工程构建与门禁维护脚本集

> **所属模块**：`fractal-git/scripts/`  
> **核心使命**：提供跨平台（Windows pwsh / Linux bash / Node common）双轨构建、测试、单向拓扑与门禁验证自动化工具链。

---

## 脚本速查表

| 脚本路径 | 平台/Shell | 换行契约 | 核心职责 | 调用示例 |
| :--- | :--- | :---: | :--- | :--- |
| **`ps1/build.ps1`** | Windows (pwsh 7+) | **CRLF** | 执行微 Crate 拓扑、Plumbing 等价性、TS 门面与 Rust 完整构建 | `pwsh -File scripts/ps1/build.ps1` |
| **`ps1/gate-rust.ps1`** | Windows (pwsh 7+) | **CRLF** | Rust 工业级质量门禁（rustfmt, clippy -D warnings, 零堆分配, 单测） | `pwsh -File scripts/ps1/gate-rust.ps1` |
| **`sh/build.sh`** | Linux / WSL (bash) | **LF** | 遵循 `set -euo pipefail` 的 Linux 完整构建与测试流水线 | `bash scripts/sh/build.sh` |
| **`sh/gate-rust.sh`** | Linux / WSL (bash) | **LF** | 遵循 `set -euo pipefail` 的 Linux Rust 工业级门禁验证 | `bash scripts/sh/gate-rust.sh` |
| **`common/validate-crate-topology.js`** | 跨平台 (Node.js) | **LF** | 校验 9 大微 Crate 单向无环依赖 DAG 与层级隔离 (`FGT-DEP-001`) | `node scripts/common/validate-crate-topology.js` |
| **`common/validate-git-parity.js`** | 跨平台 (Node.js) | **LF** | 校验 Git Plumbing 编解码与目录尾斜杠排序的 100% 字节等价性 (`FGT-OBJ-001`) | `node scripts/common/validate-git-parity.js` |
| **`common/validate-gate-bridge.js`** | 跨平台 (Node.js) | **LF** | 校验提交预审区门禁桥的规则 SSOT 闭包与延迟预算 (`FGT-BRG-001`) | `node scripts/common/validate-gate-bridge.js` |
| **`common/check-zero-alloc-boundary.js`** | 跨平台 (Node.js) | **LF** | 静态扫描 Rust 生产代码循环内的瞬态堆分配与裸 unwrap (`FGT-PRF-001`) | `node scripts/common/check-zero-alloc-boundary.js` |

> **关于根级 `scripts/build.{ps1,sh}`**：该目录下不提供门面调度跳板。此前的跳板有效代码不足 3 行，仅做参数透传，同时违反 `EXT-DIR-001`（`.ps1` 应归 `ps1/`、`.sh` 应归 `sh/`）与 `ARCH-ABS-001`（单行透传跳板消融），也不满足 `ARCH-FAC-001` 的 $\text{ELOC} \ge 15$ 实质承载门限。请直接调用语言域内的脚本：
> - Windows: `pwsh -File scripts/ps1/build.ps1`
> - Linux/WSL: `bash scripts/sh/build.sh`


---

## 跨平台执行契约与子进程规则
1. **工作目录显式隔离**：脚本内部一律使用相对于项目根目录的绝对路径或 `$PSScriptRoot` / `$(dirname "$0")` 定位，防止跨目录漂移；
2. **非交互模式守卫**：脚本默认以非交互静默模式运行，适合 CI 流水线或 Agent 自动化调用；
3. **零黑话纪律**：输出信息一律为纯客观技术事实，严禁堆砌执行数字流水账或情感形容词。
