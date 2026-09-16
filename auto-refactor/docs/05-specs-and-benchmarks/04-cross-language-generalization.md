# 跨语言泛化审查方法与能力矩阵

> **目的**：说明本引擎如何以**同一套规则**服务不同语言、不同项目的严格审查，并给出把一个新项目接入的**标准流程与验收判据**。
> **性质**：项目无关文档——只描述引擎能力、配置边界与方法；具体项目的路径、阈值、豁免、规则交叉映射与审查结论一律留在**该项目自己的仓库**（例：`<project>/.auto-refactor/`）。
> **相关预设**：[`presets/python-strict.config.json`](../../presets/python-strict.config.json)、[`presets/typescript-strict.config.json`](../../presets/typescript-strict.config.json)。

---

## 1. 泛化模型：四层边界

| 层 | 归属 | 内容 | 判据 |
| :--- | :--- | :--- | :--- |
| 引擎 | 本仓库 `src/` | 语言适配器、分析器、规则语义与稳定规则 ID | 不得出现任何项目名、项目路径、项目专有词 |
| 语言包 | 本仓库 `src/analyzers/*` + `src/core/*Adapter` | 只按**语言**划分的能力（如 Python 现代化、Python 命名守卫、各语言适配器） | 绑定语言合法；绑定项目不合法 |
| 项目配置 | 消费方仓库（如 `<project>/.auto-refactor/config.json`） | `include`/`exclude`、层映射、阈值、规则开关、suppressions（必填 `reason`）、项目自有注释指令与词汇表 | 换项目只改这里，引擎零改动 |
| 证据 | 消费方仓库或工作区 | 该项目的审查报告、扫描产物、规则交叉映射 | 不回流进引擎仓库 |

**中立性不变量**（`npm test` 中的 `validate-project-neutrality` 自动强制）：

1. 引擎仓库的 `src/`、`scripts/`、`presets/`、`docs/` 不得出现任何已登记的项目标识符。
2. `presets/*.json` 是**语言级**预设：不得包含 `suppressions`，`include` 必须是 `**/` 开头的通配（不得是项目锚定路径）。
3. 规则行为只能由声明的选项驱动：项目专有的注释指令（`comments.options.directiveTokens`）与黑话词汇（`hygiene.options.jargonPatterns`）必须经配置注入，引擎默认集保持通用。

> 一句话验收：**新接入第 N 个语言/项目时，本仓库应当零改动。**

---

## 2. 接入一个新项目的标准流程

1. **选语言预设**：`presets/python-strict.config.json` / `presets/typescript-strict.config.json`（开启该语言适用的全部分析器，使用引擎默认阈值）。
2. **落项目配置**：在项目仓库建 `<project>/.auto-refactor/config.json`，从预设复制后叠加项目差异——`include`、层映射（`architecture.options.layers`）、阈值、suppressions（每条必填 `reason`）、项目自有指令与词汇。
3. **先只读跑一遍**：`node <engine>/dist/index.js scan --root . --config .auto-refactor/config.json --format json --out report.json --no-cache --no-daemon`。
4. **三向分诊**：把发现分为 **真信号** / **口径冲突（项目政策）** / **引擎缺口**；口径冲突用带理由的 suppression 表达，引擎缺口进本仓库的缺口清单。
5. **增量棘轮**：先对新增/改动文件设「零新增」（`--baseline` + `--baseline-granularity grouped`），存量再分批收敛。
6. **写项目侧报告**：审查结论与规则交叉映射留在项目仓库（`<project>/.auto-refactor/`），不回流引擎。

---

## 3. 能力矩阵

| 能力 | 语言无关 | 语言包 | 项目侧配置 |
| :--- | :---: | :---: | :--- |
| 注释卫生（编码损坏 / 行宽 / 分隔线 / 小文件横幅）`CMT-MOJI/WID/SEP/BAN-001` | ✅ | — | 指令词表、门禁等级 |
| 简化族（空实现 / 注释当代码 / 调试输出 / 函数长度）`SIM-*` | ✅ | — | 长度阈值、输出白名单 |
| 文档族（围栏 / 失效引用 / 重复段落）`DOC-*` | ✅（`.md`） | — | 链接豁免目标 |
| 结构卫生（死代码 / 克隆块 / 桩标记 / 命名漂移 / 黑话）`HYG-*` | ✅ | 命名守卫（Python 等） | 黑话词表、克隆阈值 |
| 复杂度 / 大文件 / 常量 / 依赖图 / 性能 / 安全 `complexity`·`large-file`·`constants`·`dependency-graph`·`performance`·`security`·`secrets` | ✅（读归一化 AST；依赖图的导入提取覆盖 TS/JS 与 Python） | 适配器负责解析 | 阈值、豁免、层级策略 |
| 治理（日志 / 调试输出 / 类型注解 / 嵌套）`GOV-*` | ✅ | — | 允许清单、阈值 |
| 架构分层 `ARCH-*` | ✅（引擎） | — | **层映射与组合根模型必须由项目声明** |
| Python 现代化 `PYM-*` | — | ✅ | 无 |
| 注释与文件头契约（六字段横幅 / 公共 API 文档） | ✅（引擎） | — | **是否启用与字段约定属项目政策** |

> 适配器清单：TypeScript/JS（typescript、oxc 双解析器）、Rust、GDScript、Python、Markdown。未接入的语言由 `unsupportedLanguage`（默认 `error`）fail-closed，杜绝「静默回退到错误解析器」的假安全。

---

## 4. 已登记的能力缺口

| # | 缺口 | 影响 | 建议 |
| :---: | :--- | :--- | :--- |
| G2 | 架构规则没有「组合根 / 应用工厂」模型 | 应用工厂注册全局依赖会被判为跨层违规 | 支持 `compositionRoots` 配置（文件/函数白名单）或在层级映射中显式声明 |
| G3 | 嵌套深度按「控制结构 + block」双计数 | 缩进语言下计数高于人类直觉约 2× | 为缩进语言改用「纯控制流深度」口径 |
| G4 | 架构层模型是 Clean/DDD 强约束 | 与「领域模型直用 ORM」类现实架构冲突 | 提供 `layerPolicy: 'clean' \| 'pragmatic'` 档位或逐规则豁免 |

> **G1 已关闭**：`dependency-graph` 现支持 Python 导入提取（模块级 `import a.b, c.d` 与 `from .pkg import name`，含 `__init__.py` 包解析与相对点号语义）。函数内惰性导入与 docstring 示例**不建边**——前者本就是用来打断循环依赖的，后者不是依赖。Python 的未使用导出仍不做（无 export 关键字，把公开 `def/class` 当导出会让路由/CLI 入口全成误报），该口径已由回归套件锁定。

---

## 5. 复核纪律（数字必须可证伪）

1. **真路径**：扫描根目录必须是真实路径；对别名/符号链接根扫描会得到 `filesScanned: 0`，不可当作「零违规」。
2. **启用面**：`simplify`、`python-modern`、`docs`、`comments`、`hygiene` 等 specialized 分析器**默认关闭**——配置不显式启用就不会运行。引擎已把这件事显式化：`summary.disabledAnalyzers` 列出全部被关闭的分析器，文本输出打印 `skipped (disabled) analyzers: …`；当扫到某语言文件而对应语言包关闭时（`.py`+`python-modern`、`.md`+`docs`）另给 `analyzer coverage:` 提示。复核时仍应确认 `summary.byAnalyzer` 出现目标分析器。
3. **真零 vs 静默跳过**：用同一配置扫描一个必然违规的合成夹具（如空实现 `.py` + 未闭合围栏 `.md`），确认对应规则确实命中，再采信该项目上的「零发现」。
4. **逐规则计数**：任何结论都附 `filesScanned` 与逐规则计数；报告产物留档于项目侧或工作区，不写入引擎仓库。

---

## 6. 引擎自审（dogfooding）

引擎用**自己的分析器审查自己**，并作为 `npm run gate` 的一环强制执行：

- `npm run gate:self`：以本仓库的 `auto-refactor.config.json`（项目政策与代码同源）扫描
  `src/**/*.ts` + `scripts/*.js`，对着 `baselines/self-scan.baseline.json`（grouped 粒度）做棘轮，
  默认只阻断**新增 error**（`--severity info|warning|error` 可调）。
- `npm run gate:self:update`：重新冻结基线（评审动作；冻结本身不阻断，否则存量错误的仓库永远无法重冻）。
- 政策不是静默忽略：本仓库的假密钥夹具、消息字面量等噪声以**带 `reason` 的 suppression**表达，
  其余存量债务进基线，新增债务必须修复或显式评审。
- 入口链：`npm run gate` = build → format:check → lint → **gate:comments** → **gate:self** → test；
  CI 的 `auto-refactor` job 直接复用该链，无需额外步骤。

> 这也是「同一套规则服务不同项目」的最强自证：引擎对自己的代码走的是与消费方**完全相同**的
> 扫描、抑制、基线与棘轮语义，没有内部后门。

### 6.1 工具链与规则的现代化基线（2026-09-15）

- **编译目标**：`target: ES2022`（Node 20 基线），并开启 `noImplicitOverride`、
  `noFallthroughCasesInSwitch`、`noImplicitReturns`、`allowUnusedLabels: false`——四条护栏各自
  只暴露 1 处真实问题，说明此前的严格模式已覆盖大部分风险面。
- **ESLint 现代化规则**（本轮起强制）：`@typescript-eslint/consistent-type-imports`（类型导入一律
  `import type`；保留本仓库刻意的懒类型注解 `import('typescript').SourceFile`）、
  `logical-assignment-operators`、`no-else-return`、`prefer-object-spread`。
  自动修复 168 处后零违规。
- **已记录的例外**：`no-explicit-any` 仍关闭（动态边界：归一化 AST / 插件契约 / 报告负载）；
  可选链规则需要 typed linting（会成倍增加 lint 时间），本轮不启用——两项都在 `eslint.config.mjs`
  写明理由，属"已决策"而非遗漏。
- **规则语义升级**：`GOV-EXC-001` 现在把**带理由标记**（`best-effort` / `ignore` / `intentional` /
  `expected`）的注释型 catch 视为已记录决策，只报无理由的静默吞异常。引擎借此把自己 56 处
  best-effort catch 全部补上理由，error 级发现 158 → 106。
