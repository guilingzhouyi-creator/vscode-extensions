# 02 角色养成与装备集群

> 本集群收录账户角色生命周期、创角序章与命途模组适配、六维生理与潜能成长、随身背包与词缀鉴定、战备锻造、技能典籍、魔法规则、全域命名空间与伪装体系共 **12 个**后端业务领域（合计 112 个 `.gd` 文件）。

---

## 领域目录索引

| 文档 | 领域 ID (`domains.json`) | 脚本数 | 配置主表 | 测试入口 |
| :--- | :--- | :---: | :--- | :--- |
| [account.md](account.md) | `account` | 13 | `domains.account.core` | [test_account.gd](../../../../tests/unit/domains/test_account.gd) |
| [character_creation.md](character_creation.md) | `character_creation` | 35 | `domains.character_creation.core` | [test_character_creation.gd](../../../../tests/unit/domains/test_character_creation.gd) |
| [lifecycle_physiology.md](lifecycle_physiology.md) | `lifecycle_physiology` | 3 | `domains.lifecycle.core` | [test_lifecycle_physiology.gd](../../../../tests/unit/domains/test_lifecycle_physiology.gd) |
| [potential_growth.md](potential_growth.md) | `potential_growth` | 4 | `domains.potential.core` | [test_potential_growth.gd](../../../../tests/unit/domains/test_potential_growth.gd) |
| [inventory.md](inventory.md) | `inventory` | 14 | `domains.inventory.core` | [test_inventory.gd](../../../../tests/unit/domains/test_inventory.gd) |
| [equipment_loadout.md](equipment_loadout.md) | `equipment_loadout` | 3 | `domains.equipment.core` | [test_equipment_loadout.gd](../../../../tests/unit/domains/test_equipment_loadout.gd) |
| [workshop_forge.md](workshop_forge.md) | `workshop_forge` | 3 | `domains.workshop.core` | [test_workshop_forge.gd](../../../../tests/unit/domains/test_workshop_forge.gd) |
| [lattice_skill_book.md](lattice_skill_book.md) | `lattice_skill_book` | 4 | `domains.lattice.core` | [test_lattice_skill_book.gd](../../../../tests/unit/domains/test_lattice_skill_book.gd) |
| [magic_system.md](magic_system.md) | `magic_system` | 11 | `domains.magic_rules.core` | [test_magic_system.gd](../../../../tests/unit/domains/test_magic_system.gd) |
| [item_namespace_registry.md](item_namespace_registry.md) | `item_namespace_registry` | 15 | `domains.item_namespace_registry.core` | [test_item_namespace_registry.gd](../../../../tests/unit/domains/test_item_namespace_registry.gd) |
| [item_statistics.md](item_statistics.md) | `item_statistics` | 4 | `domains.item_statistics.core` | [test_item_statistics.gd](../../../../tests/unit/domains/test_item_statistics.gd) |
| [identity_disguise.md](identity_disguise.md) | `identity_disguise` | 3 | `domains.identity_disguise.core` | [test_identity_disguise.gd](../../../../tests/unit/domains/test_identity_disguise.gd) |
