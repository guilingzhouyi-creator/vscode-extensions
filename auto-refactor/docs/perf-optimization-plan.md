# auto-refactor 跨域性能优化方案

> 作者：架构师（高见远）｜状态：方案设计（不实现）｜日期：2026-08-13
>
> 本方案只做研究与设计，不改任何源码。所有改动均以两条硬性约束为验收门槛：
> - `npm run validate`（scripts/validate-equivalence.js）—— **6 场景字节级比对**（TS 4 + Rust 2，含 inproc 与 worker 路径），输出必须逐字节不变；
> - `npm run benchmark` —— 度量性能，作为收益判据。

---

## 0. 目标与现状基线

**目标**：在不改变任何输出字节的前提下，降低 parse+analyze 阶段耗时，重点解决：
1. 物化层固定成本（中小文件慢 ~50% 的结构性代价，绝对量 ~0.15ms/文件）；
2. 大文件的物化与遍历分配压力（单文件 200 函数 ≈3000 行：`createSourceFile` 5.4ms，`TypeScriptAdapter.parse` 22.7ms，物化 ≈17ms 是主瓶颈）；
3. worker 线程池的传输与批处理效率（多文件、多 worker 场景）。

**关键事实（代码阅读确认）**：
- 物化已做三项优化：text 懒物化（仅字面量）、introducesBinding 单次化（TS）、跳过纯 token 节点（13402→8601）。**注意：Rust 适配器仍存在 introducesBinding 每节点调用 3 次的问题（见 P0-4）**。
- 适配器已是进程级单例（`adapters.ts` 注册表），**不存在"每文件 new adapter"**；worker 线程在 `workerData` 阶段预加载 analyzer 模块一次，也不存在每文件重新 require（除 `instantiateAnalyzer` 每文件 new 实例，见 P1-2）。
- 遍历路径每节点分配：`adapter.childScope(...)` 返回 `{className, binding}` 对象（8601 次/文件）、每个 `visit` 调用套 try/catch（8601×N 次/文件）、每个文件 3 次 `content.split`（FileMetricCollector 1 次 + largeFile 2 次）。

---

## 1. 跨域调研摘要

### 1.1 编译器 / 静态分析域（oxc / Biome / SWC / ESLint）

- **Oxc**：AST 分配在 bumpalo 内存竞技场（arena）中，短字符串用 CompactString 内联，解析器内除这两者外**零堆分配**；作用域绑定/符号解析推迟到语义分析阶段，不在 parser 内做。核心哲学是"一次解析、多处复用"——lint/format/transform 共享同一份 AST，避免重复解析。（来源：oxc GitHub README、官方 benchmark；Oxc Parser 解析 typescript.js 26.3ms vs SWC 84.1ms / Babel 853ms）
- **Biome / SWC**：同为 Rust 原生 + 单次解析多阶段复用；启动即全速（无 JIT 预热），rayon 数据并行。
- **ESLint 9/10**：
  - 多线程 lint：按文件拆任务到 worker 池；文档建议 **先以物理核数的一半起步调 --concurrency**，并提示 CI/容器中虚拟核会虚高。
  - **增量缓存**：两级哈希（文件内容哈希 + AST 结构哈希）避免伪命中；`--cache` 对未变更文件可省 95% 重复 lint。
  - 官方 `--timing` 剖析规则耗时；典型瓶颈分布：AST 解析 ~45%、规则校验 ~30%、I/O ~10%。
- **可迁移点**：① 单次解析 + 共享遍历（本项目已做到，正是 NEW 单遍模型）；② "延迟做昂贵语义"（Oxc 把 binding 推迟到语义阶段——本项目对应"物化时只预计算分析器真正消费的字段"）；③ 减少分配（arena 不可直接移植，但"消除每节点多余对象/字符串"可移植）；④ 两级缓存/增量（适合作为 CLI 后续特性）。

### 1.2 Node / V8 运行时域

- **worker_threads 传输**：`postMessage` 默认走 structured clone（深拷贝）；大对象用 **transferable ArrayBuffer 零拷贝**（`postMessage(msg, [buf.buffer])`，发送方失去所有权）；真正共享用 SharedArrayBuffer + Atomics。worker 冷启动 60–100ms、常驻 RSS 25–35MB/个，**小任务（<2ms）不值得走 worker**；池大小建议 `os.availableParallelism()`（尊重 cgroup 配额，优于 `os.cpus().length`）。（来源：Node 官方文档、runtimepanic、hirenodejs、devcraftly 等工程博客）
- **V8 分配与 GC**：
  - 分配本身是 bump-pointer，接近免费；**真正贵的是把对象推入老年代后的 GC 压力**。短命对象由 Scavenger 近乎免费回收——所以"少分配"的主要收益来自**减少长生命周期对象与每次遍历的临时对象总量**。
  - 对象形状稳定 → 隐藏类 + monomorphic IC 命中；**hot path 避免 try/catch**（触发去优化）；避免频繁增删属性（对象退化为 dictionary mode）。
  - **Map vs Object**：固定结构小对象用 Object（IC 极快）；动态增删/键为对象时用 Map。
  - 对象池结论有争议：V8 分配便宜，池反而可能把对象留在老年代；**对"数组/容器复用"要谨慎，但"消除必然产生的空数组/中间数组"是明确的正收益**。
- **fs**：`readFileSync` 在 worker 内由 libuv 线程池并发执行，多 worker 下文件 I/O 本身已并行；主线程异步预读 + Buffer transfer 可与解析流水线重叠（见 P0-5）。
- **可迁移点**：worker 池常驻复用（本项目已做：一个 run 内常驻）；批处理消息（DB 类比）；transferable 内容传递（仅当把读文件移到主线程时）；`availableParallelism`；hot path 去 try/catch（P1-3）；消除每节点临时对象（P0-2）。

### 1.3 数据库 / 大数据域（跨域类比）

- **连接池 / 连接复用**：池化长连接避免每请求建连（20–30ms/次）——对应本项目 **worker 常驻**与**适配器单例**（已做）；进一步对应"analyzer 实例复用"（P1-2）。
- **批处理**：单条插入 1000 次 ≫ 一次批量插入；微批处理（micro-batching）在 Spark/Flink 中按窗口积压成批——对应 **worker 消息批处理**（P0-5：一次 postMessage 携带多文件，摊薄往返开销）。
- **物化视图 / 汇总表 / 覆盖索引**：把昂贵聚合预先算好存起来，查询只做查找——对应本项目 **语义标志预计算**（adapter 物化时算好 isConstBound/tolerated/branchWeight 等，已做）；**进一步可迁移**：行统计（lines/nonBlankLines）物化一次供所有消费者共享（P0-3）；位置换算（line/column）只对会产出 Issue 的节点物化（P0-1）。
- **预聚合下推**：数据库端聚合代替逐行取回——对应"遍历中一次收集 + finalize 统一计算"（已做）。

### 1.4 可迁移手段 → 本项目映射

| 跨域手段 | 来源域 | 本项目落点 | 状态 |
|---|---|---|---|
| 一次解析多处复用 / 共享遍历 | oxc/Biome/ESLint | `runStreaming` 单遍多路复用 | ✅ 已做 |
| 语义字段预计算（物化视图） | DB 物化视图 / Oxc 语义推迟 | adapter 预计算 flags | ✅ 已做 |
| 消除每节点多余分配 | Oxc arena / V8 GC | childScope 对象、Position 对象、空 children 数组 | ⏳ P0-2 / P0-1 / P1-4 |
| 昂贵操作只对消费者需要处执行 | Oxc 语义推迟 / ESLint timing | Position 惰性、nameOf 定向 | ⏳ P0-1 / P0-4 |
| 共享聚合结果 | DB 汇总表/覆盖索引 | 行统计单次计算共享 | ⏳ P0-3 |
| worker 批处理 / 微批 | DB batch / Flink | 多文件一条消息 | ⏳ P0-5 |
| transferable 零拷贝 | Node worker_threads | 主线程预读 + Buffer transfer | ⏳ P0-5 |
| 连接/实例复用 | DB 连接池 | analyzer 实例复用、visit 绑定提升 | ⏳ P1-2 |
| hot path 去 try/catch | V8 IC/去优化 | 内建 analyzer 免捕获 | ⏳ P1-3 |
| 增量缓存（两级哈希） | ESLint --cache | CLI 特性（roadmap） | ⏳ P2 |

---

## 2. 性能剖析结论（瓶颈定位）

按单文件 200 函数 ≈3000 行、8601 个物化节点估算（数量级，非精确测量）：

| 热点 | 位置 | 规模 | 占比估计 |
|---|---|---|---|
| `posOf()` 行/列换算 | typescriptAdapter.ts:166-167, 332-335 | 每节点 2 次（start+end）= ~17.2k 次 + 17.2k 个 `{line,column}` 对象 | 物化 17ms 中的 25–40% |
| `childScope()` 对象分配 | traverse.ts:95 + 两适配器 | 每节点 1 次 = ~8.6k 个 `{className,binding}` | 遍历段 30–50% |
| `nameOf()` getText | typescriptAdapter.ts:168, 278-283；rustAdapter.ts:119 | 每节点 1 次，name 节点约 10–20% | 物化 5–15% |
| `content.split` ×3 | traverse.ts:151；largeFile.ts:80-81 | 每文件 2–3 次整串 split + 数组 | 大文件 ~0.3–0.8ms/文件 |
| 空 `children: []` | 两适配器 mapNode | 每节点 1 个空数组（叶节点占多数） | 分配/GC 中低 |
| try/catch × visit | traverse.ts:86-90 | 每节点 × 分析器数 | 去优化风险（中低） |
| Rust `introducesBinding` ×3 | rustAdapter.ts:126-128 | 每节点 3 次 `childForFieldName` | Rust 路径高 |

---

## 3. 优化点清单（核心）

> 每条含：① 涉及文件与具体改动位置 ② 改动描述 ③ 预期收益（估算）④ 风险与字节一致性影响 ⑤ 优先级。

---

### P0-1 位置（Position）惰性化——只对会产出 Issue 的节点换算行/列

- **① 文件与位置**
  - `src/core/multilang.ts`：`NormalizedNode.start/end` 由必填 `Position` 改为可选（或保留类型但允许 undefined），并注明"仅字面量 / 函数体 / FunctionKeyword 保证存在"。
  - `src/core/typescriptAdapter.ts`：mapNode（166-167 行）中 `start/end` 改为条件计算：仅当 `isLiteral || fnLike || n.kind === ts.SyntaxKind.FunctionKeyword` 时调用 `posOf`，否则不赋值。
  - `src/utils/ast.ts`：`locN(node, file)`（46-48 行）对缺失位置做显式断言（throw 或 `!` 断言），避免静默产出错误位置。
  - 消费点核对（已确认安全）：`constants.ts`（仅 literal 节点读 `node.start.line`/`locN`）、`complexity.ts`（仅 functionLike 节点与 FunctionKeyword 首子节点）、`largeFile.ts`（固定 line 1，不读位置）。
- **② 改动描述**：把"每节点 2 次 line/col 换算 + 2 个 Position 对象"压缩为"每文件只对 ~200–300 个会出现在 Issue 里的节点换算"。位置语义、输出值完全不变。
- **③ 预期收益**：消除 ~16.9k 次 `getLineAndCharacterOfPosition`（含 lineMap 二分）与 ~17k 个 Position 对象分配。估算物化 22.7ms → **~15–18ms（物化 -20%~-35%）**；中小文件固定成本 0.15ms/文件 → **~0.10–0.12ms/文件**；同时显著降低 GC 压力。
- **④ 风险与字节一致性**：低。`location.start/end` 对会出现的 Issue 保持逐字节一致；validate 6 场景全量覆盖（TS 4 场景含字面量/函数体/FunctionKeyword 全部 Issue 形态）。唯一风险是未来新增分析器误读未物化节点位置——用 locN 断言兜底。Rust 适配器位置来自 tree-sitter `startPosition`（免费），**不需要改**。
- **⑤ 优先级：P0**（收益/风险比最高）。

---

### P0-2 scope 推导零分配——`childScope` 每节点对象改为遍历内联

- **① 文件与位置**
  - `src/core/traverse.ts`：visitNode（95 行）`const childScope = adapter.childScope(node, className, binding)` → 内联推导（见下）；`runStreaming` 保持对外行为不变。
  - `src/core/multilang.ts`：`LanguageAdapter.childScope` 改为**可选接口方法**（默认走共享推导），或直接从接口删除并移入 traverse。
  - `src/core/typescriptAdapter.ts`（128-144 行）、`src/core/rustAdapter.ts`（87-103 行）：删除各自 `childScope`（两实现逻辑**逐字相同**，见下）。
- **② 改动描述**：TS 与 Rust 的 `childScope` 都是同一套基于归一化 flags 的规则：
  ```
  isClassDefining → (className = node.name ?? className, binding = null)
  functionLike    → (className, binding = null)
  introducesBinding → (className, binding = node.bindingName ?? binding)
  否则             → (className, binding) 不变
  ```
  在 traverse 内用局部变量重写，零对象分配：
  ```ts
  let cName = className, cBinding = binding;
  if (node.isClassDefining) { cName = node.name ?? className; cBinding = null; }
  else if (node.functionLike) { cBinding = null; }
  else if (node.introducesBinding) { cBinding = node.bindingName ?? binding; }
  ```
  `childScope` 保留为可选接口（未来语言若规则不同可覆盖），内置两适配器删除实现。
- **③ 预期收益**：消除每节点 1 个 `{className,binding}` 对象（~8.6k/文件）与一次函数调用；估算遍历段 **-30%~-50%**，全文件总耗时 **-5%~-10%**；GC 压力显著下降（这是 V8 老年代压力主要来源之一）。
- **④ 风险与字节一致性**：中低。行为是纯函数等价改写（两适配器规则已核对逐字一致）；validate 6 场景（TS 4 + Rust 2，覆盖 className/binding 全部分支）保证输出不变。需注意接口删除属编译期破坏，`dist` 需重新 build。
- **⑤ 优先级：P0**。

---

### P0-3 行统计物化共享——消除每文件 2–3 次 `content.split`

- **① 文件与位置**
  - `src/core/traverse.ts`：FileMetricCollector.finalize（151 行）`ctx.content.split(/\r\n|\n/)`。
  - `src/analyzers/largeFile.ts`：finalize（80-81 行）两次 `content.split(/\r\n|\n/)`（lines + nonBlankLines）。
  - `src/core/analyzer.ts`：runAnalyzers（423-486 行）；`src/core/worker.ts`：runOne（59-128 行）——在拿到 `content` 后计算一次行统计，放入 `AnalyzerContext`（`types.ts` 增加可选字段如 `lineStats`）。
  - `src/core/types.ts`：`AnalyzerContext` 增加 `lineStats?: { lines: number; nonBlankLines: number }`。
- **② 改动描述**：新增 `countLineStats(content)`（放 `src/utils/ast.ts`），单次遍历完成：
  - `lines = 1 + 字符 '\n' 的个数`（与 `split(/\r\n|\n/)` 长度语义完全一致：`'\r\n'` 含 `\n`，空串→1，`'a\n'`→2）；
  - `nonBlankLines`：按 `trim()` 的 WhiteSpace 集合（U+0009/000A/000B/000C/000D/0020/00A0/1680/2000-200A/2028/2029/202F/205F/3000/FEFF）判定"当前行是否出现过非空白字符"，遇 `\n` 计数。
  - FileMetricCollector 与 largeFile.finalize 改为读取 `ctx.lineStats`（保持各自输出值逐字节一致）。
  - **推荐实施顺序**：先做"共享一次 split 结果"（最小改动、零语义风险），再做"无数组单遍扫描"版本，并以 validate + 一个临时断言脚本（对比 split/trim 结果）兜底。
- **③ 预期收益**：每文件减少 2 次整串 split + 2 个行数组分配 + 1 次 filter 遍历；3000 行大文件估算 **-0.3~-0.8ms/文件**（+GC 减少）；中小文件固定成本小幅下降。
- **④ 风险与字节一致性**：低。lines/nonBlankLines 语义与现状逐字节一致（validate 的 fileMetrics 含此两字段，6 场景均覆盖）；单遍扫描需与 trim 语义精确对齐（见上文集合），建议加等价性断言。
- **⑤ 优先级：P0**（低风险、收益确定，且为 P1-2 的 ctx 化铺垫）。

---

### P0-4 定向 name 物化 + Rust `introducesBinding` 单次化

- **① 文件与位置**
  - `src/core/typescriptAdapter.ts`：mapNode（168 行）`name: this.nameOf(n, sf)` → 仅当 `fnLike || isClassDefining || introducesBinding` 时调用 `nameOf`，否则 `undefined`；`nameOf`（278-283 行）保持不变。
  - `src/core/rustAdapter.ts`：mapNode（126-128 行）`introducesBinding: this.introducesBinding(sn)`、`bindingName: this.introducesBinding(sn) ? this.nameOf(sn) : null`、`hasFunctionInitializer: this.introducesBinding(sn)` —— **同一谓词每节点调 3 次**（每次做 `childForFieldName('value')`），改为先算一次 `const isBinding = this.introducesBinding(sn)` 复用；`nameOf`（119 行）同 TS 一样条件化。
- **② 改动描述**：核对全部 `node.name` 消费者（complexity 的 nameFor、largeFile 顶层 functionLike、traverse childScope 的 isClassDefining、Rust impl 名），确认只有 functionLike / isClassDefining / introducesBinding 三类节点被消费——因此其他节点（变量名、属性名、参数名等）不再调用 `getText`/`childForFieldName`。
- **③ 预期收益**：TS 减少 ~数百次 `getText(sf)` 子串分配；Rust 减少 ~2/3 的 `childForFieldName` 调用（Rust 路径收益显著）。估算物化 **-3%~-8%**。
- **④ 风险与字节一致性**：低。消费者核对完毕；validate 6 场景覆盖 name 相关输出（binding/className/函数名/impl 名）。
- **⑤ 优先级：P0**。

---

### P0-5 worker 批处理管线（batch dispatch + 主线程预读 + Buffer 零拷贝）

- **① 文件与位置**
  - `src/core/analyzer.ts`：runWorkerPool（250-309 行）——目前每文件一条 `postMessage({file, absPath})`（282 行），worker 内自行 `readFileSync`（worker.ts:65）。
  - `src/core/worker.ts`：runOne（59-128 行）消息协议改为批量任务。
- **② 改动描述**（分两步，可独立合入）：
  1. **批处理**：主线程每批发送 N 个文件（建议 16–64，可配置），消息体 `{ tasks: [{file, absPath}] }`；worker 逐个处理、一次回传 `{ results: [{file, issues, metric}] }`。顺序仍由现有 `idxByFile` 索引映射保证。
  2. **主线程预读 + transferable**：主线程用 `fs.promises.readFile(abs)`（异步、与 worker 解析重叠）读为 Buffer，`postMessage({ file, buf }, [buf.buffer])` 零拷贝转移；worker 端 `buf.toString('utf8')` 解码（或 TextDecoder）。读失败的文件由主线程直接产出 `{issues:[], metric:null}`，不再派发（与现状语义一致）。
- **③ 预期收益**：多 worker + 多文件场景下，消息往返摊薄（每文件一条 → 每批一条）与 I/O/CPU 流水线重叠，估算 **-5%~-15%**（workers=4、300+ 文件时可见）；大文件场景零拷贝省一次字符串复制。workers=1（in-process）路径不受影响。
- **④ 风险与字节一致性**：中。内容与结果完全一致（仍是同一份文件字节、同一解析路径）；validate 的 `corpus-workers`、`rust-workers` 两场景直接覆盖 worker 路径；注意 Buffer 转移后主线程不可再读该 buffer（一次性派发，无碍）。批处理若引入错误会整批失败——保留现有"worker 池失败 → in-process 兜底"机制。
- **⑤ 优先级：P0**（任务明确要求 worker 优化；若工程风险偏好低，可只做第 1 步，第 2 步降为 P1）。

---

### P1-1 TS 零物化懒投影快速路径（roadmap，分两步）

- **① 文件与位置**：`src/core/typescriptAdapter.ts`（mapNode）、`src/core/traverse.ts`（runStreaming 驱动方式）、`src/core/analyzer.ts`（runAnalyzers 选择路径）。
- **② 改动描述**：为 TS 场景新增"不物化整树"的路径——`runStreaming` 直接驱动 `ts.Node` 下降，仅在 visit 被调用处按需投影为 `NormalizedNode`（每次投影一个节点，随用随弃）。`NormalizedNode`/analyzer 接口不变；仅当**无 legacy analyzer**（无 `visit` 的插件）时启用（legacy 仍需真实 SourceFile 与整树）。
- **③ 预期收益**：这是唯一能追平 MIXED 中小文件基线（129ms→~85-95ms）的方案：彻底消除 8601 个节点对象的物化固定成本。
- **④ 风险**：高（引擎遍历路径改动大，投影对象生命周期需仔细管理；`parent/grandparent/depth/className/binding` 线程化逻辑需在 ts.Node 层重演）。建议作为独立里程碑，逐步替换并由 validate 6 场景兜底。
- **⑤ 优先级：P1**（收益最大但风险最大，不放进首批 P0）。

---

### P1-2 analyzer 实例复用 + visit/finalize 绑定提升

- **① 文件与位置**：`src/core/traverse.ts`（53-58 行每文件 bind）、`src/core/analyzer.ts`（runAnalyzers 440 行 `p.factory()`）、`src/core/worker.ts`（84 行 `instantiateAnalyzer` 每文件调用）、`src/core/types.ts`（Analyzer/StreamingEntry 契约）。
- **② 改动描述**：把 streaming analyzer 的**每文件累积状态**从实例字段迁入 `ctx` 上的 per-file accumulator（如 `ctx.state`），使 analyzer **实例可跨文件复用**、`visit/finalize` 在 worker/扫描初始化时绑定一次；每文件不再 `factory()`/bind。对齐 DB 连接池类比：连接（实例）常驻，事务（ctx）每文件新建。
- **③ 预期收益**：消除每文件 N 个实例分配 + N 次 bind；中小文件固定成本再降 ~0.02–0.04ms/文件。
- **④ 风险**：中。Analyzer 公共契约语义变化（文档明确"每文件 fresh instance"）；需保证并发文件间状态隔离（ctx 对象天然隔离）。validate 6 场景兜底；custom analyzer 生态需兼容（可保留旧路径）。
- **⑤ 优先级：P1**。

---

### P1-3 runStreaming hot path 瘦身（try/catch 与去优化）

- **① 文件与位置**：`src/core/traverse.ts`（86-90 行）。
- **② 改动描述**：a) 内置 analyzer（constants/large-file/complexity/__metric__）已知为纯计算、不应抛错，可**免 try/catch**（仅 custom analyzer 保留捕获）；b) 或采用"分析器首次抛错后跳过其后续 visit"（`errored` 已存在，输出仍是一条 error issue，行为等价）。
- **③ 预期收益**：消除每节点每分析器的 try/catch（V8 去优化风险），遍历段 **-5%~-15%**。
- **④ 风险**：中。若内置 analyzer 未来引入抛错点，会从"吞掉报 info/error"变为"中断遍历"——需配套单元测试；validate 只保证输出一致，不保证异常路径，需人工评审。
- **⑤ 优先级：P1**。

---

### P1-4 空 children 数组消除

- **① 文件与位置**：`src/core/typescriptAdapter.ts`（179 行 `children: []`）、`src/core/rustAdapter.ts`（130 行）。
- **② 改动描述**：mapNode 改为 `let kids; ts.forEachChild(...) { (kids ??= []).push(...) }; node.children = kids;`——**有子节点才分配数组**；`adapter.children()` 与所有 `n.children || []` 消费点已兼容（`children` 接口本就可选；complexity 的 `n.children || []` 与 traverse 的 `adapter.children(node)` 均处理 undefined）。可共享一个 `EMPTY_CHILDREN` 常量避免反复 `[]`。
- **③ 预期收益**：消除每文件数千个空数组分配（叶节点占多数），内存与 GC 中低收益。
- **④ 风险**：低。接口已是可选；validate 兜底。
- **⑤ 优先级：P1**。

---

### P1-5 语言选择微优化 + 运行时可感知核数

- **① 文件与位置**：`src/core/adapters.ts`（25 行 `Object.values(adapters).find(...)`）、`src/core/analyzer.ts`（368 行 `os.cpus().length`）。
- **② 改动描述**：`adapterFor` 预建 `Map<ext, LanguageAdapter>` 一次，避免每文件 Object.values 扫描；`os.cpus().length` → `os.availableParallelism()`（Node ≥19，尊重容器 CPU 配额）。
- **③ 预期收益**：微（每文件 <1µs；容器环境 worker 数更合理）。
- **④ 风险**：低。无输出影响。
- **⑤ 优先级：P1**。

---

### P2-1 rawKind 条件化

- **① 文件与位置**：`src/core/typescriptAdapter.ts`（162 行 `rawKind: ts.SyntaxKind[n.kind] ?? String(n.kind)`）、`src/core/multilang.ts`。
- **② 改动描述**：`rawKind` 唯一消费者是 complexity.ts:95 的 `first.rawKind === 'FunctionKeyword'`（已核对 constants/largeFile/metric 均不消费）；仅对 FunctionKeyword 节点赋值，其余留空（接口改可选）。
- **③ 预期收益**：省 8600 次属性查询/字符串引用（很小）；若连 `String(n.kind)` 兜底分支都省掉，杜绝极少数非法 kind 的字符串分配。
- **④ 风险**：低（rawKind 不在 validate normalize 范围内）；但属"面向当前消费点"的收缩，未来消费者需注意。
- **⑤ 优先级：P2**。

---

### P2-2 增量磁盘缓存（CLI 特性）

- **① 文件与位置**：`src/core/analyzer.ts`（scan 入口，介于 collectFiles 与 parse 之间）。
- **② 改动描述**：ESLint 式两级缓存——文件内容 hash + 工具版本/配置 hash → 未变更文件直接复用上次 issue/metric。默认关闭（validate/benchmark 场景保持全量扫描），提供 `--cache` 开关与缓存目录。
- **③ 预期收益**：增量场景（CI 部分构建、重复扫描）可省 80–95% 重复工作；单次全量扫描无收益。
- **④ 风险**：中（缓存一致性与失效策略需设计；validate 不覆盖，需独立测试）。
- **⑤ 优先级：P2**。

---

### P2-3 worker 池跨 scan() 复用（进程常驻）

- **① 文件与位置**：`src/core/analyzer.ts`（runWorkerPool）、`src/core/worker.ts`。
- **② 改动描述**：模块级 worker 池，多次 `scan()` 调用复用线程（免每次 60–100ms 冷启动）。
- **③ 预期收益**：仅对"同一进程多次扫描"的库调用方有意义；CLI 单次执行无收益。
- **④ 风险**：中（生命周期管理、config 变化时需重建）。
- **⑤ 优先级：P2**。

---

## 4. P0 推荐清单（供工程师实施）

按"收益/风险比"排序，**建议实施顺序即此顺序**（每步独立可验证、可单独合入）：

| # | 优化项 | 优先级 | 预期收益（估算） | 主要风险 | 验证 |
|---|---|---|---|---|---|
| 1 | P0-1 位置惰性化 | P0 | 物化 -20%~-35%；小文件 0.15→~0.10-0.12ms/文件 | 低（消费点已核对 + locN 断言） | validate 6 场景 + benchmark |
| 2 | P0-2 scope 推导零分配 | P0 | 遍历 -30%~-50%；总耗时 -5%~-10% | 中低（接口删除，需重编译） | validate（TS 4 + Rust 2 覆盖全部 scope 分支） |
| 3 | P0-3 行统计物化共享 | P0 | 大文件 -0.3~-0.8ms/文件；GC 下降 | 低（先共享 split，再单遍扫描 + 等价断言） | validate fileMetrics 字段 |
| 4 | P0-4 定向 name + Rust 单次化 | P0 | 物化 -3%~-8%；Rust 路径显著 | 低（消费者核对完毕） | validate 6 场景 |
| 5 | P0-5 worker 批处理管线 | P0 | 多 worker 多文件 -5%~-15% | 中（消息协议改动；保留 in-process 兜底） | validate corpus-workers / rust-workers |

**P0 合计预期**：单文件物化 22.7ms → 约 **13–17ms**；300 中小文件 129ms → 约 **95–112ms**（更接近 MIXED 85ms）；大文件 230ms → 约 **200–215ms**。彻底追平需 P1-1（懒投影）。

## 5. 后续路线（P1/P2 摘录）

- **P1-1 零物化懒投影**：唯一能彻底消除小文件物化固定成本的方案，建议作为下一个独立里程碑（高收益高风险，先做 P0 再评估）。
- **P1-2 analyzer 实例复用**：与 P0-3 的 `ctx.lineStats` 化方向一致，可合并演进（per-file 状态全部进 ctx）。
- **P1-3 try/catch 瘦身**：与 P0-2 同属 hot path，可在 P0 之后做（需异常路径评审）。
- **P1-4 空 children 消除 / P1-5 微优化**：低风险顺手项。
- **P2**：rawKind 条件化、增量缓存、worker 池跨扫描复用（特性型优化，独立排期）。

## 6. 验证策略

1. **每完成一个 P0 项**：`npm run build && npm run validate`（6 场景字节级，必须 ALL PASS）；若失败先于优化项排查（改动均为等价改写，不应影响输出）。
2. **性能判据**：`npm run benchmark`（默认 300 文件 workers=1）记录前后 median；大文件场景用 `--files=12` 类参数或手工构造 12×3000 行语料复核；worker 场景用 `--workers=4` 复核 P0-5。
3. **P0-3 专项断言**（建议）：临时脚本对比 `countLineStats` 与 `split(/\r\n|\n/)` + `trim()` 在全部 validate 语料与 samples 上的结果一致（防 trim 白字符集合偏差）。
4. **P0-5 专项**：validate 的 `corpus-workers`/`rust-workers` 两场景即为 worker 路径字节级回归；另在 worker 失败时确认 in-process 兜底仍生效（现有 catch 逻辑保留）。
5. **GC 观测（可选）**：`node --trace-gc` 或 `--expose-gc` 对比 P0 前后 GC 停顿/次数，验证"减少老年代压力"的预期。

---

## 附：已确认不改动或无需改动的点

- **text 懒物化**（仅字面量）：已做，正确。
- **TS introducesBinding 单次化**：已做（`const isBinding = introducesBinding(n)`）；**Rust 端未做，列入 P0-4**。
- **适配器单例 / worker 预加载 analyzer 模块**：已做，无"每文件 new adapter / require"问题；"每文件 new 实例"属 P1-2 范围。
- **setParentNodes:false**：已做（15–20% 解析收益），保持。
- **单遍多路复用遍历**：已做，是跨域调研确认的正确方向，不动。
