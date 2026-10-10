# 01. 配置模式与多格式报告契约

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：[`config.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/config/config.ts)、[`config.schema.json`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/config.schema.json)、[`report.schema.json`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/report.schema.json)、[`reporters`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/reporters/)、[`compact-ledger-store.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/trajectory/compact-ledger-store.ts)

---

## 1. 三层配置解析优先级 (`resolveConfig`)

[`resolveConfig`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/config/config.ts) 采用**声明式三层覆盖模型**，高优先级字段自动覆盖低优先级默认值：

$$\text{FinalConfig} = \text{BuiltInDefaults} \;\triangleleft\; \text{ConfigFile (`auto-refactor.config.json` / `ar.config.json`)} \;\triangleleft\; \text{CLI / ScanOptions Overrides}$$

- **内置默认层 (`BuiltInDefaults`)**：内置 30 大分析器与 325 条注册规则的默认安全阈值与开关配置。
- **项目配置层 (`ConfigFile`)**：项目根目录下的 `auto-refactor.config.json`、`ar.config.json` 或由 `--config` 指定的文件。若 JSON 语法损坏（如尾随逗号、括号失配），引擎通过 [`Logger.warn`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/logger.ts) 显式警告并回退至安全默认值，绝不静默吞没错误。
- **命令行与 API 覆盖层 (`CLI / Overrides`)**：通过 CLI 参数（如 `--fail-on-severity`, `--analyzers`, `--format`）或编程式 [`ScanOptions`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/api.ts) 传入的即时参数，具备最高优先级。

---

## 2. 核心配置项字典 (`auto-refactor.config.json`)

系统全量内置 **30 个多语言分析器** 与 **325 条全量规则**，支持声明式 JSON 配置：

| 配置键 | 类型 | 默认值 | 核心职责说明 |
| :--- | :--- | :---: | :--- |
| `include` / `exclude` | `string[]` | `["src/**/*.ts", ...]` | 标准 Glob 路径过滤（`**/` 严格匹配零或多个完整路径段） |
| `format` | `'text' \| 'json' \| 'sarif'` | `'text'` | 报告渲染格式（SARIF 严格遵循 OASIS SARIF 2.1.0 规范） |
| `failOnIssue` | `boolean` | `false` | 当存在未抑制的 `error` 级发现时返回退出码 `1` |
| `failOnSeverity` | `'info' \| 'warning' \| 'error'` | `'error'` | 广义门禁阻断阈值（仅统计未被 `suppressions` 命中的有效发现） |
| `commentLevel` | `'off' \| 'basic' \| 'standard' \| 'strict'` | `'standard'` | 四档注释与文件头审计等级（`standard` 强制六字段模块头与 ECD-C） |
| `securityLevel` | `'off' \| 'basic' \| 'full'` | `'basic'` | 安全与密钥扫描深度档位（`off` 时彻底禁用 `security` 与 `secrets`） |
| `autoTuneScale` | `boolean` | `true` | 是否根据项目代码规模自适应缩放弹性阈值 ([`scaleTuner.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/profiler/scaleTuner.ts)) |
| `classifyLiterals` | `boolean` | `true` | 启用语义字面量分类（自动豁免分隔符、编码格式名、HTTP 动词等良性字面量） |
| `thresholds` | `ThresholdsConfig` | 见下表 | 圈复杂度、物理行数、有效代码行、重复字面量与魔法数阈值 |
| `suppressions` | `SuppressionEntry[]` | `[]` | 按 `matchFile` + `matchRule` + `reason` 精细登记的作用域豁免表 |

### 2.1 核心阈值参数真实基线 (`thresholds`)

根据 [`src/core/config/config.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/config/config.ts) 代码真源，核心阈值默认值严格定义如下：

| 阈值键名 | 默认值 | 物理量纲 | 治理目标与工程语义 |
| :--- | :---: | :---: | :--- |
| `magicNumberMin` | **`2`** | 纯标量 | 忽略 `0` 与 `1`（数组边界、自然起始），拦截 $\ge 2$ 的未具名语义魔数 |
| `duplicateLiteralThreshold` | **`3`** | 重复频次 | 同一字面量在同文件内重复出现达到 3 次即触发常量抽取建议 |
| `hardcodedStringMinLength` | **`3`** | 字符长度 | 排除单字符与超短符号，专注于具名业务字符串抽取 |
| `fileLinesWarn` | **`400`** | 物理行 (LOC) | 物理代码行警告阈值，提示开发者进行职责拆分评估 |
| `fileLinesFail` | **`1400`** | 物理行 (LOC) | 物理代码行阻断阈值，超出直接触发阻断性违规 |
| `effectiveLocWarn` | **`750`** | 有效代码行 (ELOC) | 排除注释与空行后的净有效代码行警告阈值 |
| `effectiveLocFail` | **`900`** | 有效代码行 (ELOC) | 净有效代码行阻断阈值，严格限制单文件信息熵承载上限 |
| `complexityWarn` | **`10`** | 圈复杂度 (CC) | 函数圈复杂度预警线，建议引入卫语句与策略表分发 |
| `complexityFail` | **`20`** | 圈复杂度 (CC) | 函数圈复杂度阻断线，严禁提交超高认知负担的代码块 |
| `fileFunctionsWarn` | **`15`** | 函数数量 | 单文件声明函数数量预警线，识别过载模块 |
| `maxNestingDepth` | **`5`** | 嵌套层深 | 控制流最大嵌套深度阻断阈值 |

---

## 3. 多格式结构化报告契约 (`report.schema.json`)

引擎产出的 [`ScanReport`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/types.ts) 顶层结构包含以下标准化核心载荷：

```json
{
  "$schema": "./report.schema.json",
  "summary": {
    "filesScanned": 128,
    "issuesTotal": 4,
    "bySeverity": { "error": 0, "warning": 3, "info": 1 },
    "byAnalyzer": { "constants": 2, "complexity": 1, "comments": 1 },
    "executionTimeMs": 248.5
  },
  "issues": [
    {
      "id": "constants:duplicate-literal:src/engine.ts:42",
      "analyzer": "constants",
      "rule": "duplicate-literal",
      "severity": "warning",
      "message": "Literal string appears 3 times; consider extracting constant.",
      "location": {
        "file": "src/engine.ts",
        "start": { "line": 42, "column": 15 },
        "end": { "line": 42, "column": 28 }
      },
      "suggestion": "const RETRY_LIMIT_KEY = 'retry-limit';",
      "actionable": {
        "action": "extract_constant",
        "code": "AR:CONST:001",
        "safeToAutomate": true
      }
    }
  ],
  "qualityScore": {
    "compositeScore": 94.2,
    "grade": "A",
    "indices": { "architectureConsistency": 96.0, "codeSecurity": 99.8, "performanceEfficiency": 92.5 },
    "coverage": 1.0,
    "pillars": { "architecture": 96.0, "security": 99.8, "performance": 92.5 }
  },
  "triPlaneQuality": {
    "staticScore": 94.2,
    "dynamicScore": 91.0,
    "feedbackScore": 88.5,
    "totalScore": 92.4,
    "weights": { "Ws": 0.55, "Wd": 0.30, "Wf": 0.15 }
  },
  "autonomy": {
    "compositeAutonomyIndex": 92.45,
    "grade": "L4_HIGH_AUTONOMY",
    "dimensions": {
      "effectiveLocAutonomy": 98.2,
      "symbolCallAutonomy": 89.4,
      "domainKernelDensity": 86.1,
      "codeOriginality": 95.0,
      "supplyChainResilience": 91.2,
      "criticalPathAutonomy": 94.0
    },
    "confidence": {
      "sampleSufficiency": 0.942,
      "credibleScore": 92.1,
      "lowerBound": 89.85,
      "upperBound": 94.35,
      "isLowConfidence": false
    }
  }
}
```

### 3.1 进程退出码契约 (`scanAndRender`)

| 退出码 | 含义 | 触发条件 |
| :---: | :--- | :--- |
| **`0`** | 门禁通过 (PASS) | 无达到 `failOnSeverity` 的未抑制违规，基线棘轮未检测到新增违规 |
| **`1`** | 质量门禁阻断 (GATE HIT) | 存在未抑制的阻断级违规，或基线棘轮检测到新增违规信用透支 (`newBlocking > 0`) |
| **`2`** | 运行时或配置错误 (ERROR) | 命令行参数非法、文件读取权限异常或内部引擎故障 |

---

## 4. 重构演进紧凑账本格式 (`.refactor-trajectory/`)

为记录长期重构轨迹与 ELOC 演进，系统通过 [`compact-ledger-store.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/trajectory/compact-ledger-store.ts) 维护有界轻量账本：

### 4.1 单行 NDJSON 紧凑记录契约

每个审查或重构批次持久化为一行 NDJSON 记录，**严格保证体积 $< 350\text{ 字节}$**，时间戳严格遵循 `*Ms` 物理量纲：

```json
{"t":1791215846846,"rev":"c8158eba","id":"run-042","mod":"core-scorer","agent":"agent-refactor","eloc":{"proc":1250,"uniq":1180,"chg":120,"sem":85,"reloc":25,"cosm":10},"score":{"bef":88.2,"aft":94.5,"vec":[96.0,99.8,92.5],"qed":0.0525},"debt":{"add":0,"res":15,"reg":0},"gate":{"pass":true,"code":"PASS"}}
```

- **字段权威规范**：
  - `t`: 审查执行纪元毫秒时间戳（`timestampMs`，物理量纲保证精度）；
  - `rev`: Git Short SHA 校验散列（8 位）；
  - `id`: 运行实例唯一标识（截断至 12 字符内）；
  - `mod`: 目标模块或领域标识（截断至 12 字符内）；
  - `agent`: 执行 Actor 或 Agent 唯一标识（截断至 12 字符内）；
  - `eloc`: 四层正交有效代码行计数器（`proc` 处理行, `uniq` 独立行, `chg` 变动行, `sem` 语义行, `reloc` 重定位行, `cosm` 装饰行）；
  - `score`: 重构前后质量得分与向量（`bef` 前分, `aft` 后分, `vec` 核心维度向量, `qed` 质量效率导数）；
  - `debt`: 技术债务变动点数（`add` 新增技术债, `res` 偿还技术债, `reg` 回归违规数）；
  - `gate`: 门禁裁决结果（`pass` 是否放行, `code` 裁决标识码）。

### 4.2 滚动窗口与两级聚合淘汰

- **活动滚动窗口 (`DEFAULT_MAX_ROLLING_RUNS = 100`)**：`active.ndjson` 仅保留最近 100 轮运行记录，超过则自动触发增量归档；
- **周度聚合账本 (`weekly.json`)**：按自然周统计各 Agent 的净重构行数、净技术债偿还趋势与门禁通过率；
- **终生演化摘要 (`lifetime.json`)**：持久化工程终生累计代码净化总量、架构熵减趋势与全生命周期 ROI。

---

## 5. 关联文档导航

- [02. 全维性能基准与原生算子加速台账](./02-performance-benchmarks.md)
- [05. 外部工程接入与基线棘轮指南](./05-consumer-integration.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](./07-quantified-quality-standard.md)
