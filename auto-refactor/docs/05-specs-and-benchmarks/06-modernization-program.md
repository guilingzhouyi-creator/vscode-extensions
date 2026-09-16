# 引擎现代化改造计划（六域）

> **状态**：计划基线 2026-09-15 ｜ 引擎自审口径 **144 文件 / 6,758 发现 / 政策留痕 4,450 / error 52**（基线 827 组，`npm run gate` 绿）
> **总原则**：每一批改造都必须**降低自审指标**、**附回归锁**、**保持 `npm run gate` 全绿**、**文档与代码同批更新**；基线只允许单调下降（棘轮）。
> **反向指标**：误报率以三个真实消费方（Python / GDScript / TS 各一，配置与报告留在各自仓库）交叉验证，不得为了让数字好看而放宽规则语义。

---

## 0. 当前基线（作为每批的对照）

| 指标 | 现状 | 目标（本计划完成时） |
| :--- | ---: | ---: |
| error 级发现 | 52 | **0** |
| warning 级发现 | 2,156 | ≤ 800 |
| `magic-number` | 792 | ≤ 200 |
| `duplicate-literal` | 278 | ≤ 100 |
| `GOV-PRF-004` / `PRF-IO-001`（同步 IO） | 78 / ≤24 | 0（库代码）/ 政策分流 |
| `GOV-TYP-003`（裸 any） | 105 | ≤ 30 |
| `GOV-DBG-001`（console） | 374 | 政策分流 + ≤ 50 |
| `high-complexity` / `SIM-LONG-001` / `large-file` | 124 / 112 / 32 | 各减半 |
| 基线组数 | 827 | ≤ 600 |

---

## 1. 自身常量化改造（Self-Constantization）

**问题**：792 处 `magic-number`、278 处 `duplicate-literal`，集中在阈值表、字节/协议边界与 `scripts/` 基准脚本。

**分级策略**（避免"为了消警告而制造垃圾常量"）：

| 级别 | 对象 | 处理 | 例子 |
| :--- | :--- | :--- | :--- |
| L1 协议/编码常量 | 位掩码、编码边界、字节窗口 | 必须具名，块状声明 | `src/core/utf8.ts` ✅ 25 → 0 |
| L2 阈值/权重表 | 评分权重、规模分级、启发式表 | 收敛为单一 `TUNING`/`HEURISTICS` 常量块，按语义分组 | `src/core/profiler/scaleTuner.ts`(43)、`src/core/governance/semanticLiterals.ts`(78) |
| L3 重复字面量 | 同值 ≥N 次的字符串/数字 | 抽公共常量并消 `duplicate-literal` | `src/core/oxcAdapter.ts`(19)、`scripts/bench-*` |
| L4 结构性小数字 | `0/1/2`、数组下标、`slice(0,1)` | **不强制常量化**：把自审阈值调到 `magicNumberMin: 3`，并在配置 `_comment` 说明 | 全仓库 |

**批次**：
1. ✅ B1 `utf8.ts`（L1，25 → 0）
2. B2 `scaleTuner.ts` + `semanticLiterals.ts`（L2，合并为 `TUNING` 块；预计消 100+）
3. B3 `src/core/*.ts` 其余高发文件 + L4 阈值策略落地（预计消 200+）
4. B4 `scripts/*.js` 常量化（基准/校验器共享 fixtures 常量；预计消 150+）

**验收**：`magic-number` ≤ 200、`duplicate-literal` ≤ 100；每批附"提取前后对照 + 无行为变化"证据（等价金标不变）。

---

## 2. 规则集集中管理（Rule Registry）

**问题**：规则元数据分散在 analyzer 实现、`core/messages`、`docs/04` 表格、`DOCS.md` 索引；新增规则要改 4 处，容易漂移（本仓库已出现过文档 ID 与实现不一致）。

**方案**：
1. 新增 `src/core/rules/registry.ts`：单一注册表，每条规则声明
   `{ id, family, analyzer, languages, severity, level, summary, remediation, docsAnchor, internalizedFrom?, options? }`。
   - governance 已有 `GovernanceRule` 注册表 → 迁移为同一抽象（`defineRule()`），保留其 `checkNode/checkFile` 钩子。
2. **由注册表生成**（不手写）：
   - `docs/04-analyzers-and-rules/01-builtin-rules.md` 的规则表格（生成区块 + `<!-- generated -->` 标记）；
   - CLI `--help` 的规则清单、SARIF `rules[]` 元数据、报告中的 rule 描述；
   - `report.schema.json` 里 rule 枚举（可选）。
3. 新增守卫 `scripts/validate-rules-registry.js`（挂进 `npm test`）：
   - **三方一致**：注册表 ↔ analyzer 实现产出的 ruleId ↔ 文档表格；
   - 无孤儿（实现了未登记 / 登记了未实现）、ID 格式合法、`languages` 与实测一致。

**验收**：新增一条规则只改"注册表 + 实现"两处；`validate-rules-registry` 在 CI 强制。

---

## 3. 算法高性能再优化（Performance）

**问题**：自审仍报 `GOV-PRF-002`（循环内线性查找）88、`PRF-MEM-001`、`PRF-ALG-001`、`SIM-LONG-001` 112、`high-complexity` 124；热路径集中在扫描主循环、增量缓存与结果聚合。

**候选清单（按收益/风险排序）**：
1. **扫描主循环**：`comments`/`simplify`/`hygiene` 的逐行 scanner 有多趟 `split`/正则；合并为**单次遍历 + 复用行缓冲**（一次扫描产出多个规则族的信号）。
2. **增量缓存**：L1→L2→L3 的 content hash 目前多处重复计算（自审 `PRF-IO-001` residual 即在此）；引入进程内 `hashCache`，按 `(rel, mtimeMs, size)` 复用。
3. **结果聚合**：`issues.push` + 多轮 `sort` → 单轮 Map 归并 + 稳定排序；大报告（>10k）用分块排序。
4. **worker 分片**：`WORKER_BATCH_SIZE`/flush 阈值按文件大小自适应，减少 IPC 往返（用 `bench-warm` A/B）。
5. **内存**：报告构建期的中间数组改为惰性/迭代器；`qualityScore` 计算避免二次遍历 issues。

**验收**：`npm run bench-baselines --check` 作为回归门；同一 corpus 冷扫吞吐 ≥ +20%、warm 命中路径 ≥ +10%、峰值 RSS ≤ -15%；**报告字节完全不变**（等价金标 + `validate-warm` 双保险）。
**风险**：性能优化最容易破坏确定性 → 每项优化必须单独提交 + 附前后 bench 数据。

---

## 4. 命名集统一规范化（Naming Sets）

**问题**：规则 ID 家族前缀已存在但无强校验；选项名有 `*AllowPatterns` / `*AllowList` / 单位缺失等混用；文档标题中英混排。

**方案**：
1. **规则 ID**：`FAMILY-TOPIC-NNN`（大写、主题 2–4 词、3 位序号）；家族清单固定：`LANG / CMT / SIM / HYG / GOV / PRF / SEC / ARCH / PYM / DOC / DB`。
2. **选项名**：camelCase + 单位/语义后缀（`Ms`/`Lines`/`Threshold`/`Patterns`）；统一 `*AllowPatterns`（弃用 `*AllowList` 别名一版）。
3. **代码命名**：文件 kebab-case、类 PascalCase、函数/变量 camelCase、常量 UPPER_SNAKE；Python 侧由 `HYG-NAM-001`/`PYM-*` 覆盖。
4. **守卫**：`scripts/validate-naming-conventions.js` —— 规则 ID 正则、选项名白名单、文档标题格式、通用缩写禁用表（`cfg`/`mgr`/`tmp` 等仅在私有作用域允许）。
5. **迁移**：旧选项名保留一个版本（配置层吸收 + `CHANGELOG` 标注），下一大版本移除。

**验收**：命名守卫进 `npm test`；新增规则/选项不需要人工记忆命名规则。

---

## 5. 多语言规范化扫描（Multi-Language Standardization）

**问题**：适配器已覆盖 TS/JS、Rust、GDScript、Python、Markdown，但"规范化"规则分布不均：注释/简化/文档为语言无关；Rust/GDScript 无现代化包；语言能力矩阵只到"能解析"，没有"能查什么"。

**方案**：
1. **规范化矩阵**：把现有能力矩阵扩成 `规则家族 × 语言` 覆盖表（✅ 已实现 / ⚠️ 部分 / ⛔ 空缺），空缺显式登记并给出优先级。
2. **语言包补齐**（按消费方需求排序）：
   - `rust-modern`：`try!`→`?`、`extern crate`→2018 路径、`#[macro_use]`→显式导入、`&String`→`&str`、`clone()` 滥用、edition 2021 语法；
   - `gdscript-modern`：`yield`→`await`、`export`/`onready`→`@export`/`@onready`、`Pool*Array`→`Array`、`connect` 语法迁移；
   - `ts-modern`（见第 6 节）。
3. **跨语言一致性套件** `validate-language-matrix.js`：同一语义规则在不同语言上的 key-point 夹具与"必须命中/必须沉默"断言。
4. **接入成本约束**：新语言 = adapter + language pack + fixtures，引擎核心零改动（由 `validate-project-neutrality` 与 `validate-language-support` 双重保障）。

**验收**：矩阵中"规范化空缺"清零或带登记理由；新增语言 2 天内可接入（有 checklist 与脚手架模板）。

---

## 6. 现代化写法检测（Modernity Packs）

**问题**：目前只有 `python-modern`（12 条）；TS/JS 依赖 ESLint（语法级、缺跨语言统一报告）；Rust/GDScript 完全没有现代化检测。

**方案**：

| Pack | 规则示例 | 与既有工具的边界 |
| :--- | :--- | :--- |
| `ts-modern` | `var`→`const/let`、`require`→`import`、`new Array/Wrapper()`→字面量、`arguments`→rest、`Object.assign`→spread、`indexOf`→`includes`、`substr`→`slice`、`String.replace` 全局→`replaceAll`、`any`→`unknown`、缺失 `import type` | ESLint 覆盖语法级；引擎补**跨语言一致报告 + 项目策略**（如与 ESLint 冲突时的 `governance` 口径） |
| `rust-modern` | 同第 5 节清单 + `unwrap()` 风险分级 | clippy 覆盖部分；引擎补"现代化批次"统一呈现 |
| `gdscript-modern` | Godot 3→4 语法迁移清单 | 引擎独有（无成熟 linter） |
| `python-modern` | 已交付 12 条（`PYM-*`） | ruff 覆盖部分；引擎保留跨语言报告口径 |

**设计约束**：
- 每条规则必须是 `FAMILY-TOPIC-NNN` + 注册表登记 + fixtures + 文档 + 默认关闭（specialized）；
- 与项目现有 linter 重叠的规则：默认 `info` 或文档标注"二选一"，不得双源互相打脸；
- 现代化包只在**语言包**层实现，引擎核心与规则注册表保持语言无关。

**验收**：每个 pack ≥ 10 条规则、语言 key-point 套件全绿；三个消费方实测误报率 < 5%。

---

## 7. 执行顺序与批次（依赖关系）

```
第 1 批  规则注册表骨架 + 命名守卫        ✅ 已交付（见 §2 状态）
第 2 批  常量化 B2/B3/B4 + L4 阈值策略    ✅ 已交付（B4 由 §1 的策略豁免覆盖，见下）
第 3 批  ts-modern pack（10 条）          ✅ 已交付
第 4 批  性能优化 1/2（主循环 + hash 复用）🟡 1/2：评审记忆库批量写 + 上限压实已交付
第 5 批  rust-modern / gdscript-modern    ✅ 已交付
第 6 批  性能优化 3/4（聚合 + worker 分片）⛔ 未开始（登记见下）
第 7 批  多语言矩阵补齐 + 一致性套件       ✅ 已交付
第 8 批  收尾：基线重冻、缺口清零、文档归档 🟡 别名窗口已声明；发射切换与剩余文档待做
```

### 第 1 批交付状态（2026-09-15）

| 项 | 结果 |
| :--- | :--- |
| 影子注册表 | `src/core/rules/registry.ts`：**81 条规则**（70 canonical / 11 legacy），含 id / 家族 / 归属分析器 / 语言范围 / 默认级别 / 一句话意图 / 治理建议 / 文档锚点 |
| 命名守卫 | `scripts/validate-rules-registry.js`（挂进 `npm test`）：唯一性、canonical 前缀与家族一致、legacy 必须有 `legacyReason`、**登记集 ≡ 实现可产出集**（双向无孤儿）、文档覆盖率可见且不得回退 |
| 文档覆盖率 | 45/81（36 条待文档生成批次补齐，守卫每次运行都会打印清单） |
| 遗留别名 | 11 个 lowercase id（`large-file`/`magic-number`/`import-cycle`…）登记为 legacy，改名需走别名窗口，不做静默重命名 |

每批 = 1–3 个提交（实现 / 回归锁 / 文档），批内不混入无关重构。

## 第二阶段：深度实现审计后的执行计划（2026-09-16）

审计结论：当前系统是「工程化良好的静态规则平台」（综合完成度约 40–45%），尚不是「基于统一语义底座的控制平面」。八项能力中 1/2/3/5/7 项受制于同一个底层缺失：**没有跨文件符号/类型/调用/数据流底座**，因此各审查器只能在单文件 AST 或词法层工作。执行计划按底座优先排序：

| 批次 | 内容 | 状态 |
| :--- | :--- | :--- |
| B1 | 底座接线修复：`ALL_BUILTIN_ANALYZERS` 补齐 6 个分析器（此前路由会静默丢弃）；`getReviewMemory()` 改为**向上查找** `<root>/.auto-refactor-cache`（此前 CLI `guide/trajectory/memory` 在子目录运行会静默读空）；`scanAsymmetric` 标注为 `@experimental` 并说明未接线；新增「四方注册面一致」与「缓存目录发现」回归锁 | ✅ 已交付 |
| B2 | **Symbol/Type Index 底座**：`src/core/intelligence/symbolIndex.ts` + 单次遍历采集（TS/Python 适配器已产出调用名）+ `summary.symbolIndex` 覆盖计数 + `querySymbols()` API + `auto-refactor symbols <name>` CLI + 键点验证器 | 🟡 部分交付：**物化路径完整**（真实仓库实测：TS 语料 830 定义/200 调用；Python 消费方 1917 定义/8579 调用/3518 跨文件）；**lazy-projection 快路径尚不产出符号**——根因经实测钉死：投影树不通过 `.children` 暴露子节点（由 `NodeProjector.rawChildren()` 在共享遍历中按需物化），且 `project()` 不回指 raw 节点，故任何「对已投影树做二次遍历」的采集方式都恒为空（已排除：采集时机、placeholder 门、策略位）。**B2b 第一步已闭合**：`runStreamingProjected` 新增 `onNode` 观察者并接到 `SymbolIndex`，默认配置（投影路径）现可产出**声明**（实测 `sample.ts` 16 条定义）；**调用点已产出**（实测：`samples` 默认投影扫描 defs=12 / refs=44 / callGraph edges=44，其中 42 条已归属调用者；两条遍历逐边一致由 `validate-symbol-index`/`validate-call-graph` 断言）→ B2b |
| B3 | 跨文件字面量索引 + 聚类规则（Literal→Symbol→Domain→Frequency） | ✅ 已交付：`LiteralIndex` + `literalClusters.ts` 聚类后处理 pass + 消费校验器 |
| B4 | 调用图 + 错误传播链（`ERR-*`） | ✅ 已交付：`callGraph.ts`（共享 SymbolIndex 派生）+ `errorFlow.ts`（`ERR-PRP-001` 错误传播链与分类法冲突）+ `validate-call-graph` + `validate-error-flow`（≥3 跳链路与边界断言） |
| B5 | 稀疏 Reviewer 激活接线（profile→risk→routing→budget） | ✅ 已交付：`projectProfiler.ts`（4大原型检测）+ `sparseRuleRouter.ts`（原型矩阵路由）+ `summary.activatedReviewers` 主路径发布 + `validate-asymmetric-routing`（demo/web/game/library 激活集断言） |
| B6 | 不确定性模型（`evidence{confidence,requiresRuntime}`）+ 压缩下界规则 | ✅ 已交付：`Issue.evidence` + `NEED_RUNTIME_EVIDENCE` + `summary.uncertainty` 聚合 + `CMP-EXP/LIN/CAL/DEN-001` 压缩下界族 + `validate-compression-bounds`（100%命中、可数断言、FP 0.00%） |
| B7 | 数据流/生命周期图 + Effective LOC/语义增量度量 + 语义区域切片 | ✅ 已交付：`dataFlow.ts`（7 阶段生命周期图 + `PRF-LEAK-001` O(t)/O(n) 无界增长）接入 `performance` 分析器，`computeIncrementalMetrics`（有效 LOC/耦合/复杂度/重复度增量）接入 `templates/consumer/run.mjs --coupling-gate`；新增 `contextSlice.ts`（意图→声明/依赖/影响区域 + 预算与静态性约束）与 `validate-context-slice`；`validate-data-flow` 5/5 实测通过 |

### 第 2–8 批交付状态（2026-09-15 续）

| 项 | 结果 |
| :--- | :--- |
| 常量化 B2/B3 | 自审活口 `magic-number` **792 → 0**（B2 常量化 43+78 项；B3 收尾 5 路并行清掉 53 文件 216 项；`config.ts`/`resultCodec.ts`/`qualityScorer.ts` 单独成批） |
| 重复字面量 | 151 项 → **0**（52 文件，6 路并行）；引擎侧同时修掉「重复趟不复用 `classifyLiteral`」的一致性缺口，`ignoreLiterals` 进入全局 `thresholds` 级联 |
| B4 脚本常量化 | 由策略替代：`scripts/**` 的 `magic-number`/`duplicate-literal` 登记为**带 reason 的夹具豁免**（夹具里的数字与重复值是构造输入/期望值，不是产品魔法数）；产品代码口径不变 |
| ts-modern | 10 条 `TSM-*`（`var`/`require`/包装构造器/`arguments`/`Object.assign`/`indexOf` 边界/`substr`/字符串 `replace`/显式 `any`/仅类型导入）+ 掩码扫描 + 键点锁 |
| rust-modern / gdscript-modern | 7 条 `RSM-*` + 7 条 `GDM-*`（Godot 3→4 迁移）；`src/core/sourceMask.ts` 为三个语言包共用掩码实现 |
| 多语言矩阵 | `scripts/validate-language-matrix.js`：逐语言断言「适配器认领 + 语言无关探针命中 + 该语言包声明才命中」，并断言 `.sh`/`.ps1` 这类「已发现但无适配器」必须 fail-closed 为 `LANG-UNSUPPORTED` |
| 别名窗口 | `src/core/rules/aliases.ts`：11 个 legacy id → canonical id（`large-file`→`BIG-SIZE-001` 等），`areAliasForms()` 供匹配层使用；注册表守卫已能识别「窗口声明的未来 id」。**发射切换未做**（改名会动基线与消费方 `matchRule`，留待下一个大版本窗口） |
| 性能批次 1 | 评审记忆库：`saveRecord` 逐条 append → **批量缓冲 + 扫描结束 flush**，JSONL 无界增长 → **上限压实 + 原子重写**（3.08MB → 有界），加载去重 LRU；回归锁 3 条并入 `validate-review-memory`（9/9）；300 文件基准 253.7ms → **103.0ms**（−59.4%） |
| 性能批次 2 | 适配器按扩展名直连（`EXTENSION_ADAPTER_IDS` + 运行时注册优先）：非本语言解析器不再加载——纯 Python 扫描 170ms → **36ms**（−77%，模块加载 22 → 14），300 文件 TS 档位 103.0 → **93.3ms**（较历史最好值 143.0ms −34.7%）；防漂移守卫并入 `validate-language-support` |
| 性能批次 3 | `--no-cache` 语义修复（此前仍写 `.auto-refactor-cache/memory.jsonl`）：`ScanConfig.cacheEnabled` 由 `cache` 选项派生，关闭缓存时评审记忆留在进程内；顺带修掉 `flush()` 在 `buildReport` 开头调用导致「本轮审计下一轮才落盘」的缺陷。同机 A/B：热扫描中位 **86ms → 76ms（−11.6%）**；回归锁并入 `validate-review-memory`（10/10，含冷进程持久化断言） |
| 性能批次 4（决策级评估） | **解析器默认化**：同机受控 A/B（12 次热扫描 / 8 次大文件扫描，`daemon:'off'`、`cache:false`）——小文件语料（301×~220B）typescript **73ms** vs oxc 81ms（oxc 反而慢 11%，按文件的原生绑定调用开销占主导）；大文件语料（12×2600 行）typescript 345ms vs oxc **334ms**（−3%，落在噪声内）；两边 issue 数完全一致（429 / 11,948）且 `validate-oxc` 键点断言字节等价。**结论：保持 `typescript` 为默认**，`--parser=oxc` 作为大文件可选路径保留；默认切换无收益，登记问题就此关闭 |
| 性能批次 5（worker 分片） | 默认并发从「恒为单进程」改为**按文件数自动缩放**：`effectiveWorkers()` = `files / 24`，上限 `min(cores, 8)`，下限 1；显式 `--workers N` 照旧生效。同机受控实测（7 次热扫描、去掉配置里的 workers 键以测真实默认）：300 小文件 **默认 58ms vs 单进程 74ms（−22%）**；12 个大文件默认自动回落为单进程，**391 vs 394ms（持平）**——此前「一律 8 线程」会让大文件场景慢 29%，现已由文件数阈值挡住。输出与单进程逐条一致（issue 集合哈希相同），等价性与 worker 场景全绿 |
| 规则注册表 | 81 → **105 条**（+24 语言包规则）；文档覆盖 45/81 → **69/105** |
| 门禁 | `npm run gate` 全绿（**140 项断言**）；自审活口 `magic-number` 0、`duplicate-literal` 0 |

### 三仓交叉验证（2026-09-15，新引擎 + 新语言包）

| 消费方 | 语言 | 实测（新引擎） | 结论 |
| :--- | :--- | :--- | :--- |
| Python 消费方（`.auto-refactor/` 棘轮） | Python | 242 文件 / 2,062 项 [error=49, warning=553, info=1,460] / 抑制 1,450 / **`ratchetNew=0`** | 棘轮不破；新语言包按预期显示为 `disabled`（`comments`、`ts-modern`、`rust-modern`、`gdscript-modern`） |
| GDScript 消费方（`industrial` 档 + `classifyLiterals`） | GDScript | 505 文件 / 14,686 项（error=3）/ 规则分布 `hardcoded-string` 10,096、`magic-number` 1,544… | 适配器与内容型分析器对 `.gd` 真实生效；新包默认关闭，未静默改变既有门禁 |
| TypeScript 消费方（稳定 CLI 契约适配层） | TypeScript | `refactor:scan` 全绿：`ratchet.newCount=0`、`ratchetBaselineUsed=true`、`suppressedCount=7` | 该适配层只依赖引擎外部契约（scan 子命令 + ScanReport + 退出码），跨版本升级未破约 |

> 交叉验证同时佐证了「新分析器默认关闭」这一设计约束：三个消费方都只把 `ts-modern`/`rust-modern`/`gdscript-modern` 列进 `skipped (disabled) analyzers`，没有新增阻断。

**登记未做（诚实缺口）**：
1. **性能批次 3/4 剩余技巧**（主循环单遍化、哈希复用、聚合、worker 分片）**经测量后判定不做**：分割（8 趟）与 SHA-256（2 趟）各仅 0.4–0.8ms（<1%）；解析器默认化已按上表结论关闭（oxc 小文件更慢）；主循环单遍化在架构上已成立（分析器共用同一次遍历）；剩余成本集中在 TypeScript 编译器自身的模块编译与逐文件系统调用，属固有开销；
2. **legacy id 发射切换**与基线迁移：别名窗口已就位，切换本身是破坏性变更，需要消费方同步窗口；
3. **36 条规则文档**（守卫每次运行打印清单）与 `DOCS.md` 归档；
4. **远程 CI 从未运行**、三仓未 push（引擎/消费方），21 项变异探针未重跑。

---

## 8. 防回退与度量

1. `npm run gate`（build → format → lint → gate:comments → **gate:self** → test）每批必须绿；
2. `baselines/self-scan.baseline.json` **只降不升**，升级必须走 `gate:self:update` 并在提交信息里给出理由；
3. 三项目交叉验证（Python / GDScript / TS 三个消费方）在每批结束时重跑，误报率上升即回退该规则；
4. 性能批次必须附 `bench-baselines` 前后对照，报告字节不变的证据由等价金标与 `validate-warm` 提供；
5. 规则语义变更（如 `GOV-EXC-001` 的"已记录 catch"）必须同时给出：规则文档、回归锁、消费方影响评估。

---

## 9. 风险登记

| 风险 | 影响 | 缓解 |
| :--- | :--- | :--- |
| 常量化把语义常量变成噪音 | 可读性下降 | L4 阈值策略：结构性小数字不强制；L1–L3 按语义分组命名 |
| 规则注册表改造面大 | 短期回归风险 | 先做"影子注册表 + 一致性守卫"，实现不动，等守卫绿再切换生成文档 |
| 性能优化破坏确定性 | 缓存/增量结果漂移 | 每项独立提交 + bench + 等价金标 + `validate-warm` |
| 现代化规则与项目 linter 重叠 | 双源冲突 | 默认 info / 文档标注二选一；三项目实测 |
| 语言包膨胀 | 维护成本 | 语言包默认关闭、矩阵登记、脚手架模板化 |
