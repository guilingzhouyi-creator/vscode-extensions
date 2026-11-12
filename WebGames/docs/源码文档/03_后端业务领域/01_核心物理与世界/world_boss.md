# 世界首领机制与贡献结算 (`world_boss`)

> 对应源码：`backend/domains/world_boss/`（3 个 `.gd`）。提供单机游荡天灾与联机大型首领同构的多阶段血槽模型、破盾转相狂暴状态机与多维贡献排行掉落分配器。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [world_boss_entity.gd](../../../../backend/domains/world_boss/world_boss_entity.gd) | `WorldBossAggregate` | 首领聚合实体 | 承载 `boss_uid`、`phase_current_hp`、`mechanism_shield_hp`、`is_channeling_wipe_spell`、`is_invulnerable`；默认字段源自 `domains.world_boss:entity_defaults/*` |
| [phase_transition_fsm.gd](../../../../backend/domains/world_boss/phase_transition_fsm.gd) | `ConfigurablePhaseTransitionFSM` | 阶段切换与破盾状态机 | `apply_boss_damage()` 判定阶段血条归零切相、护盾刷新（`phase_transition/shield_hp`）与狂暴属性放大（`str_multiplier`） |
| [universal_contribution_solver.gd](../../../../backend/domains/world_boss/universal_contribution_solver.gd) | `UniversalContributionSolver` | 贡献度排行与分配纯求解器 | `calculate_leaderboard()`、`distribute_boss_loot()` 按 `contribution/weights/{damage,heal,tanking}` 计算 MVP 与战利品配额 |

---

## 二、关联配置与验证

- **配置与文案**：`domains.world_boss.core`（别名 `domains.world_boss`）、`narratives.world_boss`。
- **测试入口**：[test_world_boss.gd](../../../../tests/unit/domains/test_world_boss.gd)。
