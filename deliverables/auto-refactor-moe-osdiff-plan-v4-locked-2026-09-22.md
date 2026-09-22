# auto-refactor 规则扩展计划 · 定稿版（v4）—— 决策锁定 + 计划表

> ⚠️ **设计偏置已被 v5 取代**：v4 中隐含的"最小侵入 / 向后兼容优先"价值排序被判定为错误，已改为 **原则 0：严格规范化约束优先**（D7）。
> v4 的 5 项决策（D1–D5）、F1/F2 定稿设计、AgentProfile 矩阵、MANIFEST 覆盖面仍然有效；**§3「最小侵入」的 14 处设计需按 v5 §3 替换表改写**。
> 见 `auto-refactor-moe-osdiff-plan-v5-strict-final-2026-09-22.md`。

> **修订关系**：本文件是 v1→v2→v3 链条的**定稿**。v3 的缺陷清单（F1–F8）、v2 的多语言/Profile 策略、v1 的缺口清单全部继承；本文件**锁定 5 项决策**并新增 F1/F2 的定稿设计、精细化成本门禁、`AgentProfile` 完整定义与总计划表。
> **决策来源**：2026-09-22 用户拍板（F1=真 Diff · F2=方案 B · 门禁=加权成本比+分类绝对上界且更精细化 · AgentProfile=新增且定义清晰 · MANIFEST=纳入）+ 统一层归属澄清。
> **性质**：设计定稿，不含实现

---

## 0. 决策定稿表

| # | 议题 | **定稿** | 关键约束 |
| :--: | :--- | :--- | :--- |
| D1 | F1 纯删除不可见 | **引擎内做真 Diff**（不改变消费方契约） | 复用既有 Myers/hunk 原语；`changedLines` 保留为可选快路径 |
| D2 | F2 注释注入旁路 | **方案 B：新增 `INSTRUCTION_SURFACE` 类别** | 不改 `COMMENT_DOC_ONLY`，doc 比例门禁不受影响 |
| D3 | 门禁口径 | **加权成本比 + 分类别绝对上界，且做三级精细化** | 公式见 §4；分母固定；并加棘轮 |
| D4 | AgentProfile | **新增 `profile` 字段，四值枚举，含完整归一化矩阵** | 需同步 `report.schema.json` 与消费方 |
| D5 | MANIFEST 作用域 | **纳入**：包清单 + 锁文件 + 容器 + CI + 环境/密钥文件 | 仍走统一适配器注册表（§1.3） |

---

## 1. 统一层澄清（回答"不是有统一层吗？"）

**结论：是，存在统一层；但统一层只覆盖"解析与诊断"，恰恰不覆盖"路由信号"——这正是双词表缺陷的根因。**

### 1.1 现状：三层统一 + 一处空白

| 层 | 载体 | 是否统一 | 证据 |
| :--- | :--- | :--- | :--- |
| 诊断契约 | `Issue`（analyzer/rule/severity/location/suppression/isNew） | ✅ 统一 | 全分析器共用单结构 |
| **AST 归一化 IR** | `NormalizedAst` / `NormalizedNode` + `LanguageAdapter`（`multilang.ts:296`） | ✅ 统一（跨 5 语言） | 单次遍历多路复用即建立在此层 |
| 适配器注册表 | `EXTENSION_ADAPTER_IDS` + `registerAdapter` + `adapterFor`（`ast/adapters.ts:55,103,121`） | ✅ 统一 | 由 `validate-language-support.js` 断言防漂移 |
| 语义适配器 | `UnifiedLanguageAdapter`（`semantic/adapters/base.ts:28`） | ⚠️ **第二个适配器层** | 与上表并存 |
| **路由信号** | `SliceFeatureVector`（7 布尔）/ `DiffSemanticCategory`（6 类别） | ❌ **完全未统一** | 两套词表，无任何守卫 |

### 1.2 已存在的层间漂移（实证）

`GoSemanticAdapter` 定义于 `semantic/adapters/skeleton-adapters.ts:79`，但 **Go 既不在 `EXTENSION_ADAPTER_IDS`，也不在 `supportedLanguages`**（`typescript, javascript, python, rust, gdscript`）。

> 即：**两个适配器层已经漂移**。这说明"有了统一层"不等于"统一生效"——本计划的 S0 阶段必须包含**层间一致性守卫**，否则新增 `MANIFEST` 适配器会加剧同一问题（注册到 A 层、被 B 层忽略）。

### 1.3 落点定稿

| 目标 | 落点 | 理由 |
| :--- | :--- | :--- |
| `MANIFEST` / `NON_SOURCE` 适配器 | **注册进既有统一注册表**（`EXTENSION_ADAPTER_IDS` + `validate-language-support.js`） | 先例明确：**`MarkdownAdapter` 已证明非代码文本可接入该层**（`.md → markdown`），无需另起注册路径 |
| `MutationSignal` 词表 | **定义在统一层之上，由 `NormalizedNode` 的 `nodeKind` 派生**（切片侧）；Diff 侧由行正则派生**但映射到同一枚举** | 统一的是**词表与身份**，不是提取器；这样既保住 Diff 侧的 O(变更行) 性能，又消除双词表 |
| 语义/姿态适配器漂移（§1.2） | S0 增加守卫：`supportedLanguages` ≡ `EXTENSION_ADAPTER_IDS` 值集 ≡ 语义适配器 `extensionMap` | 一次性消除既有漂移 |

---

## 2. D1 定稿：F1 真 Diff 设计

### 2.1 设计

| 项 | 定稿 |
| :--- | :--- |
| 位置 | `src/core/diff/`（**已存在**该域：`diff-types.ts`、`hunk-builder.ts`），不新建域 |
| 复用 | 既有 **Bit-Parallel Myers / SWAR** 原语（`bench-quant` 已实测：1k 行最坏 **0.410ms**、64 位向量 **17.8μs**；5000 行 10 处编辑 **3.549ms**） |
| 契约 | `changedLines?: string[]` **保留**（显式传入即走原路径，零行为变化）；新增可选 `changes?: { added: string[]; removed: string[] }`；**两者都缺省时，用真 Diff 取代当前的"行集合差"** |
| 新信号 | `DELETION`（`removed.length > 0`） |
| `isDocOnly` 判定修正 | 由"**新增行全为注释**"改为"**新增行与删除行全为注释**" |
| 降级 | 若真 Diff 耗时超出调用方 `latencyBudgetMs` 预算 → 回退到行集合差并在 `routingPlan.reasons` 记 `DIFF_BUDGET_FALLBACK` |

### 2.2 成本（必须实测，禁推断）

| 场景 | 既有 | 真 Diff 增量 | 结论 |
| :--- | :--- | :--- | :--- |
| 单文件 ≤500 行 | 行集合差 O(n) 哈希 | Myers ≈ **<0.2ms** | `auditSlice` 10ms 预算内可接受 |
| 5000 行 + 10 处编辑 | — | **3.549ms**（已实测） | 超 10ms 预算的 1/3 → 需 `DIFF_BUDGET_FALLBACK` |
| 全量扫描 | 不涉及 | **0**（全量路径不调用分类器） | 吞吐不受影响 |

### 2.3 验收

| 项 | 判定 |
| :--- | :--- |
| 功能 | `deletion-guard` 夹具：删除 `if (!isAuthorized) throw …` → `categories ∋ DELETION`、`isDocOnly=false`、安全专家进入 active |
| 等价性 | 既有"新增型"变更的检出结果**逐字节不变**（`bench-diff` 字节等价闸门） |
| 性能 | `bench-diff` 加速比不劣于基线 `/0.95`；`M6 sliceAuditLatencyUs` P95 ≤20ms |
| 回归 | `gate:self` + `gate:self:warning` `newBlocking=0` |

---

## 3. D2 定稿：F2 方案 B（新增 `INSTRUCTION_SURFACE` 类别）

### 3.1 分类器改动（最小侵入）

| 步骤 | 定稿 |
| :--- | :--- |
| 新常量 | `INSTRUCTION_SURFACE_CATEGORY = 'INSTRUCTION_SURFACE'`，加入 `DiffSemanticCategory` 联合类型 |
| 检测位置 | **在 `allComments` 提前 return 之前**追加一次检测（`diffClassifier.ts:290` 之前） |
| 检测内容 | ① 指令覆盖语：`ignore previous` / `disregard` / `do not report` / `system prompt` / `exfiltrate` 等；② **不可见与双向控制字符**：U+200B/200C/200D/200E/200F/202A-202E/2066-2069 |
| 检测成本 | 复用同一次逐行循环，增加 2 个正则 + 1 次字符检查 → **亚微秒/行** |
| 类别结果 | 命中时 `categories = {COMMENT_DOC_ONLY?, INSTRUCTION_SURFACE}`，且 **`isDocOnly = false`** |
| **置信层修正（关键）** | `computeConfidenceTier` 增加最高优先级分支：**含 `INSTRUCTION_SURFACE` ⇒ 返回 `'LOW'`**，禁止推测式免检旁路 |
| 路由 | `INSTRUCTION_SURFACE: [ANALYZER_SECURITY]` |

### 3.2 门禁影响（已核算，安全）

| 场景 | active | ratio | 既有门禁 | 判定 |
| :--- | :--- | ---: | :--- | :--- |
| 纯文档变更（无注入） | {comments} | **0.048** | ≤0.15 | ✅ **完全不受影响** |
| 文档 + 注入命中 | {comments, security} ∪ {hygiene, constants} = 4 | **0.190** | 无断言（doc 断言只覆盖纯文档夹具） | ⚠️ 需新增专属上界：`INSTRUCTION_SURFACE ≤ 4 专家` |
| 代码 + 注入命中 | 依类别叠加 | ≤0.286 | — | 由分类别上界守护（§4） |

> 说明：`isDocOnly=false` 会让共享专家注入（+2），故注入场景为 4 个专家。这是**有意为之**——注入命中代表"该文件已不可信"，宁多跑不漏。

---

## 4. D3 定稿：三级精细化加权成本门禁

### 4.1 权重定义（S0 实测产出，禁止编造）

```
weight(expert) = 单文件平均增量耗时(μs) / 归一化基准
基准               = S0 扫描时该专家在 200 文件样本上的 P50 耗时
维护               = 随专家新增/修改必须重测，写入 experts-weights.json 并纳入 expertsDigest
```

| 轨道 | 权重上限 | 依据 |
| :--- | :--- | :--- |
| `fast` | ≤150μs → 权重 ≤1.0 | FastTrack 15ms 预算 / 单文件 |
| `deep` | ≤2000μs → 权重 ≤13.3 | DeepTrack 异步，不占前台预算 |

### 4.2 三级粒度（比 v3 更精细）

| 级别 | 指标 | 公式 | 断言 |
| :--- | :--- | :--- | :--- |
| **L1 专家级** | `expertLatencyUs` | 逐专家 P50/P95 | `fast ≤150μs`；`deep ≤2000μs` |
| **L2 信号级** | `signalWeight` | `Σ weight(active ∧ signal=s)` | 每个信号设 **独立预算**（防信号爆炸） |
| **L3 类别级** | `categoryWeight` | `Σ weight(active) / Σ weight(ALL_BUILTIN_ANALYZERS)` | 分类别上界（下表） |
| **L4 全局级（棘轮）** | `weightedCostRatio` | 同 L3，分母**固定**为全量内置集 | **只降不升**（对冻结基线棘轮） |

### 4.3 分类别绝对上界（首次全量纳入守护）

| 类别 | 现行 | **定稿上界** | 现状实测 |
| :--- | :--- | :--- | ---: |
| `LITERAL_ONLY` | ≤0.25 | **≤3 专家 / ≤0.25** | 3（0.143） |
| `COMMENT_DOC_ONLY` | ≤0.15 | **≤1 专家 / ≤0.15** | 1（0.048） |
| `INSTRUCTION_SURFACE`（新） | — | **≤4 专家 / ≤0.25** | 4（0.190） |
| `IMPORT_EXPORT` | 无 | **≤5 专家 / ≤0.30** | 5（0.238） |
| `CONTROL_FLOW` | 无 | **≤7 专家 / ≤0.35** | 6（0.286） |
| `INTERFACE_SIGNATURE` | 无 | **≤7 专家 / ≤0.35** | 6（0.286） |
| `GENERAL_CODE`（原型） | 无 | **≤加权 0.60** | 0.333~0.571 |
| `DELETION`（新） | — | **≤6 专家 / ≤0.30** | 待实测 |

> L3/L4 的分母**固定为 `ALL_BUILTIN_ANALYZERS`**，消除 v3-F4 的"配置相关分母"问题；本仓库 config 仅启用 9 个分析器时，分母仍取全量集，故同一变更在各消费方**口径一致**。

---

## 5. D4 定稿：`AgentProfile` 完整定义

### 5.1 枚举与归一化矩阵（必须清晰 —— 本表即契约）

| 维度 | `untrusted` | `standard`（默认） | `trusted-autonomous` | `human-review` |
| :--- | :--- | :--- | :--- | :--- |
| 适用对象 | 外部/实验性 Agent、未知模型 | 常规自主 Agent（**OSDIff 默认**） | 已建立信誉的长驻 Agent | 人类开发者 |
| 安全族（`SEC-*`/`secrets`） | **强制开启**（配置不可关） | 强制开启 | 强制开启 | 强制开启 |
| `SEC-OPR-001` 危险操作 | **恒 BLOCK** | BLOCK | WARN | WARN |
| 推测式免检旁路（`confidenceTier=HIGH`） | **禁止**（全走验证） | 允许（`INSTRUCTION_SURFACE`/`DELETION` 除外） | 允许 | 允许 |
| `forceFull` | 禁止 | 允许 | 允许 | 允许 |
| 阻塞级别 | `error` + `warning`（安全类） | `error` | `error` | `error` |
| 超出 `latencyBudgetMs` | **不降级**（宁可慢） | 降级 DeepTrack | 降级 DeepTrack | 降级 DeepTrack |
| 归档要求 | 强制（`AGT-PRV-001` 溯源登记） | 强制 | 建议 | 免 |

### 5.2 落点与兼容

| 项 | 定稿 |
| :--- | :--- |
| 字段名 | `profile?: AgentProfileName`（**新增**，不覆盖 `author`；`author` 保留为溯源信息） |
| 出现位置 | `PraxisSliceAuditInput` · `DiffFileInput` · CLI `--profile <name>` · 报告 `summary.agentProfile` |
| 报告 schema | `report.schema.json` 的 `summary` 增加 `agentProfile`（enum 四值）；**必填于 `summary`** |
| 默认值 | 显式声明 `standard`；**若 `author` 缺失且未声明 profile → 回落 `untrusted`**（fail-closed） |
| 与 `securityLevel` 关系 | `securityLevel` 仍控制"开哪几条"；`profile` 控制"允不允许豁免"。**profile 优先级高于 securityLevel**（不可被 `securityLevel: off` 降级） |
| 消费方影响 | OSDIff 需传 `profile`；不传则按 `standard`（或 author 缺失时 `untrusted`）→ **向后兼容，但可能从"允许旁路"变为"禁止旁路"**，须在变更日志中标注 |

---

## 6. D5 定稿：`MANIFEST` 作用域（含容器/CI）

### 6.1 覆盖面（全部经统一注册表接入）

| 类别 | 文件 | 适配器 | 信号 | 对位规则 |
| :--- | :--- | :--- | :--- | :--- |
| JS/TS | `package.json` · `package-lock.json` · `pnpm-lock.yaml` · `yarn.lock` · `.npmrc` · `.yarnrc` | `MANIFEST` | `MANIFEST` | `SEC-SUP-001/002/003` |
| Python | `requirements*.txt` · `pyproject.toml` · `poetry.lock` · `Pipfile(.lock)` · `setup.py/cfg` | `MANIFEST` | `MANIFEST` | 同上 |
| Rust | `Cargo.toml` · `Cargo.lock` | `MANIFEST` | `MANIFEST` | 同上 |
| Go（顺带闭合 §1.2 漂移） | `go.mod` · `go.sum` | `MANIFEST` | `MANIFEST` | 同上 |
| **容器** | `Dockerfile*` · `docker-compose*.y{a,}ml` · `.dockerignore` | `MANIFEST` | `MANIFEST` + `CONFIG_SECURITY` | **`SEC-SUP-004`** · `SEC-CFG-001` |
| **CI** | `.github/workflows/*.yml` · `.gitlab-ci.yml` · `Jenkinsfile` · `Makefile` | `MANIFEST` | `MANIFEST` + `CONFIG_SECURITY` | **`SEC-SUP-005`** · `SEC-CFG-001` |
| **环境与密钥** | `.env*` · `*.pem` · `*.key` · `id_rsa*` | `NON_SOURCE` | `NON_SOURCE` | `SEC-CRY-001` · `secret-detected` 扩展 |

### 6.2 新增两条 P0 规则（因纳入容器/CI 而产生）

| 规则 ID | 级别 | 判定 | 为什么必须 |
| :--- | :--- | :--- | :--- |
| `SEC-SUP-004` | **error** | 容器/CI 清单中的凭据明文、`USER root`、`--privileged`、镜像 `latest` 未固定 digest | Agent 可直接改 Dockerfile/CI 获得宿主机权限 |
| `SEC-SUP-005` | **error** | CI 工作流触发器放宽（`pull_request_target`+`checkout` PR 头）、权限未最小化（`permissions: write-all`）、第三方 action **未固定 commit SHA** | Agent 改一行 CI 即可读取/外传仓库机密；未固定 SHA 的 action 是供应链攻击主通道 |

---

## 7. 总计划表（核心交付）

### 7.1 阶段表

| 阶段 | 任务 | 产出 | 前置 | 门禁 | 验收指标 | 回滚点 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **S0 地基** | ① 真 Diff 落 `core/diff`（D1）② `perf-metrics` hrtime 门面（F5）③ `MutationSignal` 词表 + `ExpertManifest` 契约 ④ `CATEGORY_ANALYZER_MATRIX` 键集断言 + 去硬编码（F6）⑤ **层间一致性守卫**（§1.2 漂移）⑥ 权重实测产出 `experts-weights.json` | 契约层 + 守卫 + 基线与权重 | 无 | `npm test` 全量 + `hotpath-bench` | 三个守卫全绿；权重表落盘；既有检出**字节等价** | 全部为新增模块，直接 revert |
| **S1 注入面** | `INSTRUCTION_SURFACE` 类别（D2）+ `SEC-INS-001/002` + **`isDocOnly` 双判修正（F1）** | 分类器扩展 + 2 规则 | S0①②③④ | `validate-asymmetric` + 新夹具 | M14 免检旁路率=0；M13 删除检出率>0.095 | `experts.instruction-surface.enabled=false` |
| **S2 供应链** | `SEC-SUP-001~005` + `MANIFEST` 适配器 + lockfile 哈希缓存 | 适配器 + 5 规则 | S0③⑥ | 夹具三组 + 缓存命中率 | `manifest-poison` BLOCK；缓存命中率 >99% | `experts.supply-chain.enabled=false` |
| **S3 制品面** | `AGT-ART-001` + `NON_SOURCE` 适配器 | 适配器 + 1 规则 | S0③ | `nonsource-fixture` | `scratch/` 未 ignore 命中 | 规则开关 |
| **S4 危险操作** | `SEC-OPR-001` + 授权声明豁免机制 | 1 规则 | S0③ | `dangerous-ops` 夹具 | 危险原语命中且可声明豁免 | 规则开关 |
| **S5 可靠性** | `GOV-ASY-001` · `CPX-DET-001`（需补 Diff 侧 `ASYNC`/`IO` 信号） | 2 规则 | S0③ | 异步/非确定性夹具 | floating promise 命中；`Date.now` 决策命中 | `track: fast→deep` |
| **S6 Agent 协作** | `AGT-PRV-001` · `AGT-SCP-001` · `AGT-BDG-001` · `AGT-CMT-001` + **`AgentProfile` 全链路（D4）** | 4 规则 + schema 变更 | S0③ | 四 Profile 差异化断言 | M17 Profile 一致性=100% | schema 版本回退 |
| **S7 门禁升级** | 三级加权成本门禁 + 分类别上界（D3） | 断言 + 棘轮 | S0⑥ + S1~S6 | `validate-asymmetric` + `gate:self:slice` | L4 棘轮只降不升 | 保留旧断言开关 |
| **S8 收尾** | v1 第 3 批 P1 十条 · `DOC-DRV-001`（收敛 F8 三处口径）· locale 层 | 10+1 规则 + i18n | S0 | `bench-baselines` | 吞吐 ≥3.5 MB/s；`json/sarif` 零字典加载 | 规则开关 |

### 7.2 规则交付清单（29 条）

| ID | 级别 | 专家 | 信号 | 轨道 | 语言 | 批次 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--: |
| `SEC-SUP-001` | error | supply-chain | MANIFEST | deep | all | S2 |
| `SEC-SUP-002` | error | supply-chain | MANIFEST | deep | all | S2 |
| `SEC-SUP-003` | error | supply-chain | MANIFEST | deep | all | S2 |
| `SEC-SUP-004` | error | supply-chain | MANIFEST+CONFIG_SECURITY | deep | all | S2 |
| `SEC-SUP-005` | error | supply-chain | MANIFEST+CONFIG_SECURITY | deep | all | S2 |
| `SEC-INS-001` | error | instruction-surface | INSTRUCTION_SURFACE | fast | all | S1 |
| `SEC-INS-002` | warning | instruction-surface | INSTRUCTION_SURFACE | fast | all | S1 |
| `SEC-OPR-001` | error | dangerous-ops | IO+MANIFEST | fast | all | S4 |
| `AGT-ART-001` | warning | artifact-hygiene | NON_SOURCE | deep | all | S3 |
| `CPX-DET-001` | warning | determinism | CONTROL_FLOW+IO | fast | ts/py | S5 |
| `GOV-ASY-001` | error | async-correctness | ASYNC | fast | ts/py | S5 |
| `AGT-SCP-001` | warning | change-blast-radius | （变更元数据） | deep | all | S6 |
| `SEC-EGR-001` | warning | egress | IO | deep | all | S8 |
| `SEC-CFG-001` | error | config-security | CONFIG_SECURITY | fast | all | S8 |
| `SEC-CRY-001` | warning | crypto-misuse | NON_SOURCE+CONFIG_SECURITY | deep | all | S8 |
| `DEP-SUP-004` | error | phantom-api | IMPORT_EXPORT | deep | all | S8 |
| `GOV-RAC-001` | warning | race | ASYNC | deep | ts/py | S8 |
| `GOV-RES-001` | warning | resource-budget | IO | deep | all | S8 |
| `GOV-RTY-001` | warning | retry-policy | IO | deep | all | S8 |
| `DAT-IDM-001` | warning | idempotency | IO | deep | all | S8 |
| `DAT-TXN-001` | warning | transaction | IO | deep | all | S8 |
| `MNT-API-001` | error | api-contract | SIGNATURE | deep | all | S8 |
| `DOC-DRV-001` | warning | doc-drift | DOC_COMMENT | deep | markdown | S8 |
| `AGT-PRV-001` | info | provenance | （变更元数据） | deep | all | S6 |
| `AGT-BDG-001` | warning | agent-budget | （变更元数据） | deep | all | S6 |
| `AGT-CMT-001` | warning | commit-hygiene | （变更元数据） | deep | all | S6 |
| `GOV-XLG-001` | info | cross-language | LITERAL+CONTROL_FLOW | deep | all | S8 |
| `HYG-EQV-001` | warning | equivalence | DELETION+SIGNATURE | deep | all | S8 |
| `GOV-OBS-001` | info | observability | IO | deep | all | S8 |

### 7.3 指标与门禁总表

| # | 指标 | 目标 | 门禁 | 批次 |
| :--: | :--- | :--- | :--- | :--: |
| M1 | `advisedRatio` | 按类别上界（§4.3） | `validate-asymmetric` | S0 |
| M2 | `appliedRatio` | 与 advised 差值 ≤0.10 | **新增** | S0 |
| M3 | `weightedCostRatio` | L4 棘轮只降不升 | **新增** | S7 |
| M4 | `categoryCapViolation` | 0 | **新增** | S7 |
| M5 | `fastTrackLatencyUs` | P50≤15ms / P95≤30ms | `hotpath-bench`（15% 阻断） | S0 |
| M6 | `sliceAuditLatencyUs` | P50≤10ms / P95≤20ms | **新增** | S0 |
| M7 | `expertLatencyUs`（L1） | fast≤150μs / deep≤2000μs | **新增** | S7 |
| M8 | `signalWeight`（L2） | 每信号独立预算 | **新增** | S7 |
| M9 | 全域吞吐 | ≥3.5 MB/s | `bench-baselines` | S8 |
| M10 | `gate:self:slice` 时长 | ≤1.9s×1.15 | 既有 | S7 |
| M11 | 稳态成本 | ≤1μs/文件/专家 | **新增（核心承诺）** | S7 |
| M12 | 内存峰值 | 不触及 heap 450MB | `bench-quant` | S2 |
| M13 | **删除检出率** | 纯删除 `advisedRatio>0.095` | **新增** | S1 |
| M14 | **免检旁路率** | 含注入/不可见字符 ⇒ 0 | **新增** | S1 |
| M15 | 误报率 | <5%（影子 ≥1 周） | 升级前置 | S1 起 |
| M16 | 等价性 | 既有检出字节不变 | `bench-diff` | 每批 |
| M17 | **Profile 一致性** | 四 Profile 行为 ≡ §5.1 矩阵 | **新增** | S6 |

---

## 8. 风险表

| 风险 | 影响 | 对策 |
| :--- | :--- | :--- |
| 真 Diff 拖慢 `auditSlice` | 超 10ms 预算 | `DIFF_BUDGET_FALLBACK` 降级 + M6 断言 |
| `INSTRUCTION_SURFACE` 误报（正常英文注释含 "ignore"） | 噪音 | 要求**祈使语 + 动作**共现；影子期统计 M15，误报 >5% 则收窄词表 |
| L4 棘轮被"新专家权重低"稀释 | 回归被掩盖 | 权重随 `expertsDigest` 强制重测；棘轮比对冻结基线而非静态阈值 |
| **两层适配器漂移加剧**（注册到 A 层被 B 层忽略） | `MANIFEST` 静默不生效 | S0⑤ 层间一致性守卫；`MANIFEST` 必须同时在两处可见 |
| `AgentProfile` 默认值改变既有旁路行为 | 消费方意外阻塞 | 变更日志标注；`standard` 默认，`author` 缺失才回落 `untrusted` |
| 容器/CI 规则误伤合法 `USER root` | 阻断流水线 | `SEC-SUP-004` 提供 `<file>#allow-root` 式授权声明豁免 |
| 文档口径 F8 已漂移 | 指标不可信 | S8 `DOC-DRV-001` 收敛为单一真源 |

---

## 9. 剩余待确认（仅 2 项）

1. **`AgentProfile` 的默认回落**：采用"`author` 缺失 ⇒ `untrusted`"（安全优先，但可能让既有 OSDIff 调用突然变严），还是"统一默认 `standard`"（兼容优先）？
2. **`SEC-SUP-004/005` 的阻塞策略**：容器/CI 变更是否一律 BLOCK（含 `status: BLOCK`），还是仅对 `PRESENT` 以上 profile 生效？

---

## 附录：事实索引（本文件新增部分）

| 事实 | 位置 |
| :--- | :--- |
| `LanguageAdapter` 契约（`parse`/`project`/`root`/`children`） | `src/core/ast/multilang.ts:296-340` |
| 扩展名注册表 + `registerAdapter`（运行时注册） | `src/core/ast/adapters.ts:55-66,103-106,121` |
| **第二适配器层** `UnifiedLanguageAdapter` | `src/core/semantic/adapters/base.ts:28`；`registry.ts:28-29` |
| **漂移实证**：`GoSemanticAdapter` 存在但 Go 未纳入 | `semantic/adapters/skeleton-adapters.ts:79` vs `EXTENSION_ADAPTER_IDS` / `supportedLanguages` |
| `MarkdownAdapter` 先例（非代码文本已接入统一层） | `src/core/ast/markdown-adapter.ts:21`；`.md → markdown` |
| `allComments` 提前 return 点（F2 插入位置） | `src/core/router/diffClassifier.ts:290-304` |
| 置信层计算（需插入 `INSTRUCTION_SURFACE ⇒ LOW`） | `diffClassifier.ts:221-236` |
| 行集合差（F1 待替换点） | `diffClassifier.ts:101-118` |
| Myers/SWAR 既有实测 | `docs/05-specs-and-benchmarks/02-performance-benchmarks.md:36-39` |
