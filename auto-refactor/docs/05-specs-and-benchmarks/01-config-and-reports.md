# 01. 配置模式与多格式报告契约

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：`src/core/config/config.ts`、`config.schema.json`、`report.schema.json`、`src/core/reporters/`

---

## 1. 三层配置解析优先级 (`resolveConfig`)

`src/core/config/config.ts` 采用**声明式三层覆盖模型**，高优先级字段自动覆盖低优先级默认值：

$$\text{FinalConfig} = \text{BuiltInDefaults} \;\triangleleft\; \text{ConfigFile (`auto-refactor.config.json` / `ar.config.json`)} \;\triangleleft\; \text{CLI / ScanOptions Overrides}$$

当配置文件存在但 JSON 语法损坏（如尾随逗号、括号失配）时，引擎通过 `console.warn` 显式输出告警并回退至内置安全默认配置，绝不静默吞没配置错误。

---

## 2. 核心配置项字典 (`auto-refactor.config.json`)

| 配置键 | 类型 | 默认值 | 核心职责说明 |
| :--- | :--- | :---: | :--- |
| `include` / `exclude` | `string[]` | `["src/**/*.ts", ...]` | 标准 Glob 路径过滤（`**/` 严格匹配零或多个完整路径段） |
| `format` | `'text' \| 'json' \| 'sarif'` | `'text'` | 报告渲染格式（SARIF 严格遵循 OASIS SARIF 2.1.0 Schema） |
| `failOnIssue` | `boolean` | `false` | 当存在未抑制的 `error` 级发现时返回退出码 `1` |
| `failOnSeverity` | `'info' \| 'warning' \| 'error'` | `'error'` | 广义门禁阻断阈值（仅统计未被 `suppressions` 命中的发现） |
| `commentLevel` | `'off' \| 'basic' \| 'standard' \| 'strict'` | `'standard'` | 四档注释与文件头审计等级 |
| `securityLevel` | `'off' \| 'basic' \| 'full'` | `'basic'` | 安全与密钥扫描深度档位 |
| `autoTuneScale` | `boolean` | `true` | 是否根据项目规模自动调整弹性阈值 (`scaleTuner.ts`) |
| `classifyLiterals` | `boolean` | `true` | 启用语义字面量分类（自动豁免分隔符、编码名、HTTP 动词等良性字面量） |
| `thresholds` | `ThresholdsConfig` | 见下表 | 圈复杂度、文件行数、有效代码行、魔法数与阻塞 I/O 白名单阈值 |
| `suppressions` | `SuppressionEntry[]` | `[]` | 按 `matchFile` + `matchRule` + `reason` 精细登记的作用域豁免表 |

### 2.1 核心阈值参数 (`thresholds`)

- `magicNumberMin`（默认 `3`）：忽略 `0/1/2` 结构性偏移计数，仅拦截 $\ge 3$ 的未具名语义数值；
- `duplicateLiteralThreshold`（默认 `4`）：同一字面量重复出现达到该次数时触发提取建议；
- `fileLinesWarn` / `fileLinesFail`（默认 `400` / `900`）：物理行警告与阻断线；
- `effectiveLocWarn` / `effectiveLocFail`（默认 `800` / `1600`）：扣除注释与空行后的有效代码行（Effective LOC）阈值；
- `complexityWarn` / `complexityFail`（默认 `12` / `25`）：单函数圈复杂度警告与阻断阈值；
- `blockingIoAllowPatterns` / `allocationAllowPatterns`：允许同步 I/O 或瞬态分配的 CLI/脚本路径 Glob 白名单。

---

## 3. 多格式结构化报告契约 (`report.schema.json`)

`ScanReport` 顶层结构包含以下核心载荷：

1. `summary`：总文件数、总耗时、按严重度（`error` / `warning` / `info`）与按分析器分组计数；
2. `issues`：携带 `id` (`analyzer:rule:file:line`)、`rule`、`severity`、`message`、`location`、`suggestion`、`suppression` 的标准化诊断数组；
3. `qualityScore`：静态十维质量评分、各支柱明细与有效扣分点 (`effectivePoints`)；
4. `triPlaneQuality`：静态平面 ($S$)、动态遥测平面 ($D$)、演化反馈平面 ($F$) 的三平面融合得分；
5. `autonomy`：代码自治度指数（Code Autonomy Index, CAI）评估报告。

### 3.1 进程退出码契约 (`scanAndRender`)

| 退出码 | 含义 | 触发条件 |
| :---: | :--- | :--- |
| **`0`** | 门禁通过 (PASS) | 无达到 `failOnSeverity` 的未抑制违规 |
| **`1`** | 质量门禁阻断 (GATE HIT) | 存在未抑制的阻断级违规，或基线棘轮检测到新增信用消耗 (`newBlocking > 0`) |
| **`2`** | 运行时或配置错误 (ERROR) | 命令行参数非法、文件读取权限异常或内部引擎故障 |

---

## 4. 关联文档导航

- [05. 外部工程接入与基线棘轮指南](./05-consumer-integration.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](./07-quantified-quality-standard.md)
