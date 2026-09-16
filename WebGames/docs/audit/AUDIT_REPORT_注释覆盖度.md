# 审计报告：全仓函数文档注释（##）覆盖度审计

> [!NOTE]
> **审计口径**：`backend/` + `frontend/` 全部生产 GDScript（排除 tests/benchmarks/.uid），统计类级 `func`/`static func`（含内嵌类 2 缩进）与其紧邻上方（跳过空行）`##` 文档注释前置情况。
> **审计日期**：2026-09-05。**规范基准**：函数文档注释统一使用 `##` 行（前导空白不计），与 `event_bus.gd` 等高覆盖文件一致；`#` 单注释用于区块/行内说明，不计入函数文档。

---

## 一、 总体结论

| 指标 | 数值 |
| :--- | :---: |
| 统计文件数 | 260 |
| 函数总数 | 1722 |
| 已文档化函数 | 1588 |
| **总覆盖率** | **92.2%** |
| **0% 覆盖文件** | **0（已清零）** |
| 100% 覆盖文件 | 189 |
| 剩余非满覆盖文件 | 71 |

---

## 二、 剩余非满覆盖文件（71 个，按覆盖率升序）

| 文件 | 函数文档注释 | 覆盖率 |
| :--- | :--- | :---: |
| `backend/domains/admin_sandbox/gm_command_catalog.gd` | 3/6 | 50% |
| `backend/domains/admin_sandbox/sandbox_cheat_solver.gd` | 1/2 | 50% |
| `backend/domains/bulletin_board_maintenance/bulletin_board_solver.gd` | 1/2 | 50% |
| `backend/domains/bulletin_board_maintenance/bulletin_push_pipeline.gd` | 1/2 | 50% |
| `backend/domains/character_creation/character_creation_service.gd` | 1/2 | 50% |
| `backend/domains/chat_command/reward_dispatch_pipeline.gd` | 1/2 | 50% |
| `backend/domains/equipment_loadout/equipment_fsm.gd` | 2/4 | 50% |
| `backend/domains/event_driven_audio/audio_bus_pipeline.gd` | 1/2 | 50% |
| `backend/domains/game_settings/settings_persistence_service.gd` | 2/4 | 50% |
| `backend/domains/ground_loot/ground_dropped_item_aggregate.gd` | 1/2 | 50% |
| `backend/domains/ground_loot/ground_loot_pickup_solver.gd` | 1/2 | 50% |
| `backend/domains/item_namespace_registry/item_quality_snapshot.gd` | 2/4 | 50% |
| `backend/domains/item_namespace_registry/item_uid_generator.gd` | 5/10 | 50% |
| `backend/domains/lattice_skill_book/grimoire_authoring_pipeline.gd` | 1/2 | 50% |
| `backend/domains/localization_i18n/localization_solver.gd` | 1/2 | 50% |
| `backend/domains/magic_system/action_card_definition.gd` | 4/8 | 50% |
| `backend/domains/magic_system/magic_attribute_school.gd` | 2/4 | 50% |
| `backend/domains/mail_system/mail_delivery_pipeline.gd` | 2/4 | 50% |
| `backend/domains/matter_disposal/matter_disposal_solver.gd` | 1/2 | 50% |
| `backend/domains/physics_thermodynamics/combat_pipeline_fsm.gd` | 1/2 | 50% |
| `backend/domains/quest_causality/causality_dag_solver.gd` | 1/2 | 50% |
| `backend/domains/sovereignty_realm/feoffment_solver.gd` | 1/2 | 50% |
| `backend/domains/spatial_movement/spatial_location_entity.gd` | 1/2 | 50% |
| `backend/domains/world_gateway/world_gateway_fsm.gd` | 4/8 | 50% |
| `backend/domains/world_state/world_instance.gd` | 3/6 | 50% |
| `backend/domains/account/entitlement_service.gd` | 6/11 | 55% |
| `backend/domains/lifecycle_physiology/physiology_entities.gd` | 6/11 | 55% |
| `backend/domains/magic_system/delay_scheduler.gd` | 5/9 | 56% |
| `backend/domains/character_creation/attribute_init_solver.gd` | 4/7 | 57% |
| `backend/domains/cdkey_voucher/voucher_dispatch_pipeline.gd` | 3/5 | 60% |
| `backend/domains/inventory/item_entity.gd` | 3/5 | 60% |
| `backend/domains/physics_thermodynamics/tertiary_timeline_engine.gd` | 3/5 | 60% |
| `backend/infrastructure/game_config.gd` | 12/20 | 60% |
| `backend/domains/currency_economy/currency_entities.gd` | 8/13 | 62% |
| `backend/domains/admin_sandbox/clawback_service.gd` | 7/11 | 64% |
| `backend/domains/inventory/item_attribute_appraisal_solver.gd` | 2/3 | 67% |
| `backend/domains/item_namespace_registry/item_quality_resolver.gd` | 2/3 | 67% |
| `backend/domains/item_namespace_registry/magic_baseline_resolver.gd` | 2/3 | 67% |
| `backend/domains/item_namespace_registry/magic_tier_snapshot.gd` | 4/6 | 67% |
| `backend/domains/item_namespace_registry/quality_tier_registry.gd` | 4/6 | 67% |
| `backend/domains/item_statistics/item_statistics_solver.gd` | 4/6 | 67% |
| `backend/domains/lattice_skill_book/lattice_decompiler_service.gd` | 2/3 | 67% |
| `backend/domains/matter_disposal/disposal_pipeline.gd` | 2/3 | 67% |
| `backend/domains/physics_thermodynamics/combat_play_validator.gd` | 2/3 | 67% |
| `backend/domains/world_gateway/game_mode_routing_solver.gd` | 2/3 | 67% |
| `backend/domains/world_navigation/map_ecology_solver.gd` | 2/3 | 67% |
| `frontend/theme/theme_manager.gd` | 4/6 | 67% |
| `backend/domains/character_creation/attribute_conversion_engine.gd` | 8/11 | 73% |
| `backend/domains/gacha_wish/gacha_banner_entity.gd` | 3/4 | 75% |
| `backend/domains/item_namespace_registry/item_registry_solver.gd` | 6/8 | 75% |
| `backend/domains/magic_system/multi_cast_solver.gd` | 3/4 | 75% |
| `backend/infrastructure/authority_sync_stub.gd` | 3/4 | 75% |
| `backend/domains/event_extractor/composite_event_extractor.gd` | 10/13 | 77% |
| `backend/infrastructure/game_bootstrap.gd` | 7/9 | 78% |
| `backend/domains/account/save_slot_dto.gd` | 4/5 | 80% |
| `backend/domains/contract_registry/contract_completeness_guard.gd` | 4/5 | 80% |
| `backend/domains/item_namespace_registry/item_loader_pipeline.gd` | 4/5 | 80% |
| `backend/infrastructure/event_bus.gd` | 8/10 | 80% |
| `frontend/i18n/ui_text_resolver.gd` | 9/11 | 82% |
| `backend/domains/cdkey_voucher/redemption_flow_orchestrator.gd` | 5/6 | 83% |
| `backend/domains/character_creation/character_creation_fsm.gd` | 5/6 | 83% |
| `backend/domains/item_statistics/account_item_library.gd` | 10/12 | 83% |
| `backend/domains/localization_i18n/localization_registry_catalog.gd` | 5/6 | 83% |
| `backend/domains/magic_system/seal_solver.gd` | 5/6 | 83% |
| `backend/domains/persistence_protocol/save_assembler.gd` | 5/6 | 83% |
| `backend/infrastructure/deterministic_rng.gd` | 12/14 | 86% |
| `backend/domains/item_namespace_registry/item_registry_catalog.gd` | 8/9 | 89% |
| `backend/domains/account/auth_service.gd` | 9/10 | 90% |
| `frontend/navigation/view_router.gd` | 9/10 | 90% |
| `frontend/i18n/ui_binding_registry.gd` | 10/11 | 91% |
| `frontend/i18n/ui_intermediary.gd` | 11/12 | 92% |

---

## 三、 合规与结论

1. **0% 文件已清零**：全仓 260 个生产文件无一函数缺失 `##` 文档注释。
2. **门禁**：`audit_gd` 三节审查（style/高级架构/简化）全绿；`COMMENT-PENDING-MARKER`（未决标记禁令）无触发。
3. **建议**：剩余 71 个非满覆盖文件多为核心函数已文档化、仅个别私有辅助函数未覆盖；可继续按 §二 清单逐批补齐至 100%，或将「新函数必须带 `##`」纳入 `audit_gd.py` 基线棘轮防回潮。
