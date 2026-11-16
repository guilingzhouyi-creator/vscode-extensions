# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 全域测试注册表 (Test Registry)
# 文件路径: res://tests/test_registry.gd
# 职责: 统一注册后端业务领域、横切护栏与前端系统全量测试套件
# ==============================================================================
class_name TestRegistry
extends RefCounted

# 核心母机 13 大领域
const SuiteInventoryDomain = preload("res://tests/unit/domains/test_inventory.gd")
const SuitePhysicsDomain = preload("res://tests/unit/domains/test_physics_thermodynamics.gd")
const SuiteWorldNavigationDomain = preload("res://tests/unit/domains/test_world_navigation.gd")
const SuiteLatticeDomain = preload("res://tests/unit/domains/test_lattice_skill_book.gd")
const SuiteDeterministicDomain = preload("res://tests/unit/domains/test_deterministic_sandbox.gd")
const SuitePersistenceDomain = preload("res://tests/unit/domains/test_persistence_protocol.gd")
const SuiteLifecycleDomain = preload("res://tests/unit/domains/test_lifecycle_physiology.gd")
const SuiteMonsterDomain = preload("res://tests/unit/domains/test_monster_ecology.gd")
const SuiteQuestDomain = preload("res://tests/unit/domains/test_quest_causality.gd")
const SuiteCurrencyDomain = preload("res://tests/unit/domains/test_currency_economy.gd")
const SuiteTradingDomain = preload("res://tests/unit/domains/test_trading_logistics.gd")
const SuiteNPCDomain = preload("res://tests/unit/domains/test_npc_simulation.gd")
const SuiteSovereigntyDomain = preload("res://tests/unit/domains/test_sovereignty_realm.gd")

# 交互中枢、经济循环与首领引擎 10 大领域
const SuiteAccountDomain = preload("res://tests/unit/domains/test_account.gd")
const SuiteCharacterCreationDomain = preload("res://tests/unit/domains/test_character_creation.gd")
const SuitePotentialGrowthDomain = preload("res://tests/unit/domains/test_potential_growth.gd")
const SuiteGachaDomain = preload("res://tests/unit/domains/test_gacha_wish.gd")
const SuiteEquipmentLoadoutDomain = preload("res://tests/unit/domains/test_equipment_loadout.gd")
const SuiteWorkshopForgeDomain = preload("res://tests/unit/domains/test_workshop_forge.gd")
const SuiteAdminSandboxDomain = preload("res://tests/unit/domains/test_admin_sandbox.gd")
const SuiteChatCommandDomain = preload("res://tests/unit/domains/test_chat_command.gd")
const SuiteEliteMutationDomain = preload("res://tests/unit/domains/test_elite_mutation.gd")
const SuiteWorldBossDomain = preload("res://tests/unit/domains/test_world_boss.gd")

# 组织治理、空间移动与全域因果 12 大领域
const SuiteCDKeyVoucherDomain = preload("res://tests/unit/domains/test_cdkey_voucher.gd")
const SuiteMailSystemDomain = preload("res://tests/unit/domains/test_mail_system.gd")
const SuiteGameSettingsDomain = preload("res://tests/unit/domains/test_game_settings.gd")
const SuiteOrganizationGuildDomain = preload("res://tests/unit/domains/test_organization_guild.gd")
const SuiteCommissionQuestDomain = preload("res://tests/unit/domains/test_commission_quest.gd")
const SuiteIdentityDisguiseDomain = preload("res://tests/unit/domains/test_identity_disguise.gd")
const SuiteSpatialMerchantDomain = preload("res://tests/unit/domains/test_spatial_merchant.gd")
const SuiteSpatialMovementDomain = preload("res://tests/unit/domains/test_spatial_movement.gd")
const SuiteHardwareInputDomain = preload("res://tests/unit/domains/test_hardware_input.gd")
const SuiteGroundLootDomain = preload("res://tests/unit/domains/test_ground_loot.gd")
const SuiteMatterDisposalDomain = preload("res://tests/unit/domains/test_matter_disposal.gd")
const SuiteNarrativeOrchestrationDomain = preload("res://tests/unit/domains/test_narrative_orchestration.gd")

# 命名空间、灰度热更、国际化、音频、通知与遥测 8 大领域
const SuiteItemNamespaceRegistryDomain = preload("res://tests/unit/domains/test_item_namespace_registry.gd")
const SuiteFeatureToggleCanaryDomain = preload("res://tests/unit/domains/test_feature_toggle_canary.gd")
const SuiteLocalizationI18nDomain = preload("res://tests/unit/domains/test_localization_i18n.gd")
const SuiteEventDrivenAudioDomain = preload("res://tests/unit/domains/test_event_driven_audio.gd")
const SuiteNotificationRedDotDomain = preload("res://tests/unit/domains/test_notification_red_dot.gd")
const SuiteBulletinBoardMaintenanceDomain = preload("res://tests/unit/domains/test_bulletin_board_maintenance.gd")
const SuiteTelemetryAccountLifecycleDomain = preload("res://tests/unit/domains/test_telemetry_account_lifecycle.gd")
const SuiteItemStatisticsDomain = preload("res://tests/unit/domains/test_item_statistics.gd")
const SuiteEventExtractorDomain = preload("res://tests/unit/domains/test_event_extractor.gd")
const SuiteWorldStateDomain = preload("res://tests/unit/domains/test_world_state.gd")
const SuiteItemQualityDomain = preload("res://tests/unit/infrastructure/test_item_quality.gd")
const SuiteMagicTierDomain = preload("res://tests/unit/infrastructure/test_magic_tier.gd")
const SuiteNameRegistryDomain = preload("res://tests/unit/infrastructure/test_name_registry.gd")
const SuiteItemDescriptionDomain = preload("res://tests/unit/infrastructure/test_item_description.gd")
const SuiteEventProbabilityDomain = preload("res://tests/unit/infrastructure/test_event_probability.gd")
const SuiteEventDescriptionDomain = preload("res://tests/unit/infrastructure/test_event_description.gd")
const SuiteCopywritingDomain = preload("res://tests/unit/infrastructure/test_copywriting.gd")
const SuiteCdcDomain = preload("res://tests/unit/infrastructure/test_cdc.gd")
const SuiteTaskWorldEventDomain = preload("res://tests/unit/infrastructure/test_task_world_event.gd")
const SuiteCdkeyEligibilityDomain = preload("res://tests/unit/infrastructure/test_cdkey_eligibility.gd")
const SuiteRuleScopeDomain = preload("res://tests/unit/infrastructure/test_rule_scope.gd")
const SuiteFlowOrchestrationDomain = preload("res://tests/unit/infrastructure/test_flow_orchestration.gd")
const SuiteDynamicEconomyDomain = preload("res://tests/unit/infrastructure/test_dynamic_economy.gd")
const SuiteMagicRuleSystemDomain = preload("res://tests/unit/domains/test_magic_system.gd")
const SuiteWorldGatewayAndModeIsolation = preload("res://tests/unit/domains/test_world_gateway.gd")

# 专属集成流水线套件（全量测试口径覆盖）
const SuiteCombatTertiaryTimelinePipeline = preload("res://tests/integration/pipelines/test_combat_tertiary_timeline_pipeline.gd")
const SuiteItemAttributeAffixSystemPipeline = preload("res://tests/integration/pipelines/test_item_attribute_affix_system_pipeline.gd")
const SuiteCharacterCreationAndOpeningPipeline = preload("res://tests/integration/pipelines/test_character_creation_and_opening_pipeline.gd")
const SuitePrologueCoreAndPlaceholderPipeline = preload("res://tests/integration/pipelines/test_prologue_core_and_placeholder_pipeline.gd")
const SuiteNarrativeDagOrchestrationPipeline = preload("res://tests/integration/pipelines/test_narrative_dag_orchestration_pipeline.gd")
const SuiteGameLoopFSMPipeline = preload("res://tests/integration/pipelines/test_game_loop_fsm_pipeline.gd")

# 横切关注点：配置层护栏 + 架构护栏 + 契约注册表
const SuiteConfigurationGuard = preload("res://tests/guards/test_configuration_guard.gd")
const SuiteArchitectureGuardDomain = preload("res://tests/guards/test_architecture_guard.gd")
const SuiteFrontendBoundaryGuard = preload("res://tests/guards/test_frontend_boundary_guard.gd")
const SuiteContractRegistryPipeline = preload("res://tests/integration/pipelines/test_contract_registry_pipeline.gd")
const SuiteGameLifecyclePipeline = preload("res://tests/integration/pipelines/test_game_lifecycle_pipeline.gd")
const SuitePerformanceAndScalabilityPipeline = preload("res://tests/integration/pipelines/test_performance_and_scalability_pipeline.gd")
const SuiteCombatDualRandomAndTimelinePipeline = preload("res://tests/integration/pipelines/test_combat_dual_random_and_timeline_pipeline.gd")
const SuiteLogErrorBasePipeline = preload("res://tests/integration/pipelines/test_log_error_base_pipeline.gd")
const SuiteStructuredLogPipeline = preload("res://tests/integration/pipelines/test_structured_log_pipeline.gd")
const SuiteSaveDomainContracts = preload("res://tests/unit/infrastructure/test_save_domain_contracts.gd")
const SuiteSaveMigrationEngine = preload("res://tests/unit/infrastructure/test_save_migration_engine.gd")
const SuiteEditorHotReload = preload("res://tests/unit/infrastructure/test_editor_hot_reload.gd")
const SuiteSaveConsistencyRecovery = preload("res://tests/unit/infrastructure/test_save_consistency_recovery.gd")
const SuiteResourceLifecycleGovernance = preload("res://tests/unit/infrastructure/test_resource_lifecycle_governance.gd")
const SuiteBoundedCacheAndIdempotency = preload("res://tests/unit/infrastructure/test_bounded_cache_and_idempotency.gd")
const SuiteBackendRobustnessGuard = preload("res://tests/guards/test_backend_robustness_guard.gd")
const SuiteUnifiedLoggerService = preload("res://tests/unit/infrastructure/test_unified_logger_service.gd")
const SuiteLogCryptoAndBaseMessages = preload("res://tests/unit/infrastructure/test_log_crypto_and_base_messages.gd")
# EventBus 2.0 空间分发与零GC流水线
const SuiteEventBus2ZeroGCPipeline = preload("res://tests/integration/pipelines/test_event_bus2_zero_gc_pipeline.gd")
# 用户会话生命周期与主页HUD双轨同步流水线
const SuiteSessionLifecycleAndHudSyncPipeline = preload("res://tests/integration/pipelines/test_session_lifecycle_and_hud_sync_pipeline.gd")
# 灰度发布版本编排与底层动态更新流水线
const SuiteVersionGovernancePipeline = preload("res://tests/integration/pipelines/test_version_governance_pipeline.gd")
# 存档二次载入与复合鉴权双轨分流全链路流水线
const SuiteSaveSecondaryLoadAndDualStreamPipeline = preload("res://tests/integration/pipelines/test_save_secondary_load_and_dual_stream_pipeline.gd")
# 快照测试工程模式与全域数据流插桩全链路流水线
const SuiteSnapshotEngineeringHarnessPipeline = preload("res://tests/integration/pipelines/test_snapshot_engineering_harness_pipeline.gd")
# 双域储存架构与异步流式加载全链路流水线
const SuiteDualDomainStoragePipeline = preload("res://tests/integration/pipelines/test_dual_domain_storage_pipeline.gd")
# 统一资源索引中心与配置系统异步流式加载全链路流水线
const SuiteResourceCatalogAndAsyncConfigPipeline = preload("res://tests/integration/pipelines/test_resource_catalog_and_async_config_pipeline.gd")
# 演进 03: 高承压对象池与数据导向无头处理器架构
const SuiteObjectPoolAndBatchPipeline = preload("res://tests/unit/infrastructure/test_object_pool_and_batch_pipeline.gd")
# 演进 01: 超大型子域多配置表目录拆分与泛化路由架构
const SuiteConfigSubtablesDomain = preload("res://tests/unit/infrastructure/test_config_subtables.gd")
# 内存泄漏生命周期防御与引用解环流水线
const SuiteMemoryLeakLifecycle = preload("res://tests/unit/infrastructure/test_memory_leak_lifecycle.gd")
# 算法优化与瞬态分配消除流水线
const SuiteAlgorithmOptimizationPerformance = preload("res://tests/unit/infrastructure/test_algorithm_optimization_performance.gd")
# 账号注册与物理持久化流水线
const SuiteAccountRegistrationAndPersistence = preload("res://tests/integration/pipelines/test_account_registration_and_persistence.gd")
# 世界档案库与模式探针防越权网关流水线
const SuiteWorldArchiveAndAntiBridgePipeline = preload("res://tests/integration/pipelines/test_world_archive_and_anti_bridge_pipeline.gd")
# 世界内角色权威创建与时空装配流水线
const SuiteAuthoritativeCharacterCreationPipeline = preload("res://tests/integration/pipelines/test_authoritative_character_creation_pipeline.gd")
# 剧情MOD相对加载与因果扰动流水线
const SuiteNarrativeModAndPerturbationPipeline = preload("res://tests/integration/pipelines/test_narrative_mod_and_perturbation_pipeline.gd")
# MOD开发者SDK与联机安全净化流水线
const SuiteModSdkAndRealmSecurityPipeline = preload("res://tests/integration/pipelines/test_mod_sdk_and_realm_security_pipeline.gd")
# 单机显性MOD预检与命途UI多包列表适配流水线
const SuiteDestinyModPrecheckAndUiAdaptationPipeline = preload("res://tests/integration/pipelines/test_destiny_mod_precheck_and_ui_adaptation_pipeline.gd")
# 全目录MOD磁盘加载与Agent无头试玩流水线
const SuiteFullModDiskAndPlaythroughPipeline = preload("res://tests/integration/pipelines/test_full_mod_disk_and_playthrough_pipeline.gd")
# Agent交互试玩与伴侣观察总线流水线
const SuiteAgentInteractiveSessionAndCompanionPipeline = preload("res://tests/integration/pipelines/test_agent_interactive_session_and_companion_pipeline.gd")
# 主页HUD六大支柱与网关模式自适应全链路流水线
const SuiteAuthoritativeHudAndModeAdaptationPipeline = preload("res://tests/integration/pipelines/test_authoritative_hud_and_mode_adaptation_pipeline.gd")
# 主页HUD面向Agent标准数据包与动态行动空间流水线
const SuiteAgentHudSliceAndActionSpacePipeline = preload("res://tests/integration/pipelines/test_agent_hud_slice_and_action_space_pipeline.gd")
# Agent遥测高频推演基准与深度对象池流水线
const SuiteAgentTelemetryHighThroughputPipeline = preload("res://tests/integration/pipelines/test_agent_telemetry_high_throughput_pipeline.gd")
# 统一协议工厂与双轨信封及ESC系统菜单后端联动流水线
const SuiteUnifiedProtocolAndEscPipeline = preload("res://tests/integration/pipelines/test_unified_protocol_and_esc_pipeline.gd")
# MOD开发者SDK便利协议同步与推演流水线
const SuiteModSdkDeveloperErgonomicsPipeline = preload("res://tests/integration/pipelines/test_mod_sdk_developer_ergonomics_pipeline.gd")
# Agent全流程推演与开发者工作台流水线
const SuiteAgentFullPlaythroughAndWorkbenchPipeline = preload("res://tests/integration/pipelines/test_agent_full_playthrough_and_workbench_pipeline.gd")
# 高纯度二进制数据流与GameConfig双轨流水线
const SuiteBinaryConfigAndKdatPipeline = preload("res://tests/integration/test_binary_config_and_kdat_pipeline.gd")
# 全域非阻塞CG视频播放与剧情通用Hook流水线
const SuiteCutsceneHookAndPlaybackPipeline = preload("res://tests/integration/test_cutscene_hook_and_playback_pipeline.gd")
# 艺术资源寻址与环境裁决治理套件
const SuiteAssetPathResolver = preload("res://tests/unit/infrastructure/test_asset_path_resolver.gd")
# 全链路生命周期与ESC菜单后端双分流无头流水线
const SuiteFullLifecycleChainAndEscFlowPipeline = preload("res://tests/integration/pipelines/test_full_lifecycle_chain_and_esc_flow_pipeline.gd")
# 全链路前后端交互数据流契约与后端闭环改造无头验收流水线
const SuiteFullChainBackendProtocolAndLifecyclePipeline = preload("res://tests/integration/pipelines/test_full_chain_backend_protocol_and_lifecycle_pipeline.gd")
# 注册后端校验、原子持久化与二次重载插槽回灌流水线
const SuiteAccountRegistrationAndRealReloadPipeline = preload("res://tests/integration/pipelines/test_account_registration_and_real_reload_pipeline.gd")
# 客户端交互协议空间标准化与边界适配器验收流水线
const SuiteClientProtocolSpaceAndBoundaryPipeline = preload("res://tests/integration/pipelines/test_client_protocol_space_and_boundary_pipeline.gd")
# Tier 3 MOD 运行时差分加载、统一磁盘发现与结构化诊断验收流水线
const SuiteTier3ContentOverridePipeline = preload("res://tests/integration/pipelines/test_tier3_content_override_pipeline.gd")
# 零 MOD Fail-Closed 全链路验证流水线
const SuiteZeroModFailClosedPipeline = preload("res://tests/integration/pipelines/test_zero_mod_fail_closed_pipeline.gd")
# 纯插件化异世界 MOD 组合叠加与零泄漏隔离流水线
const SuitePluginModCompositionAndIsolation = preload("res://tests/integration/pipelines/test_plugin_mod_composition_and_isolation.gd")
# 真实前端场景与 RealServiceContainer 全链路无头推演流水线
const SuiteRealFrontendGatewayWorkbenchPrologue = preload("res://tests/integration/pipelines/test_real_frontend_gateway_workbench_prologue.gd")
# 世界档案 MOD 锁重入复原与漂移阻断验收流水线
const SuiteWorldModLockReentryAndDrift = preload("res://tests/integration/pipelines/test_world_mod_lock_reentry_and_drift.gd")
# 全端真实可点击UI闭环与锁安全端到端验收流水线
const SuiteRealUiChainAndLockSecurityPipeline = preload("res://tests/integration/pipelines/test_real_ui_chain_and_lock_security_pipeline.gd")
# MOD运行时全消费链路、真异步 UI 与 .kmod 资产安全闭环验收流水线
const SuiteModRuntimeAsyncAndAssetsPipeline = preload("res://tests/integration/pipelines/test_mod_runtime_async_and_assets_pipeline.gd")
# 全领域真实服务、基座去卡拉尔中性化、SDK强校验与门禁收口验收流水线
const SuiteNeutralitySdkAndGatesPipeline = preload("res://tests/integration/pipelines/test_neutrality_sdk_and_gates_pipeline.gd")
# 全真冷启动 app_root.tscn 与边界协议健壮性集成流水线
const SuiteRealColdStartBootstrapPipeline = preload("res://tests/integration/pipelines/test_real_cold_start_bootstrap_pipeline.gd")
# KMOD 归档多媒体解码与 Tier3 中立隔离集成流水线
const SuiteKmodAudioMediaAndTier3Pipeline = preload("res://tests/integration/pipelines/test_kmod_audio_media_and_tier3_pipeline.gd")

# 前端 17 大系统白模与表现层测试套件
const SuiteFE01AccountEntry = preload("res://tests/unit/frontend/test_fe_01_account_entry.gd")
const SuiteFE02MainHUD = preload("res://tests/unit/frontend/test_fe_02_main_hud.gd")
const SuiteFE03CharacterProgression = preload("res://tests/unit/frontend/test_fe_03_character_progression.gd")
const SuiteFE04CombatView = preload("res://tests/unit/frontend/test_fe_04_combat_view.gd")
const SuiteFE05EconomyTrade = preload("res://tests/unit/frontend/test_fe_05_economy_trade.gd")
const SuiteFE06GachaWish = preload("res://tests/unit/frontend/test_fe_06_gacha_wish.gd")
const SuiteFE07QuestCausality = preload("res://tests/unit/frontend/test_fe_07_quest_causality.gd")
const SuiteFE08MailSystem = preload("res://tests/unit/frontend/test_fe_08_mail_system.gd")
const SuiteFE09GuildSocial = preload("res://tests/unit/frontend/test_fe_09_guild_social.gd")
const SuiteFE10WorldMap = preload("res://tests/unit/frontend/test_fe_10_world_map.gd")
const SuiteFE11MonsterEcology = preload("res://tests/unit/frontend/test_fe_11_monster_ecology.gd")
const SuiteFE12CraftingWorkshop = preload("res://tests/unit/frontend/test_fe_12_crafting_workshop.gd")
const SuiteFE13GrimoireAuthoring = preload("res://tests/unit/frontend/test_fe_13_grimoire_authoring.gd")
const SuiteFE14NotificationBulletin = preload("res://tests/unit/frontend/test_fe_14_notification_bulletin.gd")
const SuiteFE15SettingsCenter = preload("res://tests/unit/frontend/test_fe_15_settings_center.gd")
const SuiteFE16SystemSave = preload("res://tests/unit/frontend/test_fe_16_system_save.gd")
const SuiteFE17MiscEdge = preload("res://tests/unit/frontend/test_fe_17_misc_edge.gd")
# 前端基础设施与横切领域测试套件
const TestFrontendArchitectureAndBootstrapDomain = preload("res://tests/unit/frontend/test_frontend_architecture_and_bootstrap.gd")
const TestFrontendUIStateAndMock = preload("res://tests/unit/frontend/test_frontend_ui_state_and_mock.gd")
const TestFrontendInfrastructureDomain = preload("res://tests/unit/frontend/test_frontend_infrastructure.gd")
const TestFrontendBoundaryDomain = preload("res://tests/unit/frontend/test_frontend_boundary.gd")
const SuiteFrontendRobustness = preload("res://tests/unit/frontend/test_frontend_robustness.gd")
const SuiteFrontendErrorDomain = preload("res://tests/unit/frontend/test_frontend_error_domain.gd")

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
		# 统一魔法规则模型与行动卡机制（新增 magic_system 域）
		TestMagicRuleSystemDomain,
		# 登录后世界入口模式隔离与状态架构完善
		TestWorldGatewayAndModeIsolation,
		# 业务流水线套件（评审收敛补登记；TestContractRegistryFactory 为
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
		TestResourceLifecycleGovernance, TestBoundedCacheAndIdempotency, TestBackendRobustnessGuard, TestUnifiedLoggerService, TestLogCryptoAndBaseMessages,
		TestEventBus2ZeroGCPipeline,
		TestSessionLifecycleAndHudSyncPipeline,
		TestVersionGovernancePipeline,
		TestSaveSecondaryLoadAndDualStreamPipeline,
		TestSnapshotEngineeringHarnessPipeline,
		TestDualDomainStoragePipeline,
		TestResourceCatalogAndAsyncConfigPipeline,
		TestObjectPoolAndBatchPipeline,
		TestConfigSubtablesDomain,
		TestMemoryLeakLifecycle,
		TestAlgorithmOptimizationPerformance,
		TestAccountRegistrationAndPersistence,
		TestWorldArchiveAndAntiBridgePipeline,
		TestAuthoritativeCharacterCreationPipeline,
		TestNarrativeModAndPerturbationPipeline,
		TestModSdkAndRealmSecurityPipeline,
		TestDestinyModPrecheckAndUiAdaptationPipeline,
		TestFullModDiskAndPlaythroughPipeline,
		TestAgentInteractiveSessionAndCompanionPipeline,
		TestAuthoritativeHudAndModeAdaptationPipeline,
		TestAgentHudSliceAndActionSpacePipeline,
		TestAgentTelemetryHighThroughputPipeline,
		TestUnifiedProtocolAndEscPipeline,
		TestModSdkDeveloperErgonomicsPipeline,
		TestAgentFullPlaythroughAndWorkbenchPipeline,
		TestBinaryConfigAndKdatPipeline,
		TestCutsceneHookAndPlaybackPipeline,
		TestAssetPathResolver,
		TestFullLifecycleChainAndEscFlowPipeline,
		TestFullChainBackendProtocolAndLifecyclePipeline,
		TestAccountRegistrationAndRealReloadPipeline,
		TestClientProtocolSpaceAndBoundaryPipeline,
		TestTier3ContentOverridePipeline,
		TestZeroModFailClosedPipeline,
		TestPluginModCompositionAndIsolation,
		TestRealFrontendGatewayWorkbenchPrologue,
		TestWorldModLockReentryAndDrift,
		TestRealUiChainAndLockSecurityPipeline,
		TestModRuntimeAsyncAndAssetsPipeline,
		TestNeutralitySdkAndGatesPipeline,
		TestRealColdStartBootstrapPipeline,
		TestKmodAudioMediaAndTier3Pipeline
	]

## 前端测试套件（17 大系统 + 6 前端基建与边界套件 = 23；全域 124 后端与横切 + 23 前端 = 147 套件）
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

## 全域测试套件（后端业务域 + 横切基础设施 + 前端 23 = 全域共 147 套件）
static func get_all_engine_test_classes() -> Array:
	var list := get_all_test_classes()
	list.append_array(get_frontend_test_classes())
	return list

## 校验套件注册表完整性与唯一性契约 (ARCH-FAC-001)
static func validate_registry_integrity() -> Dictionary:
	var backend_classes := get_all_test_classes()
	var frontend_classes := get_frontend_test_classes()
	var total_classes := get_all_engine_test_classes()
	var seen_classes: Dictionary = {}
	var duplicates: Array = []
	var null_entries: int = 0
	for tc in total_classes:
		if tc == null:
			null_entries += 1
			continue
		var script_id: int = tc.get_instance_id()
		if seen_classes.has(script_id):
			duplicates.append(tc)
		else:
			seen_classes[script_id] = true
	var is_valid: bool = (null_entries == 0) and (duplicates.is_empty())
	return {
		"valid": is_valid,
		"backend_count": backend_classes.size(),
		"frontend_count": frontend_classes.size(),
		"total_count": total_classes.size(),
		"null_count": null_entries,
		"duplicate_count": duplicates.size()
	}

## 按类引用或标识检索注册状态
static func is_test_class_registered(target_class) -> bool:
	if target_class == null:
		return false
	var target_id: int = target_class.get_instance_id()
	for tc in get_all_engine_test_classes():
		if tc != null and tc.get_instance_id() == target_id:
			return true
	return false
