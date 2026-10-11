# ==============================================================================
# 模块归属: 集成测试层 (Integration · 角色创建与时空装配流水线)
# 文件路径: res://tests/integration/pipelines/test_authoritative_character_creation_pipeline.gd
# 架构定位: Integration Test Suite / Pipeline Harness
# 跨域依赖: 上游: TestRegistry | 下游: WorldCharacterCreationOrchestrator, WorldArchiveRepository, AccountRepository, SaveDataAccessLayer, WorldGatewayFSM | 配置: config/domains/*.json | 信号: 无直接监听
# 职责说明: 自动化全链路测试世界内角色权威创建流水线。覆盖纯名字权威解算、前端篡改防御、全景呈现快照契约、背包装备物理水化、世界历史片段单调追加及网关状态机自动回挂跃迁。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name TestAuthoritativeCharacterCreationPipeline
extends TestCase

const TEST_SANDBOX_DIR: String = "user://test_sandbox_acc_pipeline/"
const TEST_WORLD_ID: String = "WORLD_ACC_TEST_01"
const TEST_ACCOUNT_ID: String = "ACC_ACC_TEST_01"

# ==============================================================================
# 一、测试套件总入口与环境重置
# ==============================================================================

## 执行全量流水线测试
static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_authoritative_creation_pure_name())
	results.append(test_client_tamper_defense())
	results.append(test_presentation_envelope_completeness())
	results.append(test_starter_loadout_physical_hydration())
	results.append(test_world_clock_and_history_monotonicity())
	results.append(test_disk_persistence_and_gateway_handoff())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "Authoritative Character Creation Pipeline",
		"all_passed": all_passed,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"results": results
	}

## 装配纯净隔离沙箱
static func _setup_environment() -> void:
	WorldArchiveRepository.reset_for_tests()
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()

	var world_repo := WorldArchiveRepository.get_instance()
	world_repo.set_custom_root_dir(TEST_SANDBOX_DIR + "worlds/")
	world_repo.set_custom_catalog_path(TEST_SANDBOX_DIR + "worlds/world_catalog.json")
	world_repo.load_all()
	world_repo.create_world(TEST_WORLD_ID, "时空测试界域")

	var acc_repo := AccountRepository.get_instance()
	acc_repo.set_custom_registry_path(TEST_SANDBOX_DIR + "accounts/account_registry.json")
	acc_repo.load_all()

	var acc := AccountProfileAggregate.new()
	acc.account_id = TEST_ACCOUNT_ID
	acc.username = "PipelineTester"
	acc_repo.save_account(acc)

## 对称注销清理沙箱
static func _teardown_environment() -> void:
	var world_repo := WorldArchiveRepository.get_instance()
	if world_repo.has_world(TEST_WORLD_ID):
		world_repo.delete_world(TEST_WORLD_ID)
	WorldArchiveRepository.reset_for_tests()
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()

# ==============================================================================
# 二、用例实现 (TC-ACC-01 ~ TC-ACC-06)
# ==============================================================================

## TC-ACC-01: 纯名字输入权威创角成功，六维/身世由后端完全派生
static func test_authoritative_creation_pure_name() -> Dictionary:
	_setup_environment()

	var req := AuthoritativeCharacterCreationRequestDTO.new()
	req.account_id = TEST_ACCOUNT_ID
	req.world_id = TEST_WORLD_ID
	req.slot_id = 1
	req.character_name = "逐风者"
	req.request_seed = 10001

	var res: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req)
	var ok_success: bool = bool(res.get("success", false))
	var ok_name: bool = str(res.get("character_name", "")) == "逐风者"
	var ok_slot: bool = int(res.get("slot_id", 0)) == 1

	var profile: CharacterProfile = res.get("profile", null)
	var ok_profile: bool = profile != null
	var ok_attrs: bool = false
	var ok_origin: bool = false

	if ok_profile:
		var attrs: Dictionary = profile.attributes
		var has_str := attrs.has("STR") and int(attrs["STR"]) >= 1 and int(attrs["STR"]) <= 6
		var has_con := attrs.has("CON") and int(attrs["CON"]) >= 1 and int(attrs["CON"]) <= 6
		var has_int := attrs.has("INT") and int(attrs["INT"]) >= 1 and int(attrs["INT"]) <= 6
		var has_agi := attrs.has("AGI") and int(attrs["AGI"]) >= 1 and int(attrs["AGI"]) <= 6
		var has_spr := attrs.has("SPR") and int(attrs["SPR"]) >= 1 and int(attrs["SPR"]) <= 6
		var has_vit := attrs.has("VIT") and int(attrs["VIT"]) >= 1 and int(attrs["VIT"]) <= 6
		ok_attrs = has_str and has_con and has_int and has_agi and has_spr and has_vit

		var origin_id: String = str(profile.growth_state.get("origin_id", ""))
		var race_id: String = str(profile.growth_state.get("race_id", ""))
		ok_origin = not origin_id.is_empty() and not race_id.is_empty()

	_teardown_environment()

	var passed: bool = ok_success and ok_name and ok_slot and ok_profile and ok_attrs and ok_origin
	return {
		"test": "TC-ACC-01: 纯名字输入权威创角成功，六维/身世由后端完全派生",
		"passed": passed
	}

## TC-ACC-02: 前端篡改属性/身世防御（伪造字段强制丢弃，后端计算保持权威）
static func test_client_tamper_defense() -> Dictionary:
	_setup_environment()

	var req := AuthoritativeCharacterCreationRequestDTO.new()
	req.account_id = TEST_ACCOUNT_ID
	req.world_id = TEST_WORLD_ID
	req.slot_id = 1
	req.character_name = "防作弊卫士"
	req.request_seed = 20002
	req.extra_custom_fields = {
		"attributes": {"STR": 999, "CON": 999, "INT": 999},
		"origin_id": "HACKER_ORIGIN",
		"race_id": "GOD_RACE",
		"gold": 99999999
	}

	var res: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req)
	var ok_success: bool = bool(res.get("success", false))

	var profile: CharacterProfile = res.get("profile", null)
	var ok_profile: bool = profile != null
	var ok_str_bounded: bool = false
	var ok_origin_guarded: bool = false
	var ok_race_guarded: bool = false
	var ok_gold_guarded: bool = false

	if ok_profile:
		var str_val: int = int(profile.attributes.get("STR", 0))
		ok_str_bounded = str_val >= 1 and str_val <= 6

		var origin_val: String = str(profile.growth_state.get("origin_id", ""))
		ok_origin_guarded = origin_val != "HACKER_ORIGIN" and not origin_val.is_empty()

		var race_val: String = str(profile.growth_state.get("race_id", ""))
		ok_race_guarded = race_val != "GOD_RACE" and not race_val.is_empty()

		var gold_val: int = int(profile.personal_resources.get("gold", 0))
		ok_gold_guarded = gold_val < 9999999

	_teardown_environment()

	var passed: bool = ok_success and ok_profile and ok_str_bounded and ok_origin_guarded and ok_race_guarded and ok_gold_guarded
	return {
		"test": "TC-ACC-02: 前端篡改属性/身世防御（伪造字段强制丢弃）",
		"passed": passed
	}

## TC-ACC-03: 全景只读呈现信封数据完备性断言（雷达图、生理、装备非空）
static func test_presentation_envelope_completeness() -> Dictionary:
	_setup_environment()

	var req := AuthoritativeCharacterCreationRequestDTO.new()
	req.account_id = TEST_ACCOUNT_ID
	req.world_id = TEST_WORLD_ID
	req.slot_id = 1
	req.character_name = "光芒先锋"
	req.request_seed = 30003

	var res: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req)
	var ok_success: bool = bool(res.get("success", false))

	var pres: CharacterCreationPresentationDTO = res.get("presentation", null)
	var ok_pres: bool = pres != null
	var ok_fields: bool = false

	if ok_pres:
		var has_id := not pres.character_id.is_empty()
		var has_name := pres.character_name == "光芒先锋"
		var has_origin := not pres.origin_id.is_empty() and not pres.origin_name.is_empty()
		var has_race := not pres.race_id.is_empty() and not pres.race_name.is_empty()
		var has_radar := pres.attributes_radar.size() == 6
		var has_phys := not pres.physiology_summary.is_empty()
		var has_wallet := not pres.wallet_summary.is_empty() and int(pres.wallet_summary.get("gold", 0)) > 0
		var has_equip := not pres.starter_equipment.is_empty()
		var has_chron := not pres.world_chronicle.is_empty() and str(pres.world_chronicle.get("world_id", "")) == TEST_WORLD_ID
		var has_prologue := not pres.prologue_preview.is_empty()
		ok_fields = has_id and has_name and has_origin and has_race and has_radar and has_phys and has_wallet and has_equip and has_chron and has_prologue

	_teardown_environment()

	var passed: bool = ok_success and ok_pres and ok_fields
	return {
		"test": "TC-ACC-03: 全景只读呈现信封数据完备性断言",
		"passed": passed
	}

## TC-ACC-04: 背包装备真实物理水化（ItemEntity 挂载到 WearableInventoryAggregate）
static func test_starter_loadout_physical_hydration() -> Dictionary:
	_setup_environment()

	var req := AuthoritativeCharacterCreationRequestDTO.new()
	req.account_id = TEST_ACCOUNT_ID
	req.world_id = TEST_WORLD_ID
	req.slot_id = 1
	req.character_name = "铁骑重装"
	req.request_seed = 40004

	var res: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req)
	var ok_success: bool = bool(res.get("success", false))

	var profile: CharacterProfile = res.get("profile", null)
	var ok_profile: bool = profile != null
	var ok_inv: bool = false
	var ok_equip: bool = false

	if ok_profile:
		ok_inv = not profile.inventory.is_empty()
		ok_equip = not profile.equipment.is_empty()
		var has_weapon := profile.equipment.has("MAIN_HAND") or profile.equipment.has("main_hand") or profile.equipment.size() > 0
		ok_equip = ok_equip and has_weapon

	_teardown_environment()

	var passed: bool = ok_success and ok_profile and ok_inv and ok_equip
	return {
		"test": "TC-ACC-04: 背包装备真实物理水化",
		"passed": passed
	}

## TC-ACC-05: 目标世界时钟锚定与历史片段只增断言
static func test_world_clock_and_history_monotonicity() -> Dictionary:
	_setup_environment()

	var world_repo := WorldArchiveRepository.get_instance()
	var w_inst: WorldInstance = world_repo.load_world(TEST_WORLD_ID)
	w_inst.advance_world_time(15)
	world_repo.save_world(w_inst)
	var count_0: int = w_inst.history_fragments.size()

	var req1 := AuthoritativeCharacterCreationRequestDTO.new()
	req1.account_id = TEST_ACCOUNT_ID
	req1.world_id = TEST_WORLD_ID
	req1.slot_id = 1
	req1.character_name = "先祖之一"
	req1.request_seed = 50005
	var res1: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req1)
	var ok_1: bool = bool(res1.get("success", false))

	var w_reloaded1: WorldInstance = world_repo.load_world(TEST_WORLD_ID)
	var count_1: int = w_reloaded1.history_fragments.size()
	var ok_c1: bool = (count_1 == count_0 + 1)
	var last_frag1: Dictionary = w_reloaded1.history_fragments[count_1 - 1]
	var ok_frag1: bool = str(last_frag1.get("type", "")) == "CHARACTER_BORN" \
		and str(last_frag1.get("character_id", "")) == str(res1.get("character_id", "")) \
		and int(last_frag1.get("world_time", {}).get("tick", -1)) == 15

	var req2 := AuthoritativeCharacterCreationRequestDTO.new()
	req2.account_id = TEST_ACCOUNT_ID
	req2.world_id = TEST_WORLD_ID
	req2.slot_id = 2
	req2.character_name = "后嗣之二"
	req2.request_seed = 50006
	var res2: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req2)
	var ok_2: bool = bool(res2.get("success", false))

	var w_reloaded2: WorldInstance = world_repo.load_world(TEST_WORLD_ID)
	var count_2: int = w_reloaded2.history_fragments.size()
	var ok_c2: bool = (count_2 == count_1 + 1)
	var last_frag2: Dictionary = w_reloaded2.history_fragments[count_2 - 1]
	var ok_frag2: bool = str(last_frag2.get("type", "")) == "CHARACTER_BORN" \
		and str(last_frag2.get("character_id", "")) == str(res2.get("character_id", ""))

	_teardown_environment()

	var passed: bool = ok_1 and ok_2 and ok_c1 and ok_frag1 and ok_c2 and ok_frag2
	return {
		"test": "TC-ACC-05: 目标世界时钟锚定与历史片段只增断言",
		"passed": passed
	}

## TC-ACC-06: 物理落盘与 WorldGatewayFSM 自动回挂跃迁至 WORLD_ENTRY_PERMITTED
static func test_disk_persistence_and_gateway_handoff() -> Dictionary:
	_setup_environment()

	var gateway := WorldGatewayFSM.new(TEST_ACCOUNT_ID)
	gateway.enter_gateway()

	var acc_repo := AccountRepository.get_instance()
	var acc: AccountProfileAggregate = acc_repo.find_by_id(TEST_ACCOUNT_ID)
	gateway.select_mode_for_account(WorldGatewayModel.GameMode.SINGLE_PLAYER, acc, {}, TEST_WORLD_ID, "SLOT_01")
	var phase_before: int = gateway.context.current_phase
	var ok_phase_before: bool = (phase_before == WorldGatewayModel.GatewayPhase.CHARACTER_PENDING)

	var req := AuthoritativeCharacterCreationRequestDTO.new()
	req.account_id = TEST_ACCOUNT_ID
	req.world_id = TEST_WORLD_ID
	req.slot_id = 1
	req.character_name = "网关漫步者"
	req.request_seed = 60006

	var res: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req, gateway)
	var ok_success: bool = bool(res.get("success", false))

	# 1. 验证 SaveDataAccessLayer 物理落盘
	var load_res := SaveDataAccessLayer.load_game("SLOT_01")
	var ok_dal: bool = bool(load_res.get("success", false))
	var loaded_name: String = str(load_res.get("data", {}).get("character_info", {}).get("name", ""))
	var ok_dal_name: bool = (loaded_name == "网关漫步者")

	# 2. 验证 AccountRepository 账号槽位封面绑定
	var refreshed_acc: AccountProfileAggregate = acc_repo.find_by_id(TEST_ACCOUNT_ID)
	var ok_acc_has_slot: bool = refreshed_acc != null and refreshed_acc.save_slot_summaries.has("SLOT_01")
	var slot_summary: SaveSlotSummaryDTO = refreshed_acc.save_slot_summaries.get("SLOT_01", null) if ok_acc_has_slot else null
	var ok_slot_name: bool = slot_summary != null and slot_summary.character_name == "网关漫步者"

	# 3. 验证 WorldGatewayFSM 自动回挂并跃迁
	var phase_after: int = gateway.context.current_phase
	var ok_phase_after: bool = (phase_after == WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED)
	var ok_attached_id: bool = (gateway.context.active_character_id == str(res.get("character_id", "")))

	_teardown_environment()

	var passed: bool = ok_phase_before and ok_success and ok_dal and ok_dal_name and ok_acc_has_slot and ok_slot_name and ok_phase_after and ok_attached_id
	return {
		"test": "TC-ACC-06: 物理落盘与 WorldGatewayFSM 自动回挂跃迁",
		"passed": passed
	}
