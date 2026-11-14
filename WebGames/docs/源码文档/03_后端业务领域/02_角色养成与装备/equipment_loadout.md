# 战备配装槽位与属性聚合 (`equipment_loadout`)

> 对应源码：`backend/domains/equipment_loadout/`（3 个 `.gd`）。管理角色全身战备槽位、背包与穿戴状态原子互换状态机，以及在不修改存档的前提下对生理副本叠加热力学/符文词缀修正的求值器。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置驱动 |
| :--- | :--- | :--- | :--- |
| [equipment_loadout_aggregate.gd](../../../../backend/domains/equipment_loadout/equipment_loadout_aggregate.gd) | `EquipmentLoadoutAggregate` | 战备槽位聚合体 | `get_equipped_item()`、`equip()`、`unequip()`、`unequip_item_ref()`、`snapshot_slots()`、`restore_slots()`、`serialize()`/`deserialize()` |
| [equipment_fsm.gd](../../../../backend/domains/equipment_loadout/equipment_fsm.gd) | `EquipmentFSM` | 穿卸与容量联动状态机 | `equip_from_inventory()`、`unequip_to_inventory()` 校验槽位合法性与背包容量（`WearableInventoryAggregate` 为唯一容量真源） |
| [equipment_modifier_evaluator.gd](../../../../backend/domains/equipment_loadout/equipment_modifier_evaluator.gd) | `EquipmentModifierEvaluator` | 战备词缀聚合评估器 | `evaluate_total_modifiers()`、`apply_loadout_to_physiology()` 遍历槽位累加前缀/后缀/符文加成至独立生理副本 |

---

## 二、关联配置与验证

- **配置映射**：`domains.equipment.core`（槽位表与 `rune_modifiers`）与 `narratives.equipment`。
- **测试入口**：[test_equipment_loadout.gd](../../../../tests/unit/domains/test_equipment_loadout.gd)。
