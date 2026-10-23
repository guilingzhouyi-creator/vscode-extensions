---
name: telemetry-statistical-modeling
description: >-
  度量评估、经典贝叶斯统计建模与反刷分熔断规范。指导 Agent 在 auto-refactor 等分析系统中
  落实从 0 纯客观统计、Jeffreys Beta(0.5, 0.5) 共轭后验均值与方差置信区间估计、
  异构系统多语言均衡指数与离散度惩罚模型、基于 AST symbolIndex 的 CAI 符号追踪、以及 BLOCK_GAMING_DETECTED 虚假重构熔断。
---

# telemetry-statistical-modeling — 客观度量、贝叶斯统计建模与反刷分规范

本技能确立全工作区质量度量、代码自研率（CAI）分析与自治评分系统的数学根基，落实**从 0 纯客观统计**、**无信息 Jeffreys $\text{Beta}(0.5, 0.5)$ 共轭后验置信区间**、**异构多语言均衡指数**及**反刷分熔断防御（`BLOCK_GAMING_DETECTED`）**。

---

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

## 五、 验证命令与关联资产

```powershell
node auto-refactor/scripts/validate-autonomy-scorer.js && node auto-refactor/scripts/validate-project-neutrality.js
```

- [jeffreys-beta-credible-interval.md](references/jeffreys-beta-credible-interval.md)：Fisher 信息矩阵 Jeffreys 先验推导与 `BLOCK_GAMING_DETECTED` 反刷分攻击向量剖析；
- [bayesian-confidence-evaluator.ts](templates/bayesian-confidence-evaluator.ts)：贝叶斯置信区间计算与反刷分熔断评估器标准模板。
