# 施工细则：全域脚本库规范化重构与严格写法约束治理 —— 阶段2：PowerShell严格工程化约束与换行符治理实施

> [!NOTE]
> **【施工目标】**：对工作区全量 15 份 PowerShell 脚本（`WebGames/scripts/ps1/*.ps1` 14 份与根目录 `scripts/ps1/package.ps1` 1 份）实施严格工程化约束改造。全面治理换行符，强制统一为 CRLF（严格对齐 `AGENTS.md` 规范）；注入标头三件套（`[CmdletBinding()]`、`Set-StrictMode -Version Latest`、`$ErrorActionPreference = 'Stop'`）；排查消除潜在未初始化变量引用，统一参数强类型化与 `[ValidateSet()]` 声明；重构外部工具退出码穿透与异常阻断防线。本阶段确保在不改变各脚本原有业务 CLI 行为的前提下，实现工程健壮性飞跃。
> **【施工开始日期】：施工开始日期: 2026-09-12** —— 真实读取系统时间。
> 状态：✅ 已完成（2026-09-13 验收闭环）
> **【用户指令溯源】**：用户明确指令（2026-09-12）——「接下来审查脚本库，再次规范化，对齐已规范化的后端文件标准，同时更严格审查与对写法也进行更严格的约束，先归档后执行升级改造计划」。
> **【对应需求源】**：[路线图总索引](../../路线图总索引.md)；[AGENTS.md](../../../../../AGENTS.md)；[阶段1细则](阶段1_全域脚本盘点与标准题头及等宽分隔线规范化设计.md)。

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * `AGENTS.md` §四（命名与格式规范：`ps1 CRLF，sh/gd/md/json/py LF`）；
  * `WebGames/scripts/README.md` §二（PowerShell 健壮性防线与平台化异常处理）；
  * 阶段 1 细则《阶段1_全域脚本盘点与标准题头及等宽分隔线规范化设计.md》§1.4（等宽集中分隔结构契约）。
* **核心不变量约束断言**：
  * `Inv-P85-2-1 (CRLF 换行符硬性契约)`：全量 15 份 `.ps1` 脚本物理换行符必须 100% 转换为 CRLF，严禁单 LF 残留；
  * `Inv-P85-2-2 (标头三件套必填契约)`：全量 15 份 `.ps1` 脚本前三行必须强制包含 `[CmdletBinding()]`、`Set-StrictMode -Version Latest` 与 `$ErrorActionPreference = 'Stop'`；
  * `Inv-P85-2-3 (外部退出码严格穿透)`：执行 `godot`、`python` 或其他 CLI 后，必须显式判定 `$LASTEXITCODE`，失败必须阻断退出，严禁静默吞噬错误；
  * `Inv-P85-2-4 (参数强类型化)`：废除裸 `param()`，所有参数必须显式声明强类型（如 `[string]`, `[switch]`, `[int]`）；
  * `Inv-P85-2-5 (功能等价与行为不减)`：所有改造保证 CLI 参数面、输出报告与既有自动化构建行为完全等价。
* **防漂移最高指示**：严格坚守两轮施工机制，第一轮细则编制未经批准绝不动手改代码；严禁引入跨平台运行不兼容的 PowerShell 专有扩展，保证 Windows 与 Linux/WSL 环境均可稳定运行。

---

## 一、 PowerShell 严格工程化约束与换行符规范体系 (PowerShell Strict Engineering)

### 1.1 换行符严格收敛规范 (`AGENTS.md` 硬契约)

依据 `AGENTS.md` 规范：“`ps1 CRLF，sh/gd/md/json/py LF`”：
1. **全量 15 份 PowerShell 脚本**（`WebGames/scripts/ps1/*.ps1` 14 份、`scripts/ps1/package.ps1` 1 份）统一执行换行符向 **CRLF** 的物理转换；
2. **Bash 与 Python 脚本**（35 份 `.py`、23 份 `.sh`）确保换行符为 **LF**；
3. 将换行符断言纳入自动化门禁看守，杜绝后续编辑产生 CRLF/LF 混用。

### 1.2 PowerShell 标头三件套与安全防御契约

全量 15 份 PowerShell 脚本前三行硬性统一：

```powershell
[CmdletBinding()]
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
```

#### 严格模式下的三大防护机制：
1. **未定义变量与属性探测防御**：
   - 启用 `Set-StrictMode -Version Latest` 后，访问任何未声明变量会直接抛出异常；
   - 环境变量探测统一使用 `$env:VAR` 或 `Get-ChildItem env:VAR`，杜绝直接访问不存在的普通变量；
2. **非捕获异常阻断**：
   - 全局 `$ErrorActionPreference = 'Stop'`，发生任何原生 Cmdlet 错误直接阻断退出，严禁吞噬；
   - 需容错的特定操作使用 `try { ... } catch { ... }` 显式局部处理；
3. **外部命令退出码穿透**：
   - 外部可执行程序（如 `godot`、`python`、`git`）调用后，必须显式检查 `$LASTEXITCODE`；
   - 若 `$LASTEXITCODE -ne 0`，必须输出错误日志并显式执行 `exit $LASTEXITCODE`，杜绝外包命令报错而 PS1 脚本返回 0。

### 1.3 参数类型化与验证契约

- 废除裸 `param()` 声明；
- 所有参数必须显式声明强类型（如 `[string]`, `[switch]`, `[int]`）；
- 枚举型参数必须配置 `[ValidateSet(...)]` 校验属性，参数非法时自动阻断；
- 统一使用 PascalCase 参数命名，与同名 `.sh` 脚本的 kebab-case 选项通过 `audit_pair_parity` 双向对齐。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] `Step 2.1`：对全量 15 份 `.ps1` 脚本执行换行符转换，落地为标准 CRLF。
- [x] `Step 2.2`：在全量 `.ps1` 脚本中注入 `[CmdletBinding()]`、`Set-StrictMode -Version Latest`、`$ErrorActionPreference = 'Stop'`。
- [x] `Step 2.3`：全面排查严格模式下的潜在变量引用缺陷，消除未初始化变量读取风险。
- [x] `Step 2.4`：规范化 `param()` 块强类型修饰与 `[ValidateSet()]` 属性。
- [x] `Step 2.5`：重构外部工具调用逻辑，确保 `$LASTEXITCODE` 严格传递与显式退出。

---

## 三、 阶段交付物与验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `DOD-P85-S2-01` | 换行符 CRLF 合规 | 15 份 `.ps1` 脚本二进制读取 | 100% 包含 `\r\n`，零纯 `\n` 违规 |
| `DOD-P85-S2-02` | 严格模式覆盖 | 15 份 `.ps1` 脚本全文静态解析 | 15/15 显式声明 `Set-StrictMode -Version Latest` |
| `DOD-P85-S2-03` | 错误偏好统一 | 15 份 `.ps1` 脚本全文静态解析 | 15/15 显式声明 `$ErrorActionPreference = 'Stop'` |
| `DOD-P85-S2-04` | 脚本运行健壮性 | 逐一运行常用 PS1 脚本（`-Help` 或自检） | 在严格模式下 0 变量/属性未定义异常，执行稳定 |
