# auto-refactor 规则扩展方案 v2 —— MoE 稀疏激活 × Praxis Agent OSDIff 约束对齐

> ⚠️ **性能模型与路由设计章节已被 v3 取代**：本文件的**批次划分、多语言策略、Agent Profile、待决策问题仍然有效**；
> 但 §1.1 路由描述不完整、§6.1 的三个激活比例数值**有误**（遗漏共享专家与语言门控机制）。
> 勘误表与修正后的模型见 `auto-refactor-moe-osdiff-plan-v3-2026-09-22.md` §0 与 §1.2。

> **修订关系**：本文件取代 `auto-refactor-rule-coverage-gap-analysis-2026-09-22.md`（v1）的方案部分；v1 的**缺口清单与探针证据仍然有效**，作为本方案的需求来源。
> **新增约束**（v2 相对 v1）：① 审查系统采用 **MoE 稀疏激活**架构；② 服务于 **Praxis 团队 Agent OSDIff** 系统；③ 方案须**泛化**（适配不同 Agent 与审查场景）；④ 须支持**多语言输入与输出**；⑤ 须证明**不引入明显性能开销**并给出可评估指标与验证方式。
> **日期**：2026-09-22 · **性质**：设计提案，不含实现

---

## 0. v1 → v2 的实质变化

| 维度 | v1（通用缺口分析） | v2（本方案） |
| :--- | :--- | :--- |
| 规则提出方式 | 按严重度列 27 条提案 | 追加 **MoE 归属列**：专家 / 触发类别 / 激活信号 / 稳态成本 / 运行轨道 |
| 泛化能力 | 未专门讨论 | §3：消除双路由词表、专家契约、Agent Profile、场景档位 |
| 多语言 | 仅讨论被审语言 | §4：输入语言矩阵 + **输出 locale 层**（当前完全缺失） |
| 性能 | 仅"新规则须交付 bench" | §6：稀疏激活 / 延迟 / 吞吐的**定量影响与上界推导** |
| 验证 | 复用既有门禁 | §7：指标表 + 采集点 + 判定矩阵，**含门禁语义升级提案** |

---

## 1. 系统现状复核（MoE 架构事实基线）

以下均为代码核验所得，作为方案的硬约束。

### 1.1 路由链路是"双词表"，扩张规则须同步两处

| 链路 | 实现 | 词表 |
| :--- | :--- | :--- |
| **切片链路**（Praxis 细粒度） | `src/core/router/sparseMoEGate.ts` | `SliceFeatureVector` **7 个布尔特征**：`hasSignatureMutation` · `hasControlFlowMutation` · `hasLiteralMutation` · `hasAsyncMutation` · `hasIoMutation` · `hasTypeMutation` · `isDocOnly` |
| **Diff 链路**（FastTrack） | `src/core/router/sparseRuleRouter.ts` + `diffClassifier.ts` | `DiffSemanticCategory` **6 个类别**：`LITERAL_ONLY` · `CONTROL_FLOW` · `INTERFACE_SIGNATURE` · `IMPORT_EXPORT` · `COMMENT_DOC_ONLY` · `GENERAL_CODE` |
| 候选集 | `ALL_BUILTIN_ANALYZERS` | **21 个可路由分析器**（不含 `engine`） |

**关键风险**：两套词表互不联通。任何新增专家若只挂一处映射，将在**另一条路径上静默失效**——不报错、不告警、只是不执行。这是本方案 §3.1 要优先解决的泛化缺陷。

### 1.2 双轨流水线与既有性能护栏

| 机制 | 事实 |
| :--- | :--- |
| **FastTrack（轨 1）** | 本地化稀疏路由推测式审查 + Review Memory 域指纹复用，设计目标 **< 15ms**；实测 **0.22ms**（对比冷全库 1,284ms） |
| **DeepTrack（轨 2）** | 异步全局：依赖图、循环依赖、分层越界 → 经 `EscalationChannel` 发 `ARCHITECTURE_BREACH` / `CIRCULAR_DEPENDENCY` 事件 |
| 自适应并发 | `LoadGovernor`（`src/core/profiler/loadGovernor.ts`） |
| 复用缓存 | Review Memory 域指纹匹配（`memory/domainFingerprint` + `semanticMatcher`） |
| Agent 输出 | `AgentConstraintGenerator` 已产出 `agentGuidancePrompt` |
| **既有比例门禁** | `validate-asymmetric-routing.js:110` 字面量 diff `activationRatio ≤ 0.25`；`:168` 文档 diff `≤ 0.15`；`validate-self-slice-audit.js:99` 切片审计 `≤ 0.25` |
| **既有防劣化门禁** | `bench-hot-paths.js` 3 大热点路径**劣于基线 15% 自动阻断** |
| 规模基线 | 2.51 MB / 234 文件 / 63,905 行；全域吞吐 3.66 MB/s；增量切片自审 1.9s（vs 全量 35.8s） |

### 1.3 Praxis OSDIff 契约现状

| 契约 | 事实 | 对本方案的影响 |
| :--- | :--- | :--- |
| `PraxisSliceAuditInput` | `{ filePath, oldContent, newContent, changedLines, author?, maxCallDepth? }` | 记忆中的 Diff 接口二选一**已定型为 `(oldContent, newContent, changedLines)`** |
| `PraxisSliceAuditVerdict` | 含 `routingPlan` / `impacts` / `issues` / **`latencyMs`** / `status(PASS/WARN/BLOCK)` | 延迟已可观测，可直接纳入指标采集 |
| `auditSlice()` 实际行为 | **只做三件事**：切片提取 → 稀疏路由 → 调用链影响追踪；`issues` **仅来自调用链**，**未执行任何分析器** | **当前"稀疏激活的专家"只是计划，不是执行**。新增专家若走此路径，等于增加真实负载——延迟预算必须重算 |
| `IPraxisSliceAuditService` | 三个方法：`auditSlice` / `traceCallImpact` / `getRoutingPlan` | 新增能力应作为**可选 expert 集**注入，而非改变既有签名（保证向后兼容） |

### 1.4 语言适配器深度不对称

`src/core/semantic/adapters/`：`typescript-adapter.ts` · `python-adapter.ts` · **`skeleton-adapters.ts`**（Rust/GDScript）。
`supportedLanguages`（快照真源）= `typescript, javascript, python, rust, gdscript`。

**结论**：5 个受支持语言中，**仅 TS 与 Python 具备专用 AST 适配器**，Rust/GDScript 走骨架适配器。跨语言泛化能力实际受限于适配器深度，而非规则数量。

### 1.5 消息层：有目录、无 locale

`src/core/messages/` 下 12 个域模块（architecture / comments / governance / guidance / hygiene / performance / scoring / secrets / security / trajectory / types / index）。

**核验结果**：全仓 `zh-CN` / locale 字典探针 **0 命中**（唯一 i18n 命中是 `scripts/.corpus/src/unit_i18n_*.ts` 测试语料，非实现）。规则文案 **中英混排**（例：`CPX-AMP-001` 中文、`ARCH-DISP-001` 英文、`CMP-CAL-001` 英文）。

### 1.6 文档口径已出现漂移（实证）

| 出处 | 声称的激活比例 |
| :--- | :--- |
| `sparseMoEGate.ts` 头注释 | **10%~25%** |
| `sparseRuleRouter.ts` 头注释 | 削减 **80%~95%** 遍历工作量 |
| `docs/05-specs-and-benchmarks/02-performance-benchmarks.md:53` | **15%~35%** |

三处口径不一致，且无机器守卫 → 直接支撑 v1 提案 `DOC-DRV-001`（文档量化声明与真源一致性）。

---

## 2. 方案总原则

1. **零稳态成本（Zero Steady-State Cost）**：任何新增规则在"信号不命中"时的成本必须为 **O(1) 文本前置短路**，不得引入额外的全树遍历或文件读取。这是不引入明显性能开销的**唯一可验证路径**（沿用既有"规则级文本短路"设计与 `bench-hot-paths` 15% 门禁）。
2. **规则即数据（Rule-as-Data）**：新增规则只允许扩展**注册表条目 + 类别矩阵 + 语言适配器声明**三处数据面，不得新增专用遍历代码路径。
3. **门控而非兜底**：新专家**禁止并入 `GENERAL_CODE` 兜底**，必须绑定显式信号（见 §6.1 的定量理由）。
4. **轨道可声明**：每条规则必须声明运行轨道（`fast` / `deep` / `off`），默认 `deep`，进入 FastTrack 需通过延迟预算评审。
5. **输出语言与规则身份解耦**：`rule id` 与指标字段**恒为英文稳定标识**，只有人类可读文案走 locale 层。

---

## 3. 泛化能力设计（适配不同 Agent 与审查场景）

### 3.1 统一路由词表（消除双词表）

**问题**：`SliceFeatureVector`（7 布尔）与 `DiffSemanticCategory`（6 类别）语义重叠但不联通。

**方案**：抽象单一真源 `MutationSignal` 枚举，两链路各自映射到它：

| 统一信号 | 切片链路来源 | Diff 链路来源 |
| :--- | :--- | :--- |
| `LITERAL` | `hasLiteralMutation` | `LITERAL_ONLY` |
| `CONTROL_FLOW` | `hasControlFlowMutation` | `CONTROL_FLOW` |
| `SIGNATURE` | `hasSignatureMutation` | `INTERFACE_SIGNATURE` |
| `IMPORT_EXPORT` | 由 sliceExtractor 补充 | `IMPORT_EXPORT` |
| `DOC_COMMENT` | `isDocOnly` | `COMMENT_DOC_ONLY` |
| `ASYNC` | `hasAsyncMutation` | **缺失 → 需补** |
| `IO` | `hasIoMutation` | **缺失 → 需补** |
| `TYPE` | `hasTypeMutation` | **缺失 → 需补** |
| **`MANIFEST`**（新增） | 需新增 | 需新增 |
| **`NON_SOURCE`**（新增） | 需新增 | 需新增 |
| **`CONFIG_SECURITY`**（新增） | 需新增 | 需新增 |

**收益**：新增专家只注册一次，两条链路自动生效；`validate-rules-registry.js` 可加断言"每个专家至少绑定 1 个统一信号，且两链路映射完备"，从机制上消灭 §1.1 的静默失效。

### 3.2 专家契约（Expert Manifest）

每个专家以声明式元数据注册，使**调度、成本核算、门禁计算全部数据驱动**：

| 字段 | 用途 |
| :--- | :--- |
| `id` / `family` / `track(fast\|deep\|off)` | 身份与轨道 |
| `signals: MutationSignal[]` | 激活信号（取代硬编码 if 链） |
| `languages: string[] \| 'all'` | 语言作用域 |
| `steadyCost: 'O(1)' \| 'O(n)' \| 'O(graph)' \| 'O(files)'` | **性能门禁的权重来源** |
| `weight: number` | 加权成本（见 §6.1 门禁升级） |
| `requiresArtifacts?: string[]` | 非源码依赖（如 `package-lock.json`） |
| `fallback: 'skip' \| 'escalate-deep'` | 无法判定时的行为（默认 `escalate-deep`，不静默丢弃） |

### 3.3 Agent Profile（适配不同 Agent）

不同 Agent 的能力、信任级别、可执行动作不同。建议引入 **Agent Profile** 配置档，把"审查严格度"与"Agent 身份"解耦：

| Profile | 适用 Agent | 规则档位 | 典型用途 |
| :--- | :--- | :--- | :--- |
| `untrusted` | 外部/实验性 Agent、未知模型 | 全量 + 安全类**强制开启** + `SEC-OPR-001` 恒 BLOCK | 沙箱准入 |
| `standard` | 常规自主 Agent（含 OSDIff 默认档） | 全量 + 安全类开启 | 日常提交门禁 |
| `trusted-autonomous` | 已建立信誉的长驻 Agent | 全量 + 性能类降级为 `info` | 批量重构 |
| `human-review` | 人类开发者 | 与 `standard` 同 | 避免"对机器严、对人松"的反向不一致 |

实现落点：复用既有 `author?: string` 字段（`PraxisSliceAuditInput`）与 `securityLevel` 级联机制，扩展为 `profile` 级联，**不改变既有签名**。

### 3.4 审查场景档位

| 档位 | 轨道 | 目标延迟 | 规则子集 |
| :--- | :--- | :--- | :--- |
| `fast` | FastTrack | < 15 ms | 仅 `track: fast` 专家 |
| `deep` | FastTrack + DeepTrack | 秒级 | 全量 |
| `audit` | 全量扫描 | 3.66 MB/s 基线 | 全量（含 `O(files)` 成本专家） |
| `ci` | 全量 + 门禁 | 无硬上限 | 全量 + 阻塞级规则 |

---

## 4. 多语言审查

### 4.1 输入语言矩阵（现状 vs 目标）

| 层次 | 语言 | 现状 | v2 目标 |
| :--- | :--- | :--- | :--- |
| 代码 | TypeScript / JavaScript | 专用适配器 ✅ | 保持 |
| 代码 | Python | 专用适配器 ✅ | 保持 |
| 代码 | Rust / GDScript | **骨架适配器** ⚠️ | 升级为专用适配器（安全类规则需 AST 精度） |
| 文本 | Markdown | `docs` 分析器 ✅ | 扩展至"指令面"审查（`SEC-INS-002`） |
| **清单/构建** | `package.json` / lockfile / `requirements.txt` / `Cargo.toml` / `pyproject.toml` | **不在受支持语言集** ❌ | **新增 `MANIFEST` 适配器**（`SEC-SUP-001/002/003` 的前置条件） |
| **非源码制品** | `.gitignore` / `scratch/` / `tmp*` / `.log` | 不可见 ❌ | 新增 `NON_SOURCE` 适配器（`AGT-ART-001`） |
| 脚本 | Shell / PowerShell | 经 governance 通用层 ⚠️ | 显式声明为受支持语言（`SEC-OPR-001` 主战场） |
| 容器/IaC（可选） | Dockerfile / YAML / SQL | 无 | 列为 v3 候选，本方案不承诺 |

**判定原则**（写入规范）：规则须声明 `languages`；**语言专属规则**必须标记 `languageExclusive` 并在跨语言矩阵中登记；**语言无关规则**（如 `SEC-VUL-002` 命令注入）必须由统一语义层实现，**禁止每语言复制一套正则**（否则直接踩 `CPX-RED-001` 自身规则）。

### 4.2 输出多语言（当前完全缺失）

**问题**：`messages/` 有 12 个域模块，但**无 locale 字典**；规则文案中英混排。

**方案（三层解耦）**：

| 层 | 内容 | 语言策略 |
| :--- | :--- | :--- |
| 稳定层 | `rule id`、`analyzer id`、`dimension id`、JSON/SARIF 字段名、指标键 | **恒英文**（保证机器消费者与基线稳定，绝不做本地化） |
| 文案层 | `summary` / `remediation` / `routing reason` | 走 locale 字典：`messages/locales/{en,zh-CN}.json`，键 = `rule id` |
| 报告层 | `format: text` 的人类可读输出；SARIF `message.text` | 依 `locale` 配置渲染；SARIF 保留英文 `ruleId` |

**关键约束（性能）**：locale 字典**按需惰性加载**，且只加载所选 locale（默认 `en`）；`json` / `sarif` 输出路径**不得触发任何字典加载**。这保证本地化对机器消费路径的稳态成本为 **0**。

**新增配置项（须登记 config schema）**：`locale: 'en' | 'zh-CN'`（默认 `en`）。注意项目红线要求"严禁向配置表臆造未在架构规范中定义的新字段"——须**先更新架构规范再落 schema**。

### 4.3 新增规则的多语言适配成本

| 规则族 | 语言无关性 | 实现策略 | 新增适配成本 |
| :--- | :--- | :--- | :--- |
| `SEC-SUP-*` | 语言无关（清单层） | 1 个 `MANIFEST` 适配器覆盖 5 类清单 | **低**（一次） |
| `SEC-INS-*` | 语言无关（文本层） | 统一文本扫描，复用既有 SWAR 向量化 | **极低** |
| `AGT-ART-001` | 语言无关（文件系统层） | 1 个 `NON_SOURCE` 适配器 | **极低** |
| `SEC-OPR-001` | 半无关（命令字符串） | 统一原语表 + 各语言命令构造点 | 中 |
| `GOV-ASY-001` / `CPX-DET-001` | **语言相关** | TS/Python 走 AST；Rust/GDScript 需适配器升级 | **高**（依赖 §4.1 适配器升级） |
| `DAT-IDM/TXN-001` | 语言相关 | 语义层 ORM/驱动识别 | 中高 |

> **排序含义**：把"语言无关且成本极低"的 P0 安全族排在**第 1 批**，把依赖适配器升级的可靠性族后置——这同时是最优的**性能风险**排序。

---

## 5. 新增规则总表（含 MoE 归属）

在 v1 的 27 条基础上补齐 MoE 维度。`稳态成本` 指信号不命中时的成本。

### 5.1 第 1 批（P0 安全 · 语言无关 · 零稳态成本）

| 规则 ID | 级别 | 专家 | 触发信号 | 稳态成本 | 轨道 | 需新增适配器 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `SEC-SUP-001` | error | `supply-chain` | `MANIFEST` | O(1) 路径短路 | deep | `MANIFEST` |
| `SEC-SUP-002` | error | `supply-chain` | `MANIFEST` | O(1) | deep | `MANIFEST` |
| `SEC-SUP-003` | error | `supply-chain` | `MANIFEST` | O(1) | deep | `MANIFEST` |
| `SEC-INS-001` | error | `instruction-surface` | `DOC_COMMENT` \| `MANIFEST` | O(1)（SWAR 字节扫描） | **fast** | 无 |
| `SEC-INS-002` | warning | `instruction-surface` | `DOC_COMMENT` | O(1) | fast | 无 |
| `SEC-OPR-001` | error | `dangerous-ops` | `IO` \| `MANIFEST` | O(1) | fast | 无 |
| `AGT-ART-001` | warning | `artifact-hygiene` | `NON_SOURCE` | O(1) | deep | `NON_SOURCE` |

### 5.2 第 2 批（P0/P1 · 协作与确定性）

| 规则 ID | 级别 | 专家 | 触发信号 | 稳态成本 | 轨道 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GOV-ASY-001` | error | `async-correctness` | `ASYNC` | O(1) 文本短路 | fast |
| `CPX-DET-001` | warning | `determinism` | `CONTROL_FLOW` \| `IO` | O(1) | fast |
| `AGT-SCP-001` | warning | `change-blast-radius` | 变更元数据（非文件内容） | O(1) | deep |

### 5.3 第 3 批（P1）

`SEC-EGR-001` · `SEC-CFG-001` · `SEC-CRY-001` · `DEP-SUP-004` · `GOV-RAC-001` · `GOV-RES-001` · `GOV-RTY-001` · `DAT-IDM-001` · `DAT-TXN-001` · `MNT-API-001`
—— 归属见 §5 表列规则；其中 `DEP-SUP-004`（幻觉 API）走 `IMPORT_EXPORT` 信号 + lockfile 符号表，`MNT-API-001` 走 `SIGNATURE` 信号（复用既有调用链影响分析，**无新增遍历**）。

### 5.4 第 4 批（P2 + 元守卫）

`DOC-DRV-001` · `AGT-PRV-001` · `AGT-BDG-001` · `AGT-CMT-001` · `GOV-XLG-001` · `HYG-EQV-001` · `GOV-OBS-001` + **§3.1 统一词表守卫** + **§6.1 加权成本门禁**。

---

## 6. 性能影响分析与优化思路

### 6.1 稀疏激活：新增专家对激活比例与既有门禁的冲击（定量）

设候选集大小 `N`，当前 `N = 21`；既有实测激活比例区间 **0.095~0.35**（约 2~7 个专家）。

**最坏情形（把新专家并入 `GENERAL_CODE` 兜底）**：`GENERAL_CODE` 已为"全量兜底"（ratio = 1.0），故**兜底路径不会因新增专家而变差**，但会在所有场景下无条件执行安全扫描 → **稳态成本被破坏**，与原则 1 冲突。

**条件门控情形（推荐）**：为每批新增专家绑定显式信号，稳态期望激活增量 ≈ **+0.5~1.5** 个专家。

| 场景 | 新增前 | 新增后（推荐设计） | 既有门禁 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| 字面量 diff | 2/21 = **0.095** | 2/27 = **0.074** | ≤ 0.25 | ✅ PASS |
| 文档 diff | 2/21 = **0.095** | 3/27 = **0.111**（+`SEC-INS-002`） | ≤ 0.15 | ✅ PASS（余量收窄） |
| 切片审计 | ≤ 0.25 | ≤ 0.25 | ≤ 0.25 | ✅ 需复核 |

**发现 1（门禁语义缺陷）**：新增专家会**增大分母 `N`**，使 `activationRatio = active/N` **机械下降** → 既有比例门禁会**自动放宽**，丧失判别力。

> **提案**：把门禁从"计数比"升级为**加权成本比**：
> `weightedCostRatio = Σ weight(active) / Σ weight(all)`，其中 `weight` 来自专家契约的 `steadyCost` 与实测 μs。
> 并对关键场景保留**绝对激活数上界**（如文档 diff ≤ 3 个专家），防止分母膨胀掩盖回归。

**发现 2（安全专家被结构性旁路）**：`sparseMoEGate.dispatchSliceExperts` 对 `isDocOnly` **立即 return**（仅 comments + docs），而 `ANALYZER_SECURITY` 仅在 `hasIoMutation` 时激活。

> **后果**：v1 判定为 P0 的 `SEC-INS-001/002`（注释/文档中的注入与不可见字符）在**当前门控下永远不会执行**。
> **修正**：新增 `instruction-surface` 专家并绑定 `DOC_COMMENT` 信号；同时把 `isDocOnly` 的"提前 return"改为"提前 return + 强制附加 instruction-surface"，否则该 P0 缺口无论规则怎么实现都无效。

### 6.2 推理延迟

| 路径 | 目标 | 新增规则的影响 | 优化思路 |
| :--- | :--- | :--- | :--- |
| `auditSlice`（Praxis 契约） | 头注释声明 **sub-10ms** | ⚠️ **当前实现不执行分析器**，新增专家执行后延迟将**真实上升** | ① 仅注入 `track: fast` 专家；② 新增 `latencyBudgetMs` 参数（默认 10ms），超预算则**降级为 DeepTrack 事件**并返回 `status: WARN` + `routingPlan.reasons` 标注降级原因 |
| FastTrack | **< 15ms**，实测 0.22ms | 预算余量充足（~68×） | ① 前置 O(1) 短路；② 复用 Review Memory 域指纹，命中即跳过同域专家 |
| `getRoutingPlan` | 纯规划，无执行 | 仅矩阵查询，可忽略 | 保持"不执行"语义（作为预热 API） |

**逐规则延迟预算**（纳入门禁）：FastTrack 专家单规则 **≤ 150 μs/文件**（占 <15ms 预算的 1%）；DeepTrack 专家 **≤ 2 ms/文件**。

### 6.3 吞吐量

| 项 | 分析 |
| :--- | :--- |
| 稳态影响 | **0**（信号不命中 → O(1) 前置文本短路，沿用既有 22 项规则的做法） |
| 命中时增量 | `SEC-INS-*` 走既有 **SWAR 64-bit 向量扫描**（6.45 GB/s），2.51 MB 全库 < 1 ms |
| 非源码文件扫描 | 新增 `MANIFEST` / `NON_SOURCE` 适配器引入**额外文件 IO**（清单文件通常 < 100 KB，相对 2.51 MB 源码占比 < 4%） |
| 全量 `audit` 档 | 预计吞吐从 **3.66 MB/s** 降至 **3.5~3.6 MB/s（≤ 4.5%）**，需实测确认 |

### 6.4 内存与分配

沿用既有约束：`loop-transient-allocation` / `PRF-MEM-001` / `CPX-SPACE-001`——新增专家**循环内零瞬态堆分配**；专家上下文对象**单例复用**（对齐 `GovernanceAnalyzer` 的 `reusableEvalCtx` 模式）。

### 6.5 优化思路清单（12 条）

1. **信号前置短路**：专家入口先做 O(1) 文本/路径判定，命中再进入 AST 逻辑。
2. **强制收敛路径**：把 4 批专家统一注册进 `MutationSignal` 矩阵，禁止散落 if 链。
3. **增量切片**：新专家默认只处理 diff 关联语法单元，非全树遍历（复用 `sliceExtractor`）。
4. **Review Memory 复用**：同域重复变更直接复用上次专家结论。
5. **LoadGovernor 分级**：`O(files)` 成本专家（`SEC-SUP-*`、`AGT-ART-001`）标记为低优先级任务，避免抢占 FastTrack 的 CPU。
6. **清单解析缓存**：以 lockfile **内容哈希**为键缓存解析结果（lockfile 变更频率远低于源码）。
7. **locale 惰性加载**：`json`/`sarif` 路径零加载（§4.2）。
8. **深轨异步**：`fallback: escalate-deep` 保证不牺牲前台延迟。
9. **worker 分片**：既有 `worker-scheduler` 承接 `O(files)` 专家。
10. **门禁语义升级**：加权成本比替代计数比（§6.1 发现 1）。
11. **零新遍历承诺**：`MNT-API-001` 复用既有调用链图，`DEP-SUP-004` 复用符号表 + lockfile。
12. **拒绝清单**：明确**不做**"为每个语言实现一套安全正则"（会同时违反 `CPX-RED-001` 与性能预算）。

---

## 7. 可评估的性能指标与验证方式

### 7.1 指标表（含采集点与门禁）

| # | 指标 | 定义 | 目标 | 采集点 | 门禁 |
| :--: | :--- | :--- | :--- | :--- | :--- |
| M1 | `activationRatio` | 激活专家 / 候选专家 | 字面量 ≤ 0.25；文档 ≤ 0.15 | 报告 `summary.activatedReviewers` | 既有 `validate-asymmetric-routing.js` |
| M2 | **`weightedCostRatio`** | Σ weight(激活) / Σ weight(全量) | ≤ 0.20 | 新报告字段 | **新增**（§6.1 发现 1） |
| M3 | **绝对激活专家数** | 每场景激活专家计数 | 文档 diff ≤ 3 | 同上 | **新增** |
| M4 | `fastTrackLatencyMs` | FastTrack 墙钟 | P50 < 15ms，P95 < 30ms | `FastTrackVerdict.latencyMs` | `hotpath-bench`（15% 劣化阻断） |
| M5 | **`sliceAuditLatencyMs`** | Praxis 切片审计墙钟 | P50 < 10ms，P95 < 20ms | `PraxisSliceAuditVerdict.latencyMs` | **新增断言**（当前无上界断言） |
| M6 | 单规则延迟 | 专家单文件增量耗时 | fast ≤ 150 μs；deep ≤ 2 ms | 新增 per-expert 计时 | **新增** |
| M7 | 全域吞吐 | MB/s | ≥ 基线 3.66 MB/s 的 95% | `bench-baselines` | `bench-history.json` 比对 |
| M8 | 增量切片自审总时长 | `gate:self:slice` | ≤ 1.9s × 1.15 | `gate-self-slice.js` | 既有 |
| M9 | 热缓存扫描 | 1001 文件 | ≤ ~180ms × 1.15 | `bench-warm`（S1~S6） | 既有 |
| M10 | 稳态零成本 | 信号不命中时新增专家耗时 | **≤ 1 μs/文件/专家** | 微基准 | **新增（核心承诺）** |
| M11 | 内存峰值 | 扫描 RSS 增量 | ≤ +5% | `bench-quant` 50k 行压测 | 新增阈值 |
| M12 | 误报率 | 影子运行期 false positive 比例 | 升 `error` 前 < 5% | 影子运行统计 | **新增（升级前置条件）** |

### 7.2 验证方式（复用既有体系，不另起一套）

| 验证 | 命令 / 方式 | 判定 |
| :--- | :--- | :--- |
| 热点防劣化 | `npm run hotpath-bench` | 劣于基线 **15%** 即阻断（既有） |
| 稀疏路由比例 | `npm run validate-asymmetric-routing` | M1 断言（既有）+ M2/M3（新增） |
| 双轨与 MoE 旁路实测 | `npm run bench-asymmetric` | 输出 "Workload reduction / compute eliminated %" |
| 增量与字节等价 | `npm run bench-diff` | 加速比 + **字节级等价**（既有硬约束） |
| 极限压测 | `npm run bench-quant` | SWAR / Myers / 50k 行 |
| 缓存与守护进程 | `npm run bench-warm` | S1~S6 延迟 |
| 切片门禁 | `npm run gate:self:slice:warning` | MoE 毫秒级响应 |
| 等价性闸门 | 既有 baselines + `validate-*` | **新规则不得改变既有规则的检出结果**（回归闭环） |
| 本体自审 | `npm run gate:self` / `gate:self:warning` | `newBlocking = 0`（基线只降不升） |

### 7.3 新增基准用例（fixture 设计）

| Fixture | 规模 | 用途 |
| :--- | :--- | :--- |
| `bench-osdiff-slice-*` | 单函数级 diff × 6 类别 × 5 语言 | M5 / M6 / M10 |
| `manifest-fixture` | 含 `postinstall`、非白名单 registry、lockfile 漂移 | `SEC-SUP-001/002/003` 正反向 |
| `instruction-fixture` | 含零宽/双向控制字符与指令覆盖语（**须逐字保留**，参照既有 `secret-detected` 夹具的 reason 抑制登记） | `SEC-INS-001/002` |
| `nonsource-fixture` | `scratch/`、`tmp*`、未 ignore 的 `.log` | `AGT-ART-001` |
| `async-nondet-fixture` | floating promise、`Date.now()` 作决策输入 | `GOV-ASY-001` / `CPX-DET-001` |

### 7.4 验收判定矩阵

| 批次 | 放行条件（**全部满足**） |
| :--- | :--- |
| 每批 | ① `hotpath-bench` 无 >15% 劣化；② M10 稳态成本 ≤1 μs 达标；③ `bench-diff` 字节等价；④ 新规则正反向用例全 PASS；⑤ `gate:self` + `gate:self:warning` `newBlocking=0` |
| 升 `error` 前 | ⑥ 影子运行 ≥1 周且 M12 误报率 <5%；⑦ M5 `sliceAuditLatencyMs` P95 <20ms |
| 全量交付 | ⑧ M7 吞吐 ≥ 95% 基线；⑨ M8/M9 劣化 ≤15%；⑩ M11 内存 ≤ +5% |

---

## 8. 交付批次

| 批次 | 内容 | 性能风险 | 前置条件 |
| :--- | :--- | :--- | :--- |
| **1** | `SEC-SUP-001/002/003` · `SEC-INS-001/002` · `SEC-OPR-001` · `AGT-ART-001` | **低**（语言无关 + O(1)） | `MANIFEST`/`NON_SOURCE` 适配器；`isDocOnly` 提前 return 修正 |
| **2** | `GOV-ASY-001` · `CPX-DET-001` · `AGT-SCP-001` | 低—中 | `ASYNC`/`IO` 信号补入 diff 词表 |
| **3** | `SEC-EGR-001` · `SEC-CFG-001` · `SEC-CRY-001` · `DEP-SUP-004` · `GOV-RAC-001` · `GOV-RES-001` · `GOV-RTY-001` · `DAT-IDM-001` · `DAT-TXN-001` · `MNT-API-001` | 中 | 符号表 + lockfile 缓存 |
| **4** | `DOC-DRV-001` · `AGT-PRV-001` · `AGT-BDG-001` · `AGT-CMT-001` · `GOV-XLG-001` · `HYG-EQV-001` · `GOV-OBS-001` + 统一词表守卫 + 加权成本门禁 | 低 | §3.1 落地 |
| **并行（先决）** | 统一 `MutationSignal` 词表 + 专家契约 + locale 层骨架 | 低 | 无（建议**先于第 1 批**） |

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
| :--- | :--- | :--- |
| 双词表静默失效 | 专家在某条链路永不执行 | §3.1 统一词表 + 注册表守卫断言"两链路映射完备" |
| `isDocOnly` 提前 return | P0 注入类规则**结构性无效** | 改为"提前 return + 强制附加 instruction-surface"（§6.1 发现 2） |
| 计数比门禁被分母膨胀稀释 | 性能回归被掩盖 | 升级为加权成本比 + 绝对激活数上界（M2/M3） |
| FastTrack 延迟预算击穿 | OSDIff 前台体验退化 | `latencyBudgetMs` + 超预算降级 DeepTrack（§6.2） |
| 误报导致门禁噪音 | 团队关停规则 → 安全能力实际归零 | 影子运行 1 周 + M12 <5% 才升 `error`；夹具类误报按既有 reason 抑制登记（参照 `secret-detected` 先例） |
| locale 拖慢机器消费路径 | 吞吐下降 | `json`/`sarif` 路径零字典加载（§4.2） |
| 文档口径已漂移 | 指标口径不可信 | 落地 `DOC-DRV-001`，把 10%~25% / 15%~35% / 80%~95% 统一到真源 |

---

## 10. 与 v1 的映射

| v1 条目 | v2 归属 |
| :--- | :--- |
| P0-1 供应链（6 条中 3 条） | §5.1 `SEC-SUP-001/002/003`，走新增 `MANIFEST` 适配器 |
| P0-2 指令面注入 | §5.1 `SEC-INS-001/002`；**须同时修正 `isDocOnly` 旁路** |
| P0-3 危险操作原语 | §5.1 `SEC-OPR-001` |
| P0-4 幻觉 API | §5.3 `DEP-SUP-004`（复用符号表 + lockfile，零新遍历） |
| P0-5 变更爆炸半径 | §5.2 `AGT-SCP-001` |
| P0-6 工作区残留物 | §5.1 `AGT-ART-001` |
| P1/P2 全部 | §5.2 ~ §5.4，均补齐"专家 / 信号 / 轨道 / 稳态成本"四列 |

**v1 中未变的两条结构性原则（仍然成立）**：① 安全规则默认开启（fail-closed）——并在 v2 中升级为"按 Agent Profile 强制"；② 规则生效面纳入门禁——v2 追加"两链路映射完备性"断言。
