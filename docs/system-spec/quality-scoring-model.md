# 十维工程质量量化评分模型与数学体系规范

> 本文档为 auto-refactor 静态分析引擎及全工作区统一质量审查中枢所采用的**十维工程质量量化评分体系（Ten-Dimensional Quality Scoring Architecture）**的权威数学规范与工程设计手册。

---

## 一、 十维质量空间定义与物理语义映射

全工作区将软件工程代码质量严格投影至 10 个正交维度，各维度均由底层专用静态分析器发射的确定性规则直接驱动，杜绝主观臆断：

| 维度英文标识 (Key) | 维度中文名称 | 物理语义与工程核心关注点 | 关联规则族与典型检测项 | 计分模式 |
| :--- | :--- | :--- | :--- | :--- |
| **`architectureConsistency`** | 架构一致 | 架构分层单向流动、严禁跨层循环依赖、门面实质承载（`ARCH-FAC-001`）与单行空包跳板清零（`ARCH-ABS-001`） | `ARCH-*`, `NAM-DEC-*`, `IMP-*` | 双曲密度衰减 |
| **`semanticPurity`** | 语义纯度 | 消除无执行逻辑假分支、死代码、幽灵注释与多余类型包装 | `HYG-DED-*`, `HYG-WRAP-*`, `DEAD-*` | 双曲密度衰减 |
| **`codeSecurity`** | 代码安全 | 拦截敏感密钥 Token、未授权端点暴露、客户端未发布资源下发、ReDoS 漏洞与权限旁路 | `SEC-*`, `SEC-EXP-*`, `SECRET-*` | **绝对无容忍扣分** |
| **`performanceEfficiency`** | 性能预算 | 严禁循环内瞬态堆分配（`CPX-SPACE-001`）、高算法复杂度线性遍历（`PRF-ALG-002`）、渲染重排与动效卡顿 | `PRF-*`, `ADV-PRF-*`, `UI-ENG-002` | 双曲密度衰减 |
| **`standardization`** | 标准化 | 命名规范（`NAM-*`）、驼峰/下划线词素切分、自解释长度包络、现代缩写合规与统一格式契约 | `NAM-*`, `HYG-NAM-*`, `UI-ENG-001` | 双曲密度衰减 |
| **`modernity`** | 现代化 | TypeScript/JavaScript/GDScript 现代语法演进（`TSM-*`）、过时 API 淘汰、严格类型推断 | `TSM-*`, `GOV-STD-*`, `MOD-*` | 双曲密度衰减 |
| **`maintainability`** | 可维护性 | 控制流圈复杂度（$\text{CC} \le 15$）、嵌套深度（$\text{Depth} \le 4$）、单行噪声比（$\text{Noise} \le 4.0$）与单文件双轨体积（$\text{ELOC} \le 900, \text{LOC} \le 1400$） | `large-file`, `CPX-BUD-*`, `PROD-HYG-*` | 双曲密度衰减 |
| **`commentQuality`** | 注释质量 | 六字段 JSDoc 模块头部契约、算法退化边界显式声明、有效注释密度模型（$\text{ECR} \ge 0.75$）、零敏捷代号与零黑话 | `CMT-*`, `DOC-*` | 双曲密度衰减 |
| **`duplication`** | 重复率 | 魔法数字抽取、硬编码字符串解耦、常量库拓扑归一（`CONST-*`）、大常量库良性模式识别 | `CONST-*`, `duplicate-literal`, `HYG-CLN-*` | 双曲密度衰减 |
| **`techDebtRisk`** | 技术债风险 | 系统性演进风险、Tier 1 关键阻断债务穿透、未决重构热点扩散倾向 | `DEBT-*`, Tier 1/2 债务穿透 | 双曲密度衰减 |

---

## 二、 维度计分数学模型与衰减曲线

### 1. 绝对模式（Absolute Defect Count Mode）
对于 `codeSecurity` 维度，系统采用绝对扣分模型：
$$s_{\text{sec}} = \max\left(0, 100 - P_{\text{raw}}\right)$$
- **数学设计依据**：安全缺陷属于非容忍类别。无论文件是 20 行还是 1000 行，一个硬编码的私钥、未授权公开的 API 端点或 ReDoS 正则，其风险严重度完全相同，**绝不允许随代码体积增大而被稀释**。

### 2. 双曲密度衰减模型（Hyperbolic Density Decay Mode）
对其余 9 个非绝对维度，系统采用规模标准化的双曲密度衰减算法：

$$\text{effectiveScale} = \max(1, \text{scaleFactor}) = \max\left(1, \frac{\text{LOC}}{100}\right)$$

$$\text{density} = \frac{P_{\text{raw}}}{\text{effectiveScale}}$$

$$s_i = \max\left(0, \min\left(100, \frac{100 \times H}{H + \text{density}}\right)\right)$$

其中，$H = \text{SATURATION\_HALFPOINT} = 30$ 为**饱和半衰点**。

#### 数学优越性分析（为何摒弃传统指数硬截断）：
- **传统公式缺陷**：早期的负指数截断公式 $P_{\text{eff}} = \min(P_{\text{raw}}, 100 \times (1 - e^{-\text{density}/40}))$，其 $\min$ 操作会在 $\text{density} \ge 240$ 时将惩罚强行锁死在 100 分（得分坍缩至 0），导致一个累计 1000 扣分的文件与累计 20000 扣分的极端违规文件在评分上完全无法区分；
- **双曲渐近曲线优势**：
  1. **严格保序性（Strict Monotonicity）**：双曲函数 $\frac{100 \times H}{H + \text{density}}$ 在 $\text{density} \in [0, +\infty)$ 上严格单调递减，渐近于 0 但绝不提前截断，使极端代码坏味道始终保持严格的偏序关系；
  2. **消除阶梯断崖（Smooth Damping）**：平滑反映微小重构带来的质量收益，哪怕在重度违规代码中消除几处缺陷，分数也会平滑上升，为渐进式重构提供可观测的激励反馈。

---

## 三、 全局综合质量指数：加权几何平均模型

系统综合健康分（Composite Quality Index）采用**加权几何平均数（Weighted Geometric Mean）**，而非传统的算术平均数：

$$\text{Composite} = \exp\left( \frac{\sum_{i \in \mathcal{E}} w_i \cdot \ln(\max(\text{Floor}, s_i))}{\sum_{i \in \mathcal{E}} w_i} \right)$$

其中：
- $\mathcal{E}$ 为本次扫描激活的有效维度集合；
- $w_i \ge 0$ 为各维度的静态风险权重；
- $\text{Floor} = \text{COMPOSITE\_INDEX\_FLOOR} = 15$ 为单轴保护底线。

### 为什么选择加权几何平均（木桶短板敏感公理）？
- **算术平均的致命缺陷**：算术平均值 $\frac{1}{N}\sum s_i$ 允许单维度的崩溃被其他维度的虚高彻底掩盖。例如：9 个维度满分 100 分，而 1 个维度（如安全或架构）发生系统性崩溃降为 0 分，算术平均值仍然高达：
  $$\frac{9 \times 100 + 0}{10} = 90.0 \text{ 分 (依然评定为 A+)}$$
  这会在工程实践中造成极其危险的“虚假繁荣”，掩盖关键致命缺陷；
- **几何平均的短板惩罚**：几何平均值对极端小值天然具备对数级惩罚能力。同样的短板案例在加权几何平均下（受 $\text{Floor}=15$ 钳制）：
  $$\text{Composite} = \exp\left( \frac{9 \times \ln(100) + 1 \times \ln(15)}{10} \right) \approx 82.7 \text{ 分 (总分直接被强力拉跌)}$$
  从而确保团队无法通过刷高某些容易维度的分数来掩盖架构和安全上的核心技术债。

---

## 四、 真实技术债穿透模型 (Tech-Debt Penetration)

为了彻底根除系统由于路由断流导致的 `techDebtRisk` 维度恒得 100.0 分的“假满分”现象，系统建立了**分级技术债务穿透机制**：

```
[底层分析器发射违规 Issues]
         │
         ├── Tier 1: 关键阻断性债务 (Critical Debt) ────> 100% 穿透惩罚 ──┐
         │                                                              │
         ├── Tier 2: 渐进演进性债务 (Evolutionary Debt) ──> 50% 阻尼穿透 ───┼──> dimensionPenalties['techDebtRisk']
         │                                                              │
         └── 维度直接关联规则 (Direct Debt Rules) ────────> 100% 直接计入 ──┘
```

1. **Tier 1 关键阻断性债务**：包括未捕获的高危安全漏洞、严重的门面跳板违规与致命循环依赖，以 100% 的风险权重穿透至 `techDebtRisk`；
2. **Tier 2 渐进演进性债务**：包括超标圈复杂度、大型文件体积膨胀等，以 50% 阻尼系数穿透计入；
3. **真实响应效果**：全仓 0 项 Critical 债务与 211 项 High 债务时，`techDebtRisk` 客观响应为 **99.8 分**，打破虚假满分，与现实代码健康度保持客观联动。

---

## 五、 统计学置信度与 Jeffreys Beta 后验模型

评分系统不采用主观写死的固定误差，而是基于主流经典统计学进行置信度区间估计：

### 1. 证据体量增长曲线
$$\text{BaseConfidence} = \text{clamp}\left( 0.6, 1.0, 0.6 + \frac{\text{Volume}}{\text{Scale}} \right)$$
$$\text{Confidence} = \max\left(0.6, \text{BaseConfidence} \times \text{Coverage}\right)$$
- 文件级别：$\text{Scale} = 750$，$\text{Volume} = \min(\text{LOC}, 300)$；
- 工程级别：$\text{Scale} = 15000$，考虑全仓样本统计规模，杜绝小型文件以过高置信度误导决策。

### 2. Jeffreys 先验共轭后验概率
在评估违规率与自主度（CAI）区间时，引入**无信息 Jeffreys 先验** $\text{Beta}(0.5, 0.5)$：
- 设样本试验次数为 $n$，正例数为 $k$；
- 后验分布为：
  $$\theta \sim \text{Beta}\left(k + 0.5, n - k + 0.5\right)$$
- 后验均值：
  $$\mathbb{E}[\theta] = \frac{k + 0.5}{n + 1}$$
- 后验方差：
  $$\text{Var}(\theta) = \frac{(k + 0.5)(n - k + 0.5)}{(n + 1)^2 (n + 2)}$$
彻底杜绝人为设定“$\pm 3\%$”等臆造的常数误差区间。

---

## 六、 防刷分与防注水公理 (Anti-Gaming Protocol)

为了防范开发者或智能体通过“机械拆分代码”、“无意义填充注释”或“复制空逻辑”来人为刷高评分，系统设置了刚性 Anti-Gaming 熔断机制：

1. **客观统计零注水**：所有指标必须从 0 开始纯客观累加，严禁保底伪造；
2. **语义改动比重门槛（Semantic ELOC Ratio）**：重构提交中若语义有效代码行 $\text{ELOC}_{\text{semantic}} \le 15\%$，且未产生真实技术债净消除，系统判定为无效注水，强制触发 `BLOCK_GAMING_DETECTED` 熔断；
3. **1:3 动态包络密度守卫**：有效代码与物理行必须符合 1:3 动态包络，严禁通过注入冗余机械空行来稀释圈复杂度。
