# 无信息 Jeffreys Beta 共轭后验推导与反刷分熔断 (`BLOCK_GAMING_DETECTED`) 深度指南

> 本指南整合了无信息 Jeffreys 先验共轭贝叶斯置信区间推导与自治评分反刷分熔断机制。

---

## 一、 无信息 Jeffreys 先验 $\text{Beta}(0.5, 0.5)$ 数学推导

1. **重参数化不变性先验**：
   对二项分布似然 $\text{Binomial}(n, \theta)$，由 Fisher 信息矩阵 $I(\theta) = \frac{n}{\theta(1-\theta)}$ 导出的无信息先验为：
   $$p(\theta) \propto \sqrt{I(\theta)} \propto \theta^{-1/2}(1 - \theta)^{-1/2} = \text{Beta}(0.5, 0.5)$$
2. **共轭后验更新与区间估计**：
   观测到 $s$ 次成功与 $f$ 次失败（$n = s + f$）后，后验分布服从 $\text{Beta}(\alpha^*, \beta^*) = \text{Beta}(s + 0.5, f + 0.5)$：
   $$\mu = \frac{s + 0.5}{n + 1}, \quad \sigma = \sqrt{\frac{(s + 0.5)(f + 0.5)}{(n + 1)^2(n + 2)}}, \quad \text{CI}_{95\%} = [\max(0, \mu - 1.95996\sigma),\; \min(1, \mu + 1.95996\sigma)]$$
   当小样本 $n < 5$ 时，$\sigma$ 自然较大，如实暴露高不确定性；严禁人工写死 `± 5%` 常数误差或注入 `1.2x` 权重放大。

---

## 二、 三类刷分攻击向量与 `BLOCK_GAMING_DETECTED` 熔断判据

1. **三类典型刷分反模式**：
   - **纯格式与空白搬移 (Trivial Churn)**：批量调换等价参数或空行刷高改动文件数；
   - **微改动冒充架构重构**：仅改 1~2 个局部变量名却申报模块级重构；
   - **删减契约注释压减 LOC (`CMT-VMD-001`)**：为压低物理行数粗暴删除六字段 JSDoc 或状态机不变式注释。
2. **刚性熔断公式**：
   ```typescript
   if (semanticRatio <= 0.15 && netDebtEliminated <= 0) {
     return { status: 'FROZEN', code: 'BLOCK_GAMING_DETECTED' };
   }
   ```
   凡语义有效行改动占比 $\le 15\%$ 且未产生真实技术债净消除（$\Delta_{\text{Debt}} \le 0$），一律冻结评分并阻断。

---

## 三、 Popoviciu 方差界与非线性双曲饱和衰减推导

1. **Popoviciu 方差不等式证明 (Popoviciu, 1935)**：
   设随机变量 $X$ 概率测度支撑集为闭区间 $[a, b]$。对任意实数 $c$，均有 $\text{Var}(X) \le E[(X - c)^2]$。
   令 $c = \frac{a + b}{2}$，则对任意 $x \in [a, b]$，有 $|x - c| \le \frac{b - a}{2}$，从而：
   $$\text{Var}(X) \le E\left[\left(X - \frac{a+b}{2}\right)^2\right] \le \frac{(b - a)^2}{4}$$
   等号成立当且仅当 $P(X = a) = P(X = b) = \frac{1}{2}$（极端两极分化对半分布）。
   在评分测度空间 $[0, 100]$ 中：
   $$\sigma_{\max} = \frac{100 - 0}{2} = 50.0$$
   因此，离散度惩罚因子 $D = 1.0 - \left(\frac{\sigma_S}{\sigma_{\max}}\right) \times \gamma$（当 $\gamma = 0.5$ 时，$D = 1.0 - \frac{\sigma_S}{100}$）确保在理论最严重崩溃极值下，折减系数恰好下探至 0.5，既能严厉惩罚偏科，又客观捍卫剩余 50% 资产存量底线。

2. **Michaelis-Menten / Hill 饱和衰减与一阶/二阶导数证明**：
   $$S(D) = \frac{100 H}{H + D}, \quad H = 30, \; D \ge 0$$
   - 一阶导数：$\frac{dS}{dD} = -\frac{100 H}{(H + D)^2} < 0$，在 $[0, \infty)$ 严格单调递减，保证在任意超大缺陷密度下偏序严格单调不变（严禁 Sigmoid 触底截断为 0 造成梯度消失）；
   - 二阶导数：$\frac{d^2S}{dD^2} = \frac{200 H}{(H + D)^3} > 0$，处处严格下凸，体现边际扣分递减与容错韧性。
