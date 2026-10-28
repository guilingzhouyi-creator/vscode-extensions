---
name: telemetry-statistical-modeling
description: >-
  【触发：评分/度量/跑分/统计模型/贝叶斯/CAI/注水/反刷分】开发评分器、重构度量算法或反刷分时触发。落实从 0 纯客观统计、Jeffreys Beta(0.5,0.5) 共轭后验估计与 BLOCK_GAMING_DETECTED 虚假重构熔断。
---

# telemetry-statistical-modeling — 客观度量、贝叶斯统计建模与反刷分规范

本技能确立全工作区质量度量、代码自研率（CAI）分析与自治评分系统的数学根基，落实**从 0 纯客观统计**、**无信息 Jeffreys $\text{Beta}(0.5, 0.5)$ 共轭后验置信区间**、**异构多语言均衡指数**及**反刷分熔断防御（`BLOCK_GAMING_DETECTED`）**。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | 自动重构内核（链上第 4 步） |
| **前置** | [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md) |
| **接续** | [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md) |
| **并行支援** | [coding-craft](../coding-craft/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md)、[debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md) |
| **领域链** | 自动重构内核：auto-refactor-dev → rust-engineering → algorithmic-operator-engineering → telemetry-statistical-modeling → test-benchmark-engineering |

**何时联动**：新增分析器或规则 → `auto-refactor-dev` + `rule-catalog-governance` + `test-benchmark-engineering`；Rust 与 TypeScript 输出字节不等价 → `auto-refactor-dev` + `rust-engineering` + `debugging-and-error-recovery`
<!-- SKILL-LINKS:END -->

## 一、 客观统计零注水与 AST 符号溯源公理

| 治理支柱 | 刚性约束指标 | 架构职责与防范目标 |
| :--- | :--- | :--- |
| **基数从零纯客观** | 零倍率放大 / 零保底加分 | 符号与质量得分从 0 起算，严禁乘 1.2/1.5 倍虚假放大或写死保底分 |
| **AST 符号索引追踪** | 基于 `symbolIndex` 真实节点 | 外部依赖调用必须基于 AST 符号索引精确追踪，严禁正则行匹配盲扫 |
| **小样本真实不确定性** | 严禁写死固定误差常数 | 样本不足时如实输出宽置信区间，严禁硬编码 `score ± 5%` |
| **概率测度封闭性** | 严格钳制于 $[0.0, 1.0]$ | 评分与置信区间受测度截断保护，杜绝出现负值或超上限值 |

---

## 二、 Jeffreys Beta(0.5, 0.5) 共轭后验与 Popoviciu 多语言均衡模型

1. **无信息 Jeffreys 先验共轭后验**（成功 $s$，失败 $f$，样本量 $n = s + f$）：
   - 后验分布：$\theta \mid s, f \sim \text{Beta}(s + 0.5, f + 0.5)$；
   - 后验均值与方差：$\mu = \frac{s + 0.5}{n + 1}$，$\sigma^2 = \frac{(s + 0.5)(f + 0.5)}{(n + 1)^2 (n + 2)}$；
   - 双侧 95% 置信区间（$z \approx 1.95996$）：$\left[\max(0.0, \mu - z\sigma),\; \min(1.0, \mu + z\sigma)\right]$。
2. **Popoviciu 方差界与异构多语言均衡指数 (`calculatePolyglotGeneralizationIndex`)**：
   - 根据 Popoviciu 方差不等式 (Popoviciu, 1935)，对取值在 $[0, 100]$ 的任意有界变量，理论最大标准差为 $\sigma_{\max} = \frac{100 - 0}{2} = 50.0$；
   - 设 $M$ 个活跃技术栈得分为 $S_i \in [0, 100]$、对数规模权重 $w_i = \ln(\text{LOC}_i + 10)$，加权均值 $\mu = \frac{\sum w_i S_i}{\sum w_i}$，加权标准差 $\sigma = \sqrt{\frac{\sum w_i (S_i - \mu)^2}{\sum w_i}}$；
   - 归一化离散度 $\tilde{\sigma} = \frac{\sigma}{\sigma_{\max}}$，最大惩罚弹性 $\gamma = 0.5$（确保极端极化下仍保留 50% 资产存量底色）：
     $$D = \max\left(0.0,\; 1.0 - \tilde{\sigma} \cdot \gamma\right) = \max\left(0.0,\; 1.0 - \frac{\sigma}{100}\right), \quad S_{\text{balanced}} = \mu \times D$$

---

## 三、 Michaelis-Menten 双曲饱和衰减与加权几何平均非补偿评级

1. **Michaelis-Menten / Hill 双曲有理饱和衰减**：
   - 缺陷密度扣分采用双曲有理形式：$S = 100 \times \frac{H}{H + \text{density}}$（$H = 30$ 为半饱和常数）；
   - 数学特性：处处严格下凸（$\frac{d^2S}{dD^2} > 0$）且全域单调递减（$\frac{dS}{dD} < 0$），在无穷远处严格保持偏序梯度，彻底消除传统 Sigmoid 饱和触底为 0 导致多劣质文件不可区分的弊端。
2. **加权几何平均非补偿评级模型 (MCDA)**：
   - 综合分采用加权几何平均：$S_{\text{composite}} = \exp\left(\frac{\sum w_i \ln(\max(15, S_i))}{\sum w_i}\right)$；
   - 避免传统算术平均下“9 个 100 分掩盖 1 个 0 分塌陷轴（均分 90 仍得 A）”的虚假健康，对单项短板产生非线性拖拽。
3. **SQALE 技术债务比率 (TDR, ISO/IEC 25010)**：
   - 与 SonarQube 同构，基于 $30\text{ min/ELOC}$ 研发成本基线，标准等级切分：$\le 5\%$ (A), $\le 10\%$ (B), $\le 20\%$ (C), $\le 50\%$ (D), $> 50\%$ (E)。

---

## 四、 反刷分熔断防御机制 (`BLOCK_GAMING_DETECTED`)

当自动化重构或提交同时满足以下两项条件时，立即判定为虚假刷分并冻结评分收益：
1. **语义代码改动比例极低**：$\text{Ratio}_{\text{semantic}} = \frac{\text{ELOC}_{\text{changed}}}{\text{ELOC}_{\text{total}}} \le 15\%$；
2. **真实技术债务净消除非正**：$\Delta_{\text{Debt}} \le 0$（未消除任何规则违规、循环堆分配或复杂度超标）。

---

## 五、 演化轨迹账本精度与真实技术债消减公理 (Trajectory Ledger & Defect Tracking)

长期演化账本必须客观反映代码质量的微观渐进收益，严禁经验合成与截断失真：

| 治理指标 | 刚性设计标准 | 核心算法与防范目标 |
| :--- | :--- | :--- |
| **小数密度精度与 $k\text{Mean}$** | 六位小数 + 千行密度投影 | 质量演化密度 $\text{QED} = \frac{\Delta Q}{\text{ELOC}}$ 以六位小数保留（`Math.round(x * 1000000) / 1000000`）；宏观展示引入 $k\text{Mean} = \text{mQED}/1\text{k ELOC}$，防止大仓微重构下溢归零。 |
| **双轨技术债务收益率** | `netYield` 与 `densityYield` 双轨分流 | 收益率严禁用跨轮次累加的 `processedTotal` 作分母（防止累加稀释失真）。`netYield` 以 $semanticTotal/1000$ 为分母（下限 $0.1$），$semanticTotal$ 为零时退到 $uniqueTotal/1000$；`densityYield` 以全仓去重底数 $uniqueTotal/1000$（下限 $1$）为基底。 |
| **缺陷指纹比对基线** | 独立签名账本优先，截断报告仅作降级 | 债务增删比对读 `.refactor-trajectory/baseline-signatures.json`：键为 `规则#文件`，值按行号匹配并附债务层级。该账本缺失或不可解析时才退回 AAS 报告的 `files` 段，而该段受 Token 预算截断（`truncated` 字段非零），因此不得将 AAS 载荷当作权威比对源。 |
| **真实增删与显式折算** | 取 Git numstat 真实增删，折算权重集中声明 | 增删行直接取 `git diff --numstat HEAD`，排除 `reports/`、`.refactor-trajectory/`、`dist/`、`node_modules/`；语义行数按文件类型权重加权求和，权重常量内联于折算函数内，新增语言时须同处登记。历史底数解析顺序为 $uniqueTotal \to processedTotal/totalRuns \to$ 内建常量，任一层命中即停，不得跳过前两层直接取固定值。 |
| **度量与执行真值双向闭合** | 派生值必等于运行时实报总数 | 任何对外公布的计数必须由可执行真源重算，且与运行时自报总数逐一相等（如测试套件数须等于 `ALL N/N TEST SUITES PASSED`）。解析源码的守卫若与运行时总数不符，先判定为守卫自身的文本解析缺陷（如只识别多行 `\n];` 终止符而漏掉单行 `}];`），严禁反过来删改文档迁就错误守卫。 |

---

## 六、 验证命令与关联资产

```powershell
node auto-refactor/scripts/validate-autonomy-scorer.js && node auto-refactor/scripts/validate-project-neutrality.js
node auto-refactor/scripts/validate-trajectory-accumulator.js && node auto-refactor/scripts/validate-compact-ledger.js
```

- [jeffreys-beta-credible-interval.md](references/jeffreys-beta-credible-interval.md)：Fisher 信息矩阵 Jeffreys 先验推导与 `BLOCK_GAMING_DETECTED` 反刷分攻击向量剖析；
- [bayesian-confidence-evaluator.ts](templates/bayesian-confidence-evaluator.ts)：贝叶斯置信区间计算与反刷分熔断评估器标准模板。
