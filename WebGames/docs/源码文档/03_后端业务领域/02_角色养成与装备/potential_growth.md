# 后天潜能成长与双轨洗点 (`potential_growth`)

> 对应源码：`backend/domains/potential_growth/`（4 个 `.gd`）。采用“阅历突破授点 + 破阶递减加点 + 事件驱动底层实际值永久修正 + 因果洗点重塑”替代传统等级数值膨胀体系。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 关键公开接口 |
| :--- | :--- | :--- | :--- |
| [potential_growth_engine.gd](../../../../backend/domains/potential_growth/potential_growth_engine.gd) | `PotentialGrowthEngine` | 潜能点容器 | `grant_potential_points()`、`serialize()`/`deserialize()` |
| [targeted_attribute_solver.gd](../../../../backend/domains/potential_growth/targeted_attribute_solver.gd) | `TargetedAttributeSolver` | 破阶加点成本求解器 | `calculate_point_cost_for_next_stat()`、`allocate_targeted_point()` 按分段递增成本升级 L1 属性等级 |
| [dynamic_attribute_adjuster.gd](../../../../backend/domains/potential_growth/dynamic_attribute_adjuster.gd) | `DynamicAttributeAdjuster` | 事件驱动底层值修正器 | `consume_event_channel()`、`apply_dynamic_adjustment()` 直接修正 L3 底层实际值并执行非负地板钳制（不改显示等级） |
| [attribute_respec_pipeline.gd](../../../../backend/domains/potential_growth/attribute_respec_pipeline.gd) | `AttributeRespecPipeline` | 因果重塑洗点管线 | `calculate_respec_cost()`、`execute_heart_core_respec()` 扣除指数递增的金币与魔单晶费用，重置 L1 等级与 L2 阅历系数（保留先天基础系数），全额返还潜能点 |

---

## 二、关联配置与验证

- **配置映射**：`domains.potential.core` 与 `narratives.potential`。
- **测试入口**：[test_potential_growth.gd](../../../../tests/unit/domains/test_potential_growth.gd)。
