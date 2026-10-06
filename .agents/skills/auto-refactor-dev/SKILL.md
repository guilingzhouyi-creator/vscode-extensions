---
name: auto-refactor-dev
description: >-
  auto-refactor 静态分析重构引擎、Rust+TS 双轨内核与 Praxis 客户端 SDK 开发规范。指导 Agent 在
  auto-refactor 项目中维护 27 内置分析器与 304 条规则体系、保证 Rust 算子与纯 TS 桥接 100% 字节等价、
  落实 Praxis SDK 调用范式、一体两面三层拓扑 Diff 引擎、AgentDirectives 结构化协议、高精度时间戳与暂存分流原子落盘。
---

# auto-refactor-dev — 静态重构引擎与双轨算子开发规范

本技能规范了 `auto-refactor/` 静态代码分析与治理引擎的核心架构原则、双轨算子等价性约束、27 个内置分析器与 304 条规则治理体系、Praxis 客户端 SDK 调用范式、一体两面三层拓扑 Diff 引擎、AgentDirectives 结构化指令协议、高精度时间戳规范以及暂存分流原子落盘机制。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新增或修改静态代码分析器**（27 个内置分析器，位于 `src/analyzers/*.ts`）；
2. **注册或调整规则元数据**（304 条内置规则，位于 `src/core/rules/` 与 `src/core/scoring/dimensionRuleTable.ts`）；
3. **开发 Rust N-API 原生算子或更新纯 TS Shim 回退实现**（`crates/` 与 `src/core/native/`）；
4. **调用或扩展 Praxis 审查客户端 SDK**（`IPraxisReviewClient`、`createPraxisClient`、`src/core/praxis/`）；
5. **维护一体两面三层拓扑 Diff 引擎或 AgentDirectives 协议**（`diff-topology.ts`、`agent-directives.ts`）；
6. **调整 AST 局部切片或 Sparse MoE 路由器**（`src/core/ast/`、`src/core/router/`）；
7. **维护质量模型、基线自审复用、演化轨迹账本或高精度时间戳/暂存落盘逻辑**。

---

## 二、 六层技术架构与 Rust+TS 双轨内核等价性

`auto-refactor` 采用 TypeScript 调度编排与 Rust N-API 原生算子内核结合的双轨架构：
- **L1 原生算子层**：`crates/auto-refactor-core` 与 `crates/ops-{diff,graph,pattern,mask,clone}`；
- **L2 语法与语义层**：`NormalizedNode` 统一语法树与 `SemanticGraph` 跨语言（8 种语言）图底座；
- **L3 规则与分析器**：27 个内置分析器与 304 条规则金字塔治理体系；
- **L4 调度与快轨**：Sparse MoE 变更熵密门禁路由器与 `<10ms` AST 切片快轨；
- **L5 质量度量平面**：静态（10 支柱）+ 动态证据 + 演化（CAI 指数）；
- **L6 Praxis 交付层**：统一客户端 SDK、多 Agent 冲突仲裁、轨迹配方学习与级联回滚。

### 刚性等价性铁律：
Rust 原生算子（64-bit SWAR 向量化扫描、Bit-Parallel Myers 差分、Tarjan SCC / 支配树、词法脱敏状态机、MinHash+LSH）与纯 TypeScript 回退实现（`src/core/native/*-shim.ts`）在输出数据结构、行号平移、哈希值以及错误边界上必须保持 **100% 语义与字节等价**，受 `scripts/validate-native-parity.js` 与 `scripts/validate-equivalence.js` 持续看守。

---

## 三、 27 内置分析器与 304 规则金字塔体系

### 1. 27 个内置分析器全景清单
所有分析器均统一在 `src/core/analyzer-registry.ts` 的 `BUILTIN_FACTORIES` 与 `BUILTIN_MODULE_PATHS` 中显式登记，支持单进程调度与 Worker 多线程并行实例化：

| 分类 | 分析器名称 (`AnalyzerId`) | 核心职责与检测范围 |
| :--- | :--- | :--- |
| **基础与卫生** | `constants` | 硬编码魔法字面量提取、常量集中化与免检作用域判定 |
| | `large-file` | 单文件双轨代码行（ELOC/LOC）与物理包络超限检测 |
| | `complexity` | 控制流嵌套深度（Depth <= 4）与函数圈复杂度（CC <= 15）抑制 |
| | `comments` | 无效注释、废弃代码段、TODO 漂移与注释代码比率分析 |
| | `hygiene` | 物理空文件、尾随空白符、行尾序列与跨平台换行守卫 |
| | `naming` | 符号命名风格、保留前缀、抽象泄露与命名语义一致性 |
| | `simplify` | 冗余条件分支、无效三元运算符与逻辑表达式平铺 |
| **架构与拓扑** | `architecture` | 门面模式承载、分层依赖单向性、跨层透传与不可变封装 |
| | `data-architecture` | 实体模型解耦、查询下沉、无状态服务与数据边界治理 |
| | `dependency-graph` | 模块循环依赖（Tarjan SCC 强连通分量）、扇入扇出失衡分析 |
| | `dependency-layout` | 目录结构依赖拓扑、孤岛模块识别与物理路径组织合理性 |
| | `gate-architecture` | 门禁分流规范、子进程上下文隔离、脚本探测深度约束 |
| **安全与治理** | `secrets` | 高熵密钥、API Token、硬编码凭证与脱敏状态机 |
| | `security` | 动态代码执行（eval/Function）、反序列化漏洞与注入防范 |
| | `governance` | 工作区协议契约、单源规则引用核验与黑话拦截 |
| **性能与现代性** | `performance` | 循环内瞬态堆分配、昂贵正则、高频对象浅拷贝与内存泄漏 |
| | `test-modernity` | 单元测试现代断言、覆盖率契约、TAU/EMTD/CBCR 指标 |
| | `stdlib` | 现代标准库 API 替换过时废弃工具与原生算子优先 |
| | `docs` | API 文档契约完备性、JSDoc/Docstring 真实性与同步性 |
| **语言与生态** | `ts-modern` | TypeScript 现代语法（satisfies、const 类型参数、类型收窄） |
| | `python-modern` | Python 3.12+ 模式匹配、类型提示、生成器与上下文管理器 |
| | `rust-modern` | Rust 所有权范式、生命周期标注、零拷贝与错误处理惯例 |
| | `go-modern` | Go 泛型、通道缓冲、goroutine 泄漏防范与上下文传递 |
| | `shell-lint` | Shell/Bash 脚本严谨性、pipefail 标志与变量引用引号闭合 |
| | `gdscript-modern` | GDScript 4 静态类型推断、注解规范与节点引用安全 |
| | `gdscript-game` | 游戏循环（_process/_physics_process）性能与节点树拓扑 |
| | `vscode-extension` | VS Code 扩展生命周期、Disposable 资源释放与 UI 线程解耦 |

### 2. 四层规则金字塔治理 (304 条内置规则)
- **Layer 1（通用基础）**：格式、命名、注释、死代码、物理卫生；
- **Layer 2（工程架构）**：分层依赖、门面承载、不可变封装、数据解耦；
- **Layer 3（语言进阶）**：TS/Rust/Python/Go/GDScript 现代特性、资源安全；
- **Layer 4（演化自治）**：代码自治度（CAI）、重构收益判定（ROI）、防刷分去抖。

### 3. 命名规范与扣分预算红线
- **规则 ID 规范**：遵循 Canonical 格式 `FAMILY-TOPIC-NNN`（如 `ARCH-FAC-001`、`GATE-AST-001`、`ADV-PRF-002`）；
- **单源登记**：新增规则必须在 `src/core/rules/` 导出，在 `src/core/scoring/dimensionRuleTable.ts` 绑定权重，并同步在 `scripts/common/rule-catalog.json` 全局真源中完成注册；
- **单 Finding 扣分预算红线**：单个 Finding 扣分维度上限严格受限：$$\text{AxesPerFinding} \le 4$$ 严禁单一违规向全维度大面积滥扣分。

---

## 四、 Praxis 客户端 SDK (`IPraxisReviewClient` / `createPraxisClient`)

Praxis 客户端 SDK 是面向多智能体协同、CI 门禁与开发者工具的统一高级调用门面（位于 `src/core/praxis/`），通过强类型接口解耦底层 AST 扫描细节：

### 1. 客户端初始化与工厂
通过 `createPraxisClient` 构造统一客户端实例，支持注入自定义语义图、路由器或任务卡上下文：
```typescript
import { createPraxisClient, IPraxisReviewClient } from 'auto-refactor';

const client: IPraxisReviewClient = createPraxisClient({
  root: process.cwd(),
  enableMoE: true,
  includeDualFacedPresentation: true,
  defaultLocale: 'zh-CN',
  defaultCardContext: {
    cardId: 'CARD-1024',
    cellId: 'CELL-REFACTOR-01',
    agentUid: 'agent-worker-42',
    checkpointId: 'chk-d3f030a'
  }
});
```

### 2. 核心调用 API
客户端提供四个一等公民方法：
1. **`reviewWorkspace(options?: PraxisWorkspaceReviewOptions): Promise<PraxisWorkspaceReviewVerdict>`**
   执行全工作区全量或过滤分析，输出 `scanReport`、`status`、`issues`、`agentDirectives` 与 `directivesMarkdown`。
2. **`reviewFile(filePath: string, content?: string, options?: PraxisFileReviewOptions): Promise<PraxisFileReviewVerdict>`**
   针对单文件执行 AST 切片与 Sparse MoE 条件路由器审查，输出单文件判定 `verdict`、`sparsePlan` 与机器指令。
3. **`reviewDiff(input: DiffInput, options?: PraxisGovernanceOptions): Promise<PraxisDiffGovernanceResult>`**
   执行代码变更的语义化审查，生成三层拓扑 Diff、反向依赖影响闭包、8 支柱补丁质量评分与标准统一补丁。
4. **`evaluateMergeGate(sourceBranch: string, targetBranch: string, hunks: ReviewDiffHunk[]): Promise<PraxisMergeGateVerdict>`**
   在分支合并与 Pull Request 阶段评估合并门禁不变量，输出 `approved`、`violations` 与一体两面 Diff。

---

## 五、 一体两面三层拓扑 Diff 引擎

Diff 治理子系统（`src/core/praxis/diff-topology.ts`）实现了机器代理（Agent Face）与人类审查（Human Face）100% 数据对称的“一体两面”，并通过“三层拓扑”对变更进行深度解剖：

### 1. 一体两面对称表达 (Dual-Faced Diff)
- **Agent Face (`DiffAgentFace`) — 机器可执行**：
  - 携带精确 AST 作用域（`enclosingSymbol`、`scopeRange`、`symbolKind`）；
  - 行号精确映射（`exactLineOffsets`，区分 `context`/`insert`/`delete`）；
  - 确定性补丁指令（`deterministicHunkId`、`patchDirective`）与代码切片（`codeSlice`）。
- **Human Face (`DiffHumanFace`) — 人类与 UI 友好**：
  - 决策徽章（`decisionBadge`，携带 `red`/`yellow`/`blue`/`green` 状态）；
  - 双语字典与本地化描述（`i18nMessage` 支持 `zh-CN` 与 `en` 双语对齐）；
  - 视觉呈现（折叠层级 `foldingLevel`、语法高亮类别 `visualHighlight`）；
  - 审查动作建议（`suggestedReviewAction`: `accept` | `auto_fix` | `rework` | `escalate_l3a` | `reject`）与质性依据 `rationale`。

### 2. 三层拓扑结构 (Three-Tier Topology)
1. **Layer 1: Build Execution Unit Diff (`DiffLayer1BuildUnit`)**
   关注物理代码行变更量、增删改统计、变更行号列表与基础 AST 节点映射（`DiffAstNodeMapping`），供执行智能体进行局部重构与语法自愈。
2. **Layer 2: Review Cell Diff (`DiffLayer2ReviewCell`)**
   利用 `SemanticGraph` 计算反向依赖影响闭包、依赖传播路径（`SemanticPropagationNode`）、跨模块架构契约冲突（`DiffContractConflict`）以及质性验证建议清单。
3. **Layer 3: Conflict & High-Risk Diff (`DiffLayer3ConflictRisk`)**
   高危与冲突阻断层：
   - 跨层依赖违规（`DiffCrossLayerRisk`）；
   - 破坏性改动（`DiffDestructiveRisk`，如大面积删除 $\ge 50$ 行且比例超标、公开 API 移除）；
   - 循环内瞬态堆分配风险（`DiffLoopAllocationRisk`，循环内闭包、字面量分配）；
   - 未解决的 Git 冲突标记（`DiffConflictMarker`）；
   - 触发一票熔断与专家升级仲裁（`shouldEscalateToL3A`）。

### 3. Unified Patch 输出
通过 `toAgentUnifiedPatch()` 与 `formatUnifiedDiff()` 生成与标准 `git apply` 100% 兼容的补丁文本，供自主 Agent 直接执行无损回放与原子落盘。

---

## 六、 AgentDirectives 结构化指令协议

为实现静态分析结果到 AI Agent 的机器可执行闭环，引擎输出符合 CAPP 规范的 `AgentDirectivesBundle`：

```typescript
export interface AgentDirectivesBundle {
  items: AgentDirectiveItem[];          // 结构化指令条目
  compactPromptText: string;             // 适合注入单次 Prompt 的超紧凑 CAPP 文本
  renderedMarkdown: string;              // 人类与 LLM 易读的格式化 Markdown
  presentationPayload?: PraxisPresentationPayload; // 前端诊断卡片
  summary: {
    total: number;
    blockCount: number;
    warnCount: number;
    infoCount: number;
  };
}
```

每条 `AgentDirectiveItem` 包含规则 ID、违规级别、物理行列、自动化安全标记（`safeToAutomate`）、推荐动作（`action`）、分类标签（`taxonomy`）以及开箱即用的修复代码模板（`templateSnippet`）。

---

## 七、 高精度时间戳规范与暂存分流原子落盘

### 1. 高精度时间戳命名契约 (*Ms)
- 测量与调度中所有时间字段必须以 `*Ms` 结尾，显式声明毫秒物理量纲，如：
  - `parseStartTimeMs`：AST 解析起始毫秒时间戳；
  - `startMs` / `endMs`：会话或扫描区间时间戳；
  - `durationMs`：任务执行耗时；
- **严禁使用**：`time`、`ts`、`startTime` 等缺失时间量纲与语义上下文的模糊缩写。

### 2. 暂存路径精确语义分流
- **`stagingPath`**：存放完整未压缩构建、完整代码切片或分析阶段产物的标准暂存目录；
- **`compactStagingPath`**：存放脱敏、去冗余、紧凑 NDJSON 或规格化折叠产物的专用暂存路径；
- **严禁命名**：模糊使用 `tmp`、`stage`、`tempDir` 等含义不明的目录标识。

### 3. 暂存原子落盘原则 (Atomic Rename)
为保证并发环境与系统意外崩溃下的数据零损坏：
1. 数据先完整写入专属暂存文件（位于 `stagingPath` 或 `compactStagingPath`）；
2. 完成校验和（Checksum）或文件尺寸与格式核验；
3. 执行原子重命名操作（`fs.renameSync`）替换目标文件，彻底消除半写（Torn Write）与脏读风险。

---

## 八、 基线自审报告复用机制与增量切片快轨

1. **消除无谓重复开销**：全仓全量自审（`runSelfAudit()`）涉及 27 个分析器与 304 条规则遍历，执行耗时约 14s。在常规门禁与增量校验时，禁止重复运行全量 `runSelfAudit()`；
2. **基线报告快照复用**：
   - 优先读取已生成的基线自审报告快照（`.refactor-cache/baseline-self-audit.json`）；
   - 校验流程仅对暂存区增量文件执行 AST 局部切片比对与差分分析，将增量审计时间压缩在 100ms 以内；
3. **缓存失效与强制重建条件**：
   - 当检测到底层规则定义（`src/core/rules/`）、分析器实现（`src/analyzers/`）或原生算子（`crates/`）发生文件变更时，自动触发基线报告全量重建；
   - 允许显式传递 `--force-audit` 参数强制刷新基线报告。

---

## 九、 项目中立性守卫与零孤儿单测契约

1. **项目中立性守卫 (`validate-project-neutrality.js`)**：
   - `auto-refactor` 定位为通用多语言分析与治理引擎，分析器代码中严禁写入特定业务仓库路径（如硬编码某个业务子项目名或专属目录路径）；
   - 若需针对特定框架（如 Godot 或 VS Code 扩展）进行分析，必须通过探测标准配置标记（如 `project.godot` 或 `vscode` 依赖）进行通用架构特征推断（Archetype Context）。
2. **测试防孤儿纳管契约**：
   - 新增验证脚本（`scripts/validate-*.js`）必须在 `scripts/test-parallel.js` 或串行测试列表中显式登记；
   - 运行全量测试时，未纳管脚本将被 `validate-suite-manifest.js` 判定为孤儿脚本并一票阻断。

---

## 十、 三平面质量模型与长期演化账本 (CAI 2.0)

1. **静态度量平面**：十维质量模型（格式纯净度、类型健全度、架构拓扑度、认知复杂度等），采用倒数型密度饱和曲线与短板加权模型；
2. **从 0 客观统计原则**：
   - 符号调用统计必须从 0 累加，严禁对内部调用引入倍率乘数或保底加分；
   - 外部 SDK 调用必须基于全局 AST 符号索引（`symbolIndex`）获取真实交叉调用点频次，杜绝简单正则匹配；
3. **主流严谨贝叶斯统计数学模型**：
   - 废除写死固定常数的误差区间；
   - 采用经典无信息 Jeffreys 先验 $\text{Beta}(0.5, 0.5)$ 的二项分布共轭后验推断：
     $$\alpha = 0.5 + k, \quad \beta = 0.5 + (n - k)$$
   - 基于后验方差 $\text{Var}(\theta) = \frac{\alpha \beta}{(\alpha+\beta)^2(\alpha+\beta+1)}$ 动态计算 95% 贝叶斯可信区间 $[ \mu - 1.96\sigma, \mu + 1.96\sigma ]$；
4. **分层滚动持久化**：
   - 质量轨迹持久化存储至 `.refactor-trajectory/`，采用紧凑 NDJSON 格式（单条记录 $<350\text{B}$）；
   - 长期总空间预算约束在 $\le 2\text{MB}$，自动按周期滚动压缩与归档。

---

## 十一、 静态分析器上下文感知与假告警抑制规范

1. **基于文件角色（FileRole）的语义免检**：
   - 测试套件（`test_suite`、`*.test.*`、`*.spec.*`）豁免字面量和魔法数字抽取规则，保护单测断言清晰度；
   - 国际化字典文件（`i18n`、`locales`、`zh-CN.json` 等）豁免硬编码字符串抽取，字典本身即常量真源；
2. **运行时调用上下文白名单**：
   - 日志打印（`console.*`、`logger.*`）与异常抛出（`new Error(...)`）入参字符串自动跳过常量提取；
   - 复杂分析器内部必须将大函数提取为高内聚辅助函数，确保圈复杂度 $\text{CC} \le 12$。

---

## 十二、 专属构建、测试与门禁命令矩阵

在 `auto-refactor` 目录中作业时，遵循以下执行步骤：

```bash
# 进入项目目录
cd auto-refactor

# 1. 编译 TypeScript 源码至 dist/
npm run build

# 2. 运行本地轻量快速门禁（语法、命名、跳板与中立性检查）
npm run gate

# 3. 运行全量自测套件（140+ 专项校验套件并发执行，支持基线复用）
npm test

# 4. 执行多维基准性能评测
npm run benchmark
```
