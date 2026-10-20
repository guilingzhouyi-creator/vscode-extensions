---
name: auto-refactor-dev
description: >-
  auto-refactor 静态分析重构引擎、Rust+TS 双轨内核与 Praxis 客户端 SDK 开发规范。指导 Agent 在
  auto-refactor 项目中维护 30 内置分析器与 359 条规则体系，看守 Rust 与 TS 100% 字节等价、
  四阶段流水线拓扑、一体两面 Diff 引擎、名义量纲烙印与高精度暂存落盘规范。
---

# auto-refactor-dev — 静态重构引擎与双轨算子开发规范

本技能规范了 `auto-refactor/` 静态代码分析与治理引擎的核心架构原则、双轨算子等价性约束、30 个内置分析器的四阶段流水线拓扑（Stage 0~3）、359 条规则治理体系（155/155 套测试）、Praxis 客户端 SDK 与表现层语义聚合引擎、一体两面三层拓扑 Diff 引擎、高精度时间戳规范、暂存分流原子落盘以及 12 项热路径与内存治理范式。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新增或修改静态代码分析器**（30 个内置分析器，位于 `src/analyzers/*.ts`）；
2. **注册或调整规则元数据**（359 条内置规则，位于 `src/core/rules/` 与 `src/core/scoring/dimensionRuleTable.ts`）；
3. **开发 Rust N-API 原生算子或更新纯 TS Shim 回退实现**（`crates/` 与 `src/core/native/`）；
4. **调用或扩展 Praxis 审查客户端 SDK**（`IPraxisReviewClient`、`createPraxisClient`、`src/core/praxis/`）；
5. **维护一体两面三层拓扑 Diff 引擎或 AgentDirectives 协议**（`diff-topology.ts`、`agent-directives.ts`）；
6. **优化 AST 局部切片、治理扫描器热路径或 Sparse MoE 路由器**（`src/core/ast/`、`src/core/governance/`、`src/core/router/`）；
7. **维护质量模型、基线自审复用、演化轨迹账本或高精度时间戳/暂存落盘逻辑**。

---

## 二、 六层技术架构与 Rust+TS 双轨内核等价性

`auto-refactor` 采用 TypeScript 调度编排与 Rust N-API 原生算子内核结合的双轨架构：
- **L1 原生算子层**：`crates/auto-refactor-core` 与 `crates/ops-{diff,graph,pattern,mask,clone}`；
- **L2 语法与语义层**：`NormalizedNode` 统一语法树与 `SemanticGraph` 跨语言（8 种语言）图底座；
- **L3 规则与分析器**：30 个内置分析器与 359 条规则金字塔治理体系；
- **L4 调度与快轨**：Sparse MoE 变更熵密门禁路由器与 `<10ms` AST 切片快轨；
- **L5 质量度量平面**：静态（10 支柱）+ 动态证据 + 演化（CAI 指数）；
- **L6 Praxis 交付层**：统一客户端 SDK、多 Agent 冲突仲裁、轨迹配方学习与级联回滚。

### 刚性铁律与架构公理：
1. **Rust+TS 双轨内核等价性铁律**：
   Rust 原生算子（64-bit SWAR 向量化扫描、Bit-Parallel Myers 差分、Tarjan SCC / 支配树、词法脱敏状态机、MinHash+LSH）与纯 TypeScript 回退实现（`src/core/native/*-shim.ts`）在输出数据结构、行号平移、哈希值以及错误边界上必须保持 **100% 语义与字节等价**，受 `scripts/validate-native-parity.js` 与 `scripts/validate-equivalence.js` 持续看守（详见 [rust-ts-equivalence-protocol.md](references/rust-ts-equivalence-protocol.md)）。
2. **项目中立性刚性公理 (Project Neutrality Axiom)**：
   `auto-refactor` 是纯粹跨语言中立、项目中立的通用静态代码重构与治理引擎，**绝对严禁绑定任何特定外部项目**。核心分析器、规则体系与原生算子严禁硬编码外部特定业务项目的私有路径（如 `WebGames/` 或 `workspace-timing/` 的具体业务模块名）或特定业务常量。所有特定技术栈规则必须且仅能通过探测行业标准配置指纹（如 `project.godot`、`package.json` 中的标准依赖、`go.mod`）推断泛化原型环境（`Archetype Context`），并由 `validate-project-neutrality.js` 门禁执行一票否决。

---

## 三、 30 内置分析器与四阶段流水线拓扑

### 1. 四阶段分析器流水线拓扑 (Stage 0 ~ Stage 3)
引擎的 30 个内置分析器统一在 `src/core/analyzer-registry.ts` 登记，严格按 Stage 0 至 Stage 3 拓扑分层调度：

| 流水线阶段 | 分析器名称 (`AnalyzerId`) | 核心职责与检测范围 | 阶段计算特征 |
| :--- | :--- | :--- | :--- |
| **Stage 0: 物理底线与紧急安全** | `hygiene`, `shell-lint`, `large-file`, `secrets`, `security` | 空文件/换行守卫、Shell 严谨性、双轨代码行超限、高熵密钥脱敏、动态执行与注入防范 | 纯文本/字节流扫描；毫秒级短路中断 |
| **Stage 1: 文本规范、词法符号与文档** | `comments`, `naming`, `constants`, `docs`, `production-hygiene` | 注释契约/ECR、符号命名风格、魔法字面量提取、JSDoc 同步性、测试泄露与调试残留拦截 | 词法 Token 状态机流式处理；无需全 AST |
| **Stage 2: 单文件语法 AST 与语言现代化** | `simplify`, `complexity`, `stdlib`, `ts-modern`, `python-modern`, `rust-modern`, `gdscript-modern`, `go-modern`, `frontend` | 逻辑平铺、圈复杂度（$\text{CC}\le 15$）与嵌套深度（$\text{Depth}\le 4$）、现代标准库与多语言现代语法惯例、组件解耦 | 单文件 AST 与控制流图；`<10ms` 局部切片 |
| **Stage 3: 领域架构契约与全工程拓扑** | `performance`, `architecture`, `data-architecture`, `dependency-layout`, `dependency-graph`, `gate-architecture`, `gdscript-game`, `vscode-extension`, `client-exposure`, `test-modernity`, `governance` | 循环零堆分配、门面实质承载、数据解耦、Tarjan 环路检测、门禁工作目录隔离、游戏循环/扩展生命周期、测试现代性、单源规则核验 | 跨文件 `SemanticGraph`；Tarjan SCC 与支配树分析 |

### 2. 四阶段有序装配与调度的工程意义
- **三位一体单源对齐**：`analyzer-registry.ts`、`config/config.ts`、`router/sparseRuleRouter.ts` 严格按 Stage 0~3 单调有序装配；
- **快速短路熔断 (Fail-Fast Early Triage)**：Stage 0/1 在不消耗 AST 资源前即可短路拦截空文件、密钥泄露或巨石文件；仅当单文件 AST 完备时才进入 Stage 3 跨模块图分析；
- **增量执行与内存常驻控制**：Sparse MoE 路由器按文件变更熵与角色按需激活分析器（增量耗时 `<100ms`），杜绝冷启动全量实例化占满 V8 堆内存。

### 3. 四层规则金字塔与扣分预算 (353 条内置规则)
- **四层金字塔**：Layer 1（通用基础）$\to$ Layer 2（工程架构）$\to$ Layer 3（语言进阶）$\to$ Layer 4（演化自治 CAI / ROI）；
- **单源登记**：遵循 `FAMILY-TOPIC-NNN` 规范，必须在 `src/core/rules/`、`src/core/scoring/dimensionRuleTable.ts` 及全局 `scripts/common/rule-catalog.json` 同步注册；
- **单 Finding 扣分预算**：单个 Finding 扣分维度严格受限 $\text{AxesPerFinding} \le 4$；
- **双轨体积与注释包络**：单文件 $\text{ELOC} \le 900, \text{LOC} \le 1400$ 及 1:3 动态反推包络；当 $\text{ELOC} \ge 600$ 时契约注释占比必须 $\ge 8\%$。

---

## 四、 Praxis 客户端 SDK、语义聚合与一体两面三层拓扑 Diff

> 完整接口签名、数据结构与代码示例详见 [praxis-client-and-diff-topology.md](references/praxis-client-and-diff-topology.md)。

1. **Praxis 客户端 SDK (`src/core/praxis/`)**：通过 `createPraxisClient` 构造 `IPraxisReviewClient`，提供 `reviewWorkspace`、`reviewFile`、`reviewDiff`、`evaluateMergeGate` 四个一等公民异步方法，支持透传 `CardContext` 任务卡溯源上下文。
2. **一体两面三层拓扑 Diff (`diff-topology.ts`)**：
   - **一体两面**：基于同一份结构化数据对称生成机器面（`DiffAgentFace`：AST 作用域、精确行偏移、确定性补丁指令）与人类面（`DiffHumanFace`：决策徽章、双语描述、建议审查动作）；
   - **三层拓扑**：Layer 1（构建单元行级与 AST 节点映射）$\to$ Layer 2（审查单元 `SemanticGraph` 反向依赖影响闭包）$\to$ Layer 3（跨层违规、破坏性删除、循环堆分配与冲突阻断，触发 `shouldEscalateToL3A`）；
   - **标准补丁**：`toAgentUnifiedPatch()` 输出与 `git apply` 100% 兼容的 Unified Diff。
3. **AgentDirectives 协议 (`agent-directives.ts`)**：输出 `AgentDirectivesBundle`（含结构化 `items`、超紧凑 `compactPromptText`、`renderedMarkdown` 与 `presentationPayload`）。
4. **表现层语义去重聚合 (`semantic-correlation.ts`)**：
   - 针对同一文件同一行命中的多条规则，基于并查集对 11 组重叠规则族（`SEMANTIC_OVERLAP_GROUPS`）等价聚类；
   - 按严重度权重 $\text{block (4)} > \text{warn (3)} > \text{info (2)} > \text{pass (1)}$ 选举单张主卡片（`electPrimaryCard`），其余规则归入 `correlatedRules: string[]` 与 `correlationCount`，避免 UI 信息轰炸并指导 Agent 执行单一原子修复。

---

## 五、 守护进程架构、高精度时间戳规范与暂存分流原子落盘

1. **守护进程异步非阻塞 I/O 铁律 (`GOV-PRF-004` / `PRF-IO-001`)**：
   - 守护进程服务器（`src/daemon/server.ts`）与客户端 SDK 位于主进程常驻事件循环中；
   - 严禁在套接字连接建立、客户端握手或清理遗留套接字时使用 `fs.unlinkSync`、`fs.readFileSync` 等阻塞调用；
   - 套接字清理必须采用 Promise 封装的异步操作，并通过 `catch` 优雅处理 `ENOENT` 正常缺失状态。
2. **协议指令与错误码顶部常量聚类 (`NAM-LEN-002`)**：
   - 严禁在 IPC 协议路由分支、扫描结果封装或退出码判定中散落硬编码魔法字符串；
   - 所有 IPC 消息类型（`SCAN`, `SCAN_DIFF`, `CANCEL`）、信号类型（`SIGTERM`, `SIGINT`）、退出原因必须在模块顶部统一声明为不可变常量对象（如 `IPC_MESSAGE_TYPES`, `EXIT_REASONS`）。
3. **跨平台测试与基准临时路径中立性**：
   - 测试脚本与基准套件（`benchmark.js`）严禁硬编码 Windows 盘符（如 `C:\...`）或固定绝对路径；
   - 统一采用 Node.js `os.tmpdir()` 结合唯一前缀生成独立测试沙箱。
4. **高精度时间戳命名契约 (`*Ms`)**：所有时间字段必须以 `*Ms` 结尾显式声明毫秒物理量纲（如 `parseStartTimeMs`、`startMs`、`endMs`、`durationMs`），严禁使用 `time`、`ts`、`startTime` 等无量纲模糊命名。
5. **暂存路径精确语义分流**：
   - `stagingPath`：存放完整未压缩构建、代码切片或阶段产物的标准暂存路径；
   - `compactStagingPath`：存放脱敏、去冗余、紧凑 NDJSON 账本的专用暂存路径；严禁使用 `tmp`、`stage`、`tempDir`。
6. **暂存原子落盘 (Atomic Rename)**：数据先完整写入暂存文件并校验尺寸/Checksum，再通过 `fs.renameSync` 原子替换目标文件，根除半写（Torn Write）风险。

---

## 六、 基线自审复用、项目中立性与三平面质量模型 (CAI 2.0)

1. **基线自审报告复用与增量快轨**：
   - 常规增量校验优先读取 `.refactor-cache/baseline-self-audit.json` 快照，仅对暂存区增量文件执行 `<100ms` AST 切片差分；
   - 当 `src/core/rules/`、`src/analyzers/` 或 `crates/` 发生变更（或显式传 `--force-audit`）时自动触发全量重建。
2. **项目中立性守卫 (`validate-project-neutrality.js`)**：分析器严禁硬编码特定业务仓库路径；框架专属规则必须通过探测标准配置特征（如 `project.godot` 或 `vscode` 依赖）推断 `Archetype Context`。
3. **防孤儿单测契约 (`validate-suite-manifest.js`)**：所有 `scripts/validate-*.js` 必须在 `scripts/test-parallel.js`（149 个并行套件 + 5 个串行套件 + 1 个 vitest 套件 = 155 套测试）显式纳管。
4. **三平面质量模型、贝叶斯统计与长程轨迹检测**：
   - 从 0 纯客观累加符号调用，外部 SDK 调用基于全局 `symbolIndex` 精确追踪；
   - 采用无信息 Jeffreys 先验 $\text{Beta}(0.5, 0.5)$ 共轭后验（$\alpha = 0.5 + k, \beta = 0.5 + n - k$）动态计算后验均值与 95% 置信区间；
   - 质量轨迹以紧凑 NDJSON（$<350\text{B}$/条，总预算 $\le 2\text{MB}$）滚动持久化至 `.refactor-trajectory/`；全工作区 High/Critical Debt 严格保持 0 项；
   - **长程滑动窗口多步死循环振荡检测 (`regressionTrajectoryDetector.ts`)**：维护深度至多 16 步（$k \le 16$）滑动历史窗口，突破单步振荡局限，精准识别 $A \to B \to C \to A$ 等长程死循环拓扑，精确计算 `cycleLength` 并触发自适应反思指令与熔断。
5. **上下文感知假告警抑制**：测试套件（`test_suite`）豁免魔法字面量抽取；国际化字典（`i18n`）与日志/异常入参豁免硬编码字符串提取。

---

## 七、 热路径算法、高并发调度与内存治理 12 项范式

> 完整 12 项范式实现细节详见 [concurrency-memory-paradigms.md](references/concurrency-memory-paradigms.md)；跨领域算子第一性原理五步降维突破详见 [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)。

1. **Myers Trace 动态缩容**：按编辑距离 $D$ 动态分配紧凑矩阵，超限回退 `histogramDiff` 时保留前后缀修剪边界；
2. **Worker 监听器显式解绑**：批次结束时显式调用 `w.off('message', ...)` 与 `w.off(EVENT_ERROR, ...)` 释放 AST 闭包；
3. **队列单指针游标推进**：BFS 遍历严禁 `queue.shift()`，统一使用 `queue[head++]` $O(1)$ 游标；
4. **显式栈三色迭代 DFS**：`findCycles` 等图遍历统一采用显式栈 White/Gray/Black 迭代，免疫递归爆栈；
5. **路径倒排索引 (`nodesByFile`)**：按规范化文件路径索引 AST 节点，消融 `getAllNodes()` 全图扫描；
6. **文件级行切片缓存 (`cachedLines`)**：文件入口单次 `split('\n')`，函数级切片直接复用 `cachedLines.slice()`；
7. **词法正则顶层常量化 (`PRF-MEM-001`)**：严禁循环内动态编译正则；全局正则跨次调用前重置 `lastIndex = 0`；
8. **同步 I/O 隔离屏障与物理次序 (`PRF-IO-001`)**：同步 I/O 经 `*IoBarrier` 封装，且类中同步方法必须物理排在 `async` 方法之前；
9. **循环内集合预索引 (`PRF-ALG-002`)**：循环外预建 `Set` 并用 `Set.has()` 替代循环内 `Array.includes()`；
10. **词法脱敏首字符 $O(1)$ 整数分发 (`source-mask.ts`)**：`scanNextMaskSpan` 基于 `charCodeAt` 首字符 $O(1)$ 分发并拆解为 5 个 $\text{CC} \le 6$ 纯函数，跳过 8 路前缀试探；
11. **治理扫描器紧凑 `ActiveHook[]` 与单趟行扫描 (`scanner.ts`)**：文件入口按扩展名预过滤 `ActiveHook[]`，并将单行规则回调合并入 `MaskedLine[]` 构建循环；
12. **零堆分配字符统计与算子预筛 (`compressionBounds.ts`)**：以 `charCodeAt` 游标函数 `countNonWhitespace` / `countOperators` 替代 `.replace(/\s+/g, '')` 与正则匹配，在 `classifyGiantExpression` 中前置算子过滤提前 `break`。

---

## 八、 现代 TypeScript 高级类型学契约与避免重复开销架构

> 完整类型学设计原理与零冗余开销基准详见 [type-level-engineering-and-caching.md](references/type-level-engineering-and-caching.md)。

1. **名义类型与量纲烙印 (`Brand<T, B>`)**：核心时间戳（`TimestampMs`）、代码行列（`LineNumber`, `ColumnNumber`）与指纹哈希（`FileHash`）通过 `unique symbol` 名义烙印，零运行时开销，编译期杜绝量纲混用；
2. **穷尽性推导与不可达断言 (`assertNever`)**：针对 `GateStage`、`DiffSemanticCategory` 等联合类型，分发器末尾必须调用 `assertNever(variant)`，利用 `never` 强制编译期覆盖所有状态分支；
3. **模板字面量规则代码收窄 (`StandardRuleId`)**：`AR:${Domain}:${Family}-${Number}` 模板字面量类型前置锁定规则命名拓扑，拦截规则漂移（`RCFG-RULE-DRIFT`）；
4. **精确类型谓词与零盲目强转 (`is`)**：彻底消融 `as any` 与盲目 `as` 强转，所有异构或跨进程数据必须经类型守卫（`hasWorkerSymbols`）校验后安全收窄；
5. **深度只读与共享 AST 防污染 (`DeepReadonly`)**：单趟磁带流共享的 `ReadonlyAstNode` 声明为深度不可变，杜绝分析器就地变异污染语法树；
6. **全域避免重复开销四重架构**：
   - **MoE 稀疏路由 (`sparseRuleRouter.ts`)**：按文件差异分类动态匹配最小充分分析器，跳过 80%~95% 无关计算；
   - **三级拓扑缓存 (`topology-cache-manager.ts`)**：L1 LRU 内存缓存 + L2 序列化 + L3 DAG 级联最小失效；
   - **双缓冲流水线与零拷贝 (`worker-scheduler.ts`)**：`inflightRead` 磁盘 I/O 与 Worker 计算并行重叠，Transferable `ArrayBuffer` 转移所有权；
   - **单趟磁带融合 (`analyzer-runner.ts`)**：30 分析器合并为单次 AST 遍历，循环内零瞬态堆分配（`PRF-MEM-001`）。

---

## 九、 专属构建、测试与热路径基准命令

```bash
cd auto-refactor
npm run build                    # 1. 编译 TypeScript 源码至 dist/
npm run gate                     # 2. 本地轻量快速门禁（语法、命名、跳板与中立性检查）
npm test                         # 3. 运行全量自测套件（155/155 套专项校验并发/串行执行）
node scripts/bench-hot-paths.js  # 4. 热路径微基准（mask-source / governance-scan / cmp-rules）
```

---

## 十、 关联模板与参考指引

- [rust-ts-equivalence-protocol.md](references/rust-ts-equivalence-protocol.md)：Rust 原生算子与纯 TS Shim 100% 字节等价性契约规范；
- [praxis-client-and-diff-topology.md](references/praxis-client-and-diff-topology.md)：Praxis 客户端 SDK、表现层语义聚合与一体两面三层拓扑 Diff 规范指南；
- [concurrency-memory-paradigms.md](references/concurrency-memory-paradigms.md)：高并发调度、热路径字符扫描、图算法降阶与 12 项内存治理工程范式；
- [type-level-engineering-and-caching.md](references/type-level-engineering-and-caching.md)：现代 TypeScript 高级类型学工程与全域开销规避规范；
- [rust-engineering](../rust-engineering/SKILL.md)：Rust 工业级高级编程风格、零成本抽象与强制系统工程规范；
- [analyzer-boilerplate.ts](templates/analyzer-boilerplate.ts)：自定义静态分析器标准化样板；
- [validate-suite-boilerplate.js](templates/validate-suite-boilerplate.js)：规则专项回归测试套件脚手架。
