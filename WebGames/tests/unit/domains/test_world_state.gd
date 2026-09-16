# ==============================================================================
# 单元测试：Phase 08 角色死亡与世界连续性及账号权限体系
# 文件路径: res://tests/unit/domains/test_world_state.gd
# ==============================================================================
class_name TestWorldStateDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_death_clears_character_only())
	results.append(test_world_continues_after_death())
	results.append(test_no_character_inheritance())
	results.append(test_recombination_stub_off())
	results.append(test_recombination_stub_on())
	results.append(test_entitlement_gate())
	results.append(test_entitlement_seal())
	results.append(test_death_idempotent())
	results.append(test_fallen_slot_rebindable())
	results.append(test_history_fragments_bounded())
	results.append(test_world_time_day_advances())
	results.append(test_seal_order_independent())
	results.append(test_recombination_config_override())
	results.append(test_world_ref_persists())

	var all_passed: bool = true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return {"domain": "Phase 08: 角色死亡与世界连续性及权限体系", "all_passed": all_passed, "results": results}

static func test_death_clears_character_only() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	var dto := SaveSlotSummaryDTO.new()
	dto.slot_id = "SLOT_01"
	dto.character_name = "死者A"
	var profile := CharacterProfile.new()
	profile.attributes = {"STR": 10}
	profile.inventory = {"iron_sword": 1}
	profile.personal_quest_progress = {"q1": 50}
	dto.attach_character_profile(profile)
	acc.bind_character_to_slot("SLOT_01", dto)
	var world := WorldInstance.new("W1")
	world.world_state = {"resource": 5}
	var res := CharacterDeathSolver.handle_character_death(acc, "SLOT_01", world)
	var passed: bool = res.success and res.cleared_keys.size() == 3 and profile.is_fresh() and dto.is_fallen
	return {"test": "TC-P08-01: 死亡仅精确清理角色本体白名单", "passed": passed}

static func test_world_continues_after_death() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	var dto := SaveSlotSummaryDTO.new()
	dto.slot_id = "SLOT_01"
	dto.character_name = "死者B"
	var profile := CharacterProfile.new()
	profile.inventory = {"dagger": 1}
	dto.attach_character_profile(profile)
	acc.bind_character_to_slot("SLOT_01", dto)
	var world := WorldInstance.new("W1")
	world.world_time = {"tick": 10}
	world.world_state = {"resource": 5}
	var tick_before: int = int(world.world_time["tick"])
	var res := CharacterDeathSolver.handle_character_death(acc, "SLOT_01", world)
	var passed: bool = int(world.world_time["tick"]) > tick_before and world.world_state.get("resource") == 5 and world.history_fragments.size() == 1
	return {"test": "TC-P08-02: 死亡世界时间继续+状态保留+历史片段只增", "passed": passed}

static func test_no_character_inheritance() -> Dictionary:
	var fresh := CharacterDeathSolver.spawn_fresh_character("SLOT_02", "新角色")
	var passed: bool = fresh.is_fresh() and fresh.character_id == "SLOT_02" and fresh.attributes.is_empty() and fresh.inventory.is_empty()
	return {"test": "TC-P08-03: 新角色零继承死亡角色完整状态", "passed": passed}

static func test_recombination_stub_off() -> Dictionary:
	var template: Dictionary = GameConfig.get_dict("domains.world", "default_template", {"world_id": "WORLD_DEFAULT"})
	var res := WorldRecombinationStub.generate_new_world(template, [{"history_fragments": [{"event": "war"}]}])
	var passed: bool = not WorldRecombinationStub.continuity_enabled() and res.mode == "DEFAULT_ONLY" and res.world.get("world_id") == template.get("world_id")
	return {"test": "TC-P08-04: 多世界连续性开关关闭 → 仅默认世界", "passed": passed}

static func test_recombination_stub_on() -> Dictionary:
	var template: Dictionary = {"world_id": "WORLD_DEFAULT", "region_mana_density": 1.0}
	var forced := WorldRecombinationStub.generate_new_world(template, [{"history_fragments": [{"event": "war"}, {"event": "plague"}]}], {"enabled": true})
	var passed: bool = forced.mode == "RECOMBINED_STUB" and forced.fragments_count == 2 and forced.world.get("sources").size() == 2 and String(forced.world.get("world_id")).ends_with("_GEN_F2")
	return {"test": "TC-P08-05: 重组预留（config 覆盖开启 → RECOMBINED_STUB + 片段数派生 world_id）", "passed": passed}

static func test_entitlement_gate() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_P08"
	var granted := EntitlementService.add_entitlement(acc, "offline")
	var has_ok := EntitlementService.has_entitlement(acc, "offline")
	var has_missing := not EntitlementService.has_entitlement(acc, "online")
	var removed := EntitlementService.remove_entitlement(acc, "offline")
	var passed: bool = granted and has_ok and has_missing and removed and not EntitlementService.has_entitlement(acc, "offline")
	return {"test": "TC-P08-06: 权限字段可扩展且统一鉴权入口分责", "passed": passed}

static func test_entitlement_seal() -> Dictionary:
	# P39 清单 6：密封密钥经环境供给（生产缺失即失败关闭）——测试显式注入受控测试密钥
	OS.set_environment("KALAR_ENTITLEMENT_KEY", "test-seal-key-v1")
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_SEAL"
	EntitlementService.add_entitlement(acc, "offline")
	EntitlementService.add_entitlement(acc, "online")
	var seal := EntitlementService.seal_entitlements(acc)
	var ok_same := EntitlementService.verify_seal(acc, seal)
	var tampered := AccountProfileAggregate.new()
	tampered.account_id = "ACC_SEAL"
	tampered.entitlements = ["online", "offline", "hacked"]
	var fail_tamper := not EntitlementService.verify_seal(tampered, seal)
	var passed: bool = ok_same and fail_tamper
	return {"test": "TC-P08-07: 权限指纹安全存储（篡改本地无效）", "passed": passed}

static func test_death_idempotent() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	var dto := SaveSlotSummaryDTO.new()
	dto.slot_id = "SLOT_01"
	dto.character_name = "死者幂等"
	var profile := CharacterProfile.new()
	profile.inventory = {"x": 1}
	dto.attach_character_profile(profile)
	acc.bind_character_to_slot("SLOT_01", dto)
	var world := WorldInstance.new("W1")
	var first := CharacterDeathSolver.handle_character_death(acc, "SLOT_01", world)
	var second := CharacterDeathSolver.handle_character_death(acc, "SLOT_01", world)
	var passed: bool = first.success and second.error_code == "ALREADY_FALLEN" and world.history_fragments.size() == 1
	return {"test": "TC-P08-08: 重复死亡幂等拒绝且不重复追加历史", "passed": passed}

static func test_fallen_slot_rebindable() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	var dto := SaveSlotSummaryDTO.new()
	dto.slot_id = "SLOT_01"
	dto.character_name = "旧角色"
	var profile := CharacterProfile.new()
	profile.attributes = {"STR": 99}
	dto.attach_character_profile(profile)
	acc.bind_character_to_slot("SLOT_01", dto)
	CharacterDeathSolver.handle_character_death(acc, "SLOT_01", null)
	var rebind := AccountSlotBindingSolver.create_character_in_slot(acc, "SLOT_01", "新角色")
	var new_dto: SaveSlotSummaryDTO = acc.get_summary_by_slot("SLOT_01")
	var passed: bool = rebind.success and new_dto != null and not new_dto.is_fallen and new_dto.character_name == "新角色" and new_dto.character_profile == null
	return {"test": "TC-P08-09: fallen 槽位可重挂新角色（零继承，slot_id 稳定）", "passed": passed}

static func test_history_fragments_bounded() -> Dictionary:
	var world := WorldInstance.new("W_BOUND")
	for i in range(80):
		world.append_history_fragment({"event": i})
	var passed: bool = world.history_fragments.size() <= 64 and int(world.history_fragments[0]["event"]) == 80 - 64
	return {"test": "TC-P08-10: 历史片段有界回收（上限 64，弹最旧）", "passed": passed}

static func test_world_time_day_advances() -> Dictionary:
	var world := WorldInstance.new("W_DAY")
	world.advance_world_time(1)
	var tick1: int = int(world.world_time["tick"])
	var day1: int = int(world.world_time["day"])
	world.advance_world_time(19)
	var passed: bool = tick1 == 1 and int(world.world_time["tick"]) == 20 and day1 == 1 and int(world.world_time["day"]) == 2
	return {"test": "TC-P08-11: 世界时间 tick 单调 + 每 20 tick 联动 day", "passed": passed}

static func test_seal_order_independent() -> Dictionary:
	var acc_a := AccountProfileAggregate.new()
	acc_a.account_id = "ACC_ORDER"
	acc_a.entitlements = ["offline", "online"]
	var acc_b := AccountProfileAggregate.new()
	acc_b.account_id = "ACC_ORDER"
	acc_b.entitlements = ["online", "offline"]
	var seal_a := EntitlementService.seal_entitlements(acc_a)
	var passed: bool = seal_a == EntitlementService.seal_entitlements(acc_b) and EntitlementService.verify_seal(acc_b, seal_a)
	return {"test": "TC-P08-12: 权限指纹顺序无关（同集合不同顺序校验通过）", "passed": passed}

static func test_recombination_config_override() -> Dictionary:
	var empty_res := WorldRecombinationStub.generate_new_world({}, [], {"enabled": false})
	var passed: bool = empty_res.success and not empty_res.world.is_empty() and empty_res.mode == "DEFAULT_ONLY" and String(empty_res.world.get("world_id", "")).is_empty() == false
	return {"test": "TC-P08-13: 空模板回退官方默认世界模板", "passed": passed}

static func test_world_ref_persists() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_WORLD_REF"
	var res := AccountSlotBindingSolver.create_character_in_slot(acc, "SLOT_01", "世界引用角色")
	var ref_ok: String = res.get("world_state_ref", "")
	var passed: bool = res.success and ref_ok == acc.world_state_ref and not ref_ok.is_empty()
	return {"test": "TC-P08-14: 世界引用沿用（开关关闭不新建独立世界）", "passed": passed}