# 📂 WebGames/scripts — 量化标准与自动化审查脚本库

> WebGames（卡拉尔世界引擎）专用脚本库。按**语言域**分目录（`sh/` / `ps1/` / `py/`），
> 每份脚本以**统一职能前缀**命名，文件头注明职能域与退出码语义。
> 仓库级共享脚本（打包/门禁/发布）仍在根 `scripts/`，本库只放 WebGames 自身的
> 基准测量、性能地基与自动化审查工具。命名/健壮性规范对齐根 `scripts/README.md`。

---

## 一、目录与前缀分类矩阵（语言域 × 职能域）

| 前缀 | 职能域 | 语义 | 示例 |
|------|--------|------|------|
| `bench-*` | bench | 性能基准 / 数据吞吐量测量（单次，或 N 次 sweep 取中位数消抖） | `bench-run.sh`、`bench-sweep.sh` |
| `test-*` | test | 单元测试一键运行（封装 test_runner.gd，解析断言计数输出 JSON 汇总） | `test-run.sh` |
| `audit-*` | audit | 自动化审查（声明式配置值域与完整性 / 架构护栏与领域清单自洽 / 命名风格 / 高级规范质量治理 / 简化与防过度工程化 / 硬编码 / 热路径 / 测试覆盖 / 死配置 / 密钥泄露扫描 / 物品三元组 / 上下界 / 命名键 / 文案 / 魔法维度 / 事件概率 / CDC / 信道审计 / 重构度量与十维质量健康度 / 头注释契约 / 文档四域审查 / 异步并行与切片调度） | `audit_config.py`（由 `scripts/config/value_domain_rules.json` 声明式规则驱动，彻底解耦业务表）、`audit_gd.py`（基于 `scripts/config/code_governance_rules.json` v1.1.0 审查 GDScript 4 架构规范）、`audit_script_comment.py`（Phase 75 三语言头注释七字段契约，task_id=`script_comment`）、`audit_event_channels.py`（EventBusCore 信道注册一致性，task_id=`event_channels`）、`audit_runner.py`（AUDIT_TASKS 为审计任务唯一事实源）、`audit-all.sh`+`audit-all.ps1`（一键全量门禁）、`audit-arch.sh`+`audit-arch.ps1`（桥接 `tests/arch_runner.gd` 无头 Godot 架构护栏，缺 Godot 即跳过）、`audit-refactor-metrics.sh`+`audit-refactor-metrics.ps1`（桥接 auto-refactor 静态圈复杂度、十维代码质量分与多维重构建议） |
| `check-*` | check | 前置校验（环境依赖 / Godot 全量 513 个 .gd（随新卷增长）语法单进程极速批处理门禁 / mermaid 真解析校验·可选） | `check-env.sh`、`check-gdscript.sh`、`check-mermaid.sh` |
| `package-*` | package | 无头打包与产物导出（自动化导出 PCK 资源包并计算 SHA-256 校验和） | `package-webgames.sh`、`package-webgames.ps1` |
| `report-*` | report/audit | 基线聚合 / 历史趋势 / sweep 中位数 + 回归门禁（`--gate`）/ 晋升（`--promote`） | `report_aggregate.py`、`report_sweep.py` |
| `audit-perf.*` | audit | 性能专项编排：静态热点扫描 + 回归门禁 | `audit-perf.sh` |
| `archive-*` | check/archive | 路线图工程化生命周期检测与周期归档执行器（`--detect` 巡检 / `--cycle` 满10卷周期归档 / `--reindex-keywords [--cycle-target]` 关键词提纯·默认干跑需 `--apply` 落盘 / `--self-test` 10断言自检）。业务实现收敛于 `scripts/py/archive/` 九模块包（constants 治理配置单源 / metadata / links / keywords / attachment / verify / inspect 消费 audit_docs 权威结论 / cycle / `__init__`），`archive_volume.py` 仅剩 CLI 门面 | `archive-volume.sh`、`archive-volume.ps1`、`archive_volume.py`、`archive/`（包） |
| `install-*` | check/audit | Git 预提交门禁钩子一键装配器（支持 pre-commit CLI 或原生 shell 注入） | `install-hooks.sh`、`install-hooks.ps1` |
| `timestamp` | check | 系统时间落戳（施工开始日期六刻度：早上/中午/下午/晚上/半夜/凌晨；`--full` 含时刻） | `timestamp.sh`、`timestamp.ps1` |

**强制规则**：
1. 脚本命名以**目录表达语言域**：`sh/`/`ps1/` 下一律 `kebab-case`（如 `bench-run.sh`），`py/` 下一律 `snake_case`（如 `audit_config.py`）；文件名**不带语言后缀**（`bench-run.sh` 而非 `bench-run.sh.sh`），动词开头且必须携带上表前缀之一。
2. 语言以**目录归属**表达，文件名**不带语言后缀**（`bench-run.sh` 而非 `bench-run.sh.sh`）。
3. 同名 sh/ps1 视为**同构双实现**：行为与退出码必须一致，文件头互相注明。
4. 基准报告统一输出到 `WebGames/benchmarks/reports/`；仅 golden 基线
   （`baseline.json` / `baseline.md`）入库，时间戳快照与临时/测试产物按
   `WebGames/.gitignore` 忽略。

## 二、脚本头注释模板（新脚本必须遵守 · Phase 75 契约）

> 三语言统一七字段全集：**MUST**（文件路径 / 职责）＋ **SHOULD**（职能域 / 触发方 / 用法 / 依赖 / 退出码）；
> 头块上下分隔线等宽 **78 字符**；生产注释禁止未决标记（待办/修复/存疑/临时整词）。
> 门禁：`python3 scripts/py/audit_script_comment.py`（task_id=`script_comment`，已登记 audit_runner）。

```bash
#!/usr/bin/env bash
# ==============================================================================
# <脚本名> — <一句话职责>
# 文件路径: scripts/sh/<name>.sh
# 职责: <2~5 行>——核心职责、关键契约、配置/输入来源、边界约定（幂等/退出码语义）
# -----------------------------------------------------------------------------
# 职能域：<bench|audit|check|report|archive|install|dev-util>
# 触发方：<本地 CLI / CI workflow / 定时任务>
# 用法：
#   bash scripts/sh/<script>.sh <args...>
# 依赖：<环境变量 / 外部命令（godot、python3）/ 前置脚本>
# 退出码：0=成功；1=审查不通过/业务失败；2=用法错误
# ==============================================================================
set -uo pipefail
```

PowerShell 用 `<# .SYNOPSIS / .DESCRIPTION / .EXAMPLE #>` 注释块（DESCRIPTION 内必须含「文件路径:」与「职责:」字段，并尽量补齐依赖/退出码/用法/触发方），Python 用 `#` 头注释块（同 bash 字段集，含 shebang 与 78 字符等宽分隔线），docstring 仅作模块级说明补充。

## 三、错误处理与健壮性规范

| 规则 | 要求 |
|------|------|
| 严格模式 | Bash：`set -uo pipefail`（**禁用 `set -e`**，靠退出码语义而非隐式中断） |
| 退出码语义 | `0`=成功；`1`=业务失败/审查未通过；`2`=用法错误；门禁类脚本 `0`=放行 / 非 `0`=阻断 |
| 幂等 | 可重复执行不产生副作用（报告覆盖写、探针存档用后即删） |
| 破坏性操作 | 禁止删仓库文件/`git reset --hard`；只允许清理自身产生的临时产物 |
| 日志 | 结论类输出打 `echo "【xxx】"` 标记，便于流水线/巡检检索 |
| 路径 | 一律用相对 WebGames 根目录的路径，禁止硬编码绝对路径 |

## 四、性能审查工作流（sweep → promote → gate）

1. **产报告**：`bash scripts/sh/bench-sweep.sh [--runs N]`（推荐，N 次取中位数消抖）或 `bench-run.sh`（单次）→ `bench_sweep_<时间戳>.json` + `bench_latest.json`
2. **晋升基线**（首次必需）：`python3 scripts/py/report_aggregate.py --promote` → 机器可读 golden 基线 `baseline.json`
3. **性能审查**：`bash scripts/sh/audit-perf.sh [阈值%]`（默认 10）——静态热点扫描（提示级）+ 回归门禁
   （任一指标回退超阈值即 exit 1 阻断，适合挂 CI/合入门禁）
4. **审计对比**：`python3 scripts/py/report_aggregate.py --compare <旧.json> <新.json>` 人工核对变化
5. **趋势对比**：`python3 scripts/py/report_sweep.py 基准_旧.json 基准_新.json --md` —— 多期基准中位数并排，历史漂移一目了然

### 日常回归检查（改动后）

- `bash scripts/sh/test-run.sh` —— 单元测试一键运行（JSON 汇总到 `tests/reports/`）
- `bash scripts/sh/check-gdscript.sh [--scope 收敛]` —— 全量 .gd 语法/解析门禁（`godot --check-only`）
- `bash scripts/sh/audit-all.sh` —— 静态审查全家桶（配置 / 风格 / 硬编码 / 热路径 / 测试覆盖 / 死配置 / 密钥泄露 / 头注释契约 / 信道审计等 20 项静态门禁）

## 五、文档库审查工作流（audit-docs）

面向 `docs/` 全库（**707 份 md**，随文档库持续增长；实时清单以 `--manifest` 为准）的四域静态审查：**命名**（文件/文件夹/序号族，模式声明在
`audit_docs.py` 头部 `NAMING_RULES`，为单一事实源；`docs/` 根稳定命名族含 `README.md`、`卡拉尔世界引擎开发路线图.md`、`后端代码注释规范.md`）、**布局**（H1/围栏/表格列数/表前空行/行尾空白）、
**链接**（file:/// 绝对路径、死链、锚点失效——含跨文件锚点索引与候选标题提示）、
**图表**（mermaid 节点标签未引号特殊字符，渲染必败类），以及**短期施工区细则规范**（PHASE-TITLE-FORMAT 标题格式、PHASE-STAGE-STD 四段式核心结构、PHASE-CODE-SANITY 代码块健康度）。

```bash
bash scripts/sh/audit-docs.sh                 # 审查（文本摘要，exit 1=有 error 级发现）
bash scripts/sh/audit-docs.sh --json          # JSON 报告（稳定规则 ID + suggestion 字段，Agent 直读）
bash scripts/sh/audit-docs.sh --fix           # 安全修复：六类可机械判定项原位写回（保持原 EOL）
bash scripts/sh/audit-docs.sh --fix --dry-run # 演练：只出修复计划，磁盘零写入
bash scripts/sh/audit-docs.sh --baseline benchmarks/reports/docs_baseline.json
                                              # 基线棘轮门禁：仅对超出基线的新增违规 exit 1（audit-all 已挂）
bash scripts/sh/audit-docs.sh --update-baseline benchmarks/reports/docs_baseline.json
                                              # 以当前发现收紧基线（仅限真实消化存量后，禁止用于消音）
bash scripts/sh/audit-docs.sh --rules         # 规则注册表 + 命名模式声明（JSON，Agent 契约查询口）
bash scripts/sh/audit-docs.sh --manifest      # 全库 JSONL 清单（file/档号/阶段/标题），grep 单行定位文件
bash scripts/sh/audit-docs.sh --time          # 各阶段耗时（性能巡检）
bash scripts/sh/audit-docs.sh --self-test     # 引擎夹具自测（临时目录，不触碰真实 docs）
```

**语言域 `js/`**：文档工具链专用（`validate-mermaid.mjs`：jsdom 提供 DOM + `mermaid.parse` 真解析校验，与 `audit_docs.py` 的 MERMAID-SPECIAL-CHARS 启发式互补），依赖随 `scripts/js/package.json` 声明，
安装 `npm install --prefix scripts/js`（`node_modules/` 按上层 .gitignore 不入库）；
`check-mermaid.sh` 在 node/依赖缺失时跳过（提示级），因此不阻断 CI。

**基线棘轮**：基线按（规则 × 文件）计数记录已接受存量；门禁只阻断新增违规，实现
「存量只许消化、不许增长」的增量约束。**Agent 行为契约**（改前/改中/改后 SOP 与禁止行为）
见 `docs/README.md`；性能上引擎单趟装载 + 单趟审查（fix 模式跳过冗余预检），
全库 703 份亚秒级完成，`--time` 可复核。

修复域仅限六类（mermaid 引号包裹 / file:/// 转相对链接 / 行尾空白 / `<br>` 统一 / 标题空格 / 表前空行）；
改名、死链重定向、锚点改写等需内容决策的发现**只报不修**，由 Agent 依据 JSON 的
`suggestion`（重命名建议、候选锚点标题）执行。规则 ID 稳定（`NAMING-*` / `LAYOUT-*` /
`LINK-*` / `MERMAID-*`），可直接用于 CI 注解与 Agent 任务指派。

## 六、新增脚本 Checklist

1. 确定职能域与语言域，放入对应目录（`sh/` `ps1/` `py/`）
2. 按第二节模板补全头注释
3. 遵循第三节健壮性规范（幂等 + 退出码语义）
4. 更新本文件「前缀分类矩阵」表
5. 基准/审查脚本的产出物与 `benchmarks/reports/` 目录约定保持一致
6. **审查引擎必须登记任务**（P3.1 完备性自检，2026-09-04）：`py/` 下新增 `audit-*` / `report-*` / `archive-*` 引擎文件时，须同步在 `audit_runner.py` 的 `AUDIT_TASKS` 追加一行声明式注册：

   ```python
   AuditTask(task_id="<kebab-id>", name="<一句话职责>", script_name="<引擎文件名>.py",
             default_args=[...], scopes={"gd", "config"}, group="audit")
   ```

   未登记即触发 `registry_issues` 完备性阻断（豁免仅 driver `audit_runner.py` 与共享底座 `audit_common.py`）；
   用户面 CLI 若提供 `sh/` 包装，须成对提交 `ps1/` 同构实现（`pair_parity` 门禁校验参数面）。

### 设计注记：check/test/package 族刻意不进 audit-all

`test-run.*`、`check-env.*`、`check-gdscript.*`、`check-mermaid.*`、`package-webgames.*` 等**有意不并入
audit-all**：它们或存在「编译 → 测试 → 门禁」的顺序依赖，或属打包/前置校验用途。`audit-all` 的 audit 组
仅承载 20 项**无顺序依赖的静态门禁**（bench/archive 亦须显式 `--group` 触发），以保并行调度语义不被破坏；
CI 编排需要时请显式按序调用各脚本，勿将 check/test 直接并入 audit 组。
