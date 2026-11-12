# 01 核心物理与世界集群

> 本集群收录直接决定物理规则、战斗时间轴、空间导航、世界状态托管、生态怪物与物质守恒的 **10 个**后端业务领域（合计 92 个 `.gd` 文件）。

---

## 领域目录索引

| 文档 | 领域 ID (`domains.json`) | 脚本数 | 配置主表 | 测试入口 |
| :--- | :--- | :---: | :--- | :--- |
| [physics_thermodynamics.md](physics_thermodynamics.md) | `physics_thermodynamics` | 15 | `domains.combat`（3 子表） | [test_physics_thermodynamics.gd](../../../../tests/unit/domains/test_physics_thermodynamics.gd) |
| [world_navigation.md](world_navigation.md) | `world_navigation` | 3 | `domains.world.core` | [test_world_navigation.gd](../../../../tests/unit/domains/test_world_navigation.gd) |
| [world_state.md](world_state.md) | `world_state` | 42 | `domains.world_state.core` | [test_world_state.gd](../../../../tests/unit/domains/test_world_state.gd) |
| [world_boss.md](world_boss.md) | `world_boss` | 3 | `domains.world_boss.core` | [test_world_boss.gd](../../../../tests/unit/domains/test_world_boss.gd) |
| [monster_ecology.md](monster_ecology.md) | `monster_ecology` | 3 | `domains.monster.core` | [test_monster_ecology.gd](../../../../tests/unit/domains/test_monster_ecology.gd) |
| [elite_mutation.md](elite_mutation.md) | `elite_mutation` | 3 | `domains.elite.core` | [test_elite_mutation.gd](../../../../tests/unit/domains/test_elite_mutation.gd) |
| [spatial_movement.md](spatial_movement.md) | `spatial_movement` | 5 | `domains.spatial_movement.core` | [test_spatial_movement.gd](../../../../tests/unit/domains/test_spatial_movement.gd) |
| [ground_loot.md](ground_loot.md) | `ground_loot` | 4 | `domains.ground_loot.core` | [test_ground_loot.gd](../../../../tests/unit/domains/test_ground_loot.gd) |
| [matter_disposal.md](matter_disposal.md) | `matter_disposal` | 3 | `domains.matter_disposal.core` | [test_matter_disposal.gd](../../../../tests/unit/domains/test_matter_disposal.gd) |
| [deterministic_sandbox.md](deterministic_sandbox.md) | `deterministic_sandbox` | 3 | `domains.deterministic.core` | [test_deterministic_sandbox.gd](../../../../tests/unit/domains/test_deterministic_sandbox.gd) |
