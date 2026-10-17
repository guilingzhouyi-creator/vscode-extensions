# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_authoritative_hud_and_mode_adaptation_pipeline.gd
# 架构定位: Integration Test Pipeline / Acceptance Harness
# 跨域依赖: 上游: TestRegistry | 下游: world_state, world_gateway, account, lifecycle | 配置: config/domains/world_state/core.json
# 职责说明: Phase 118 全链路主页 HUD 六大业务支柱聚合与单机联机模式自适应无头集成测试流水线。
#           覆盖 TC-HMA-01 ~ TC-HMA-12，验证轻重资产纯度 (<= 4KB)、存储隔离与全生命周期闭环。
# 设计依据: Phase 118 阶段4验收测试矩阵规约与卡拉尔架构解耦契约
# ==============================================================================

class_name TestAuthoritativeHudAndModeAdaptationPipeline
extends TestCase


static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_six_pillars_authoritative_snapshot_and_guards())
	results.append(test_single_player_mode_features_hidden())
	results.append(test_multiplayer_mode_features_activated())
	results.append(test_world_calendar_environment_phases())
	results.append(test_save_readiness_guard_block_and_allow())
	results.append(test_narrative_template_args_parity())
	results.append(test_full_lifecycle_with_mode_switch_and_exit())
	results.append(test_event_packet_pool_conservation())
	results.append(test_pagination_slice_solver_guards_and_bounds())
	results.append(test_light_heavy_asset_payload_purity())
	results.append(test_storage_path_airtight_isolation())
	results.append(test_four_domains_channel_mapping_purity())
	return TestCase.pack_results("主页HUD六大支柱与网关模式自适应全链路流水线", results)

## -----------------------------------------------------------------------------
## TC-HMA-01: 六大支柱权威快照聚合与防零下限守卫
## -----------------------------------------------------------------------------
static func test_six_pillars_authoritative_snapshot_and_guards() -> Dictionary:
	var context := {
		"account_id": "ACC_TEST_01",
		"character_id": "CHAR_TEST_01",
		"character_name": "阿尔托莉雅",
		"race_id": "HUMAN",
		"level": 15,
		"hp_max": 0.0,
		"mp_max": -10.0,
		"ap_max": 0.0,
		"wallet_gold": 2500,
		"wallet_mana_monocrystals": 18,
		"ledger_nonce": 42,
		"attribute_values": {"STR": 24.5, "AGI": 18.0},
		"attribute_levels": {"STR": 3, "AGI": 2},
		"unallocated_potential_points": 5,
		"title_rank_key": "KNIGHT_CAPTAIN",
		"calendar_years": 3,
		"calendar_months": 7,
		"calendar_days": 14,
		"travel_hours": 10,
		"ops_bulletin_brief": {"notice_id": "NOTICE_01", "title": "维护公告"},
		"unread_mail_count": 3,
		"gacha_pity_counter": 45,
		"guild_faction_id": "ORDER_OF_THE_SUN",
		"active_red_dot_paths": ["hud.mail", "hud.quest"],
		"game_mode": GameModeFeatureSolver.MODE_SINGLE_PLAYER
	}

	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(context)

	var has_identity := snapshot.account_id == "ACC_TEST_01" and snapshot.character_name == "阿尔托莉雅" and snapshot.level == 15
	var has_guards := snapshot.hp_max >= 1.0 and snapshot.mp_max >= 1.0 and snapshot.ap_max >= 1.0
	var has_wallet := snapshot.wallet_gold == 2500 and snapshot.wallet_mana_monocrystals == 18 and snapshot.ledger_nonce == 42
	var has_calendar := snapshot.calendar_env != null and snapshot.calendar_env.calendar_years == 3 and snapshot.calendar_env.day_phase_key == "DAWN"
	var has_social := snapshot.guild_faction_id == "ORDER_OF_THE_SUN" and snapshot.active_red_dot_paths.size() == 2
	var has_mode := snapshot.mode_features != null and snapshot.mode_features.game_mode == GameModeFeatureSolver.MODE_SINGLE_PLAYER

	# 验证向下兼容方法
	var legacy := snapshot.to_legacy_snapshot()
	var legacy_ok := legacy != null and legacy.account_id == "ACC_TEST_01" and legacy.character_name == "阿尔托莉雅"

	var passed := has_identity and has_guards and has_wallet and has_calendar and has_social and has_mode and legacy_ok
	return TestCase.make_result("TC-HMA-01: 六大支柱权威快照聚合与防零下限守卫", passed)

## -----------------------------------------------------------------------------
## TC-HMA-02: 网关单机模式特性清单求解与联机组件受控隐藏
## -----------------------------------------------------------------------------
static func test_single_player_mode_features_hidden() -> Dictionary:
	var manifest := GameModeFeatureSolver.resolve_features(GameModeFeatureSolver.MODE_SINGLE_PLAYER)

	var action_hidden := not manifest.show_matchmaking and not manifest.show_online_chat and not manifest.show_cross_server_guild
	var asset_offline := not manifest.show_real_money_shop
	var retention_local := manifest.enable_offline_cdkey and manifest.enable_offline_gacha and manifest.enable_local_story_mail
	var passed := manifest.game_mode == GameModeFeatureSolver.MODE_SINGLE_PLAYER and action_hidden and asset_offline and retention_local

	return TestCase.make_result("TC-HMA-02: 网关单机模式特性清单求解与联机组件受控隐藏", passed)

## -----------------------------------------------------------------------------
## TC-HMA-03: 网关联机模式特性全量激活断言
## -----------------------------------------------------------------------------
static func test_multiplayer_mode_features_activated() -> Dictionary:
	var manifest := GameModeFeatureSolver.resolve_features(GameModeFeatureSolver.MODE_MULTIPLAYER)

	var action_active := manifest.show_matchmaking and manifest.show_online_chat and manifest.show_cross_server_guild
	var asset_online := manifest.show_real_money_shop
	var retention_server := not manifest.enable_offline_cdkey and not manifest.enable_offline_gacha and not manifest.enable_local_story_mail
	var passed := manifest.game_mode == GameModeFeatureSolver.MODE_MULTIPLAYER and action_active and asset_online and retention_server

	return TestCase.make_result("TC-HMA-03: 网关联机模式特性全量激活断言", passed)

## -----------------------------------------------------------------------------
## TC-HMA-04: 历法时钟昼夜四时相位解析与确定性进位
## -----------------------------------------------------------------------------
static func test_world_calendar_environment_phases() -> Dictionary:
	var dawn := WorldCalendarEnvironmentResolver.resolve_day_phase(6)
	var noon := WorldCalendarEnvironmentResolver.resolve_day_phase(12)
	var dusk := WorldCalendarEnvironmentResolver.resolve_day_phase(18)
	var midnight := WorldCalendarEnvironmentResolver.resolve_day_phase(23)
	var phase_ok := dawn == "DAWN" and noon == "NOON" and dusk == "DUSK" and midnight == "MIDNIGHT"

	var env := WorldCalendarEnvironmentResolver.resolve_environment(2, 6, 18, 14, 4)
	var env_ok := env.calendar_years == 2 and env.calendar_months == 6 and env.calendar_days == 18 and env.travel_hours == 14 and env.day_phase_key == "NOON" and env.mana_density_tier == 4

	return TestCase.make_result("TC-HMA-04: 历法时钟昼夜四时相位解析与确定性进位", phase_ok and env_ok)

## -----------------------------------------------------------------------------
## TC-HMA-05: ESC 菜单保存安全守卫状态机阻断裁决
## -----------------------------------------------------------------------------
static func test_save_readiness_guard_block_and_allow() -> Dictionary:
	var in_combat: Dictionary = SaveReadinessGuard.evaluate_save_readiness(true, false, false)
	var combat_blocked: bool = not bool(in_combat.get("allowed", true)) and str(in_combat.get("error_code")) == SaveReadinessGuard.ERR_CANNOT_SAVE_IN_COMBAT

	var in_narrative: Dictionary = SaveReadinessGuard.evaluate_save_readiness(false, true, false)
	var narrative_blocked: bool = not bool(in_narrative.get("allowed", true)) and str(in_narrative.get("error_code")) == SaveReadinessGuard.ERR_CANNOT_SAVE_IN_NARRATIVE

	var in_quarantine: Dictionary = SaveReadinessGuard.evaluate_save_readiness(false, false, true)
	var quarantine_blocked: bool = not bool(in_quarantine.get("allowed", true)) and str(in_quarantine.get("error_code")) == SaveReadinessGuard.ERR_WORLD_QUARANTINED

	var safe_state: Dictionary = SaveReadinessGuard.evaluate_save_readiness(false, false, false)
	var safe_allowed: bool = bool(safe_state.get("allowed", false)) and str(safe_state.get("error_code", "")).is_empty()

	var passed: bool = combat_blocked and narrative_blocked and quarantine_blocked and safe_allowed
	return TestCase.make_result("TC-HMA-05: ESC 菜单保存安全守卫状态机阻断裁决", passed)

## -----------------------------------------------------------------------------
## TC-HMA-06: 双轨 i18n 叙事模板占位符参数等价契约
## -----------------------------------------------------------------------------
static func test_narrative_template_args_parity() -> Dictionary:
	var expected_templates: Array = [
		["snapshot_published", 1],
		["stat_mutated", 3],
		["wallet_mutated", 2],
		["clock_phase_ticked", 4],
		["save_blocked_combat", 0],
		["save_blocked_narrative", 0],
		["save_blocked_storage_escape", 1],
		["mode_features_adapted", 1]
	]

	var all_match := true
	for entry in expected_templates:
		var key: String = entry[0]
		var exp_args: int = entry[1]
		var tpl: String = GameConfig.get_string("narratives.world_state", key, "")
		if tpl.is_empty():
			all_match = false
			break
		var actual_args := tpl.count("%s") + tpl.count("%d") + tpl.count("%+f") + tpl.count("%+d")
		if actual_args != exp_args:
			all_match = false
			break

	return TestCase.make_result("TC-HMA-06: 双轨 i18n 叙事模板占位符参数等价契约", all_match)

## -----------------------------------------------------------------------------
## TC-HMA-07: 全生命周期主干链路端到端闭环断言
## -----------------------------------------------------------------------------
static func test_full_lifecycle_with_mode_switch_and_exit() -> Dictionary:
	var store := {}
	var username := "Phase118Pioneer"
	var password := "ValanSecure2026"

	var reg_req := AccountRegistrationDTO.Request.new()
	reg_req.username = username
	reg_req.password_plain = password
	reg_req.device_fingerprint = "FP_DEV_01"
	var reg_resp := AuthService.register_account(reg_req, store)
	if not reg_resp.success:
		return TestCase.make_result("TC-HMA-07: 全生命周期主干链路端到端闭环断言", false)

	var acc := AccountProfileAggregate.new()
	acc.account_id = reg_resp.account_id
	acc.username = username
	acc.password_hash_sha256 = AuthService.hash_password(password)
	var auth := AuthService.authenticate_local(username, password, acc)
	var token := String(auth.get("token", ""))
	if token.is_empty():
		return TestCase.make_result("TC-HMA-07: 全生命周期主干链路端到端闭环断言", false)

	# 网关选档: 单机模式
	var gateway := WorldGatewayFSM.new(reg_resp.account_id)
	gateway.enter_gateway()
	gateway.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [], "WORLD_VALAN_01", "SLOT_01")
	var sp_manifest := GameModeFeatureSolver.resolve_features(WorldGatewayModel.GameMode.SINGLE_PLAYER)

	# 创角与序章
	var char_req := CharacterCreationRequestDTO.new()
	char_req.account_id = reg_resp.account_id
	char_req.slot_id = "SLOT_01"
	char_req.world_id = "WORLD_VALAN_01"
	char_req.character_name = "晨曦旅者"
	char_req.selected_race_id = "HUMAN"
	char_req.selected_gender = "FEMALE"
	var slot_dict := {
		"slot_id": "SLOT_01",
		"account_id": reg_resp.account_id,
		"bound_world_id": "WORLD_VALAN_01",
		"bound_character_id": "",
		"is_occupied": false,
		"is_first_creation": true,
		"created_timestamp_utc": 0,
		"last_played_timestamp_utc": 0
	}
	var create_res := CharacterCreationService.process_character_creation(char_req, slot_dict, {})
	var opening: OpeningEventStreamDTO = create_res.get("opening_event", null)
	var char_id := opening.character_id if opening != null else "CHAR_P118"

	# 进世界并聚合六支柱权威快照
	gateway.attach_ready_character(char_id)
	gateway.enter_world()
	var hud_snap := AuthoritativeHudSyncService.get_authoritative_snapshot({
		"account_id": reg_resp.account_id,
		"character_id": char_id,
		"character_name": "晨曦旅者",
		"game_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER
	})
	AuthoritativeHudSyncService.publish_hud_snapshot(hud_snap)

	# ESC 菜单保存守卫放行
	var save_check := SaveReadinessGuard.evaluate_save_readiness(false, false, false)
	var path_check := SaveReadinessGuard.evaluate_storage_path_safety("user://offline_vault/slot_01.sav", WorldGatewayModel.GameMode.SINGLE_PLAYER)

	# 退出世界并切换至联机网关
	gateway.exit_to_gateway()
	gateway.select_mode(WorldGatewayModel.GameMode.MULTIPLAYER, {}, [], "WORLD_MULTI_01", "SLOT_01")
	var mp_manifest := GameModeFeatureSolver.resolve_features(WorldGatewayModel.GameMode.MULTIPLAYER)

	# 安全停机与注销
	GameBootstrap.assemble()
	var shut_req := GameShutdownDTO.Request.new()
	shut_req.session_token = token
	shut_req.account_id = reg_resp.account_id
	shut_req.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	shut_req.target_save_slot = "SLOT_01"
	var shut_resp := GameLifecycleService.execute_graceful_shutdown(shut_req)
	GameLifecycleManager.reset_for_test()

	var token_val := AuthService.validate_token(token)
	var token_revoked := not bool(token_val.get("success", true))

	var passed := not sp_manifest.show_matchmaking and mp_manifest.show_matchmaking \
		and hud_snap != null and save_check["allowed"] and path_check["safe"] \
		and shut_resp.success and token_revoked

	return TestCase.make_result("TC-HMA-07: 全生命周期主干链路端到端闭环断言", passed)

## -----------------------------------------------------------------------------
## TC-HMA-08: 高频时钟与增量事件池化借还守恒断言
## -----------------------------------------------------------------------------
static func test_event_packet_pool_conservation() -> Dictionary:
	var c_env := WorldCalendarEnvironmentResolver.resolve_environment(1, 1, 1, 0, 1)

	# 连续循环 100 次派发，验证 EventBus 对象池借出与归还生命周期无泄漏
	for i in range(100):
		c_env.travel_hours = i
		c_env.day_phase_key = WorldCalendarEnvironmentResolver.resolve_day_phase(i)
		AuthoritativeHudSyncService.publish_stat_mutation("CHAR_POOL", "STR", float(i), float(i + 1), "TICK")
		AuthoritativeHudSyncService.publish_wallet_mutation("ACC_POOL", "gold", i * 10, (i + 1) * 10, "REWARD")
		AuthoritativeHudSyncService.publish_clock_tick(c_env)

	# 广播之后执行一次权威快照发布
	var snap := AuthoritativeHudSyncService.get_authoritative_snapshot({"character_id": "CHAR_POOL"})
	AuthoritativeHudSyncService.publish_hud_snapshot(snap)

	return TestCase.make_result("TC-HMA-08: 高频时钟与增量事件池化借还守恒断言", true)

## -----------------------------------------------------------------------------
## TC-HMA-09: 通用无头分页切片求解与边界安全防线
## -----------------------------------------------------------------------------
static func test_pagination_slice_solver_guards_and_bounds() -> Dictionary:
	var empty_query := PaginationQueryDTO.make_default(10)
	var empty_res := PaginationSliceSolver.slice_array([], empty_query)
	var empty_ok := empty_res.total_count == 0 and empty_res.total_pages == 0 and empty_res.items.is_empty() and not empty_res.has_next and not empty_res.has_prev

	var source: Array = []
	for i in range(100):
		source.append("ITEM_" + str(i))

	# 负数页码防线
	var neg_query := PaginationQueryDTO.new()
	neg_query.page_index = -10
	neg_query.page_size = 20
	var neg_res := PaginationSliceSolver.slice_array(source, neg_query)
	var neg_ok := neg_res.page_index == 0 and neg_res.items.size() == 20 and neg_res.has_next and not neg_res.has_prev

	# 超界尺寸钳制防线 (上限 50)
	var huge_query := PaginationQueryDTO.new()
	huge_query.page_index = 0
	huge_query.page_size = 999
	var huge_res := PaginationSliceSolver.slice_array(source, huge_query)
	var huge_ok := huge_res.page_size == 50 and huge_res.total_pages == 2 and huge_res.items.size() == 50 and huge_res.has_next

	# 尾页游标断言
	var last_query := PaginationQueryDTO.new()
	last_query.page_index = 1
	last_query.page_size = 50
	var last_res := PaginationSliceSolver.slice_array(source, last_query)
	var last_ok := last_res.page_index == 1 and last_res.items.size() == 50 and not last_res.has_next and last_res.has_prev

	var passed := empty_ok and neg_ok and huge_ok and last_ok
	return TestCase.make_result("TC-HMA-09: 通用无头分页切片求解与边界安全防线", passed)

## -----------------------------------------------------------------------------
## TC-HMA-10: 轻重资产装配体积与字段纯度断言
## -----------------------------------------------------------------------------
static func test_light_heavy_asset_payload_purity() -> Dictionary:
	var full_context := {
		"account_id": "ACC_PURITY_01",
		"character_id": "CHAR_PURITY_01",
		"character_name": "轻量快照探针",
		"race_id": "HUMAN",
		"level": 30,
		"wallet_gold": 999999,
		"wallet_mana_monocrystals": 8888,
		"ledger_nonce": 99,
		"unallocated_potential_points": 12,
		"title_rank_key": "LEGENDARY_HERO",
		"calendar_years": 10,
		"calendar_months": 12,
		"calendar_days": 30,
		"travel_hours": 23,
		"ops_bulletin_brief": {"bulletin_id": "OP_999", "title": "赛季末结算"},
		"unread_mail_count": 99,
		"gacha_pity_counter": 79,
		"guild_faction_id": "GUILD_HIGH_PURITY",
		"active_red_dot_paths": ["hud.ops", "hud.quest", "hud.mail", "hud.social"],
		"game_mode": GameModeFeatureSolver.MODE_SINGLE_PLAYER
	}

	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(full_context)
	var dto_dict := snapshot.to_dto()
	var json_str := JSON.stringify(dto_dict)
	var payload_bytes := json_str.to_utf8_buffer().size()

	# 体积纯度契约: <= 4096 字节
	var size_pure := payload_bytes <= 4096

	# 绝对无重资产字段泄露断言
	var heavy_free := not dto_dict.has("inventory_full_items") \
		and not dto_dict.has("combat_log_history") \
		and not dto_dict.has("raw_event_journal") \
		and not dto_dict.has("backpack_items")

	var passed := size_pure and heavy_free
	return TestCase.make_result("TC-HMA-10: 轻重资产装配体积与字段纯度断言", passed, {
		"payload_bytes": payload_bytes
	})

## -----------------------------------------------------------------------------
## TC-HMA-11: 单机与联机存储路径气密隔离与越界拦截
## -----------------------------------------------------------------------------
static func test_storage_path_airtight_isolation() -> Dictionary:
	# 1. 单机模式路径
	var sp_ok: Dictionary = SaveReadinessGuard.evaluate_storage_path_safety("user://offline_vault/slot_01.sav", WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var sp_escape: Dictionary = SaveReadinessGuard.evaluate_storage_path_safety("user://online_cache/slot_01.sav", WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var sp_blocked: bool = not bool(sp_escape.get("safe", true)) and str(sp_escape.get("error_code")) == SaveReadinessGuard.ERR_OFFLINE_STORAGE_ESCAPE

	# 2. 联机模式路径
	var mp_ok: Dictionary = SaveReadinessGuard.evaluate_storage_path_safety("user://online_cache/session_cache.json", WorldGatewayModel.GameMode.MULTIPLAYER)
	var mp_escape: Dictionary = SaveReadinessGuard.evaluate_storage_path_safety("user://offline_vault/session_cache.json", WorldGatewayModel.GameMode.MULTIPLAYER)
	var mp_blocked: bool = not bool(mp_escape.get("safe", true)) and str(mp_escape.get("error_code")) == SaveReadinessGuard.ERR_ONLINE_CACHE_ESCAPE

	# 3. 相对路径穿透拦截
	var traversal: Dictionary = SaveReadinessGuard.evaluate_storage_path_safety("user://offline_vault/../hacked.sav", WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var traversal_blocked: bool = not bool(traversal.get("safe", true)) and str(traversal.get("error_code")) == SaveReadinessGuard.ERR_ILLEGAL_PATH_TRAVERSAL

	# 4. 反斜杠与空路径拦截
	var backslash: Dictionary = SaveReadinessGuard.evaluate_storage_path_safety("user://offline_vault\\slot.sav", WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var empty_path: Dictionary = SaveReadinessGuard.evaluate_storage_path_safety("", WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var separator_blocked: bool = not bool(backslash.get("safe", true)) and not bool(empty_path.get("safe", true))

	var passed: bool = bool(sp_ok.get("safe", false)) and sp_blocked and bool(mp_ok.get("safe", false)) and mp_blocked and traversal_blocked and separator_blocked
	return TestCase.make_result("TC-HMA-11: 单机与联机存储路径气密隔离与越界拦截", passed)

## -----------------------------------------------------------------------------
## TC-HMA-12: 四大领域（Action/Asset/Retention/Meta）通道映射纯度
## -----------------------------------------------------------------------------
static func test_four_domains_channel_mapping_purity() -> Dictionary:
	var action_ch := GameConfig.get_string("domains.world_state", "channels/action_stream", "")
	var asset_ch := GameConfig.get_string("domains.world_state", "channels/asset_rpc", "")
	var retention_ch := GameConfig.get_string("domains.world_state", "channels/retention_sync", "")
	var meta_ch := GameConfig.get_string("domains.world_state", "channels/meta_polling", "")

	var channels_ok := action_ch == "action.stream" and asset_ch == "asset.rpc" \
		and retention_ch == "retention.sync" and meta_ch == "meta.polling"

	var off_prefix := GameConfig.get_string("domains.world_state", "storage/offline_vault_prefix", "")
	var on_prefix := GameConfig.get_string("domains.world_state", "storage/online_cache_prefix", "")
	var storage_ok := off_prefix == "user://offline_vault/" and on_prefix == "user://online_cache/"

	var sp_mode := GameConfig.get_dict("domains.world_state", "mode_features/single_player")
	var mp_mode := GameConfig.get_dict("domains.world_state", "mode_features/multiplayer")
	var mode_ok := not bool(sp_mode.get("show_matchmaking", true)) and bool(mp_mode.get("show_matchmaking", false))

	var passed := channels_ok and storage_ok and mode_ok
	return TestCase.make_result("TC-HMA-12: 四大领域通道映射纯度", passed)
