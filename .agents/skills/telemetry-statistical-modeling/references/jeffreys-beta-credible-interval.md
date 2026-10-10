# 经典无信息 Jeffreys Beta 共轭后验统计建模数学指南

本指南详细推导度量评估系统中的贝叶斯共轭后验数学模型，杜绝人工写死主观常数误差，建立主流统计学置信区间与方差估计标准。

---

## 一、 背景与主观伪造痛点

在很多静态代码分析或自主度量系统（如 CAI 自研率、自治评分器）中，常存在以下统计学劣质实践：
- **固定常数误差注水**：直接写死置信区间为 `score ± 5.0%` 或 `confidence = 0.95`；
- **小样本严重失真**：当仅分析了 2~3 个符号时，样本量过小却给出极高的置信度；
- **非概率性截断**：未对概率边界 $[0, 1]$ 进行测度论保护，导致区间越界。

为了确保度量评估在主流学术界与工业界均具备无可辩驳的数学纯洁性，必须采用**经典无信息 Jeffreys 先验共轭贝叶斯模型**。

---

## 二、 数学推导与公式体系

### 1. 无信息 Jeffreys 先验分布
对于二项分布样本模型（成功数 $s$，失败数 $f$，样本总量 $n = s + f$），Fisher 信息矩阵决定的无信息尺度不变量先验为 Jeffreys 先验：
$$p(\theta) \propto \sqrt{I(\theta)} \propto \theta^{-1/2} (1 - \theta)^{-1/2} = \text{Beta}(0.5, 0.5)$$

Jeffreys 先验具备重参数化不变性（Reparameterization Invariance），在无任何主观偏见的前提下赋予参数空间最客观的中立权值。

### 2. 共轭后验更新
根据贝叶斯定理，当似然函数为二项分布 $\text{Binomial}(n, \theta)$ 时，Beta 先验与二项似然构成天然共轭：
$$p(\theta \mid s, f) \propto \theta^s (1 - \theta)^f \cdot \theta^{0.5 - 1} (1 - \theta)^{0.5 - 1} = \theta^{(s + 0.5) - 1} (1 - \theta)^{(f + 0.5) - 1}$$
后验分布严格服从：
$$\theta \mid s, f \sim \text{Beta}(\alpha^*, \beta^*) = \text{Beta}(s + 0.5, f + 0.5)$$

### 3. 后验均值与后验方差
- **后验均值（点估计）**：
  $$\mu = \mathbb{E}[\theta] = \frac{\alpha^*}{\alpha^* + \beta^*} = \frac{s + 0.5}{n + 1}$$
- **后验方差（不确定性度量）**：
  $$\sigma^2 = \text{Var}(\theta) = \frac{\alpha^* \beta^*}{(\alpha^* + \beta^*)^2 (\alpha^* + \beta^* + 1)} = \frac{(s + 0.5)(f + 0.5)}{(n + 1)^2 (n + 2)}$$
- **后验标准差**：
  $$\sigma = \sqrt{\sigma^2}$$

### 4. 95% 置信区间 (Credible Interval)
利用标准正态近似或 Beta 分布分位数函数构建双侧 95% 置信区间（$z_{0.975} \approx 1.95996$）：
$$\text{Lower} = \max\left(0.0, \mu - z \cdot \sigma\right)$$
$$\text{Upper} = \min\left(1.0, \mu + z \cdot \sigma\right)$$

当样本极小（如 $n < 5$）时，后验标准差 $\sigma$ 天然较大，区间变宽，真实客观反映高不确定性；随着样本量 $n$ 增加，$\sigma \to 0$，置信区间迅速收敛。

---

## 三、 零注水公理与 AST 符号追踪

1. **零加权倍率**：自研代码比例度量中，自研符号与外部依赖符号的权值从 0 纯客观统计，严禁乘 1.2 或 1.5 倍虚假放大；
2. **符号索引真实溯源 (`symbolIndex`)**：外部依赖调用数必须基于真实的 TypeScript/JavaScript 抽象语法树符号索引节点逐项检索，严禁基于粗暴正则行匹配计数。

