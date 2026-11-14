# 生命周期生理机能与寿元演化 (`lifecycle_physiology`)

> 对应源码：`backend/domains/lifecycle_physiology/`（3 个 `.gd`）。定义全引擎统一六维属性底座载体 `CharacterPhysiologySheet`、年龄与肉身机能 SF 衰退模型、魔法资质反噬风险评估，以及大限触发与丹药逆龄状态机。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 关键公开接口与职责 |
| :--- | :--- | :--- | :--- |
| [character_physiology_sheet.gd](../../../../backend/domains/lifecycle_physiology/character_physiology_sheet.gd) | `CharacterPhysiologySheet` | 生理属性与寿命核心容器 | 声明 `PhysicalConstitution`、`ManaAptitude`；管理 L1 等级/进度、L2 阅历系数、L3 实际值计算（`get_actual_value()`、`get_actual_values()`、`duplicate_physiology()`、`serialize()`） |
| [lifecycle_and_physiology_solver.gd](../../../../backend/domains/lifecycle_physiology/lifecycle_and_physiology_solver.gd) | `LifecycleAndPhysiologySolver` | 机能衰退与反噬纯求解器 | `calculate_somatic_function()`（SF 衰退指数模型）与 `evaluate_mana_backfire_risk()`（按资质阈值评估精神反噬风险） |
| [lifecycle_evolution_fsm.gd](../../../../backend/domains/lifecycle_physiology/lifecycle_evolution_fsm.gd) | `LifecycleEvolutionFSM` | 年轮与大限状态机 | `age_character_years()`（年龄推进、大限/死亡临界比例判定）、`apply_rejuvenation()`（心核完整度恢复） |

---

## 二、关联配置与验证

- **配置与存档**：`domains.lifecycle.core`、`narratives.lifecycle`；在 `domains.json` 注册为 `full` 存档策略（序列化类 `GameLifecycleModel`）。
- **测试入口**：[test_lifecycle_physiology.gd](../../../../tests/unit/domains/test_lifecycle_physiology.gd)。
