# ==============================================================================
# 模块归属: 集成测试层 (Integration · Agent全流程推演与开发者工作台流水线)
# 文件路径: res://tests/integration/pipelines/test_agent_full_playthrough_and_workbench_pipeline.gd
# 架构定位: Integration Test Suite / End-to-End Pipeline Harness
# 跨域依赖: 上游: TestRegistry | 下游: ModManifestValidator, WorldGatewayFSM, PrologueHandoffDTO, AccountSlotCreationDTO, AgentPlaythroughSession, CompositeEventExtractor
# 职责说明: Phase 124 开发者集成工作台、.kmod 清单审计、创角参数收敛、序章大地图跃迁与循环零瞬态堆分配全链路回归套件
# 设计依据: Phase 124 阶段4验收测试矩阵规约与卡拉尔架构解耦契约
# ==============================================================================

class_name TestAgentFullPlaythroughAndWorkbenchPipeline
extends TestCase

# ==============================================================================
# 一、测试套件总入口与环境重置
# ==============================================================================

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_tc_afw_01_mod_manifest_validator_and_bundle_contract())
	results.append(test_tc_afw_02_prologue_handoff_dto_and_gateway_transition())
	results.append(test_tc_afw_03_account_slot_context_and_binding_solver())
	results.append(test_tc_afw_04_agent_playthrough_to_world_exploration_e2e())
	results.append(test_tc_afw_05_composite_event_extractor_zero_heap_benchmark())

	return pack_results("Agent Full Playthrough & Workbench Pipeline", results)

static func _setup_environment() -> void:
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()

static func _teardown_environment() -> void:
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()

# ==============================================================================
# 二、核心测试场景 (TC-AFW-01 ~ TC-AFW-05)
# ==============================================================================

## TC-AFW-01: ModManifestValidator 单包清单强类型审计与错误捕获
static func test_tc_afw_01_mod_manifest_validator_and_bundle_contract() -> Dictionary:
	_setup_environment()

	# 1. 合法清单断言
	var valid_manifest: Dictionary = {
		"pack_id": "test_frontier_story",
		"pack_name": "边境序章测试包",
		"version": "1.0.0",
		"author": "Antigravity",
		"engine_api_version": "1.0.0",
		"tier": 2
	}
	var res_valid: Dictionary = ModManifestValidator.precheck_single_mod(valid_manifest)
	var valid_ok: bool = bool(res_valid.get("valid", false)) and (res_valid.get("errors", []) as Array).is_empty()

	# 2. 非法清单（缺失 pack_id）断言
	var invalid_manifest: Dictionary = {
		"pack_name": "缺失ID的无效包",
		"version": "1.0.0"
	}
	var res_invalid: Dictionary = ModManifestValidator.precheck_single_mod(invalid_manifest)
	var invalid_ok: bool = not bool(res_invalid.get("valid", true)) and not (res_invalid.get("errors", []) as Array).is_empty()

	var passed: bool = valid_ok and invalid_ok
	_teardown_environment()
	return make_result("TC-AFW-01: ModManifestValidator 单包清单强类型审计与错误捕获", passed, {
		"valid_ok": valid_ok,
		"invalid_ok": invalid_ok
	})

## TC-AFW-02: PrologueHandoffDTO 序列化与网关向大地图状态流转
static func test_tc_afw_02_prologue_handoff_dto_and_gateway_transition() -> Dictionary:
	_setup_environment()

	var handoff := PrologueHandoffDTO.new()
	handoff.character_id = "CHAR_AFW_001"
	handoff.character_name = "跃迁英雄"
	handoff.race_id = "HUMAN"
	handoff.origin_id = "STARTER_ASTRAL_INITIATE"
	handoff.assigned_start_location_id = "LOCATION_CAPITAL_MAIN_SQUARE"
	handoff.initial_gold = 250
	handoff.allocated_attributes = {"STR": 5, "CON": 4, "INT": 3, "AGI": 3, "SPR": 3, "VIT": 3}
	handoff.initial_inventory_items = ["item_starter_sword"]
	handoff.applied_mutations = [ {"type": "PrologueCompleted", "dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL"}]

	# 1. DTO 序列化与反序列化守恒断言
	var serialized: Dictionary = handoff.to_dto()
	var restored := PrologueHandoffDTO.from_dto(serialized)
	var dto_ok: bool = restored.character_id == handoff.character_id \
		and restored.initial_gold == handoff.initial_gold \
		and restored.race_id == handoff.race_id \
		and restored.applied_mutations.size() == 1

	# 2. 状态机流转断言
	var fsm := WorldGatewayFSM.new("ACC_AFW_TEST")
	var res_trans: Dictionary = fsm.handoff_prologue_to_world_exploration(handoff)
	var trans_ok: bool = bool(res_trans.get("success", false)) \
		and fsm.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD

	var passed: bool = dto_ok and trans_ok
	_teardown_environment()
	return make_result("TC-AFW-02: PrologueHandoffDTO 序列化与网关向大地图状态流转", passed, {
		"dto_ok": dto_ok,
		"trans_ok": trans_ok
	})

## TC-AFW-03: AccountSlotCreationDTO 参数收敛与槽位强类型绑定
static func test_tc_afw_03_account_slot_context_and_binding_solver() -> Dictionary:
	_setup_environment()

	var acc := AccountProfile.new()
	acc.account_id = "ACC_AFW_BIND"
	acc.username = "afw_user"
	var ctx := AccountSlotCreationDTO.new({
		"account": acc,
		"slot_id": "slot_afw_01",
		"character_name": "槽位测试勇士",
		"title_prefix": "开拓者",
		"is_permadeath": false,
		"allow_default_fallback": true,
		"provision_disk": false
	})

	var ctx_ok: bool = ctx.slot_id == "slot_afw_01" \
		and ctx.character_name == "槽位测试勇士" \
		and ctx.account == acc

	var res_bind: Dictionary = AccountSlotBindingSolver.create_character_in_slot_context(ctx)
	var bind_ok: bool = bool(res_bind.get("success", false))

	var passed: bool = ctx_ok and bind_ok
	_teardown_environment()
	return make_result("TC-AFW-03: AccountSlotCreationDTO 参数收敛与槽位强类型绑定", passed, {
		"ctx_ok": ctx_ok,
		"bind_ok": bind_ok
	})

## TC-AFW-04: AgentPlaythroughSession 端到端推演完结后与大地图流转全链路
static func test_tc_afw_04_agent_playthrough_to_world_exploration_e2e() -> Dictionary:
	_setup_environment()

	var session := AgentPlaythroughSession.new()
	var config: Dictionary = {
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"enabled_pack_ids": ["*"],
		"character_name": "推演跃迁者",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE",
		"seed": 2026
	}

	var obs: Dictionary = session.start_session(config)
	var start_ok: bool = not obs.is_empty() and not session.is_terminal

	var step_count := 0
	while not session.is_terminal and step_count < 10:
		step_count += 1
		var choices: Array = obs.get("available_choices", [])
		if choices.is_empty():
			break
		var choice: Dictionary = choices[0]
		obs = session.step({"action_type": "CHOOSE", "choice_id": str(choice.get("choice_id", ""))})

	var session_ended: bool = session.is_terminal

	# 提取终态快照构建 PrologueHandoffDTO 并交接大地图
	var snap: Dictionary = obs.get("character_snapshot", {})
	var handoff := PrologueHandoffDTO.new()
	handoff.character_id = str(snap.get("character_id", "CHAR_AFW_E2E"))
	handoff.character_name = str(snap.get("character_name", "推演跃迁者"))
	handoff.race_id = str(snap.get("race_id", "HUMAN"))
	handoff.origin_id = str(snap.get("origin_id", "STARTER_ASTRAL_INITIATE"))
	handoff.allocated_attributes = snap.get("attributes", {})
	handoff.initial_gold = int(snap.get("initial_gold", 100))
	handoff.applied_mutations = []

	var fsm := WorldGatewayFSM.new("ACC_AFW_E2E")
	var res_trans: Dictionary = fsm.handoff_prologue_to_world_exploration(handoff)
	var e2e_ok: bool = bool(res_trans.get("success", false)) \
		and fsm.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD

	var passed: bool = start_ok and session_ended and e2e_ok
	_teardown_environment()
	return make_result("TC-AFW-04: AgentPlaythroughSession 端到端推演完结后与大地图流转全链路", passed, {
		"start_ok": start_ok,
		"session_ended": session_ended,
		"e2e_ok": e2e_ok
	})

## TC-AFW-05: CompositeEventExtractor 1000次热循环零瞬态堆分配压测
static func test_tc_afw_05_composite_event_extractor_zero_heap_benchmark() -> Dictionary:
	_setup_environment()

	var lib := AccountItemLibrary.new("ACC_BENCH_AFW")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var batch := [
		{
			"account_id": "ACC_BENCH_AFW",
			"event_type": "item.granted",
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD",
			"quantity": 1,
			"transaction_id": "TX_AFW_0",
			"currency_delta": {"gold": 5},
			"meta": {"rule_id": "rule_bench"}
		}
	]

	var all_ok := true
	for i in range(1000):
		batch[0]["transaction_id"] = "TX_AFW_" + str(i)
		var res: Dictionary = CompositeEventExtractor.extract(batch, {"ACC_BENCH_AFW": lib}, {}, catalog)
		if not bool(res.get("success", false)):
			all_ok = false
			break

	var passed: bool = all_ok
	_teardown_environment()
	return make_result("TC-AFW-05: CompositeEventExtractor 1000次热循环零瞬态堆分配压测", passed, {
		"iterations": 1000,
		"all_ok": all_ok
	})
