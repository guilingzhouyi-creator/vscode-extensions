# 魔法规则、几重施法、升格与延时封印 (`magic_system`)

> 对应源码：`backend/domains/magic_system/`（**11 个** `.gd`）。基于 `domains.magic_rules.core` 唯一事实源建立配置驱动的魔法属性大类/派生变体、可组合条件求值树、几重化多击结算、独立位阶升格、非阻塞延时调度与封印持久状态机。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与机制说明 |
| :--- | :--- | :--- | :--- |
| [magic_rule_registry.gd](../../../../backend/domains/magic_system/magic_rule_registry.gd) | `MagicRuleRegistry` | 配置校验注册表 | 加载 `domains.magic_rules.core` 并验证大类成员/变体来源/条件树结构闭合；`is_ready()`、`get_school()`、`get_attribute()`、`get_variant()`、`multi_cast_config()` |
| [magic_attribute_school.gd](../../../../backend/domains/magic_system/magic_attribute_school.gd) | `MagicAttributeSchool` | 属性体系与融会变体 | 光/暗基础属性集合及派生变体 `from_registry_entry()`、`variant_from_registry_entry()`、`has_attribute()` |
| [magic_definition.gd](../../../../backend/domains/magic_system/magic_definition.gd) | `MagicDefinition` | 魔法本体定义 | 绑定形态（`MagicTierSnapshot.MagicForm`）、属性与独立位阶维度（`normalize_rank()`） |
| [magic_rule_condition.gd](../../../../backend/domains/magic_system/magic_rule_condition.gd) | `MagicRuleCondition` | 组合条件求值树 | `evaluate()` 解析 `AND/OR/NOT/LEAF` 节点；未知条件类型严格返回 `false` |
| [ascension_solver.gd](../../../../backend/domains/magic_system/ascension_solver.gd) | `AscensionSolver` | 魔法位阶升格求解器 | `validate_ascension()`、`apply_ascension()` 直接在既有 1~11 阶位阶梯度上提升一阶，不复制衍生卡牌 |
| [magic_rule_state.gd](../../../../backend/domains/magic_system/magic_rule_state.gd) | `MagicRuleState` | 持续状态建模载体 | 承载封印/延时/临时升格语义；状态流转 `ACTIVE -> RELEASED/EXPIRED/HOLDER_LOST/ROLLED_BACK/CANCELLED` |
| [seal_fsm.gd](../../../../backend/domains/magic_system/seal_fsm.gd) | `SealFsm` | 封印与解放状态机 | `apply_seal()`、`apply_release()`、`is_sealed()`、`rollback_seal()`、`cleanup_expired()` |
| [delay_scheduler.gd](../../../../backend/domains/magic_system/delay_scheduler.gd) | `DelayScheduler` | 非阻塞延时调度器 | `schedule()`、`advance_steps()`、`drain_due()`、`cancel_by_holder()`（维护到期队列而不阻塞正常出牌） |
| [magic_rule_trigger.gd](../../../../backend/domains/magic_system/magic_rule_trigger.gd) | `MagicRuleTrigger` | 延时到期强制触发器 | 声明 `TriggerKind`、`ReleasePolicy`、`TargetPolicy` 与步数推进 `advance_steps()` |
| [multi_cast_solver.gd](../../../../backend/domains/magic_system/multi_cast_solver.gd) | `MultiCastSolver` | 几重化多击求解器 | `validate_play()`、`execute_play()` 消耗 1 张行动卡发动 $N$ 次独立结算 |
| [magic_settlement_solver.gd](../../../../backend/domains/magic_system/magic_settlement_solver.gd) | `MagicSettlementSolver` | 统一伤害结算适配层 | `resolve_attack()` 收口复用物理/相变真实伤害管线 |

---

## 二、关联配置与验证

- **配置映射**：`domains.magic_rules.core`、共享表 `domains.magic_tiers`、叙事表 `narratives.item_namespace_registry`。
- **测试入口**：[test_magic_system.gd](../../../../tests/unit/domains/test_magic_system.gd)。
