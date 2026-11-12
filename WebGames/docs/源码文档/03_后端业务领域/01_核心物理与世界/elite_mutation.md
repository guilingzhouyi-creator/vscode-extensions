# 精英变异词缀与狂暴机制 (`elite_mutation`)

> 对应源码：`backend/domains/elite_mutation/`（3 个 `.gd`）。在怪物生态模型之上扩展精英位格分级、配置驱动的随机变异词缀滚池与狂暴阈值触发状态机。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [elite_monster_entity.gd](../../../../backend/domains/elite_mutation/elite_monster_entity.gd) | `EliteMonsterAggregate` | 精英怪物聚合体 | 声明 `EliteGrade` 枚举与 `apply_affixes()`；默认值取自 `domains.elite:entity_defaults/*` |
| [generic_affix_solver.gd](../../../../backend/domains/elite_mutation/generic_affix_solver.gd) | `GenericAffixSolver` | 词缀定义与概率抽取 | `get_affix()`、`roll_random_affixes()`；读取 `affixes` 与分级池 `affix_pool/tier_%d` |
| [generic_berserk_fsm.gd](../../../../backend/domains/elite_mutation/generic_berserk_fsm.gd) | `GenericBerserkFSM` | 血线/超时狂暴状态机 | `check_and_trigger_berserk()` 消费 `berserk_fsm/{duration_ticks_threshold,rage_level,str_multiplier}` 并执行 L2 乘性增益 |

---

## 二、关联配置与验证

- **配置与文案**：`domains.elite.core`（别名 `domains.elite`）、`narratives.elite`。
- **测试入口**：[test_elite_mutation.gd](../../../../tests/unit/domains/test_elite_mutation.gd)。
