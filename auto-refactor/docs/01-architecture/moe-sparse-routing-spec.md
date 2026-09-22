# auto-refactor MoE 稀疏激活与规则路由架构规范（MoE Sparse Routing Specification）

> **状态**：规范性架构真源（Normative Architecture Specification）
> **版本**：1.0.0
> **生效范围**：`auto-refactor` 核心路由引擎、Praxis Agent OSDIff 切片审计接口、分析器调度流水线

---

## 1. 原则 0：严格规范化约束优先（Principle 0: Strict Normalized Constraints First）

在系统设计与演进中确立**原则 0（Principle 0）**为最高价值法则：
$$\text{规范正确性} > \text{向后兼容性} > \text{代码修改量}$$

任何为了“少改代码”或“避免破坏性变更”而保留的双轨语义、隐式兜底、行内自豁免分支，均视为系统架构缺陷。系统本体可改，消费方可同步，一次性切换为标准规范形态。

### 1.1 七条子原则（Sub-Principles P0-1 ~ P0-7）

1. **P0-1 单一真源（Single Source of Truth）**：
   每个系统概念（词表、路由矩阵、专家配置、治理豁免、成本权重）在全仓物理上**有且仅有一处**唯一定义。禁止手工并行维护两套甚至多套等价数据结构。
2. **P0-2 Fail-closed（故障闭环 / 拒绝静默放宽）**：
   遇到未知类别、未声明语言、未登记扩展名或不可判定状态时，系统**必须抛出异常或进入最严格审查轨道**，绝对禁止静默跳过、静默降级或 `||` 兜底到全量。
3. **P0-3 禁止行内自豁免（No Inline Self-Exemption）**：
   所有审查豁免必须集中登记于工作区治理台账 `governance-exemptions.json`。每条豁免必须具备精确到物理文件路径的字段，严禁使用 Glob 通配符，且必须携带 `owner`、`reason` 与强制生效的 `expiresAt` 到期时间。
4. **P0-4 语义唯一（Semantic Invariance）**：
   同一份代码变更在任何入口、任何参数组合下，必须获得完全一致的特征判定与审查强度。严禁设立“快速路径”导致审查强度被动态削弱。
5. **P0-5 破坏性变更是合法工具（Breaking Changes as Legitimate Tools）**：
   破坏性变更允许一次性生效，必须遵循严格迁移顺序：**规范文件 $\to$ Config/Report Schema $\to$ 机器守卫 $\to$ 核心实现 $\to$ 消费方同步**。禁止未定期的无限期兼容别名窗口。
6. **P0-6 无守卫的规范视为不存在（Guards Validate Specs）**：
   每一条书面规范和硬约束，必须在 `scripts/` 中具备对应的自动化机器守卫脚本（CI 断言）。无守卫看守的规范在工程上视为不存在。
7. **P0-7 未执行必须留痕（Observable Non-Execution）**：
   任何因路由剪枝、降级策略、豁免生效或信号不命中而未执行分析器的行为，必须在最终扫描报告的结构化可观测字段中显式记录原因。

---

## 2. 规范化硬约束清单（Checklist of Hard Constraints）

### 2.1 必做硬约束（MUST: C-01 ~ C-08）

| 编号 | 约束定义 | 守卫脚本 / 机制 | 违反应对 |
| :--- | :--- | :--- | :--- |
| **C-01** | 每个专家的身份、信号、轨道与成本只能由 `ExpertManifest` 唯一定义；所有类别与原型矩阵由 manifest 纯函数推导生成 | `validate-expert-manifest.js` | 构建编译失败 |
| **C-02** | 每个专家必须显式声明 `signals`、`track`、`steadyCost`、`weight`、`fallback` 完整字段 | `validate-expert-manifest.js` | 单测阻断 |
| **C-03** | 每条豁免必须登记于集中台账，具备 `ruleId`、`file`（精确相对路径）、`symbol`、`owner`、`reason`、`expiresAt` | `validate-governance-exemptions.js` | 门禁直接失败 |
| **C-04** | 安全族规则（`SEC-*`、`secrets` 等）在任何 `profile` 和配置下强制开启，其专家 `fallback` 严禁声明为 `skip` | `validate-expert-manifest.js` | 门禁直接失败 |
| **C-05** | 任何“未执行 / 降级 / 豁免”必须在报告结构中输出对应的遥测证据字段 | `report.schema.json` 强校验 | 报告校验失败 |
| **C-06** | 延迟指标必须由 `process.hrtime.bigint()` 纳秒级采集，微秒级呈现（`latencyUs`）；严禁下限截断与毫秒取整 | `validate-latency-metrics.js` | 门禁直接失败 |
| **C-07** | 新增/修改规则必须同时交付：单一真源注册项 + Markdown 文档 + 字面量常量 + 正反向单元测试用例 | `validate-rules-registry.js` | 测试套件失败 |
| **C-08** | 自审基线只降不升（Ratchet Downward Only）；基线更新严禁自动洗白新增债务，必须单向收敛 | `gate-self.js` 基线棘轮 | 门禁直接阻断 |

### 2.2 禁止硬约束（MUST NOT: N-01 ~ N-10）

| 编号 | 禁止项定义 | 守卫脚本 / 机制 |
| :--- | :--- | :--- |
| **N-01** | 代码或配置中禁止出现任何绝对路径、物理盘符或 `file:///` 协议 | `validate-project-neutrality.js` |
| **N-02** | 未知类别路由严禁使用 `\|\| ALL_BUILTIN_ANALYZERS` 进行静默回落，必须抛出 `UNKNOWN_CATEGORY` | `validate-fail-closed.js` |
| **N-03** | 无语言标识或未注册扩展名的被审文件禁止静默跳过，必须抛出 `UNCLASSIFIED_FILE` | `validate-fail-closed.js` |
| **N-04** | 源码与文档中禁止使用行内注释自豁免（如 `# allow-root`、`// @allow-unsafe`） | `validate-governance-exemptions.js` |
| **N-05** | 安全族规则禁止在配置中被声明为 `downgradeTo: info` 或通过 Glob 永久抑制 | `validate-governance-exemptions.js` |
| **N-06** | 守卫脚本与测试用例中禁止出现硬编码的专家数量上界，上界必须由 manifest 动态推导 | `validate-asymmetric-routing.js` |
| **N-07** | 同一输入禁止存在多条特征提取路径（如区分是否有 `changedLines` 的双轨语义） | `validate-diff-interface.js` |
| **N-08** | 未在 manifest 中声明 `track` 的自定义分析器严禁进入 FastTrack | `validate-expert-manifest.js` |
| **N-09** | 测试文件、代码符号、路径与提交信息中严禁出现临时施工批次黑话（如 `pXX`、`temp`、`new`、`wip`） | `validate-physical-naming.js` |
| **N-10** | 为兼容而保留的历史别名禁止无期限存在，必须绑定具体下线日期并在版本号递增时强制剔除 | `validate-rule-aliases.js` 棘轮 |

---

## 3. AgentProfile 规范与四值归一化矩阵

为了统一应对人机协作、自主 Agent 与不可信外部输入的差异化安全需求，系统确立 `AgentProfile` 为核心契约字段（必填项）。

### 3.1 四值枚举定义

1. `untrusted`：未验证身份的外部输入、实验性模型、零信任 Agent、未知调用方（CLI 缺省时的安全回落值）；
2. `standard`：常规自主编程 Agent（Praxis Agent OSDIff 的标准生产运行态）；
3. `trusted-autonomous`：经过长期工程信誉检验、在受控沙箱内运行的长驻自动化 Agent；
4. `human-review`：人类资深工程师显式触发的交互式审查模式。

### 3.2 归一化行为矩阵（Normative Behavior Matrix）

| 行为维度 | `untrusted` | `standard` | `trusted-autonomous` | `human-review` |
| :--- | :--- | :--- | :--- | :--- |
| **安全族规则（`SEC-*`/`secrets`）** | **强制开启（不可配置关闭）** | 强制开启 | 强制开启 | 强制开启 |
| **`SEC-OPR-001` 危险系统原语** | **恒为 `BLOCK`** | **恒为 `BLOCK`** | 触发 `WARN` | 触发 `WARN` |
| **`SEC-SUP-004/005` 容器/CI 违规** | **恒为 `BLOCK`** | **恒为 `BLOCK`** | **恒为 `BLOCK`** | **恒为 `BLOCK`** |
| **推测式免检旁路（Speculative Bypass）** | **绝对禁止** | 允许（注入与删除除外） | 允许 | 允许 |
| **`forceFull` 全量强制扫描** | 禁止调用 | 允许 | 允许 | 允许 |
| **门禁阻断级别** | `error` + 安全类 `warning` | `error` | `error` | `error` |
| **超预算降级策略** | **宁慢不降级（运行完整验证）** | 降级 DeepTrack 异步追查 | 降级 DeepTrack | 降级 DeepTrack |
| **溯源与审计元数据** | **强制完整核验** | 强制核验 | 建议填充 | 豁免免除 |

---

## 4. 路由信号统一模型（MutationSignal）

彻底废除 Diff 链路 `DiffSemanticCategory`（6 类别）与切片链路 `SliceFeatureVector`（7 布尔）双词表隔离的现状，建立全仓统一的变异信号枚举：

```typescript
export type MutationSignal =
    | 'LITERAL'
    | 'CONTROL_FLOW'
    | 'INTERFACE_SIGNATURE'
    | 'IMPORT_EXPORT'
    | 'DOC_COMMENT'
    | 'INSTRUCTION_SURFACE'
    | 'DELETION'
    | 'ASYNC'
    | 'IO'
    | 'MANIFEST'
    | 'NON_SOURCE'
    | 'CONFIG_SECURITY'
    | 'AGENT_METADATA';
```

- **真 Diff 唯一映射**：由 Myers / Bit-Parallel Diff 算法输出行级变更，经表驱动映射为 `Set<MutationSignal>`；
- **纯删除与注入感知**：当且仅当删除行包含代码逻辑时发射 `DELETION` 且 `isDocOnly = false`；当文本中检测到指令覆盖词或不可见控制字符时发射 `INSTRUCTION_SURFACE` 且 `isDocOnly = false`。
