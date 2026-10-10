# 反刷分熔断防御机制指南 (Anti-Gaming Detection Mechanics)

本指南阐述在代码自动化重构与质量评分流水线中，如何识别并阻断通过虚假微小改动骗取自治评分收益的刷分行为（Gaming the Metrics），确保所有重构带来真实的系统技术债净消除。

---

## 一、 刷分攻击向量与作弊特征

在多智能体或自动化重构过程中，潜在的“刷分”反模式主要表现为：
1. **纯格式与空白搬移（Trivial Churn）**：
   通过批量调整缩进、调换等价参数顺序或增加空行，制造大批改动文件，借此在统计报表中呈现虚假的高重构活跃度；
2. **微量改动冒充架构重构（Micro-edit Impersonation）**：
   仅改动 1~2 行变量名，但向门禁汇报为“全模块重构”，在没有实质降低圈复杂度、消除堆分配或消除技术债务的前提下骗取高分；
3. **注释删减规避物理体积上限**：
   为了使 `LOC <= 1400` 达标，粗暴删除核心状态机或算法契约注释，导致代码可读性与架构契约遭受破坏。

---

## 二、 熔断判定公理 (`BLOCK_GAMING_DETECTED`)

自治评分器（Autonomy Scorer）在计算重构贡献得分时，必须运行反刷分前置守卫：

### 1. 语义有效行比例阈值
设文件改动中的有效语义代码行比例为：
$$\text{Ratio}_{semantic} = \frac{\text{ELOC}_{changed}}{\text{ELOC}_{total}}$$

若 $\text{Ratio}_{semantic} \le 15\%$，即判定该改动为低语义微改动。

### 2. 技术债务净消除检验
在判定为微改动的前提下，检查该次改动是否产生了**真实技术债务的净消除**：
- 是否消除了至少 1 处分析器规则违规；
- 是否消除了循环内瞬态堆分配；
- 是否降低了函数圈复杂度或嵌套深度。

### 3. 熔断判定逻辑
若同时满足：
1. 语义代码改动比例 $\text{Ratio}_{semantic} \le 15\%$；
2. 且真实技术债务净消除数 $\Delta_{\text{Debt}} \le 0$。

系统强制冻结本次改动的评分收益并抛出熔断标记：
```typescript
if (semanticRatio <= 0.15 && netDebtEliminated <= 0) {
  return {
    status: 'FROZEN',
    code: 'BLOCK_GAMING_DETECTED',
    message: 'Trivial churn detected: Semantic modification <= 15% with zero net technical debt reduction.',
  };
}
```
该机制彻底杜绝了模型在重构过程中“机械刷量”的投机倾向。

