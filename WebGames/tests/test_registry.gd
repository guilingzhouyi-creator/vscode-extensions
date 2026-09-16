# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 全域测试注册表 (Test Registry)
# 文件路径: res://tests/test_registry.gd
# 职责: 统一注册后端 44 业务领域、横切护栏与前端 17 系统测试套件
# ==============================================================================
class_name TestRegistry
extends RefCounted

# Phase 1: 核心母机 13 大领域
const TestInventoryDomain = preload("res://tests/unit/domains/test_inventory.gd")
const TestPhysicsDomain = preload("res://tests/unit/domains/test_physics_thermodynamics.gd")
const TestWorldNavigationDomain = preload("res://tests/unit/domains/test_world_navigation.gd")
const TestLatticeDomain = preload("res://tests/unit/domains/test_lattice_skill_book.gd")
const TestDeterministicDomain = preload("res://tests/unit/domains/test_deterministic_sandbox.gd")
const TestPersistenceDomain = preload("res://tests/unit/domains/test_persistence_protocol.gd")
const TestLifecycleDomain = preload("res://tests/unit/domains/test_lifecycle_physiology.gd")
const TestMonsterDomain = preload("res://tests/unit/domains/test_monster_ecology.gd")
const TestQuestDomain = preload("res://tests/unit/domains/test_quest_causality.gd")
const TestCurrencyDomain = preload("res://tests/unit/domains/test_currency_economy.gd")
const TestTradingDomain = preload("res://tests/unit/domains/test_trading_logistics.gd")
const TestNPCDomain = preload("res://tests/unit/domains/test_npc_simulation.gd")
const TestSovereigntyDomain = preload("res://tests/unit/domains/test_sovereignty_realm.gd")

# Phase 2: 交互中枢、经济循环与首领引擎 10 大领域
const TestAccountDomain = preload("res://tests/unit/domains/test_account.gd")
const TestCharacterCreationDomain = preload("res://tests/unit/domains/test_character_creation.gd")
const TestPotentialGrowthDomain = preload("res://tests/unit/domains/test_potential_growth.gd")
const TestGachaDomain = preload("res://tests/unit/domains/test_gacha_wish.gd")
const TestEquipmentLoadoutDomain = preload("res://tests/unit/domains/test_equipment_loadout.gd")
const TestWorkshopForgeDomain = preload("res://tests/unit/domains/test_workshop_forge.gd")
const TestAdminSandboxDomain = preload("res://tests/unit/domains/test_admin_sandbox.gd")
const TestChatCommandDomain = preload("res://tests/unit/domains/test_chat_command.gd")
const TestEliteMutationDomain = preload("res://tests/unit/domains/test_elite_mutation.gd")
const TestWorldBossDomain = preload("res://tests/unit/domains/test_world_boss.gd")

# Phase 3: 组织治理、空间移动与全域因果 12 大领域
const TestCDKeyVoucherDomain = preload("res://tests/unit/domains/test_cdkey_voucher.gd")
const TestMailSystemDomain = preload("res://tests/unit/domains/test_mail_system.gd")
const TestGameSettingsDomain = preload("res://tests/unit/domains/test_game_settings.gd")
const TestOrganizationGuildDomain = preload("res://tests/unit/domains/test_organization_guild.gd")
const TestCommissionQuestDomain = preload("res://tests/unit/domains/test_commission_quest.gd")
const TestIdentityDisguiseDomain = preload("res://tests/unit/domains/test_identity_disguise.gd")
const TestSpatialMerchantDomain = preload("res://tests/unit/domains/test_spatial_merchant.gd")
const TestSpatialMovementDomain = preload("res://tests/unit/domains/test_spatial_movement.gd")
const TestHardwareInputDomain = preload("res://tests/unit/domains/test_hardware_input.gd")
const TestGroundLootDomain = preload("res://tests/unit/domains/test_ground_loot.gd")
const TestMatterDisposalDomain = preload("res://tests/unit/domains/test_matter_disposal.gd")
const TestNarrativeOrchestrationDomain = preload("res://tests/unit/domains/test_narrative_orchestration.gd")

# Phase 4: 命名空间、灰度热更、国际化、音频、通知与遥测 8 大领域
const TestItemNamespaceRegistryDomain = preload("res://tests/unit/domains/test_item_namespace_registry.gd")
const TestFeatureToggleCanaryDomain = preload("res://tests/unit/domains/test_feature_toggle_canary.gd")
const TestLocalizationI18nDomain = preload("res://tests/unit/domains/test_localization_i18n.gd")
const TestEventDrivenAudioDomain = preload("res://tests/unit/domains/test_event_driven_audio.gd")
const TestNotificationRedDotDomain = preload("res://tests/unit/domains/test_notification_red_dot.gd")
const TestBulletinBoardMaintenanceDomain = preload("res://tests/unit/domains/test_bulletin_board_maintenance.gd")
const TestTelemetryAccountLifecycleDomain = preload("res://tests/unit/domains/test_telemetry_account_lifecycle.gd")
const TestItemStatisticsDomain = preload("res://tests/unit/domains/test_item_statistics.gd")
const TestEventExtractorDomain = preload("res://tests/unit/domains/test_event_extractor.gd")
const TestWorldStateDomain = preload("res://tests/unit/domains/test_world_state.gd")
const TestItemQualityDomain = preload("res://tests/unit/infrastructure/test_item_quality.gd")
const TestMagicTierDomain = preload("res://tests/unit/infrastructure/test_magic_tier.gd")
const TestNameRegistryDomain = preload("res://tests/unit/infrastructure/test_name_registry.gd")
const TestItemDescriptionDomain = preload("res://tests/unit/infrastructure/test_item_description.gd")
const TestEventProbabilityDomain = preload("res://tests/unit/infrastructure/test_event_probability.gd")
const TestEventDescriptionDomain = preload("res://tests/unit/infrastructure/test_event_description.gd")
const TestCopywritingDomain = preload("res://tests/unit/infrastructure/test_copywriting.gd")
const TestCdcDomain = preload("res://tests/unit/infrastructure/test_cdc.gd")
const TestTaskWorldEventDomain = preload("res://tests/unit/infrastructure/test_task_world_event.gd")
const TestCdkeyEligibilityDomain = preload("res://tests/unit/infrastructure/test_cdkey_eligibility.gd")
const TestRuleScopeDomain = preload("res://tests/unit/infrastructure/test_rule_scope.gd")
const TestFlowOrchestrationDomain = preload("res://tests/unit/infrastructure/test_flow_orchestration.gd")
const TestDynamicEconomyDomain = preload("res://tests/unit/infrastructure/test_dynamic_economy.gd")
const TestMagicRuleSystemDomain = preload("res://tests/unit/domains/test_magic_system.gd")
const TestWorldGatewayAndModeIsolation = preload("res://tests/unit/domains/test_world_gateway.gd")

# Phase 45~50 专属流水线套件（评审收敛 B1：补登记既有未注册套件，全量测试口径覆盖）
const TestCombatTertiaryTimelinePipeline = preload("res://tests/integration/pipelines/test_combat_tertiary_timeline_pipeline.gd")
const TestItemAttributeAffixSystemPipeline = preload("res://tests/integration/pipelines/test_item_attribute_affix_system_pipeline.gd")
const TestCharacterCreationAndOpeningPipeline = preload("res://tests/integration/pipelines/test_character_creation_and_opening_pipeline.gd")
const TestPrologueCoreAndPlaceholderPipeline = preload("res://tests/integration/pipelines/test_prologue_core_and_placeholder_pipeline.gd")
const TestNarrativeDagOrchestrationPipeline = preload("res://tests/integration/pipelines/test_narrative_dag_orchestration_pipeline.gd")
const TestGameLoopFSMPipeline = preload("res://tests/integration/pipelines/test_game_loop_fsm_pipeline.gd")

# 横切关注点：配置层护栏 + 架构护栏 + Phase 57 契约注册表
const TestConfigurationGuard = preload("res://tests/guards/test_configuration_guard.gd")
const TestArchitectureGuardDomain = preload("res://tests/guards/test_architecture_guard.gd")
const TestFrontendBoundaryGuard = preload("res://tests/guards/test_frontend_boundary_guard.gd")
const TestContractRegistryPipeline = preload("res://tests/integration/pipelines/test_contract_registry_pipeline.gd")
const TestGameLifecyclePipeline = preload("res://tests/integration/pipelines/test_game_lifecycle_pipeline.gd")
const TestPerformanceAndScalabilityPipeline = preload("res://tests/integration/pipelines/test_performance_and_scalability_pipeline.gd")
const TestCombatDualRandomAndTimelinePipeline = preload("res://tests/integration/pipelines/test_combat_dual_random_and_timeline_pipeline.gd")
const TestLogErrorBasePipeline = preload("res://tests/integration/pipelines/test_log_error_base_pipeline.gd")
const TestStructuredLogPipeline = preload("res://tests/integration/pipelines/test_structured_log_pipeline.gd")
const TestSaveDomainContracts = preload("res://tests/unit/infrastructure/test_save_domain_contracts.gd")
const TestSaveMigrationEngine = preload("res://tests/unit/infrastructure/test_save_migration_engine.gd")
const TestEditorHotReload = preload("res://tests/unit/infrastructure/test_editor_hot_reload.gd")
const TestSaveConsistencyRecovery = preload("res://tests/unit/infrastructure/test_save_consistency_recovery.gd")
const TestResourceLifecycleGovernance = preload("res://tests/unit/infrastructure/test_resource_lifecycle_governance.gd")
const TestBoundedCacheAndIdempotency = preload("res://tests/unit/infrastructure/test_bounded_cache_and_idempotency.gd")
const TestBackendRobustnessGuard = preload("res://tests/guards/test_backend_robustness_guard.gd")
const TestUnifiedLoggerService = preload("res://tests/unit/infrastructure/test_unified_logger_service.gd")
# Phase 72: 新一代EventBus 2.0空间分发与零GC流水线
const TestEventBus2ZeroGCPipeline = preload("res://tests/integration/pipelines/test_event_bus2_zero_gc_pipeline.gd")
# Phase 71: 用户会话生命周期与主页HUD双轨同步流水线
const TestSessionLifecycleAndHudSyncPipeline = preload("res://tests/integration/pipelines/test_session_lifecycle_and_hud_sync_pipeline.gd")
# Phase 74: 灰度发布版本编排与底层动态更新流水线
const TestVersionGovernancePipeline = preload("res://tests/integration/pipelines/test_version_governance_pipeline.gd")

# 前端 17 大系统白模与表现层测试套件
const TestFE01AccountEntry = preload("res://tests/unit/frontend/test_fe_01_account_entry.gd")
const TestFE02MainHUD = preload("res://tests/unit/frontend/test_fe_02_main_hud.gd")
const TestFE03CharacterProgression = preload("res://tests/unit/frontend/test_fe_03_character_progression.gd")
const TestFE04CombatView = preload("res://tests/unit/frontend/test_fe_04_combat_view.gd")
const TestFE05EconomyTrade = preload("res://tests/unit/frontend/test_fe_05_economy_trade.gd")
const TestFE06GachaWish = preload("res://tests/unit/frontend/test_fe_06_gacha_wish.gd")
const TestFE07QuestCausality = preload("res://tests/unit/frontend/test_fe_07_quest_causality.gd")
const TestFE08MailSystem = preload("res://tests/unit/frontend/test_fe_08_mail_system.gd")
const TestFE09GuildSocial = preload("res://tests/unit/frontend/test_fe_09_guild_social.gd")
const TestFE10WorldMap = preload("res://tests/unit/frontend/test_fe_10_world_map.gd")
const TestFE11MonsterEcology = preload("res://tests/unit/frontend/test_fe_11_monster_ecology.gd")
const TestFE12CraftingWorkshop = preload("res://tests/unit/frontend/test_fe_12_crafting_workshop.gd")
const TestFE13GrimoireAuthoring = preload("res://tests/unit/frontend/test_fe_13_grimoire_authoring.gd")
const TestFE14NotificationBulletin = preload("res://tests/unit/frontend/test_fe_14_notification_bulletin.gd")
const TestFE15SettingsCenter = preload("res://tests/unit/frontend/test_fe_15_settings_center.gd")
const TestFE16SystemSave = preload("res://tests/unit/frontend/test_fe_16_system_save.gd")
const TestFE17MiscEdge = preload("res://tests/unit/frontend/test_fe_17_misc_edge.gd")
# 前端基础设施与横切领域测试套件
const TestFrontendArchitectureAndBootstrapDomain = preload("res://tests/unit/frontend/test_frontend_architecture_and_bootstrap.gd")
const TestFrontendUIStateAndMock = preload("res://tests/unit/frontend/test_frontend_ui_state_and_mock.gd")
const TestFrontendInfrastructureDomain = preload("res://tests/unit/frontend/test_frontend_infrastructure.gd")
const TestFrontendBoundaryDomain = preload("res://tests/unit/frontend/test_frontend_boundary.gd")
const TestFrontendRobustness = preload("res://tests/unit/frontend/test_frontend_robustness.gd")
const TestFrontendErrorDomain = preload("res://tests/unit/frontend/test_frontend_error_domain.gd")

## 后端 54 大业务测试套件（46 领域 + 品质 + 魔法 + 名称注册表 + 物品描述 + 事件概率 + 事件描述 + 统一文案 + 配置驱动收口）+ 横切护栏测试套件（架构/配置/前端边界护栏）
static func get_all_test_classes() -> Array:
	return [
		# Vol 01 ~ 13
		TestInventoryDomain, TestPhysicsDomain, TestWorldNavigationDomain,
		TestLatticeDomain, TestDeterministicDomain, TestPersistenceDomain,
		TestLifecycleDomain, TestMonsterDomain, TestQuestDomain,
		TestCurrencyDomain, TestTradingDomain, TestNPCDomain,
		TestSovereigntyDomain,
		# Vol 14 ~ 23
		TestAccountDomain, TestCharacterCreationDomain, TestPotentialGrowthDomain,
		TestGachaDomain, TestEquipmentLoadoutDomain, TestWorkshopForgeDomain,
		TestAdminSandboxDomain, TestChatCommandDomain, TestEliteMutationDomain,
		TestWorldBossDomain,
		# Vol 24 ~ 35
		TestCDKeyVoucherDomain, TestMailSystemDomain, TestGameSettingsDomain,
		TestOrganizationGuildDomain, TestCommissionQuestDomain, TestIdentityDisguiseDomain,
		TestSpatialMerchantDomain, TestSpatialMovementDomain, TestHardwareInputDomain,
		TestGroundLootDomain, TestMatterDisposalDomain, TestNarrativeOrchestrationDomain,
		# Vol 36 ~ 43
		TestItemNamespaceRegistryDomain, TestItemQualityDomain, TestMagicTierDomain, TestNameRegistryDomain, TestItemDescriptionDomain, TestEventProbabilityDomain, TestEventDescriptionDomain, TestCopywritingDomain, TestCdcDomain, TestFeatureToggleCanaryDomain, TestLocalizationI18nDomain,
		TestEventDrivenAudioDomain, TestNotificationRedDotDomain, TestBulletinBoardMaintenanceDomain,
		TestTelemetryAccountLifecycleDomain, TestItemStatisticsDomain, TestWorldStateDomain,
		TestEventExtractorDomain,
		TestTaskWorldEventDomain,
		TestCdkeyEligibilityDomain,
		TestRuleScopeDomain,
		TestFlowOrchestrationDomain,
		TestDynamicEconomyDomain,
		# Phase 41: 统一魔法规则模型与行动卡机制（新增 magic_system 域）
		TestMagicRuleSystemDomain,
		# Phase 47: 登录后世界入口模式隔离与状态架构完善
		TestWorldGatewayAndModeIsolation,
		# Phase 45~50 专属流水线套件（评审收敛 B1 补登记；TestContractRegistryFactory 为
		# 数据工厂非套件，由 TestContractRegistryPipeline 注入消费，不单独登记）
		TestCombatTertiaryTimelinePipeline, TestItemAttributeAffixSystemPipeline,
		TestCharacterCreationAndOpeningPipeline, TestPrologueCoreAndPlaceholderPipeline,
		TestNarrativeDagOrchestrationPipeline, TestGameLoopFSMPipeline,
		# 横切：配置层护栏 + 架构护栏 + 契约流水线 + 生命周期安全停机 + 性能扩展性加固 + 战斗双随机预排期 + 日志错误底座收敛 + 全域结构化日志升级 + 存档统一数据基础设施 + 新一代EventBus
		TestConfigurationGuard, TestArchitectureGuardDomain, TestContractRegistryPipeline, TestGameLifecyclePipeline,
		TestFrontendBoundaryGuard,
		TestPerformanceAndScalabilityPipeline, TestCombatDualRandomAndTimelinePipeline, TestLogErrorBasePipeline,
		TestStructuredLogPipeline,
		TestSaveDomainContracts, TestSaveMigrationEngine, TestEditorHotReload, TestSaveConsistencyRecovery,
		TestResourceLifecycleGovernance, TestBoundedCacheAndIdempotency, TestBackendRobustnessGuard, TestUnifiedLoggerService,
		TestEventBus2ZeroGCPipeline,
		TestSessionLifecycleAndHudSyncPipeline,
		TestVersionGovernancePipeline
	]

## 前端测试套件（17 大系统 + 6 前端基建与边界套件 = 23；全域 86 后端与横切 + 23 前端 = 109 套件）
static func get_frontend_test_classes() -> Array:
	return [
		TestFE01AccountEntry, TestFE02MainHUD, TestFE03CharacterProgression,
		TestFE04CombatView, TestFE05EconomyTrade, TestFE06GachaWish,
		TestFE07QuestCausality, TestFE08MailSystem, TestFE09GuildSocial,
		TestFE10WorldMap, TestFE11MonsterEcology, TestFE12CraftingWorkshop,
		TestFE13GrimoireAuthoring, TestFE14NotificationBulletin, TestFE15SettingsCenter,
		TestFE16SystemSave, TestFE17MiscEdge,
		TestFrontendArchitectureAndBootstrapDomain, TestFrontendUIStateAndMock,
		TestFrontendInfrastructureDomain, TestFrontendBoundaryDomain,
		TestFrontendRobustness, TestFrontendErrorDomain
	]

## 全域测试套件（后端业务域 + 横切基础设施 + 前端 23 = 全域共 109 套件）
static func get_all_engine_test_classes() -> Array:
	var list := get_all_test_classes()
	list.append_array(get_frontend_test_classes())
	return list
