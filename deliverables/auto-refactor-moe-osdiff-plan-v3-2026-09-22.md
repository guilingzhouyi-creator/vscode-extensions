# auto-refactor 规则扩展计划 v3 —— MoE 稀疏激活深度对齐版

> ⚠️ **已被 v4 定稿取代**：5 项开放问题已于 2026-09-22 拍板（F1=真 Diff · F2=方案 B · 门禁=三级精细化加权成本比 · AgentProfile=新增且完整定义 · MANIFEST=纳入含容器/CI）。
> 定稿设计与总计划表见 `auto-refactor-moe-osdiff-plan-v4-locked-2026-09-22.md`；本文件的 **F1–F8 缺陷清单与事实索引仍然有效**。

> **修订关系**：本文件取代 `auto-refactor-moe-osdiff-rule-expansion-plan-v2-2026-09-22.md` 的性能模型与路由设计章节；v1 缺口清单与 v2 的批次划分仍然有效。
> **v3 相对 v2 的实质变化**：① 勘误 v2 的性能数值（v2 的路由模型**不完整且部分错误**）；② 补齐 4 项正交路由机制、置信分层与代码角色两个此前完全遗漏的杠杆；③ 新增 8 项**代码可验证**的实现级缺陷（F1–F8），其中 2 项会使 v1 的 P0 安全规则**结构性失效**；④ 修正指标测量精度与门禁语义。
> **日期**：2026-09-22 · **性质**：设计提案，不含实现 · **依据**：以下所有事实均标注源码位置，可现场复现

---

## 0. v2 勘误（Errata）

v2 的路由模型只考虑了"类别 → 分析器"，**遗漏了共享专家、语言门控、原型矩阵、置信分层四个正交机制**，导致数值错误。

| v2 表述 | 实际实现 | 正确值 | 证据 |
| :--- | :--- | :--- | :--- |
| 字面量 diff 激活 `2/21 = 0.095` | 未计入 `injectSharedExperts` | **`3/21 = 0.143`** | `sparseRuleRouter.ts:283-290,337`；`SHARED_EXPERTS=[hygiene,constants]`（:202） |
| 文档 diff 激活 `2/21 = 0.095` | 文档 diff 只激活 comments（不含 docs），且**共享专家被跳过** | **`1/21 = 0.048`** | `COMMENT_DOC_ONLY:[COMMENTS]`（:149）；`injectSharedExperts` 首行 `if (isDocOnly) return` |
| 未提及 | **纯删除 / 空变更是 `isDocOnly=true` 且 `LITERAL_ONLY`** | **`2/21 = 0.095`** | `buildEmptyClassificationResult`（`diffClassifier.ts:264-278`） |
| "6 个类别"是唯一分类维度 | 实为 **6 类别 + 4 原型 + 语言门控 + 共享专家** 四机制叠加 | 见 §1 | `ARCHETYPE_ANALYZER_MATRIX`（:160）、`applyLanguageGating`（:266）、`LANGUAGE_EXCLUSIVE_ANALYZERS`（:207） |
| 未提及置信分层 | `confidenceTier: HIGH\|MEDIUM\|LOW`，**驱动 tiered verification bypass** | 新规则必须声明各层行为 | `diffClassifier.ts:72-73,221-236` |
| 未提及代码角色 | `codeRole: PRODUCTION\|TOOL_SCRIPT\|TEST_SUITE` | 可直接用于 Agent 场景分域 | `diffClassifier.ts:244-259` |
| 门禁 ≤0.25 是"全局约束" | 实际**仅对 LITERAL_ONLY 断言**；`CONTROL_FLOW` 实测 **0.286 已超 0.25** 而未被拦截 | 须按类别分别设目标 | `validate-asymmetric-routing.js:110`（literal）、`:168`（doc） |

> v2 的方法论问题：仅依据文件头注释推断行为。v3 全部结论均基于实现体（函数体、矩阵常量、断言语句），并附行号。

---

## 1. 路由架构全景（v3 修正版）

### 1.1 两种链路、两套词表、两套机制

| | 切片链路（Praxis OSDIff） | Diff 链路（FastTrack） |
| :--- | :--- | :--- |
| 入口 | `SparseMoEGateRouter.routeSlice(slice)` | `routeDiffToAnalyzers(classification, options)` |
| 分类输入 | `SliceFeatureVector`（7 布尔） | `DiffSemanticCategory`（6 类别，**行正则**得出） |
| 类别来源 | 由 `sliceExtractor` 从 AST 切片推导 | `inspectLines` 逐行正则（`diffClassifier.ts:134-176`） |
| 共享专家 | ❌ 无 | ✅ `[hygiene, constants]`（doc-only 时跳过） |
| 原型矩阵 | ❌ 无 | ✅ `demo/web/game/library` 仅作用于 `GENERAL_CODE` |
| 语言门控 | ❌ 无 | ✅ `applyLanguageGating`（按扩展名推断语言剪枝） |
| 自定义分析器 | ❌ 无 | ✅ `customAnalyzers` 恒激活 |
| 置信分层 | ❌ 无 | ✅ `confidenceTier` |
| 代码角色 | ❌ 无 | ✅ `codeRole` |
| 是否执行分析器 | ❌ **只出计划**（`sliceAuditService.auditSlice`） | ✅ 执行（`FastTrackVerdict.issues`） |

**结论**：Diff 链路的调度能力显著强于切片链路，但**两者的分类词表互不联通**。任何新专家必须在**两处**分别声明，否则在另一条路径静默失效。

### 1.2 计算激活面的真实公式

```
active = ( ∪ category_targets(cat_i, archetype) )
       ∪ ( isDocOnly ? ∅ : SHARED_EXPERTS )
       ∪ customAnalyzers
       ∩ availableAnalyzers        // 配置相关，见 F4
       then applyLanguageGating(language)   // 按推断语言剪除语言专属分析器
ratio  = |active| / max(1, |availableAnalyzers|)
```

**实测（`availableAnalyzers = ALL_BUILTIN_ANALYZERS`，N=21，门禁脚本的调用方式）**

| 场景 | 激活集合 | 数量 | ratio | 既有门禁 | 实际 |
| :--- | :--- | ---: | ---: | :--- | :--- |
| `LITERAL_ONLY` | constants, secrets, **hygiene**(共享) | 3 | **0.143** | ≤0.25 | ✅ 余量 0.107 |
| `COMMENT_DOC_ONLY` | comments（共享被跳过） | 1 | **0.048** | ≤0.15 | ✅ |
| 空变更/纯删除 | constants, secrets | 2 | **0.095** | 无断言 | ⚠️ 见 F1 |
| `IMPORT_EXPORT` | dep-graph, architecture, governance, hygiene, constants | 5 | **0.238** | 无断言 | — |
| `CONTROL_FLOW` | complexity, performance, hygiene, governance, security, constants | 6 | **0.286** | 无断言 | ⚠️ **已超 0.25** |
| `INTERFACE_SIGNATURE` | architecture, governance, hygiene, comments, security, constants | 6 | **0.286** | 无断言 | ⚠️ 同上 |
| `GENERAL_CODE`（无原型） | 全部 | 21 | **1.000** | 无断言 | 兜底 |
| `GENERAL_CODE` + `library` | 12 项原型集 | 12 | **0.571** | 无断言 | 兜底 |
| `GENERAL_CODE` + `web`/`game` | 7 项 | 7 | **0.333** | 无断言 | 兜底 |

---

## 2. 新发现的实现级缺陷（F1–F8）

### F1【P0】纯删除变更对分类器完全不可见 —— Agent 删掉校验/守卫时"零审查"

`extractChangedLines`（`diffClassifier.ts:101-118`）在未提供 `changedLines` 时，只收集**新内容中不存在于旧内容**的行：

```js
for (const l of newL) if (!oldLines.has(l) && l.trim()) linesToInspect.push(l);
```

**后果**：若一次变更是**纯删除**（删除一行 guard clause、删除一处权限校验、删除一个 `try/catch`），则 `linesToInspect.length === 0` → `buildEmptyClassificationResult` → `categories={LITERAL_ONLY}`、`isDocOnly=true`、`confidenceTier='HIGH'` → 路由到 **{constants, secrets} 2/21**，且置信层 HIGH 触发**推测式免检旁路**。

> 这是 Agent 编程最危险的失效模式之一：**移除安全措施不产生任何可审查信号**。而"新增违规代码"反倒会被 `GENERAL_CODE` 兜底扫到——审查系统的灵敏度与风险方向**正好相反**。
>
> **修正要求**：`changedLines` 语义需扩展为 `removedLines` + `addedLines` 双向；`isDocOnly` 不应由"新增行为注释"推断，而应由"删除行也是注释"共同判定。此项是 `SEC-*` / `MNT-API-001` / `HYG-EQV-001` 全部前置。

### F2【P0】注释中的注入被路由到"1 个分析器 + HIGH 置信 + 免检旁路"

`buildClassificationResult` 在 `obs.allComments` 时**立即返回** `COMMENT_DOC_ONLY / isDocOnly=true`（`diffClassifier.ts:290-304`）。随后：
- 路由：`COMMENT_DOC_ONLY: [COMMENTS]` → **1/21**，且 `injectSharedExperts` 跳过共享专家；
- 置信：`computeConfidenceTier(..., true) → 'HIGH'`，注释明示"safe for speculative bypass"。

> **后果**：v1 的 P0 `SEC-INS-001/002`（注释/文档中的指令注入、零宽与双向控制字符）在**当前分类 → 路由 → 置信**三段管线下**全部被旁路**。攻击者只需把 payload 写进注释，即可让审查系统以"最低成本 + 最高置信"放过它。
>
> 切片链路同病：`sparseMoEGate.dispatchSliceExperts` 对 `isDocOnly` 同样立即 return（仅 comments + docs）。

**修正设计**（二选一，推荐 A）：
- **A（最小侵入）**：`COMMENT_DOC_ONLY` 目标集加入新专家 `instruction-surface`，并**取消 doc-only 的共享专家豁免**（共享专家中的 conflicts 见 §3.3 成本核算）。
- **B（语义更正确）**：新增独立类别 `INSTRUCTION_SURFACE`，仅当注释行命中指令/不可见字符模式时置位，保持 `COMMENT_DOC_ONLY → 1` 不变。此方案不污染既有的 doc 比例门禁（≤0.15）。

### F3【P1】报告区分"计划"与"实际"，但现有门禁断言的是**计划**

`report.schema.json:130` 明确：「active/skipped 描述路由**本应**启用什么，除非 `applied` 为真；**实际运行的是 `disabledAnalyzers` + `byAnalyzer`**」。

`validate-asymmetric-routing.js` 断言的 `activationRatio` 来自 `routeDiffToAnalyzers()` 的返回值 —— 即**计划比例**，而非实跑比例。结合 v2 已证实的「`auditSlice` 不执行分析器」，**当前所有比例门禁都可能在没有真实执行的情况下通过**。

> **修正**：指标必须成对采集 `advisedRatio` 与 `appliedRatio`，门禁断言落在 `appliedRatio`；`applied=false` 时必须显式告警而非静默通过。

### F4【P1】比例门禁的分母随配置变化 → 跨消费方不可比

`ratio = active / |availableAnalyzers|`，而 `availableAnalyzers` 来自 scanner plan（配置相关）。

- 门禁脚本：不传 options → **N=21**；
- 本仓库生产自审：config 仅启用 9 个分析器 → **N=9**。

同一次 `LITERAL_ONLY` 变更，在 N=21 下为 0.143，在 N=9 下为 `{constants, hygiene}` → **2/9 = 0.222**（门禁余量仅 0.028）。**同一阈值 0.25 在两种配置下含义不同**。

> **修正**：门禁与报告统一改用**固定归一化基准**（如 `ALL_BUILTIN_ANALYZERS` 为分母）或**加权成本比**（§5.1）。

### F5【P1】延迟测量精度不足以验证 sub-10ms 与微秒级预算

`sliceAuditService.auditSlice`：`const latencyMs = Math.max(1, Date.now() - startTime)`（:132）。

- `Date.now()` 为 **1 ms 整数分辨率**；
- `Math.max(1, …)` 使最小值为 **1**，**低于 1ms 的耗时全部被记为 1ms**。

> **后果**：v2 提出的 M5（`sliceAuditLatencyMs` P50<10ms / P95<20ms）与 M6（fast ≤150μs、deep ≤2ms）**在该测量方式下不可验证**：150μs 落在分辨率之下；"sub-10ms" 仅有 10 个量化台阶。
>
> **修正**：新增 `perf-metrics` 门面，统一使用 `process.hrtime.bigint()`（或 `performance.now()`）并以 `Ns`/`μs` 双单位上报；`latencyMs` 保留为**向后兼容字段**（取整），新增 `latencyUs` 作为门禁依据。

### F6【P2】未知类别静默 fail-open 到全量扫描 + 硬编码字符串比较

```js
function resolveCategoryTargets(cat, archetype) {
    if (cat === 'GENERAL_CODE' && archetype) { ... }     // ← 硬编码字面量，未用 GENERAL_CODE_CATEGORY 常量
    return CATEGORY_ANALYZER_MATRIX[cat] || ALL_BUILTIN_ANALYZERS;   // ← 未知类别 → 全量
}
```

> **后果**：新增类别时若忘记更新矩阵，不会报错，而是**静默退化为 100% 激活** —— 表现为性能回退而非功能失败。同时 `'GENERAL_CODE'` 硬编码与 `GENERAL_CODE_CATEGORY` 常量并存，重构时易漂移。
>
> **修正**：`validate-rules-registry.js` 增加断言「`CATEGORY_ANALYZER_MATRIX` 的键集 ≡ `DiffSemanticCategory` 联合类型全集」；并把硬编码字面量替换为常量。

### F7【P1】扩展名驱动的语言推断 → 清单类文件无语言、无门控

`EXTENSION_ADAPTER_IDS`（`ast/adapters.ts:55-66`）仅含 **10 个扩展名**：`.ts/.tsx/.js/.jsx/.mjs/.cjs`（typescript）· `.rs` · `.gd` · `.py` · `.md`。
`inferLanguageFromPath`（`diffClassifier.ts:190-215`）额外识别 `.md→markdown`，其余返回 `undefined`。

**后果（三重）**：
1. `package.json` / lockfile / `requirements.txt` / `Cargo.toml` **不在 AST 适配器表内** → 供应链接口（`SEC-SUP-*`）**无落点**；
2. `applyLanguageGating` 在 `language === undefined` 时**直接 return**（`:267 if (!language) return;`）→ 语言专属分析器**不被剪枝**，可能在非源码文件上被激活（浪费）；
3. `.sh` / `.ps1` / `.yaml` / `.toml` 同样无语言标识 → `SEC-OPR-001`（危险操作原语）在脚本语言上无门控依据。

> **好消息**：`registerAdapter(adapter)`（`ast/adapters.ts:103-106`）**已支持运行时注册适配器**（last-writer-wins，按 `adapter.extensions` 认领文件），且 `EXTENSION_ADAPTER_IDS` 由 `validate-language-support.js` 断言防漂移。**新增 `MANIFEST` / `NON_SOURCE` 适配器无需改动核心引擎** —— 这是本方案泛化能力的既有抓手。

### F8【P2】文档口径三处不一致，且无机器守卫

| 出处 | 声称 |
| :--- | :--- |
| `sparseMoEGate.ts:6` | 激活比例 **10%~25%** |
| `sparseRuleRouter.ts:5` | 削减 **80%~95%** 遍历工作量 |
| `docs/05-specs-and-benchmarks/02-performance-benchmarks.md:53` | 仅激活 **15%~35%** 专家 |

实测（§1.2）为 **0.048 ~ 1.000**，三处口径均不准确。由 `DOC-DRV-001` 收敛。

---

## 3. 新专家接入设计

### 3.1 统一信号层（消除双词表）

```ts
/** 单一真源的变异信号；两条链路均映射到它 */
export type MutationSignal =
    | 'LITERAL' | 'CONTROL_FLOW' | 'SIGNATURE' | 'IMPORT_EXPORT'
    | 'DOC_COMMENT' | 'ASYNC' | 'IO' | 'TYPE'
    | 'MANIFEST'          // 新增：清单/构建文件
    | 'NON_SOURCE'        // 新增：非源码制品（scratch/tmp/log/.gitignore）
    | 'CONFIG_SECURITY'   // 新增：危险配置默认值
    | 'DELETION';         // 新增：纯删除（F1 修正）
```

- **切片链路**：`SliceFeatureVector` → `MutationSignal[]`，并补齐 `ASYNC/IO/TYPE`（切片侧已有，Diff 侧缺）与 `DELETION`。
- **Diff 链路**：`DiffSemanticCategory` → `MutationSignal[]`，并补齐 `ASYNC/IO/TYPE/MANIFEST/NON_SOURCE/DELETION`。
- **守卫断言**（加入 `validate-rules-registry.js`）：① 两链路映射覆盖 `MutationSignal` 全集；② 每个专家至少绑定 1 个信号；③ `CATEGORY_ANALYZER_MATRIX` 键集 ≡ 类别全集（F6）。

### 3.2 专家契约

```ts
export interface ExpertManifest {
    readonly id: string;                 // 与 ANALYZER_* 常量一致
    readonly family: string;
    readonly track: 'fast' | 'deep' | 'off';
    readonly signals: readonly MutationSignal[];
    readonly languages: readonly string[] | 'all';
    readonly steadyCost: 'O(1)' | 'O(n)' | 'O(graph)' | 'O(files)';
    readonly weight: number;             // 加权成本，供 §5.1 门禁使用
    readonly minConfidenceTier: 'HIGH' | 'MEDIUM' | 'LOW';  // 低于此层不激活
    readonly codeRoles?: readonly CodeRole[];               // 作用域限缩
    readonly fallback: 'skip' | 'escalate-deep';
    readonly latencyBudgetUs: number;    // fast ≤150 / deep ≤2000
}
```

`minConfidenceTier` 与 `codeRoles` 是 v3 新增的两个**零成本门控杠杆**：前者复用既有 `confidenceTier`，后者复用既有 `codeRole`，都不需要新的扫描。

### 3.3 为什么新专家**不得**进入 `SHARED_EXPERTS`

`SHARED_EXPERTS` 是**无条件激活**集合。若把 `supply-chain` / `instruction-surface` / `dangerous-ops` 放入其中，则**每一次任意代码变更**都要付出其成本 —— 与"零稳态成本"原则直接冲突。数学上的代价：

| 方案 | 新增后 literal ratio | 备注 |
| :--- | :--- | :--- |
| 进 `SHARED_EXPERTS` | (3+3)/21 = **0.286** | **直接击穿 ≤0.25 门禁** |
| 绑定信号（推荐） | (3+0)/21 = **0.143** 稳态；信号命中时 (3+1)/21 = **0.190** | 门禁内，且成本随风险出现 |

> 结论：新增安全专家**必须**走"类别/信号绑定"，唯一例外是 `instruction-surface` 在 F2 修正方案 A 下的"取消 doc-only 共享豁免"——那仍属**类别绑定**（把该专家加入 `COMMENT_DOC_ONLY` 目标集），不是无条件激活。

### 3.4 非源码适配器（`registerAdapter` 路线，无需改核心）

```ts
// 新增适配器（示意）——经 registerAdapter 注册，扩展名认领
registerAdapter(new ManifestAdapter());   // extensions: ['.json','.lock','.toml','.txt','.yaml']
registerAdapter(new NonSourceAdapter());  // 认领 .gitignore / scratch/** / tmp* / *.log
```

要求：
1. 同步更新 `EXTENSION_ADAPTER_IDS` 与 `validate-language-support.js` 的断言（既有防漂移机制）；
2. `inferLanguageFromPath` 增加 `'manifest' | 'non-source'` 返回值，使 `applyLanguageGating` 能正确剪枝；
3. 清单解析结果按 **lockfile 内容哈希**缓存（§6）。

### 3.5 输出本地化（三层解耦，机器路径零成本）

```ts
// 稳定层恒英文，绝不做本地化
rule.id / rule.family / analyzer.id / metric key / SARIF field / JSON field
// 文案层：messages/locales/{en,zh-CN}.json，键 = rule id
type MessageCatalog = Record<string, { summary: string; remediation: string }>;
// 报告层：仅 format=text 与 SARIF message.text 渲染 locale
export interface ReportOptions { locale?: 'en' | 'zh-CN'; }   // 默认 'en'
```

**硬约束**：`format=json` / `sarif` 路径**不得加载任何 locale 字典**（惰性 `import()` 按需）；默认 `en` 时**零字典加载**（文案内联回退）。

### 3.6 延迟预算与降级

```ts
export interface PraxisSliceAuditInput {
    // ...既有字段保持不变（向后兼容）
    latencyBudgetMs?: number;   // 默认 10
    profile?: AgentProfileName; // 默认 'standard'
}
// 超预算时：不抛错、不静默截断，改为
//   ① 返回 status:'WARN'
//   ② routingPlan.reasons 追加 'LATENCY_BUDGET_EXCEEDED: 已降级为 DeepTrack 异步复核'
//   ③ 经 EscalationChannel 发 DEGRADED_REVIEW 事件（复用既有通道）
```

---

## 4. 修正后的性能影响模型

### 4.1 成本落点分解（按流水线阶段）

| 阶段 | 既有成本（实测基线） | 新专家的增量 | 归因 |
| :--- | :--- | :--- | :--- |
| 文件发现 + 语言推断 | 扫描器路径匹配 | `MANIFEST`/`NON_SOURCE` 增加 **≤4% 文件数**（2.51MB 源码 vs 清单合计 <100KB） | 一次性 IO |
| 行级分类（`inspectLines`） | O(变更行) 正则 | **≈0**：新增类别复用同一次逐行循环，仅多 1~3 个正则（同量级既有 4 个正则） | 亚微秒 |
| 路由计算 | 集合运算 | O(1) | 可忽略 |
| 专家执行 | 21 分析器子集 | **新增专家被信号门控**：稳态增量为 0 | 关键项 |
| 制品/清单解析 | 无 | 按哈希缓存后 **≈0（未变更时）** | 需缓存 |
| locale 渲染 | 无 | `json`/`sarif` = **0**；`text` = O(报告条数) 字典查表 | 惰性加载 |

### 4.2 延迟预算（修正 F5 后）

| 路径 | 既有 | v3 目标 | 余量 |
| :--- | :--- | :--- | :--- |
| FastTrack | 实测 0.22ms / 目标 <15ms | 新增专家合计 ≤ **+1ms**（P95） | 68× → 仍 >60× |
| `auditSlice` | 当前 **不执行分析器**（无法与既有时延比较） | 首版仅注入 `track:'fast'` 专家，P50 ≤10ms / P95 ≤20ms | 需以 hrtime 实测建立新基线 |
| 单专家 | — | fast ≤150μs/文件；deep ≤2ms/文件 | 逐规则门禁 |

### 4.3 吞吐量与内存

| 指标 | 既有 | 预期 | 依据 |
| :--- | :--- | :--- | :--- |
| 全域吞吐 | 3.66 MB/s | ≥ 3.5 MB/s（≤4.5% 降幅） | 文件数 +≤4%、稳态专家成本 0 |
| 内存 | LoadGovernor 阈值 RSS 600MB / heap 450MB，超限即把 deep 并发压到 1 | 增量 ≤5%，且不得触及阈值 | `loadGovernor.ts:23-26,70-71` |
| deep 并发 | MICRO 4 / STANDARD 4 / ENTERPRISE 6 / MASSIVE 8 | 新增 `O(files)` 专家标记为低优先级，不占用该额度 | `loadGovernor.ts:44-68` |

---

## 5. 指标与验证 v3

### 5.1 门禁语义升级（替代 v2 的 M2/M3）

```ts
// 旧：ratio = |active| / |available|        —— 配置相关、可被分母膨胀稀释
// 新：加权成本比（分母固定为全量内置集，与配置解耦）
weightedCostRatio = Σ weight(active) / Σ weight(ALL_BUILTIN_ANALYZERS)
// 并保留绝对上界，防止分母效应掩盖回归
assert(activeCount(retainedCategories) <= categoryCap[cat])
```

| 类别 | 现行 | v3 目标 |
| :--- | :--- | :--- |
| `LITERAL_ONLY` | ≤0.25 | ≤0.25（**加严为 ≤3 个专家**，因 0.143 已含余量论证） |
| `COMMENT_DOC_ONLY` | ≤0.15 | ≤0.15，且 F2 修正后**显式允许 2 个专家**（comments + instruction-surface） |
| `CONTROL_FLOW` | 无断言（实测 0.286） | 新增 ≤0.30（**首次纳入门禁**，当前存在 14% 的未守护空间） |
| `GENERAL_CODE` | 无断言（1.000 / 原型 0.333~0.571） | 新增：启用原型时必须 ≤0.60 |

### 5.2 指标体系（v2 的 M1~M12 修正版）

| # | 指标 | 修正点 | 目标 | 采集点 |
| :--: | :--- | :--- | :--- | :--- |
| M1 | `advisedRatio` | 保留，明确为"计划" | 见 §5.1 | `summary.activatedReviewers.activationRatio` |
| M2 | `appliedRatio` | **新增：实跑比例**（F3） | 与 advised 差值 ≤0.10 | `disabledAnalyzers` + `byAnalyzer` |
| M3 | `weightedCostRatio` | 分母固定（F4） | ≤0.20 | 新增字段 |
| M4 | `categoryCapViolation` | 新增：按类别绝对上界 | 0 | 新增断言 |
| M5 | `fastTrackLatencyUs` | **hrtime 精度**（F5） | P50≤15000 / P95≤30000 | `FastTrackVerdict` + 新字段 |
| M6 | `sliceAuditLatencyUs` | **hrtime 精度**（F5） | P50≤10000 / P95≤20000 | `PraxisSliceAuditVerdict` + 新字段 |
| M7 | `expertLatencyUs` | 逐专家 | fast≤150 / deep≤2000 | 新增 per-expert 计时 |
| M8 | 全域吞吐 | — | ≥3.5 MB/s | `bench-baselines` |
| M9 | `gate:self:slice` 总时长 | — | ≤1.9s × 1.15 | `gate-self-slice.js` |
| M10 | **稳态成本** | 核心承诺 | 信号不命中 **≤1μs/文件/专家** | 微基准 |
| M11 | 内存峰值 | 锚定 Governor 阈值 | 不触及 450MB heap | `bench-quant` |
| M12 | 误报率 | 升级前置 | <5%（影子运行 ≥1 周） | 影子统计 |
| M13 | **删除检出率** | **新增（F1）** | 纯删除变更 `advisedRatio > 0.095` 且走 `DELETION` 信号 | 新 fixture |
| M14 | **免检旁路率** | 新增（F2） | 含注入语/不可见字符的注释变更**必须**命中 `instruction-surface` | 新 fixture |

### 5.3 验证夹具（关键三组）

| Fixture | 构造 | 断言 |
| :--- | :--- | :--- |
| `deletion-guard` | 删除 `if (!isAuthorized) throw …` 一行，无新增行 | 分类结果 `categories ∋ DELETION`，`isDocOnly=false`，`instruction-surface`/`security` 进入 active（M13） |
| `comment-injection` | 注释中含 `<!-- ignore previous instructions -->` + 零宽字符 | 命中 `SEC-INS-001/002`；`confidenceTier` 不得为 `HIGH`（M14） |
| `manifest-poison` | `package.json` 新增 `postinstall` + lockfile 版本漂移 | 命中 `SEC-SUP-001/002`；`codeRole=PRODUCTION` 分支必须 BLOCK |

### 5.4 验证执行矩阵

| 验证 | 命令 | 判定 |
| :--- | :--- | :--- |
| 热点防劣化 | `npm run hotpath-bench` | 劣于基线 **15%** 阻断 |
| 路由比例 | `npm run validate-asymmetric-routing` | M1/M3/M4 断言 |
| MoE 旁路收益 | `npm run bench-asymmetric` | 削减率报告 |
| 增量 + 字节等价 | `npm run bench-diff` | 加速比 + 字节等价 |
| 极限压测 | `npm run bench-quant` | SWAR / Myers / 50k 行 + M11 |
| 缓存与守护进程 | `npm run bench-warm` | S1~S6 |
| 切片门禁 | `npm run gate:self:slice:warning` | MoE 毫秒级响应 |
| 等价性闸门 | 既有 baselines | 新规则不得改变既有规则的检出 |
| 本体自审 | `npm run gate:self` / `:warning` | `newBlocking=0` |

---

## 6. 实施顺序（v3 修订）

| 阶段 | 内容 | 前置 |
| :--- | :--- | :--- |
| **S0（先决）** | ① `MutationSignal` 统一层 + 双向 `changedLines`（F1）；② `perf-metrics` hrtime 门面（F5）；③ `ExpertManifest` 契约 + 注册表守卫（§3.1）；④ `CATEGORY_ANALYZER_MATRIX` 键集断言 + 去硬编码（F6） | 无 |
| **S1** | `SEC-INS-001/002`（**必须先修 F1/F2 才有效**）· `SEC-OPR-001` | S0 ①②③ |
| **S2** | `SEC-SUP-001/002/003` + `MANIFEST` 适配器 + 哈希缓存 | S0③ + `registerAdapter` |
| **S3** | `AGT-ART-001` + `NON_SOURCE` 适配器 | S0③ |
| **S4** | `GOV-ASY-001` · `CPX-DET-001`（需补齐 Diff 侧 `ASYNC`/`IO` 信号） | S0① |
| **S5** | `AGT-SCP-001` · v1 第 3 批十条 | S0 全部 |
| **S6** | v1 第 4 批 + `DOC-DRV-001`（收敛 F8 三处口径）+ locale 层 | S0④ |

**回滚与开关**：

| 机制 | 设计 |
| :--- | :--- |
| 规则级开关 | `experts.<id>.enabled`（默认 `off` 直到影子验证通过） |
| 全局 kill switch | `experts.disabled: string[]` 一键回退，不需发版 |
| 轨道降级 | `track: fast → deep` 单键切换，用于延迟回归时止血 |
| 基线策略 | 沿用"只降不升 + `gate:self:update` + 提交信息给出理由"（AGENTS.md 口径） |

**可观测性**：每次扫描输出 `routingPlan.reasons`（已有）+ 新增 `degraded[]`（降级原因）与 `expertsSkippedBySignal[]`，使"为什么没跑"可自证——这正是当前 F1/F2 类缺陷难以被发现的根因（**缺"未执行原因"的可观测性**）。

---

## 7. 待决策的开放问题

1. **F1 的修法**：`changedLines` 扩展为 `{added, removed}` 双向（改动调用方契约），还是在引擎内部对 `oldContent/newContent` 做一次真正的行级 diff（Myers，已有 `bench-diff` 优化基础）？后者不改契约但增加 O(n) 成本。
2. **F2 的修法**：扩 `COMMENT_DOC_ONLY` 目标集（方案 A，改动小、影响 doc 比例门禁），还是新增 `INSTRUCTION_SURFACE` 类别（方案 B，语义更准、需扩分类器断言）？
3. **比例门禁口径**：接受 §5.1 的"加权成本比 + 分类别绝对上界"（需同步修改 3 个断言），还是仅固定分母（改动更小）？
4. **`AgentProfile` 落点**：复用 `author` 字段（零契约变更，但语义弱）还是新增 `profile` 字段（语义清晰，需更新 `report.schema.json` 与消费方）？
5. **`MANIFEST` 适配器的作用域**：仅覆盖 JS/Python/Rust 生态的 5 类清单，还是同时纳入 Dockerfile / CI YAML（会显著扩大第 2 批范围）？

---

## 附录：v3 事实索引（可复现）

| 事实 | 位置 |
| :--- | :--- |
| 共享专家 `[hygiene, constants]`，doc-only 跳过 | `src/core/router/sparseRuleRouter.ts:202, 283-290, 337` |
| 类别矩阵 6 行 + 原型矩阵 4 行 | `sparseRuleRouter.ts:116-194` |
| 语言门控 / 语言专属分析器表 | `sparseRuleRouter.ts:207-213, 266-274` |
| 未知类别 fail-open 全量 + 硬编码 `'GENERAL_CODE'` | `sparseRuleRouter.ts:250-258` |
| ratio = active / \|available\|，3 位小数 | `sparseRuleRouter.ts:361-363` |
| 行正则分类器 / 纯删除不可见 | `src/core/router/diffClassifier.ts:101-118, 134-176` |
| doc-only 立即 return + HIGH 置信 | `diffClassifier.ts:221-236, 290-304` |
| 空变更 → `LITERAL_ONLY + isDocOnly=true` | `diffClassifier.ts:264-278` |
| 扩展名 → 语言（10 项 + markdown） | `diffClassifier.ts:190-215`；`src/core/ast/adapters.ts:55-66` |
| `registerAdapter` 运行时注册 | `src/core/ast/adapters.ts:103-106` |
| `latencyMs = max(1, Date.now()-start)` | `src/core/praxis/sliceAuditService.ts:132` |
| `auditSlice` 不执行分析器 | `sliceAuditService.ts:110-131` |
| 切片门控：doc-only 立即 return | `src/core/router/sparseMoEGate.ts:49-54` |
| `activatedReviewers` = 建议 vs 实跑 | `report.schema.json:130-150` |
| 比例断言：literal ≤0.25 / doc ≤0.15 | `scripts/validate-asymmetric-routing.js:110, 168` |
| 切片比例断言 ≤0.25 | `scripts/validate-self-slice-audit.js:99` |
| LoadGovernor 分级与阈值 | `src/core/profiler/loadGovernor.ts:23-71` |
| 热点基线的 15% 阻断 | `docs/05-specs-and-benchmarks/02-performance-benchmarks.md:60` |
