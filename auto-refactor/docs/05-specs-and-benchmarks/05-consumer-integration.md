# 05. 外部工程接入与基线棘轮指南

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：[`reportFinalizer.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/reporting/reportFinalizer.ts)、[`validate-baseline-ratchet.js`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/scripts/validate-baseline-ratchet.js)、[`validate-consumer-runner.js`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/scripts/validate-consumer-runner.js)、[`templates/consumer/run.mjs`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/templates/consumer/run.mjs)

---

## 1. 存量工程无痛接入：基线棘轮机制 (Baseline Ratchet v1.2.0)

存量大型项目在接入包含 **30 个分析器** 与 **325 条全量规则** 的严格静态重构引擎时，往往存在数百项历史遗留违规。若直接全量阻断会导致开发停滞；若关闭规则又会导致新代码继续劣变。`auto-refactor` 通过 **单向收紧基线棘轮（Monotonic Downward Ratchet）** 实现平滑演进与债务清偿：

### 1.1 棘轮信用额度消耗模型 (`baseline.json` 1.2.0)

Baseline 1.2.0 采用基于严重度直方图的分组信用机制（Grouped Baseline），记录结构为 `(analyzer, rule, file, severity)`：

| 对比场景 | 门禁裁决 | 底层判定依据与信用机制 |
| :--- | :---: | :--- |
| 某「分析器\|规则\|文件」存量记录为 $N$ 次，本次扫描出现 $N$ 次 | **通过 (PASS)** | 消耗历史 $N$ 点信用额度，`ratchetNew = 0`，不阻断日常提交 |
| 某「分析器\|规则\|文件」存量为 $N$ 次，本次扫描增至 $N+1$ 次 | **阻断 (`newBlocking`)** | 前 $N$ 次消耗历史信用，第 $N+1$ 次无信用可用，判定为新增违规 |
| 同一行新增第二条同规则同严重度违规 | **阻断 (`newBlocking`)** | 1.2.0 按直方图计数（Multiplicity），彻底杜绝借同一行逃逸门禁 |
| 历史 `warning` 违规因文件继续膨胀升级为 `error` | **阻断 (`newBlocking`)** | 低严重度信用严禁跨级抵扣高严重度违规 |
| 历史违规被修复，当前违规数降为 $N-1$ 次 | **通过 (PASS)** | 债务实际缩减，可通过 `--baseline-ratchet-down` 自动锁死新低水位 |

---

## 2. 零高危债务防线 (Zero High-Risk Technical Debt Baseline)

为了保障系统核心安全与架构生命线，基线棘轮机制内置了**零高危债务刚性防线**：

$$\text{CriticalDebt} \equiv 0, \qquad \text{HighRiskDebt} \equiv 0$$

- **不可豁免公理**：基线文件 `baseline.json` 仅允许吸收中低风险（`medium`, `low`, `info`）与代码风格/注释类技术债；
- **致命问题零容忍**：任何涉及核心密钥泄露（`SEC-LEAK-001`）、致命架构循环依赖（`ARCH-CYC-001`）、并发状态机破坏（`REC-CAS`）等 `critical` 与 `high` 严重度的缺陷，**一律禁止写入基线信用，CI 立即执行 Fail-Closed 阻断**；
- **严禁静默扩容**：任何试图扩大基线容量的行为必须显式传入 `--force-expand` 并附带架构委员会（L3A）签名审查记录。

---

## 3. 工作区兄弟工程差异化接入配置

系统在 `presets/` 中为不同业务形态提供了经过生产检验的领域预设配置：

### 3.1 `workspace-timing/`（VS Code 插件 L0~L5 全维门禁联动）

- **配置文件定位**：引用 [`presets/vscode-extension.config.json`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/presets/vscode-extension.config.json)；
- **扫描路径定义**：包含 `**/*.ts`, `**/*.js`，排除 `node_modules/**`, `dist/**`, `tests/**`；
- **核心启用分析器**：
  - `vscode-extension`：专项审查 `Disposable` 内存泄漏、主线程长任务阻塞、国际化字面量解耦；
  - `secrets`：拦截硬编码 Token、API Key 与私钥；
  - `dependency-graph`：检测模块循环引用与无用导出符号；
  - `architecture`：强制守护五层单向架构依赖：`UI -> Engine -> Storage -> Analytics -> Shared`；
  - `governance`：控制流最大嵌套深度 $\le 5$。

```json
{
  "$schema": "./node_modules/auto-refactor/config.schema.json",
  "include": ["src/**/*.ts"],
  "exclude": ["**/dist/**", "**/tests/**"],
  "analyzers": {
    "vscode-extension": { "enabled": true },
    "architecture": { "enabled": true },
    "dependency-graph": { "enabled": true },
    "secrets": { "enabled": true }
  },
  "securityLevel": "full",
  "commentLevel": "standard"
}
```

### 3.2 `WebGames/`（Godot 4.7 GDScript 游戏引擎接入）

- **配置文件定位**：引用 [`presets/godot-game.config.json`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/presets/godot-game.config.json)；
- **扫描路径定义**：包含 `**/*.gd`，排除 `addons/**`, `test/**`；
- **核心启用分析器**：
  - `gdscript-modern`：GDScript 2.0 强类型注解、静态推导与现代语法糖；
  - `gdscript-game`：
    - **循环内瞬态堆分配拦截**：强制热循环内零 `.new()` / `.duplicate()` 分配（`GME-PRF-001`）；
    - **对象池生命周期守恒**：对象池必须具备 `reset_state()` 状态清洗契约；
    - **无头领域与表现层解耦**：前端视图组件严禁直接修改游戏核心状态机，必须统一经由 `apply_snapshot()` 驱动渲染。

```json
{
  "$schema": "./node_modules/auto-refactor/config.schema.json",
  "include": ["**/*.gd"],
  "exclude": ["**/addons/**", "**/test/**"],
  "analyzers": {
    "gdscript-modern": { "enabled": true },
    "gdscript-game": { "enabled": true }
  }
}
```

---

## 4. 标准 CI 接入命令与执行模板

消费工程通过 [`templates/consumer/run.mjs`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/templates/consumer/run.mjs) 封装统一调用命令：

```bash
# 1. 增量 PR 看守：对比 baseline.json，仅拦截新增违规 (Exit 1)
node scripts/run.mjs --fail-on-severity warning --baseline .auto-refactor/baseline.json

# 2. 导出 GitHub Code Scanning 标准 SARIF 2.1.0 报告
node scripts/run.mjs --format sarif --out reports/auto-refactor.sarif

# 3. 偿还技术债务后，单向收紧锁存基线水位（自动扣减已修复条目）
node scripts/run.mjs --update-baseline .auto-refactor/baseline.json --baseline-ratchet-down
```

---

## 5. 关联文档导航

- [01. 配置模式与多格式报告契约](./01-config-and-reports.md)
- [02. 全维性能基准与原生算子加速台账](./02-performance-benchmarks.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](./07-quantified-quality-standard.md)
