# auto-refactor 规则扩展计划 · 规范定稿（v5）—— 严格规范化约束优先

> **修订关系**：本文件是 v1→v2→v3→v4 链条的**最终定稿**，并**取代 v4 的设计偏置**。
> **v5 的实质变化**：① 追加决策 D6（安全优先）与 D7（**严格规范化约束优先 = 原则 0**，取代此前隐含的"最小侵入 / 向后兼容优先"）；② 逐项纠正 14 处"最小侵入"选择；③ 把规范落成带守卫的硬约束清单（MUST / MUST NOT）；④ 明确**可以在项目内实际修改的文件**与一次性破坏性迁移策略。
> **前提确认**：项目本体可改，消费方可同步 —— **不再以"兼容性"为由保留任何缺陷路径**。
> **性质**：规范性设计定稿，不含实现

---

## 0. 决策定稿（v5 追加）

| # | 议题 | **定稿** | 影响面 |
| :--: | :--- | :--- | :--- |
| **D6** | AgentProfile 默认回落 | **安全优先**：未声明 `profile` **即回落 `untrusted`**；且进一步收紧为 **`profile` 必填**（`PraxisSliceAuditInput.profile` / `DiffFileInput.profile` 为 required；CLI 缺省时按 `untrusted` 并在报告中显式记录回落原因） | Praxis 契约、CLI、报告 schema |
| **D7** | 设计原则 | **严格规范化约束优先（原则 0）**：规范正确性 > 兼容性 > 改动量。任何为"少改代码"而保留的双轨语义、兼容分支、行内自豁免，一律删除 | 全部阶段 |

---

## 1. 设计偏置纠错：为什么"最小侵入"在这里是错的

我此前在 5 处关键设计上默认选择了"最小侵入"，理由都是"改动小 / 不改契约 / 向后兼容"。这是**错误的价值排序**，理由如下：

| # | 诊断 | 说明 |
| :--: | :--- | :--- |
| 1 | **双轨语义本身就是缺陷源** | 保留 `changedLines` 快路径 = 同一变更因入参不同而得到**不同审查强度**。审查系统最重要的属性是**可复现与可解释**；为兼容保留语义分叉，等于把"不可复现"制度化。这正是 F1/F2 类缺陷得以长期隐藏的土壤。 |
| 2 | **兼容分支使"单一真源"无法成立** | `resolveCategoryTargets` 的 `\|\| ALL_BUILTIN_ANALYZERS`、`applyLanguageGating` 的 `if (!language) return`、`Math.max(1, …)` 下限截断 —— 都是"兜底而不是失败"。有兜底就不需要把枚举写全，于是矩阵永远可以漏配（F6）。**兜底的存在使正确性检查失去必要性。** |
| 3 | **兼容成本是伪成本** | 兼容性只有在"消费方无法同步"时才是真成本。本引擎的已知消费方为 Praxis OSDIff + 文档登记的数个消费方（Python/GDScript/TS 交叉验证），**均可同步**；且项目本体可改。故不存在必须保留的兼容负担。 |
| 4 | **软约束 = 无约束** | 行内自豁免（`# allow-root`）、glob 级永久抑制、`fallback: 'skip'`、无到期的 `suppressions`，都让规范在**出现困难的第一时间被绕过**。约束的价值在于不可绕。 |

**判定准则（写入规范）**：只有当**消费方无法同步且下线窗口不可协商**时，才允许引入兼容分支；且该分支必须**带到期日与守卫**。除此之外，一律直接改到规范形态。

---

## 2. 原则 0：严格规范化约束（7 条子原则）

| 编号 | 子原则 | 含义 | 反例（现状） |
| :--- | :--- | :--- | :--- |
| **P0-1** | **单一真源** | 每个概念只有一处定义：词表、矩阵、注册、豁免、上界 | 两套路由词表；手工维护的 `CATEGORY_ANALYZER_MATRIX`；两个适配器层 |
| **P0-2** | **Fail-closed** | 未知 / 未声明 / 不可判定 → **失败**或进入**最严分支**，绝不静默放宽 | 未知类别 → 全量激活（F6）；无语言 → 跳过门控（F7）；下限截断 1ms（F5） |
| **P0-3** | **禁止行内自豁免** | 豁免必须集中登记，且**必须**含 `owner` + `reason` + `expiresAt` | `suppressions` 仅要求 `reason`、支持 glob 永久生效 |
| **P0-4** | **语义唯一** | 同一输入在任何入口 / 配置 / 参数组合下得到**同一审查强度** | `changedLines` 快路径 vs 真 Diff；`forceFull` 绕过矩阵 |
| **P0-5** | **破坏性变更是合法工具** | 一次性切换 + 明确下线日；不设无限别名窗口 | 文档登记的"legacy id 发射切换需消费方同步窗口"（宜改为一期切换） |
| **P0-6** | **无守卫的规范视为不存在** | 每条约束必须有机器守卫（断言 / 校验脚本） | F8 三处激活口径已漂移且无守卫 |
| **P0-7** | **未执行必须留痕** | 任何"跳过 / 降级 / 豁免 / 未激活"必须产生显式原因 | `activatedReviewers` 有 `applied` 但无"为什么没跑"的汇总 |

---

## 3. 逐项替换表："最小侵入" → "严格规范化"（14 项）

| # | 原设计（最小侵入） | **严格规范化定稿** | 触及 | 守卫 |
| :--: | :--- | :--- | :--- | :--- |
| 1 | 分类器"最小侵入改动"：在 `allComments` 前插一次检测 | **重构分类器为单一信号提取器**：删除"每类别各自为正则"的写法，改为 `行特征 → MutationSignal 集合` 的**单一映射表**；新增信号只加表行，不加分支 | `diffClassifier.ts` 重写 | 表键集 ≡ `MutationSignal` 全集断言 |
| 2 | 保留 `changedLines?` 作为可选快路径 | **移除该参数**：真 Diff 是唯一入口。同一变更只有一种分类路径 | `classifyDiff` 签名、`dualTrackPipeline`、`praxis` 契约 | 编译期（签名删除）+ 契约测试 |
| 3 | `resolveCategoryTargets` 未知类别 `\|\| ALL_BUILTIN_ANALYZERS` | **删除兜底**：未知类别 → 构建期断言失败 + 运行期 `throw`（`UNKNOWN_CATEGORY`） | `sparseRuleRouter.ts:257` | 键集等价断言 + 单测 |
| 4 | `applyLanguageGating` 无语言时 `return` | **删除提前返回**：被扫描文件必须有**注册语言**或**显式 `artifact` 分类**，否则 `throw UNCLASSIFIED_FILE` | `sparseRuleRouter.ts:267`、`ast/adapters.ts` | 全量扫描 + 适配器注册表一致性断言 |
| 5 | 保留 `latencyMs = Math.max(1, Date.now()-start)` | **删除下限截断与 1ms 取整**；`latencyUs`（`hrtime.bigint`）为唯一真源，`latencyMs` 标记 deprecated 并**定档移除** | `sliceAuditService.ts:132`、`FastTrackVerdict` | 断言 `latencyMs` 调用点为 0（移除后） |
| 6 | `SEC-SUP-004` 行内 `# allow-root` 豁免 | **禁止行内自豁免**：改为集中台账 `governance-exemptions.json`，字段 **`ruleId` + `file`(精确路径，禁 glob) + `symbol` + `owner` + `reason` + `expiresAt`**；到期未复核 → 门禁失败 | 新增台账 + `config.schema.json` | 台账校验守卫（含到期检查） |
| 7 | `fallback: 'skip' \| 'escalate-deep'` | **安全族禁止 `skip`**：`SEC-*` / `secrets` / `AGT-*` 只允许 `escalate-deep` 或 `block`；`skip` 仅对 `info` 级样式类规则开放 | `ExpertManifest` 契约 | manifest 校验器 |
| 8 | 保留两个适配器层 + 加"层间守卫" | **合并为一层**：`semantic/adapters` 与 `ast/adapters` 收敛为单一 `LanguageAdapter` 注册表（含 `Go` 漂移顺带闭合） | `ast/`、`semantic/adapters/` | 单一注册表断言；删除重复概念 |
| 9 | 保留 legacy rule id + 别名窗口 | **一期切换**：`ruleVersion` 升版，一次性切换并公告下线日；不设无限别名窗口，`legacyReason` 字段保留仅作**审计记录** | `registry.ts`、`entries/*` | 别名数量棘轮（只减不增） |
| 10 | `profile` 可选，复用 `author` | **`profile` 必填**；`author` 仅作溯源。未声明 → `untrusted` + 报告显式记录回落 | Praxis 契约、CLI、`report.schema.json` | schema `required` + 契约测试 |
| 11 | `isDocOnly` 布尔即"安全" | 引入 **`SurfaceVerdict`**：文档/注释变更必须显式携带"**已执行指令面检查**"的结论（含 `SEC-INS-*` 的执行证据），否则**不得**标记 `confidenceTier: HIGH`、不得进入推测式免检旁路 | `diffClassifier.ts`、置信层 | 不变量断言："HIGH ⇒ 指令面已检查" |
| 12 | 新专家需在三处声明（注册表 + 矩阵 + 适配器） | **单一注册点**：`ExpertManifest` 是唯一真源，**矩阵与路由表由 manifest 自动生成**，手工矩阵删除 | `sparseRuleRouter.ts` | 生成物与 manifest 等价断言 |
| 13 | 分类别上界为手写数字（≤3 / ≤5 / ≤7） | **自动推导**：上界 = `Σ weight(类别目标集)`，阈值集中在**权重策略文件**；禁止在任何守卫中硬编码专家数量 | 门禁脚本 | 硬编码检测（守卫内不得出现裸数字上界） |
| 14 | `customAnalyzers` 恒激活（既有行为） | **自定义分析器必须声明 `signals` 与 `track`**，且不得进入 FastTrack 除非通过预算评审；未声明 → 配置校验失败 | `sparseRuleRouter.ts`、config schema | 配置校验器 |

---

## 4. 规范化约束清单（硬约束）

### 4.1 必做（MUST）

| 编号 | 约束 | 守卫 | 违反后果 |
| :--- | :--- | :--- | :--- |
| C-01 | 每个专家的身份只能由 `ExpertManifest` 定义；矩阵、路由、成本由上生成 | 生成物等价断言 | 构建失败 |
| C-02 | 每个专家必须声明 `signals` / `track` / `steadyCost` / `weight` / `fallback` | manifest 校验器 | 构建失败 |
| C-03 | 每条豁免必须含 `owner` + `reason` + `expiresAt`，且 `file` 为精确路径 | 台账守卫 | 门禁失败 |
| C-04 | 安全族（`SEC-*`/`secrets`/`SEC-OPR-001`）在**任何** `profile` 与 `securityLevel` 下都开启 | 生效面断言 | 门禁失败 |
| C-05 | 任何"未执行 / 降级 / 豁免"必须写入报告的可观测字段 | 报告 schema `required` | 契约测试失败 |
| C-06 | 延迟指标必须由 `hrtime.bigint()` 采集，粒度 ≥ 1μs | 门禁 | 门禁失败 |
| C-07 | 新增/修改规则必须同时交付：注册条目 + 规则文档 + 字面量常量 + **正反向用例** | `validate-rules-registry` | `npm test` 失败 |
| C-08 | 基线只降不升；升级走 `gate:self:update` **且提交信息必须给出理由** | `gate:self` | 门禁失败 |

### 4.2 禁止（MUST NOT）

| 编号 | 禁止项 | 守卫 |
| :--- | :--- | :--- |
| N-01 | 代码/配置中出现绝对路径、盘符、`file:///` | 既有红线 + 新增 `ARCH-ABS-001` 自审 |
| N-02 | 未知类别的 fail-open 兜底（`\|\|` 回落到全量） | C-01 断言 |
| N-03 | 无语言标识的文件被静默跳过门控 | C-01 断言 |
| N-04 | 行内自豁免标记（注释形式） | 台账守卫 |
| N-05 | 安全族规则被 `downgradeTo: info` 或 glob 级抑制 | 台账守卫 |
| N-06 | 守卫脚本中出现硬编码的专家数量上界 | 硬编码检测 |
| N-07 | 同一输入存在多条分类/路由路径（语义分叉） | 契约测试 |
| N-08 | 未标注 `track` 的分析器进入 FastTrack | 配置校验 |
| N-09 | 测试文件、代码符号与路径中出现施工批次黑话（`pXX`/`phaseXX`/`stXX`/`wip`/`temp`） | `validate-physical-naming` + 新增规则 |
| N-10 | 为兼容而保留的别名窗口无下线日 | 别名棘轮 |

---

## 5. 破坏性变更与迁移策略（P0-5）

| 变更 | 类型 | 迁移 | 下线 |
| :--- | :--- | :--- | :--- |
| 移除 `changedLines?` 参数 | 破坏性（签名） | 消费方改用 `(oldContent, newContent)`；引擎内部做真 Diff | 一期完成 |
| `profile` 由可选转必填 | 破坏性（契约） | Praxis OSDIff 显式传 `profile`；未传按 `untrusted` | 一期完成 |
| `classifyDiff` 返回结构改为信号集 | 破坏性（返回类型） | 同步更新 3 个已知消费方 | 一期完成 |
| legacy rule id 别名 | 破坏性（标识） | `ruleVersion` 升版 + 公告下线日 | **带具体日期**，非"窗口" |
| `latencyMs` → `latencyUs` | 渐进（deprecated） | 双字段并存一版，随后删除整数毫秒 | 定档删除 |
| 未知类别/未知语言由兜底改抛错 | 破坏性（行为） | 先加断言，再抛错；期间以 `info` 级告警暴露全部兜底触发点 | 二期完成（避免一次性红） |

> **顺序刚性**：迁移顺序固定为 **规范文件 → config/report schema → 守卫 → 实现 → 消费方**。禁止先改实现后补规范（否则等于把现状追认为规范）。

---

## 6. 需要在项目内实际修改的文件清单（项目可改，故不再规避）

| 文件 / 域 | 修改性质 |
| :--- | :--- |
| `src/core/router/diffClassifier.ts` | **重写**为单一信号提取器；删 `extractChangedLines` 的行集合差；新增 `INSTRUCTION_SURFACE` / `DELETION`；`SurfaceVerdict` |
| `src/core/router/sparseRuleRouter.ts` | **删除手工两个矩阵**，改为 manifest 生成；删未知类别兜底；语言门控改 fail-closed |
| `src/core/router/sparseMoEGate.ts` | 收敛到同一 `MutationSignal`；删 `isDocOnly` 提前 return 的"免检"语义 |
| `src/core/router/sliceTypes.ts` | `PraxisSliceAuditInput.profile` 必填；`latencyUs` |
| `src/core/praxis/sliceAuditService.ts` | hrtime 计时；删除 1ms 下限；降级留痕 |
| `src/core/pipeline/dualTrackPipeline.ts` | 适配真 Diff（去 `changedLines`）；强制信号声明；降级事件 |
| `src/core/ast/adapters.ts` + `src/core/semantic/adapters/*` | **合并为单一注册表**；新增 `MANIFEST` / `NON_SOURCE`；闭合 Go 漂移 |
| `src/core/config/*` + `config.schema.json` | `profile` 必填校验；`governance-exemptions` 台账；自定义分析器必须声明 signals/track |
| `report.schema.json` | `summary.agentProfile`（required）、`appliedRatio`、`degraded[]`、`expertsSkippedBySignal[]` |
| `scripts/validate-*.js`（新增 4 个守卫） | 见 §7.2 |
| `docs/`（3 处口径 + 规范） | 收敛 F8 漂移；登记新规范与约束编号 |

---

## 7. 计划表（v5 修订）

### 7.1 阶段表

| 阶段 | 内容 | 关键点（严格化） | 退出条件 |
| :--- | :--- | :--- | :--- |
| **S0 规范先行** | ① 规范文件（原则 0 + 约束 C/N 清单）② schema 变更（`profile` 必填、台账、报告新字段）③ 4 个新守卫 ④ **失败路径灰度**：未知类别/未知语言的兜底触发改为 `info` 告警（先暴露，不先抛错） | 禁止先改实现 | 规范评审通过 + 守卫全绿 |
| **S1 地基重构** | 真 Diff 落 `core/diff`；`hrtime` 门面；`MutationSignal` + `ExpertManifest` 单一注册点；矩阵**生成化**；适配器层**合并** | 删除全部兜底与兼容分支 | 既有检出**字节等价** |
| **S2 兜底转硬失败** | 未知类别 / 未知语言 / 无 `track` 分析器 → 抛错 | 依赖 S0④ 的告警数据确认无漏配 | 全量扫描无 `UNKNOWN_*` |
| **S3 注入面** | `INSTRUCTION_SURFACE` + `SEC-INS-001/002` + `SurfaceVerdict` + `isDocOnly` 双判 | HIGH 置信必须以指令面已检查为前提 | M13/M14 达标 |
| **S4 供应链** | `SEC-SUP-001~005` + `MANIFEST` 适配器（含容器/CI）+ 哈希缓存 | 台账式豁免（无行内豁免） | `manifest-poison` BLOCK |
| **S5 制品与危险操作** | `AGT-ART-001` + `NON_SOURCE`；`SEC-OPR-001` | 安全族不允 `skip` | 夹具全绿 |
| **S6 可靠性** | `GOV-ASY-001` · `CPX-DET-001` | 补 `ASYNC/IO` 信号 | 夹具全绿 |
| **S7 Agent 协作 + Profile** | `AGT-PRV/SCP/BDG/CMT-001` + `profile` 必填全链路 | 未声明 → `untrusted` | M17 Profile 一致性 100% |
| **S8 门禁升级** | 三级加权成本 + 自动推导上界 + 棘轮 | 守卫内禁止裸数字 | L4 只降不升 |
| **S9 规范收口** | `DOC-DRV-001` 收敛 F8；`latencyMs` 定档移除；别名一期切换 | 别名棘轮 | 三处口径归一 |

### 7.2 新增守卫（P0-6：无守卫的规范视为不存在）

| 守卫 | 职责 | 接线 |
| :--- | :--- | :--- |
| `validate-expert-manifest.js` | manifest 完整性（C-02）、安全族禁 `skip`（N-08/§3-7）、生成物等价（C-01） | `npm test` |
| `validate-governance-exemptions.js` | 台账字段完整、精确路径、**到期检查**、安全族禁抑制（C-03/N-04/N-05） | `npm test` + `gate:self` |
| `validate-fail-closed.js` | 未知类别/语言/未声明分析器必须抛错（N-02/N-03/N-08） | `npm test` |
| `validate-latency-metrics.js` | hrtime 采集 + 粒度断言 + `latencyMs` 调用点为 0（C-06） | `npm test` |

---

## 8. 剩余待确认（1 项）

**`SEC-SUP-004/005`（容器/CI）的阻塞策略**：按 D6 安全优先，我倾向 **一律 BLOCK**（不看 profile）——即"容器/CI 变更的任何供应链违规都阻断"。是否采纳？（若采纳，`human-review` profile 也不豁免，仅允许走集中台账豁免。）

---

## 附录：本轮核验事实

| 事实 | 位置 | 用途 |
| :--- | :--- | :--- |
| `suppressions` 仅要求 `reason`，支持 glob，**无 owner / 无到期** | `config.schema.json:348-378` | 支撑 C-03 与 N-04/N-05 |
| `suppressions` 已有 `downgradeTo`（可降级为 info） | `config.schema.json:369-376` | 支撑 N-05（安全族禁降级） |
| 未知类别兜底全量激活 | `sparseRuleRouter.ts:257` | §3-3 |
| 无语言即跳过门控 | `sparseRuleRouter.ts:267` | §3-4 |
| 延迟 1ms 截断 | `sliceAuditService.ts:132` | §3-5 |
| 两适配器层 + Go 漂移 | `ast/adapters.ts:55-66` vs `semantic/adapters/skeleton-adapters.ts:79` | §3-8 |
| 既有 `suppressions` 全带 `reason`（可复用为台账范式） | `auto-refactor.config.json:54-115` | C-03 设计先例 |
