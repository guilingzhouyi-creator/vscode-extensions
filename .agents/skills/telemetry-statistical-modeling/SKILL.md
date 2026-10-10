---
name: telemetry-statistical-modeling
description: >-
  度量评估、经典贝叶斯统计建模与反刷分熔断规范。指导 Agent 在 auto-refactor 等分析系统中
  落实从 0 纯客观统计、Jeffreys Beta(0.5, 0.5) 共轭后验均值与方差置信区间估计、
  基于 AST symbolIndex 的 CAI 符号追踪、以及 BLOCK_GAMING_DETECTED 虚假重构熔断。
---

# telemetry-statistical-modeling — 度量评估、贝叶斯统计建模与反刷分工作流

本技能确立了全工作区质量度量、自研率（CAI）分析与自主自治评分系统的数学理论根基，坚决落实**客观度量零注水**、**主流无信息 Jeffreys Beta 共轭后验区间建模**以及**反刷分熔断防御**。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **开发或重构度量评估模型**：涉及质量评分器、自治评分器（Autonomy Scorer）或代码自研率（CAI）算法；
2. **计算度量置信区间与方差估计**：对小样本或全量样本进行统计区间估计，严禁硬编码常数误差；
3. **符号依赖调用分析**：追踪外部依赖与自研核心之间的符号调用关系图；
4. **排查反刷分熔断阻断**：系统触发 `BLOCK_GAMING_DETECTED` 熔断或评分被强制冻结。

---

## 二、 客观统计零注水与符号溯源公理

所有质量评分与代码指标统计必须遵循求真公理：

| 治理支柱 | 刚性约束指标 | 架构职责与防范目标 |
| :--- | :--- | :--- |
| **基数从零纯客观** | 零倍率放大 / 零虚假加分 | 符号与质量得分从 0 起算，严禁人为注入基数放大或保底伪造 |
| **真实 AST 符号追踪** | 基于 `symbolIndex` 真实索引 | 外部依赖调用必须基于 AST 真实符号索引精确追踪，严禁正则盲扫 |
| **小样本真实不确定性** | 严禁写死固定误差常数 | 样本不足时如实输出大置信区间，样本充沛时收敛，严禁固定 $\pm 5\%$ |
| **概率测度封闭性** | 严格钳制于 $[0.0, 1.0]$ | 评分与置信区间必须受测度空间截断保护，杜绝出现负值或超上限值 |

---

## 三、 主流统计学 Jeffreys Beta(0.5, 0.5) 共轭后验数学公理

对于二项分布样本（$s$ 次成功、$f$ 次失败，样本总量 $n = s + f$），采用经典无信息 Jeffreys 先验共轭后验建模：

### 1. 先验与后验分布
- **无信息 Jeffreys 先验**：$\text{Beta}(0.5, 0.5)$；
- **共轭后验更新**：$\theta \mid s, f \sim \text{Beta}(s + 0.5, f + 0.5)$。

### 2. 均值、方差与 95% 置信区间
- **后验均值**：
  $$\mu = \frac{s + 0.5}{n + 1}$$
- **后验方差**：
  $$\sigma^2 = \frac{(s + 0.5)(f + 0.5)}{(n + 1)^2 (n + 2)}$$
- **双侧 95% 置信区间**（$z \approx 1.95996$）：
  $$\text{Interval} = \left[\max(0.0, \mu - z\sigma), \; \min(1.0, \mu + z\sigma)\right]$$

---

## 四、 反刷分熔断防御机制 (`BLOCK_GAMING_DETECTED`)

为防范在自动化重构中通过轻微编辑虚增活跃度或骗取自治评分，系统设置反刷分熔断防线：

### 1. 触发判定条件
当且仅当同时满足以下两项条件时，系统强制判定为虚假刷分并触发熔断：
1. **语义代码改动比例极低**：
   $$\text{Ratio}_{semantic} = \frac{\text{ELOC}_{changed}}{\text{ELOC}_{total}} \le 15\%$$
2. **净技术债务消除为零或为负**：
   $$\Delta_{\text{Debt}} \le 0$$

### 2. 处置动作
- 立即冻结本次改动的评分收益；
- 抛出 `BLOCK_GAMING_DETECTED` 告警；
- 要求必须消除实质性代码异味或优化控制流圈复杂度后方可计分。

---

## 五、 本地验证指令与断言标准

在提交度量评估相关代码前，执行本地验证：

```powershell
# 1. 验证自治评分器与数学模型测试
node auto-refactor/scripts/validate-autonomy-scorer.js

# 2. 验证项目中立性与无注水公理
node auto-refactor/scripts/validate-project-neutrality.js
```

**质性断言标准**：
- 控制台输出 `✔ [PASS] Autonomy scorer validation passed`；
- 置信区间严格通过 Beta 共轭后验数学公式计算生成；
- 反刷分熔断机制正常运行，对 $\text{ELOC}_{semantic} \le 15\%$ 的无净债务微改动精准拦截；
- 全工作区 High/Critical 技术债务保持 0 项历史归零基线，严禁引入债务反弹。

---

## 六、 关联模板与参考指引

- [jeffreys-beta-credible-interval.md](references/jeffreys-beta-credible-interval.md)：无信息 Jeffreys 先验共轭后验详细数学推导指南；
- [anti-gaming-detection-mechanics.md](references/anti-gaming-detection-mechanics.md)：反刷分熔断判定机制与作弊特征指南；
- [bayesian-confidence-evaluator.ts](templates/bayesian-confidence-evaluator.ts)：开箱即用的贝叶斯置信度计算与反刷分判定模板。

