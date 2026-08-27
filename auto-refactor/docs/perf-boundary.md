# 优化边界分析（docs/perf-boundary.md）

> 作者：架构师（高见远）｜日期：2026-08-13｜状态：分析定稿（只分析不实现）
> 范围：对每个剩余优化候选给出「当前值 / 理论下限 / 可优化空间 / 成本 / 风险 / ROI / 建议」。
> 数据基线（本机历史）：大文件 NEW 584 vs MIXED 853ms（1.46x）；300 文件 NEW 109-119 vs MIXED 85-103ms；物化 mapNode ~23ms（总 parse+map ~35ms，createSourceFile 12.4ms）；oxc parseSync 1.66-4.89ms vs ts 6.6-14.9ms。

---

## 1. 总览（TL;DR）

| 项 | 结论 |
|---|---|
| 物化 normalize（TS mapNode 剩余热点） | **值得做**（P1-4 + P2-1 + 谓词短路，低风险，mapNode 23.1→~15-18ms） |
| 物化 normalize（oxc 反射遍历） | **低 ROI 排后**（默认 parser 仍是 TS；仅当 oxc 翻默认时再做 visitorKeys 缓存） |
| P1-1 TS 零物化懒投影 | **✅ 已实施（docs/p1-1-design.md T01-T05）**：默认开启（`AR_FASTPATH !== '0'`，`=0` 安全阀）；per-file ModeB light -34%/heavy -21%，w4 轻量 -10.2%/重型 -12.0% |
| 解析（ts 12.4 / oxc 4.1ms） | **边界已到，停止**（oxc 已捕获 ~8ms/大文件；继续压解析边际 <5%） |
| 增量缓存（ESLint 式两级哈希） | **值得做但 P2 排期**（场景性收益：重复扫描 5-20x；单次全量零收益） |
| worker（小文件无收益 / 冷启动） | **固有边界，不再投入**；只做 P0-5 批处理第一步（若多文件多 worker 是目标场景） |
| GC/内存 | **与物化强耦合，无独立动作**；P1-4 顺手、P1-1 根治 |
| Known Divergences 补全（4 项） | **值得做**（合计 ~0.5 人日，全为漏报方向、不触引擎、validate 基线不变） |

**推荐下一个迭代清单（≤3 项，按 ROI/风险排序）**：
1. **Known Divergences 补全**（export * / StaticBlock / TSParameterProperty / .d.ts）—— 低成本堵漏报。
2. **物化剩余热点**：P1-4 空 children 消除 + P2-1 rawKind 条件化 + 谓词短路 —— 低风险，mapNode 23.1→~15-18ms。
3. **P1-1 零物化懒投影**（分两步）—— **✅ 已实施**（T01-T05 落地，QA Round 2 无条件验收，默认已翻；见 docs/p1-1-design.md §5.6 实测数字）。

---

## 2. 逐项边界分析

### 2.1 物化 normalize —— TS mapNode（~23ms）

| 维度 | 分析 |
|---|---|
| 当前值 | 大文件（~200 函数 / ~3000 行）parse+map ≈ 35.5ms，其中 mapNode ≈ 23.1ms；300 中小文件物化固定成本 ~0.10-0.15ms/文件。已做：位置惰性（P0-1）、name 定向（P0-4）、childScope 内联零分配（P0-2）、跳过纯 token（13402→8601 节点）。 |
| 理论下限 | **不能低于「每非跳过节点 1 个对象 + 每非叶 1 个 children 数组」**——`NormalizedNode` 契约要求物化对象供引擎消费，零分配只有懒投影（§2.4）才能做到。按 V8 monomorphic 对象 ~0.2-0.5µs/个 + 谓词求值（introducesBinding 4 个 is*、branchWeightOf switch、kindOf switch、increasesNesting Set.has）~0.3-0.6µs/节点：8601 节点 × 0.5-1.1µs ≈ **4.3-9.5ms 为物化下限**。 |
| 可优化空间 | 当前 23.1ms → 下限 4.3-9.5ms，理论 ~55-80%。但**无需追到下限**：剩余低成本项——P1-4 空 children 数组（省 ~5-7k 数组/文件）、P2-1 rawKind 条件化（省 8600 次属性引用）、introducesBinding 非常见节点短路、kindOf 查表化。合计现实目标 **15-18ms（-22%~-35%）**。 |
| 实现成本 | 低-中（P1-4/P2-1 各 ~10-30 行，validate 9 场景兜底）。 |
| 风险 | 低（接口本就是可选字段；消费点已核对）。 |
| ROI | 高（收益确定、风险低）。 |
| 建议 | **值得做**，进下一迭代（第 2 项）。 |

### 2.2 物化 normalize —— oxc 反射遍历

| 维度 | 分析 |
|---|---|
| 当前值 | oxc parse+map ≈ 117.5ms vs ts 126.8ms（perf4.log，12 文件语料）→ **总 gain 仅 1.08x**；oxc parseSync 只 4.89ms，即 oxc mapNode ≈ 112ms，**反射遍历吃掉了解析的全部收益**。原因：`Object.keys(n)` 每节点反射 + pushChild 多分支 + 每节点反复分配 children 数组。 |
| 理论下限 | 与 TS 同构（4.3-9.5ms），但反射路径到下限的工程成本更高（需 visitorKeys 缓存每类型子键、减少数组分配、inline 方法 value）。现实目标：visitorKeys + 缓存 Object.keys → ~112→60-80ms（-30~-45%）。 |
| 可优化空间 | 明确但**只对 parser=oxc 生效**；默认 parser 仍是 typescript。 |
| 实现成本 | 中（oxcAdapter 遍历重构 ~50-100 行 + 字节等价回归）。 |
| 风险 | 中（反射改 visitorKeys 必须逐类型核对子键顺序，validate 3 个 oxc 场景兜底）。 |
| ROI | 当前低（默认路径无收益）；若未来翻默认 oxc → 中高。 |
| 建议 | **低 ROI 排后**；仅在「oxc 翻默认」决策落地后启动。 |

### 2.3 解析（ts createSourceFile 12.4ms / oxc parseSync 4.1ms）

| 维度 | 分析 |
|---|---|
| 当前值 | ts 12.4ms（大文件，已 setParentNodes:false）；oxc 4.1-4.89ms（约 3x）。 |
| 理论下限 | oxc 已接近解析器下限（Rust 侧零 JS 分配）；剩余 JS 成本是 **NAPI 反序列化**（OXC 文档：可达 Rust 侧 3-20 倍），对 4.89ms 总量而言反序列化可能占 ~2-4ms——再压需减少反序列化字段或把分析器搬进 Rust（重写级，不在本迭代）。ts 侧再优化空间小（换 tsgo/编译器另说）。 |
| 可优化空间 | 解析占 parse+map 的 12.4/35.5 ≈ **35%**；oxc 已省 ~8ms（总 -24%）。继续投入解析（压反序列化或 ts 解析）边际收益 **<5%**。 |
| 实现成本 | 高（若要再压）。 |
| 风险 | 中（字节等价回归面大）。 |
| ROI | **递减点已到**。 |
| 建议 | **边界已到，停止**。保留 oxc 作为可选 parser（默认仍 TS，收益已入袋）；预算转向物化。 |

### 2.4 P1-1 TS 零物化懒投影（中小文件追平）

| 维度 | 分析 |
|---|---|
| 当前值 | 300 中小文件 NEW 109-119ms vs MIXED 85-103ms；物化固定成本 ~0.10-0.15ms/文件（MIXED 无整树物化）。 |
| 理论下限 | **MIXED（无物化整树）就是下限 ≈ 85-103ms**。懒投影不能比「每访问节点投影一次」更快——访问节点数不变（大文件 ~8601、中小文件 ~几百），但对象**生命周期**从「整树存活（长命→老年代压力）」变「即用即弃（短命→Scavenger 近免费）」。 |
| 可优化空间（收益上限） | 中小文件：109-119 → ~85-103ms（**-16%~-22%**）；大文件：parse+map 35.5 → ~20-25ms（物化 23ms → 投影 ~5-8ms，**-30%~-40%**）。这是**唯一能彻底消除小文件物化固定成本**的方案。 |
| 实现成本 | 高（引擎遍历路径重构 2-4 人日）：双路径（无 legacy analyzer 时启用）、ts.Node 层重演 parent/grandparent/depth/className/binding 线程化、投影对象生命周期管理。 |
| 风险 | 高（遍历改动面大；validate 9 场景兜底但非语料边角需人工评审）。 |
| ROI | 中高（收益确定但成本/风险高，且与 P0 项收益部分重叠——P0/P1-4 先吃掉一部分差距）。 |
| 建议 | **值得做但独立里程碑**：先做第 1、2 项（§1），若届时 300 文件已 ≤95ms（差距 <10%）可降级为「不做/排后」。 |

### 2.5 增量缓存（ESLint 式两级哈希，CLI 特性）

| 维度 | 分析 |
|---|---|
| 当前值 | 无缓存；每次 scan 全量 parse+map+traverse。 |
| 理论下限 | 重复扫描未变更文件时理想省 100%（只读 stat+hash）；ESLint 实测 80-95%。hash 成本：内容哈希 ~50-100µs/中小文件、~200-400µs/大文件；被省的 work：~0.15-0.4ms/中小文件、~30-40ms/大文件 → 净省 **60-95%**（中小文件因固定成本小，净省率低于大文件）。两级哈希（内容 hash + 配置/版本 hash）防伪命中是正确性下限。 |
| 可优化空间 | 场景性收益：CI 部分构建 / watch / 重复扫描 5-20x；**单次全量扫描零收益**（hash 反而开销）。 |
| 实现成本 | 中（analyzer.ts scan 入口 + cache 模块 + CLI --cache + 失效策略，~100-200 行）；validate 不覆盖，需独立测试。 |
| 风险 | 中（缓存一致性/失效 bug 会造成陈旧结果，比性能 bug 更隐蔽）。 |
| ROI | 对产品场景中高，对当前基准循环零。 |
| 建议 | **值得做但 P2 独立排期**，不进性能迭代主线；实现时默认关闭（validate/benchmark 场景保持全量）。 |

### 2.6 worker（小文件无收益 / 冷启动）

| 维度 | 分析 |
|---|---|
| 当前值 | 基准口径 workers=1（in-process）；worker 路径（validate corpus-workers / rust-workers = 4 worker）已验证字节等价；worker 冷启动 60-100ms/个、常驻 RSS 25-35MB/个；当前每文件一条 postMessage。 |
| 理论下限 | 单文件 worker 往返开销 ~0.05-0.15ms（postMessage + structured clone）；**小文件（<1-2ms/文件）worker 永远无收益**——这是固有边界，不是可优化缺陷。大文件多 worker 并行收益上限 ≈ 文件数并行度（多文件场景实测 1.02-1.5x）；单文件无法并行（无增量式解析）。 |
| 可优化空间 | 小文件方向：**0**（边界已到）。多文件多 worker 方向：批处理消息（P0-5 第一步）摊薄往返 → 300+ 文件 -5%~-15%；主线程预读 + Buffer 零拷贝（P0-5 第二步）→ 额外 I/O 重叠。跨 scan() 复用（P2-3）仅对「同一进程多次扫描」的库调用方有意义，CLI 单次无收益。 |
| 实现成本 | P0-5 第一步中（消息协议 + 顺序索引映射）；P2-3 中（生命周期管理）。 |
| 风险 | 中（消息协议改动；保留 in-process 兜底）。 |
| ROI | 小文件 = 0；多文件多 worker = 中（取决于目标场景是否为多 worker 大语料）。 |
| 建议 | **小文件无收益是固有边界，不再投入**；只做 P0-5 批处理第一步（若多文件多 worker 是目标场景），P2-3 排后。 |

### 2.7 GC / 内存

| 维度 | 分析 |
|---|---|
| 当前值 | 每大文件 ~8601 个 NormalizedNode 对象 + ~8601 个 children 数组（叶节点占多数）+ 遍历临时；**整树在 scan 期间存活** → 长命对象进老年代，多文件累积触发 GC。V8 短命对象（Scavenger）近免费——所以 GC 成本主要来自**晋升量**。 |
| 理论下限 | 对象总量由物化决定（见 §2.1：4.3-9.5ms 对应 ~5-8k 对象/文件）；GC 成本 ∝ 老年代晋升量，**懒投影（P1-1）把大部分对象转为短命是根治**；P1-4 再消 ~5-7k 空数组/文件。 |
| 可优化空间 | 无独立于物化的动作；对象池对 V8 是争议方案（可能反把对象留老年代），不建议。 |
| 实现成本 | 0（跟随物化项）。 |
| 风险 | — |
| ROI | 随物化项获得。 |
| 建议 | **不单独做**；P1-4 顺手、P1-1 根治。观测可用 `node --trace-gc` 对比。 |

### 2.8 Known Divergences 补全（低频项）

| 子项 | 当前值 | 修复级别 | 可优化空间 | 实现成本 | 风险 | ROI | 建议 |
|---|---|---|---|---|---|---|---|
| `export * from './mod'` | oxc 跳过 ExportAllDeclaration → 模块说明符字符串**漏报**（TS 报 hardcoded-string，且 TS 不豁免 ExportDeclaration 的 moduleSpecifier） | 1 行级：物化 source 为 StringLiteral（tolerated=false），~3-10 行 | 堵漏报，行为对齐 TS | 低 | 低（加 fixture 验证方向） | 高（成本极低） | **做**（第 1 项） |
| `StaticBlock` | oxc SKIP_TYPES 含 StaticBlock → 内层函数/嵌套不计入 functions/maxNestingDepth（**漏报**） | 结构性小修：从 SKIP_TYPES 移除，映射为 Block/Other 并下降 children，对齐 TS CONTROL_OR_BLOCK（StaticBlock 不 increment nesting），~10-20 行 + fixture | 堵 metric 漏报 | 低 | 低-中（maxNestingDepth 敏感，需 fixture 比对） | 高 | **做**（第 1 项） |
| `TSParameterProperty`（`constructor(private x = 5)`） | oxc SKIP_TYPES 含 TSParameterProperty → 默认值字面量**漏报** magic-number | 结构性小修：映射 TSParameterProperty 并下降至 parameter default 字面量，~5-15 行 | 堵漏报 | 低 | 低 | 高 | **做**（第 1 项） |
| `.d.ts` | 默认 `**/*.ts` 会扫 .d.ts，但 oxc 用 lang:'ts' 而非 'dts' | 1 行级：扩展名判定加 `d.ts → 'dts'`（1-2 行）+ fixture 验证 | 覆盖真实路径 | 低 | 低（需 fixture 确认 type-only 结构字节等价） | 中 | **做**（第 1 项；若产品明确不扫 .d.ts 可降 P2） |

**共性结论**：4 项全部是 oxc **漏报方向**（无误报风险），基线语料不含这些结构 → `npm run validate` 9 场景基线**不受影响**，只需补 POC 级 fixture 做引擎比对。合计约 **0.5 人日**，是当前 ROI 最高的增量。

---

## 3. 推荐下一个迭代清单（≤3 项）

| 序 | 迭代项 | 内容 | 预期收益 | 风险 | 排期建议 |
|---|---|---|---|---|---|
| 1 | **Known Divergences 补全** | export * / StaticBlock / TSParameterProperty / .d.ts（§2.8） | 堵 4 类漏报；行为对齐 TS | 低 | 立即（0.5 人日） |
| 2 | **物化剩余热点** | P1-4 空 children 消除 + P2-1 rawKind 条件化 + introducesBinding/kindOf 短路（§2.1） | mapNode 23.1→~15-18ms；300 文件再降 ~3-8ms | 低 | 紧随第 1 项 |
| 3 | **P1-1 零物化懒投影**（分两步） | 无 legacy analyzer 时启用快速路径（§2.4） | 中小文件 109-119→~85-103ms；大文件 -30~-40% | 高 | 独立里程碑；做完 1、2 后评估差距再定 |

**排序理由**：1、2 均为低成本高确定性收益，可在同一迭代内完成并用 `scripts/bench-baselines.js` 一键验证；3 是唯一能把中小文件追平 MIXED 的方案，但成本/风险最高，必须作为独立里程碑、且以 1、2 落地后的实测差距决定去留（差距 <10% 则降级）。

**已到边界的项（不再投入）**：解析（oxc 已捕获主要收益）、worker 小文件、对象池/GC 独立优化。**排后项**：oxc 反射遍历（等 oxc 翻默认）、增量缓存（P2 CLI 特性）、worker 跨 scan 复用（P2 库场景）。
