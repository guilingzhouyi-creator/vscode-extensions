# 仓库级脚本工程治理体系与跨平台同构规范

> 本文档为工作区仓库级脚本库（[`scripts/`](../../scripts/)）的统一工程治理规范、三种脚本语言生态契约、同构双实现机制与性能优化架构手册。

---

## 一、 仓库级脚本治理总纲与目录分层

仓库级脚本集中收口于根目录 `scripts/`，与子项目内部的私有构建脚本（如 `auto-refactor/scripts/*.js`、`WebGames/scripts/`）实施**物理与职责双重解耦**：

```
scripts/
├── README.md                      # 仓库级脚本中枢索引与语言/职能矩阵
├── common/                        # Node.js 语言域：跨平台核心算法、规则单源与流式门禁 (12 个 .js)
│   ├── gate-fast-staged.js        # Tier 1 极速内存流式门禁 (<250ms)
│   ├── validate-script-isomorphism.js # 跨平台同构脚本与防御契约自动化守卫
│   ├── validate-no-empty-files.js # 全工作区物理空文件与空包跳板守卫 (带 8KB 短路)
│   ├── validate-staged-slice.js   # AST 增量切片圈复杂度/嵌套深度/噪声比守卫
│   ├── evaluate-eloc-budget.js    # 双轨体积 ELOC<=900 / LOC<=1400 动态包络评估器
│   ├── generate-rule-catalog.js   # 400+ 规则单源目录聚合器
│   └── rule-catalog.json          # 全仓规则事实真源 (SSOT)
├── ps1/                           # PowerShell 语言域：Windows 本地交互与门禁同构实现 (7 个 .ps1)
│   ├── audit-all.ps1              # 全工作区跨项目统一审查中枢
│   ├── pre-commit-gate.ps1        # 本地提交前置门禁
│   ├── commit-msg-gate.ps1        # 提交信息结构化与风格门禁
│   ├── pre-push-gate.ps1          # 本地推送前置综合门禁
│   └── package.ps1                # 本地打包与热同步 (-HotSync)
└── sh/                            # Bash 语言域：Linux / CI 流水线同构实现与发布工具链 (15 个 .sh)
    ├── audit-all.sh               # CI / Linux 统一审查中枢
    ├── pre-commit-gate.sh         # Linux / Git Hooks 提交前置门禁
    ├── commit-msg-gate.sh         # CI 提交信息门禁
    ├── pre-push-gate.sh           # CI 推送门禁
    └── package.sh / release.sh    # 发布流与语义化版本递增 (version-bump.sh)
```

---

## 二、 三种核心脚本语言生态的工程契约

全仓跨平台脚本严格分为三种语言生态，各生态具备严谨的刚性工程契约：

```
┌────────────────────────────────────────────────────────────────────────┐
│                   三种脚本工程契约与防御指令对照                       │
├──────────────┬────────────┬─────────────┬──────────────┬───────────────┤
│ 脚本生态类型 │ 物理换行符 │ 严格防御指令 │ 工作目录隔离 │ 外部依赖原则   │
├──────────────┼────────────┼─────────────┼──────────────┼───────────────┤
│ PowerShell   │ 必须 CRLF  │ StrictMode  │ -WorkDir 显式│ 纯系统内置    │
│ Bash / Shell │ 必须 LF    │ pipefail    │ (cd ...) 子环│ 纯 POSIX/Bash │
│ Node.js      │ 必须 LF    │ 'use strict'│ 纯路径操作   │ 零外部依赖    │
└──────────────┴────────────┴─────────────┴──────────────┴───────────────┘
```

### 1. PowerShell (`.ps1`) 脚本工程契约
- **物理换行契约**：PowerShell 脚本在磁盘必须**严格保持 CRLF 换行**；
- **执行宿主与编码**：统一路由至跨平台 `pwsh`（PowerShell 7+），严禁裸调旧版 `powershell.exe`（Windows PS 5.1 解析无 BOM UTF-8 会发生乱码）；
- **严格模式与异常中断**：脚本头部必须显式声明：
  ```powershell
  Set-StrictMode -Version Latest
  $ErrorActionPreference = 'Stop'
  ```
- **工作目录显式隔离**：跨目录调用子项目流水线时，严禁使用 `Set-Location` 污染父进程，必须显式传递工作目录：
  ```powershell
  Start-Process -FilePath $npmCmd -ArgumentList "run", "test:fast" `
      -WorkingDirectory (Join-Path $repoRoot "workspace-timing") `
      -NoNewWindow -PassThru -Wait
  ```
- **沙箱安全与 Git 配置隔离**：为防止受限沙箱或 CI 容器无法读取用户根目录 `.gitconfig`，脚本头部注入默认值：
  ```powershell
  if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = 'NUL' }
  if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = 'NUL' }
  if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = '1' }
  ```

### 2. Bash / Shell (`.sh`) 脚本工程契约
- **物理换行契约**：严格保持 **LF 换行**；
- **管道安全与平铺退出码**：
  - 首行声明 Shebang：`#!/usr/bin/env bash`；
  - 严格声明 `set -uo pipefail`；
  - **禁用全局裸 `set -e`**：门禁脚本需要显式处理预期失败分支以输出详尽诊断，全域裸 `set -e` 会导致隐式暴毙并吞没上下文；
  - 预期允许失败指令必须通过平铺方式捕获退出码：
    ```bash
    STATUS=0
    npm test || STATUS=$?
    if [ "$STATUS" -ne 0 ]; then
        echo "❌ [FAIL] 测试未通过"
        exit 1
    fi
    ```
- **工作目录隔离与可移植性**：子项目切换必须使用 `(cd "<subproject>" && ...)` 子 Shell 结构，确保工作目录自动回弹；文本格式化统一使用 `printf "%s\n"` 替代不可移植的 `echo -e`。

### 3. Node.js (`.js`) 脚本工程契约
- **物理换行与缩进**：严格保持 LF 换行与 2 空格缩进；
- **零外部运行时依赖（Zero Runtime Dependencies）**：必须纯粹使用原生 Node.js stdlib（`fs`, `path`, `child_process`, `assert`），保证在未执行 `npm install` 的裸机环境下依然可无障碍运行；
- **双轨体积与复杂度刚性公理**：
  - 单函数圈复杂度 $\text{CC} \le 15$、控制流嵌套深度 $\text{Depth} \le 4$、单行噪声比 $\text{Noise} \le 4.0$；
  - 单文件有效代码行 $\text{ELOC} \le 900$、物理行 $\text{LOC} \le 1400$；
- **头部契约与严格模式**：首行呈现六字段 JSDoc，主体声明 `'use strict';`。

---

## 三、 同构双实现机制与自动化看守 (Isomorphic Architecture)

### 1. 同构双实现的必要性
在多平台团队协作中，Windows 本地开发者主要依赖 PowerShell CLI 与热同步工具，而 Linux 服务器、macOS 开发者与 GitHub Actions CI 则依赖 Bash 环境。为彻底消除跨平台行为偏差，核心脚本实施同构双实现：

| 同构脚本基名 | PowerShell 实现 | Bash 实现 | 职责定位 |
| :--- | :--- | :--- | :--- |
| `audit-all` | `scripts/ps1/audit-all.ps1` | `scripts/sh/audit-all.sh` | 全工作区跨项目统一审查中枢 |
| `pre-commit-gate` | `scripts/ps1/pre-commit-gate.ps1` | `scripts/sh/pre-commit-gate.sh` | 本地提交前置物理与复杂度门禁 |
| `commit-msg-gate` | `scripts/ps1/commit-msg-gate.ps1` | `scripts/sh/commit-msg-gate.sh` | 结构化提交信息与禁词风格门禁 |
| `pre-push-gate` | `scripts/ps1/pre-push-gate.ps1` | `scripts/sh/pre-push-gate.sh` | 推送前置全量回归与基线看守 |
| `package` | `scripts/ps1/package.ps1` | `scripts/sh/package.sh` | 扩展打包、展示资产校验与热同步 |
| `check-display-assets`| `scripts/ps1/check-display-assets.ps1`| `scripts/sh/check-display-assets.sh`| 扩展图标与展示资产合规性校验 |
| `install-hooks` | `scripts/ps1/install-hooks.ps1` | `scripts/sh/install-hooks.sh` | 仓库级 Git 钩子一键激活工具 |

### 2. 自动化同构看守 (`validate-script-isomorphism.js`)
为防范双实现发生参数或逻辑漂移，系统在统一门禁中接入了专门的同构守卫，自动验证：
1. **配对完整性**：确认 `ps1` 脚本在 `sh` 中 100% 具备同名对应实现；
2. **换行契约**：磁盘字节级确认 `ps1` 对应 CRLF，`sh` 对应 LF；
3. **防御指令**：确认双方均具备各自宿主的严格防御指令；
4. **参数一致性**：确认 `-Fast`、`-HotSync` 等核心参数双向对齐。

---

## 四、 脚本性能瓶颈与优化模型

### 1. Tier 1 内存单进程流式化 (<250ms)
- **痛点**：在 Windows 系统上，派生子进程的开销高达 80ms~250ms。若在每次 Git 提交时依次派生 6 个独立 Node 进程分别校验空文件、换行符、黑话、AST 切片等，进程初始化耗时即超过 1.5 秒；
- **优化**：将 6 大基础门禁集中于 `gate-fast-staged.js`，在**单一 Node.js 进程内单遍流式（Single-Pass Streaming）读取 Git 暂存区**，实测整体执行时间压缩至 **250ms**（纯内存判定仅 ~80ms）。

### 2. 文件遍历 Fast-Path 8KB 短路判定
- **痛点**：全仓扫描工具在遍历 2300+ 文件时，若无差别对所有文件调用 `fs.readFileSync(..., 'utf8')` 与 `.trim()`，大文件、二进制图片和长文本将引发巨量 I/O 和内存字符串分配；
- **优化**：在 `validate-no-empty-files.js` 中引入 `MAX_SUSPECT_SIZE_BYTES = 8192`。当物理文件大小 $> 8\text{KB}$ 时，其在工程常识中绝不可能是 0 字节文件、纯空白文件或 3 行跳板文件，直接跳过全文读取，**削减 90%+ 的非必要 I/O**，耗时从近 3 秒骤降至 1.4 秒（冷扫描从 38 秒降至 1 秒级）。

### 3. $O(1)$ 常数时间复杂度查找
- 禁词表匹配与规则反虚构判定全量重构为预编译 `Set.has()`，彻底根除循环体内 `Array.includes()` 带来的 $O(N \times M)$ 性能退化（消融 `PRF-ALG-002`）。

### 4. 拓扑两阶段并发调度
- 在 `audit-all.ps1` 中，第一阶段串行快速完成物理卫生与单源规则检查（耗时 ~1s），第二阶段通过 PowerShell 并发任务并行调度三大子系统（`auto-refactor`、`workspace-timing`、`WebGames`），将全仓全系统统一审查压缩至 **9 秒级**。
