# 十维工程质量量化评分模型与数学体系规范

> 本文档为 auto-refactor 静态分析引擎及全工作区统一质量审查中枢所采用的**十维工程质量量化评分体系（Ten-Dimensional Quality Scoring Architecture）**的权威数学规范与工程设计手册。

---

## 一、 十维质量空间定义与物理语义映射

全工作区将软件工程代码质量严格投影至 10 个正交维度，各维度均由底层专用静态分析器发射的确定性规则直接驱动，杜绝主观臆断：

| 维度英文标识 (Key) | 维度中文名称 | 物理语义与工程核心关注点 | 关联规则族与典型检测项 | 计分模式 |
| :--- | :--- | :--- | :--- | :--- |
| **`architectureConsistency`** | 架构一致 | 架构分层单向流动、严禁跨层循环依赖、门面实质承载（`ARCH-FAC-001`）与单行空包跳板清零（`ARCH-ABS-001`） | `ARCH-*`, `NAM-DEC-*`, `IMP-*` | 双曲密度衰减 |
| **`semanticPurity`** | 语义纯度 | 消除无执行逻辑假分支、死代码、幽灵注释与多余类型包装 | `HYG-DED-*`, `HYG-WRAP-*`, `DEAD-*` | 双曲密度衰减 |
| **`codeSecurity`** | 代码安全 | 拦截敏感密钥 Token、未授权端点暴露、客户端未发布资源下发、ReDoS 漏洞与权限旁路 | `SEC-*`, `SEC-EXP-*`, `SECRET-*` | **双轨绝对扣分与理论上限走廊** |
| **`performanceEfficiency`** | 性能预算 | 严禁循环内瞬态堆分配（`CPX-SPACE-001`）、高算法复杂度线性遍历（`PRF-ALG-002`）、渲染重排与动效卡顿 | `PRF-*`, `ADV-PRF-*`, `UI-ENG-002` | 双曲密度衰减 |
| **`standardization`** | 标准化 | 命名规范（`NAM-*`）、驼峰/下划线词素切分、自解释长度包络、现代缩写合规与统一格式契约 | `NAM-*`, `HYG-NAM-*`, `UI-ENG-001` | 双曲密度衰减 |
| **`modernity`** | 现代化 | TypeScript/JavaScript/GDScript 现代语法演进（`TSM-*`）、过时 API 淘汰、严格类型推断 | `TSM-*`, `GOV-STD-*`, `MOD-*` | 双曲密度衰减 |
| **`maintainability`** | 可维护性 | 控制流圈复杂度（$\text{CC} \le 15$）、嵌套深度（$\text{Depth} \le 4$）、单行噪声比（$\text{Noise} \le 4.0$）与单文件双轨体积（$\text{ELOC} \le 900, \text{LOC} \le 1400$） | `large-file`, `CPX-BUD-*`, `PROD-HYG-*` | 双曲密度衰减 |
| **`commentQuality`** | 注释质量 | 六字段 JSDoc 模块头部契约、算法退化边界显式声明、有效注释密度模型（$\text{ECR} \ge 0.75$）、零敏捷代号与零黑话 | `CMT-*`, `DOC-*` | 双曲密度衰减 |
| **`duplication`** | 重复率 | 魔法数字抽取、硬编码字符串解耦、常量库拓扑归一（`CONST-*`）、大常量库良性模式识别 | `CONST-*`, `duplicate-literal`, `HYG-CLN-*` | 双曲密度衰减 |
| **`techDebtRisk`** | 技术债风险 | 系统性演进风险、Tier 1 关键阻断债务穿透、未决重构热点扩散倾向 | `DEBT-*`, Tier 1/2 债务穿透 | 双曲密度衰减 |

---

## 二、 维度计分数学模型与衰减曲线

### 1. 代码安全双轨理论上限模型（Dual-Track Bounded Subtractive Model）

对于 `codeSecurity` 维度，系统摒弃单一维度的静态绝对满分假设，采用**理论安全上限双轨扣分模型（Dual-Track Bounded Subtractive Model）**：

#### (1) 为什么单纯 100.0 满分在莱斯定理、零信任哲学与真实软件工程中存在理论假象

1. **莱斯定理（Rice's Theorem）不可判定性界限**：
   莱斯定理严格证明：对于任何图灵完备语言的程序，所有非平凡的语义属性（包括“程序是否存在未发现漏洞”、“是否在所有输入下均绝对安全”）在算法上都是**不可判定（Undecidable）**的。静态代码分析引擎所发射的规则集合（如密钥扫描、正则回溯检测、AST 数据流追踪），本质上只是在可判定语法与近似语义子集上建立的**充分性启发式检测（Syntactic & Heuristic Approximation）**。标称绝对 100.0 满分在数理逻辑上混淆了“未触发已知规则违规”与“绝对数学安全性”，给工程团队与智能体注入了“代码绝对无漏洞”的认知虚假繁荣。
2. **零信任（Zero Trust: Never Trust, Always Verify）安全公理**：
   在现代纵深防御体系中，“无告警并不等价于无脆弱性”（*Absence of evidence is not evidence of absence*）。软件代码只要存在外部交互入口、接收外部数据或导出公开方法，就天然承载非零的攻击面与脆弱性熵。零信任哲学要求系统坚持“假设已被突破（Assume Breach）”与“暴露即风险”的底层假设。任何代码单元的理论安全置信度都不能无视其攻击面暴露程度而被无条件赋为绝对极限 100.0 分。
3. **真实软件工程中的攻击面扩散差异**：
   在真实微服务或插件系统中，一个仅含 10 行内部纯数学运算的封闭函数，与一个对外暴露 50 个公共 API 端点且执行复杂 Payload 反序列化的网关门面，两者在潜在攻击面（Attack Surface）上存在数量级的结构差异。若只要未检出硬编码密钥就统统赋予 100.0 满分，评分模型就彻底丧失了对架构攻击面膨胀（Attack Surface Expansion）的敏感度与度量牵引力。

---

#### (2) 理论安全上限双轨模型数学定义

系统将代码安全评分正交解耦为两条互补轨（Dual Tracks）：

- **轨 A：硬缺陷绝对扣分轨（Hard Defect Subtractive Track）**
  针对已由底层规则精确捕获的高危安全缺陷（如硬编码密钥、敏感 Token 泄露、SQL/命令注入漏洞、ReDoS 回溯灾难），执行**绝对零容忍惩罚**：
  $$P_{\text{raw}} = \sum_{j} p_j$$
  该惩罚项独立于代码规模，**绝不允许随代码体积增大而被稀释**（1 处致命密钥泄露无论位于 20 行脚本还是 2000 行大型门面中，危险等级均完全相同）。

- **轨 B：理论安全上限走廊与攻击面暴露衰减轨（Theoretical Upper-Bound & Attack Surface Attenuation Track）**
  当代码中显式缺陷扣分为 0 时（$P_{\text{raw}} = 0$），该维度的得分并非无条件锁定为 100.0，而是由**攻击面暴露函数** $\Delta_{\text{exposure}}$ 调制的动态高信任上限走廊：
  $$S_{\text{upper}} = S_{\max} - \Delta_{\text{exposure}} \in [99.0, 100.0]$$
  其中 $S_{\max} = 100.0$，最大理论衰减幅度严格约束为 $\delta_{\max} = 1.0$，确保无已知漏洞的代码必定稳固处于 $[99.0, 100.0]$ 的 A+ 质量安全走廊。

- **统一双轨合成方程（Unified Synthesis Formula）**：
  综合得分函数由两轨联合确定：
  $$s_{\text{sec}} = \max\left(0, \left(100.0 - \Delta_{\text{exposure}}\right) - P_{\text{raw}}\right)$$
  当存在显式硬缺陷时（$P_{\text{raw}} > 0$），硬缺陷扣分迅速占据绝对主导地位，直接对安全总分实施穿透式压制；当 $P_{\text{raw}} = 0$ 时，模型平滑退化为理论上限走廊。

---

#### (3) 攻击面暴露函数与导出符号/规模因子的定量衰减推导

攻击面暴露度由代码导出符号密度与有效代码体量共同决定：

1. **导出符号暴露比率（Exported Symbol Ratio）**：
   设模块对外部公开暴露的符号集合（导出函数、类、接口、公共端点）数量为 $N_{\text{exp}}$，模块内部总符号声明数量为 $N_{\text{sym}}$：
   $$r_{\text{exp}} = \frac{N_{\text{exp}}}{\max(1, N_{\text{sym}})} \in [0, 1]$$

2. **有效代码规模对数暴露因子（Scale Log-Exposure Factor）**：
   代码逻辑越庞大，控制流分歧与潜在隐蔽攻击面越大。引入标准化对数尺度（基准 100 ELOC）：
   $$\sigma_{\text{scale}} = \ln\left(1 + \frac{\text{ELOC}}{100}\right)$$
   将其归一化至 $[0, 1)$ 区间：
   $$\hat{\sigma} = \frac{\sigma_{\text{scale}}}{1 + \sigma_{\text{scale}}}$$

3. **综合暴露密度指标（Exposure Density Metric, $\rho_{\text{exp}}$）**：
   以凸组合（Convex Combination）融合符号暴露与体量暴露：
   $$\rho_{\text{exp}} = \alpha \cdot r_{\text{exp}} + \beta \cdot \hat{\sigma}, \quad \alpha = 0.6, \; \beta = 0.4, \; \alpha + \beta = 1.0$$
   因此 $\rho_{\text{exp}} \in [0, 1]$。

4. **双曲正切有界阻尼衰减函数（Corridor Damping Function）**：
   为消除阶梯硬截断并保证平滑渐近，采用双曲正切函数 $\tanh$ 进行映射：
   $$\Delta_{\text{exposure}} = \delta_{\max} \cdot \tanh(\kappa \cdot \rho_{\text{exp}})$$
   其中 $\delta_{\max} = 1.0$，$\kappa = 1.5$ 为曲率敏感度常数。

5. **渐近物理边界证明**：
   - **完全私有微小单元极限（Zero Exposure Limit）**：
     若代码为纯内部辅助函数，无导出符号且行数极简（$N_{\text{exp}} = 0, \text{ELOC} \to 0$）：
     $$\rho_{\text{exp}} \to 0 \implies \tanh(0) = 0 \implies \Delta_{\text{exposure}} = 0.0 \implies s_{\text{sec}} = 100.0$$
   - **大型开放网关极限（Asymptotic Expansion Limit）**：
     若代码为高体量外部公开网关（$r_{\text{exp}} \to 1.0, \text{ELOC} \gg 1000$）：
     $$\rho_{\text{exp}} \to 1.0 \implies \Delta_{\text{exposure}} \to 1.0 \times \tanh(1.5) \approx 0.905 \implies s_{\text{sec}} \approx 99.1 \in [99.0, 100.0]$$
     即使在极端数学上限 $\rho_{\text{exp}} \to \infty$ 下：
     $$\lim_{\rho_{\text{exp}} \to \infty} \tanh(\kappa \rho_{\text{exp}}) = 1.0 \implies \Delta_{\text{exposure}} \le 1.0 \implies s_{\text{sec}} \ge 99.0$$
   因此，无已知缺陷代码的理论安全得分被严格锚定在 **$[99.0, 100.0]$** 的高信任走廊内。

---

#### (4) 极端情况下的单调保序性、硬上下限有界性 [0, 100] 与加权几何平均数完全兼容性证明

##### 定理 1：严格单调保序性（Monotonicity Preservation）
**命题**：对于任意代码状态向量 $(\rho_{\text{exp}}, P_{\text{raw}})$，任何消除安全缺陷（$\Delta P_{\text{raw}} \le 0$）或收敛攻击面暴露（$\Delta \rho_{\text{exp}} \le 0$）的重构操作，均保证安全得分严格单调非递减：$\Delta s_{\text{sec}} \ge 0$。
- **偏导证明**：在 $s_{\text{sec}} > 0$ 的非零有效域内：
  $$\frac{\partial s_{\text{sec}}}{\partial P_{\text{raw}}} = -1 < 0$$
  $$\frac{\partial s_{\text{sec}}}{\partial \rho_{\text{exp}}} = -\delta_{\max} \cdot \kappa \cdot \text{sech}^2(\kappa \rho_{\text{exp}}) < 0 \quad (\text{因 } \text{sech}(x) > 0, \forall x \in \mathbb{R})$$
  因各一阶偏导数在定义域内恒负，逆向重构增益向量沿梯度正向运动，故 $s_{\text{sec}}$ 关于负向缺陷与负向暴露严格单调增，不存在任何使代码优化后得分反向下降的病态震荡。

##### 定理 2：硬上下限有界性（Hard Boundary Invariance $[0, 100]$）
**命题**：对任意非负缺陷 $P_{\text{raw}} \in [0, +\infty)$ 与任意非负暴露 $\rho_{\text{exp}} \in [0, +\infty)$，恒有：
$$s_{\text{sec}} \in [0.0, 100.0]$$
- **下界证明**：公式外层由 $\max(0, \cdot)$ 严格嵌位，当 $P_{\text{raw}} \ge 100$ 时，$s_{\text{sec}} \equiv 0.0$，无数值下溢或负数异常。
- **上界证明**：因 $\rho_{\text{exp}} \ge 0$ 且 $\kappa > 0$，有 $\tanh(\kappa \rho_{\text{exp}}) \ge 0 \implies \Delta_{\text{exposure}} \ge 0$；结合 $P_{\text{raw}} \ge 0$，得：
  $$(100.0 - \Delta_{\text{exposure}}) - P_{\text{raw}} \le 100.0 - 0.0 - 0.0 = 100.0$$
  因此上界永不溢出 100.0。

##### 定理 3：加权几何平均数完全兼容性（Full Compatibility with Weighted Geometric Mean）
系统综合健康分定义为带底线保护的加权几何平均数：
$$\text{Composite} = \exp\left( \frac{\sum_{i \in \mathcal{E}} w_i \cdot \ln(\max(\text{Floor}, s_i))}{\sum_{i \in \mathcal{E}} w_i} \right), \quad \text{Floor} = 15.0$$
- **性质 3.1（对数连续性与奇异点彻底消除）**：
  因 $s_{\text{sec}} \ge 0.0$，恒有 $\max(\text{Floor}, s_{\text{sec}}) \ge 15.0 > 0$。对数项 $\ln(\max(\text{Floor}, s_{\text{sec}}))$ 的真数严格处于 $[15.0, 100.0]$ 区间内，在实数集上处处有限、连续且一阶可微，彻底消除了 $\ln(0) = -\infty$ 的未定义奇点风险。
- **性质 3.2（高信任走廊摄动极小性）**：
  当代码无硬安全缺陷（$P_{\text{raw}} = 0$）时，$s_{\text{sec}} \in [99.0, 100.0]$。
  在代码安全标准权重 $w_{\text{sec}} = 0.10$ 下，对数项最大可能差值为：
  $$\Delta \ln = \ln(100.0) - \ln(99.0) \approx 4.60517 - 4.59512 = 0.01005$$
  该变动对加权指数均值的摄动贡献为：
  $$\delta_{\text{composite}} = \frac{w_{\text{sec}} \cdot \Delta \ln}{\sum w_i} = \frac{0.10 \times 0.01005}{1.0} \approx 0.001005$$
  综合评分的最大漂移量上限为：
  $$\Delta \text{Composite} \approx 100 \times \left(1 - e^{-0.001005}\right) \approx 0.10 \text{ 分}$$
  对于全局 A+ 评级门槛（$\ge 90.0$）而言，$\pm 0.10$ 分的摄动处于可忽略的微扰范畴，既客观反映了攻击面拓扑差异，又绝不引发评级假阴性误降。
- **性质 3.3（致命漏洞短板惩罚等价性）**：
  当发生严重安全缺陷导致 $s_{\text{sec}} = 0$ 时，$\max(15.0, 0.0) = 15.0$，该维度向几何均值注入 $\ln(15) \approx 2.70805$。与满分对数值相比产生压倒性跌幅（$\Delta \ln \approx 1.897$），加权几何均数对安全短板的对数惩罚威力被 100% 完整保留，强力拉低全局综合评分，严守工程上线安全底线。

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
