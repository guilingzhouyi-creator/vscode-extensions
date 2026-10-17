# ==============================================================================
# 模块归属: 集成测试流水线 (Tests · 自动化测试底座)
# 文件路径: res://tests/integration/pipelines/test_narrative_mod_and_perturbation_pipeline.gd
# 架构定位: Integration Test Pipeline / Narrative MOD & Perturbation Harness
# 跨域依赖: 上游: TestRegistry | 下游: ModPackageDiscoverySolver, CrossWorldPerturbationBroker, WorldModAffinityManager, WorldGatewayFSM, WorldArchiveRepository | 配置: config/domains/narrative_orchestration/core.json
# 职责说明: 自动化全链路测试剧情 MOD 级联发现、Kahn 拓扑排序、跨世界虚空因果扰动、世界亲和锁文件固化、防坏档拦截与安全降级
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name TestNarrativeModAndPerturbationPipeline
extends TestCase

const TEST_SANDBOX_BASE: String = "user://test_sandbox_nmp_pipeline/"

## 统一测试套件主入口
static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_cascade_discovery_and_dto_deserialization())
	results.append(test_topological_sort_and_cyclic_detection())
	results.append(test_cross_world_perturbation_lifecycle())
	results.append(test_world_mod_lock_affinity_binding())
	results.append(test_missing_critical_mod_gateway_blocking())
	results.append(test_safe_degrade_and_chronicle_fragment())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "Narrative MOD & Perturbation Pipeline",
		"all_passed": all_passed,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"results": results
	}

## 创建测试沙箱目录与辅助工具
static func _ensure_dir_exists(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		DirAccess.make_dir_recursive_absolute(dir_path)

## 写入测试清单文件
static func _write_test_manifest(file_path: String, json_dict: Dictionary) -> bool:
	_ensure_dir_exists(file_path.get_base_dir())
	var file := FileAccess.open(file_path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(json_dict, "  "))
	file.close()
	return true

## TC-NMP-01: 三级级联目录发现与 NarrativePackManifestDTO 反序列化
static func test_cascade_discovery_and_dto_deserialization() -> Dictionary:
	var sandbox_dir := TEST_SANDBOX_BASE + "tc01/"
	var alpha_dir := sandbox_dir + "pack_alpha/"
	var beta_dir := sandbox_dir + "pack_beta/"

	var alpha_manifest := {
		"pack_id": "mod_alpha_prologue",
		"pack_name": "阿尔法前传",
		"version": "1.2.0",
		"author": "KalarOrchestrator",
		"engine_api_version": "1.0.0",
		"priority": 150,
		"dependencies": [],
		"semantic_tags": ["prologue", "mystery"]
	}
	var beta_manifest := {
		"pack_id": "mod_beta_epilogue",
		"pack_name": "贝塔终章",
		"version": "2.0.0",
		"author": "KalarOrchestrator",
		"engine_api_version": "1.0.0",
		"priority": 90,
		"dependencies": ["mod_alpha_prologue"],
		"semantic_tags": ["epilogue"]
	}

	_write_test_manifest(alpha_dir + "pack.json", alpha_manifest)
	_write_test_manifest(beta_dir + "pack.json", beta_manifest)

	var discovered: Array[NarrativePackManifestDTO] = ModPackageDiscoverySolver.scan_installed_packs([sandbox_dir])
	var count_ok: bool = discovered.size() >= 2

	var found_alpha: NarrativePackManifestDTO = null
	var found_beta: NarrativePackManifestDTO = null
	for d in discovered:
		if d.pack_id == "mod_alpha_prologue":
			found_alpha = d
		elif d.pack_id == "mod_beta_epilogue":
			found_beta = d

	var alpha_ok: bool = found_alpha != null and found_alpha.version == "1.2.0" and found_alpha.priority == 150
	var beta_ok: bool = found_beta != null and found_beta.dependencies.has("mod_alpha_prologue")

	var passed: bool = count_ok and alpha_ok and beta_ok
	return {
		"test_id": "TC-NMP-01",
		"name": "三级级联目录发现与 NarrativePackManifestDTO 反序列化",
		"passed": passed,
		"details": {
			"discovered_count": discovered.size(),
			"alpha_ok": alpha_ok,
			"beta_ok": beta_ok
		}
	}

## TC-NMP-02: 拓扑依赖排序与循环依赖检测 (Kahn 算法)
static func test_topological_sort_and_cyclic_detection() -> Dictionary:
	# 1. 正常 DAG 拓扑排序测试
	var pkg_core := NarrativePackManifestDTO.new()
	pkg_core.pack_id = "core_lib"
	pkg_core.priority = 100
	pkg_core.dependencies = []

	var pkg_magic := NarrativePackManifestDTO.new()
	pkg_magic.pack_id = "magic_system"
	pkg_magic.priority = 200
	pkg_magic.dependencies = ["core_lib"]

	var pkg_quest := NarrativePackManifestDTO.new()
	pkg_quest.pack_id = "quest_flow"
	pkg_quest.priority = 100
	pkg_quest.dependencies = ["core_lib"]

	var pkg_addon := NarrativePackManifestDTO.new()
	pkg_addon.pack_id = "addon_pack"
	pkg_addon.priority = 50
	pkg_addon.dependencies = ["magic_system", "quest_flow"]

	var valid_res := ModPackageDiscoverySolver.sort_and_resolve_dependencies([
		pkg_addon, pkg_quest, pkg_magic, pkg_core
	])
	var valid_ok: bool = bool(valid_res.get("success", false))
	var sorted_list: Array = valid_res.get("sorted_packs", [])
	var sort_len_ok: bool = sorted_list.size() == 4
	var first_is_core: bool = false
	var second_is_magic: bool = false
	var last_is_addon: bool = false
	if sort_len_ok:
		first_is_core = (sorted_list[0] as NarrativePackManifestDTO).pack_id == "core_lib"
		second_is_magic = (sorted_list[1] as NarrativePackManifestDTO).pack_id == "magic_system"
		last_is_addon = (sorted_list[3] as NarrativePackManifestDTO).pack_id == "addon_pack"

	# 2. 循环依赖检测测试
	var pkg_cycle_a := NarrativePackManifestDTO.new()
	pkg_cycle_a.pack_id = "cycle_a"
	pkg_cycle_a.dependencies = ["cycle_b"]

	var pkg_cycle_b := NarrativePackManifestDTO.new()
	pkg_cycle_b.pack_id = "cycle_b"
	pkg_cycle_b.dependencies = ["cycle_a"]

	var cycle_res := ModPackageDiscoverySolver.sort_and_resolve_dependencies([pkg_cycle_a, pkg_cycle_b])
	var cycle_detected: bool = not bool(cycle_res.get("success", false)) \
		and str(cycle_res.get("error", "")) == "ERR_CYCLIC_DEPENDENCY"

	# 3. 缺失依赖检测测试
	var pkg_orphan := NarrativePackManifestDTO.new()
	pkg_orphan.pack_id = "orphan_pack"
	pkg_orphan.dependencies = ["missing_foundation_pack"]

	var missing_res := ModPackageDiscoverySolver.sort_and_resolve_dependencies([pkg_orphan])
	var missing_detected: bool = not bool(missing_res.get("success", false)) \
		and str(missing_res.get("error", "")) == "ERR_MISSING_DEPENDENCY"

	var passed: bool = valid_ok and first_is_core and second_is_magic and last_is_addon and cycle_detected and missing_detected
	return {
		"test_id": "TC-NMP-02",
		"name": "拓扑依赖排序与循环依赖检测 (Kahn 算法)",
		"passed": passed,
		"details": {
			"valid_ok": valid_ok,
			"cycle_detected": cycle_detected,
			"missing_detected": missing_detected
		}
	}

## TC-NMP-03: 跨世界虚空扰动广播、半衰期衰减与已读标记闭环
static func test_cross_world_perturbation_lifecycle() -> Dictionary:
	CrossWorldPerturbationBroker.reset_for_tests()
	var broker := CrossWorldPerturbationBroker.get_instance()
	var test_ledger_path := TEST_SANDBOX_BASE + "tc03/cross_world_perturbations.json"
	broker.set_custom_ledger_path(test_ledger_path)

	# 1. 源世界发射因果共鸣扰动
	var ptb := CrossWorldPerturbationDTO.new()
	ptb.perturbation_id = "ptb_void_surge_01"
	ptb.origin_world_id = "WORLD_ORIGIN_ALPHA"
	ptb.resonance_intensity = 1.0
	ptb.decay_half_life_seconds = 3600
	ptb.emitted_timestamp_utc = int(Time.get_unix_time_from_system())
	ptb.semantic_tags = ["abyss_eruption", "cosmic_chill"]

	var emit_res := broker.emit_perturbation(ptb)
	var emit_ok: bool = bool(emit_res.get("success", false))

	# 2. 轮询过滤：源世界排斥自旋
	var origin_poll := broker.poll_perturbations_for_world("WORLD_ORIGIN_ALPHA")
	var origin_isolated: bool = origin_poll.is_empty()

	# 3. 异源世界成功拉取
	var target_poll := broker.poll_perturbations_for_world("WORLD_TARGET_BETA")
	var target_found: bool = target_poll.size() == 1 and target_poll[0].perturbation_id == "ptb_void_surge_01"

	# 4. 半衰期衰减公式解算断言
	var decay_half: float = CrossWorldPerturbationBroker.calculate_decayed_resonance(1.0, 1000, 3600, 1000 + 3600)
	var decay_quarter: float = CrossWorldPerturbationBroker.calculate_decayed_resonance(1.0, 1000, 3600, 1000 + 7200)
	var decay_formula_ok: bool = is_equal_approx(decay_half, 0.5) and is_equal_approx(decay_quarter, 0.25)

	# 5. 访问标记与已读排斥
	var mark_res: bool = broker.mark_world_visited("ptb_void_surge_01", "WORLD_TARGET_BETA")
	var target_re_poll := broker.poll_perturbations_for_world("WORLD_TARGET_BETA")
	var target_visited_excluded: bool = mark_res and target_re_poll.is_empty()

	CrossWorldPerturbationBroker.reset_for_tests()

	var passed: bool = emit_ok and origin_isolated and target_found and decay_formula_ok and target_visited_excluded
	return {
		"test_id": "TC-NMP-03",
		"name": "跨世界虚空扰动广播、半衰期衰减与已读标记闭环",
		"passed": passed,
		"details": {
			"emit_ok": emit_ok,
			"origin_isolated": origin_isolated,
			"target_found": target_found,
			"decay_formula_ok": decay_formula_ok,
			"target_visited_excluded": target_visited_excluded
		}
	}

## TC-NMP-04: 世界 MOD 锁文件初次固化与二次验证一致性断言
static func test_world_mod_lock_affinity_binding() -> Dictionary:
	WorldArchiveRepository.reset_for_tests()
	var repo := WorldArchiveRepository.get_instance()
	var sandbox_dir := TEST_SANDBOX_BASE + "tc04/"
	repo.set_custom_root_dir(sandbox_dir + "worlds/")
	repo.set_custom_catalog_path(sandbox_dir + "worlds/world_catalog.json")
	repo.load_all()

	var world_id := "WORLD_AFFINITY_01"
	repo.create_world(world_id, "亲和锁测试界域")

	var mgr := WorldModAffinityManager.new()
	var installed_mods: Array = [
		{"pack_id": "mod_ancient_grimoire", "version": "1.0.0", "priority": 100},
		{"pack_id": "mod_starfall_causality", "version": "2.0.0", "priority": 120}
	]

	# 1. 初次固化 (清理历史残留保证确定性)
	var lock_path := mgr.get_lock_file_path(world_id)
	if FileAccess.file_exists(lock_path):
		DirAccess.remove_absolute(lock_path)
	var init_res := mgr.verify_and_bind_world_mods(world_id, installed_mods, false)
	var init_ok: bool = bool(init_res.get("success", false)) and str(init_res.get("status", "")) == "INITIALIZED"
	var file_exists_ok: bool = FileAccess.file_exists(lock_path)

	# 2. 读取锁文件校验内容完备性
	var loaded_lock := mgr.load_world_mod_lock(world_id)
	var lock_content_ok: bool = bool(loaded_lock.get("exists", false)) \
		and (loaded_lock.get("locked_packs", []) as Array).size() == 2

	# 3. 二次验证：完全一致
	var verify_res := mgr.verify_and_bind_world_mods(world_id, installed_mods, false)
	var verify_ok: bool = bool(verify_res.get("success", false)) and str(verify_res.get("status", "")) == "VERIFIED"

	WorldArchiveRepository.reset_for_tests()

	var passed: bool = init_ok and file_exists_ok and lock_content_ok and verify_ok
	return {
		"test_id": "TC-NMP-04",
		"name": "世界 MOD 锁文件初次固化与二次验证一致性断言",
		"passed": passed,
		"details": {
			"init_ok": init_ok,
			"file_exists_ok": file_exists_ok,
			"verify_ok": verify_ok
		}
	}

## TC-NMP-05: 关键 MOD 缺失网关拦截防坏档断言 (ERR_MISSING_CRITICAL_MOD)
static func test_missing_critical_mod_gateway_blocking() -> Dictionary:
	WorldArchiveRepository.reset_for_tests()
	var repo := WorldArchiveRepository.get_instance()
	var sandbox_dir := TEST_SANDBOX_BASE + "tc05/"
	repo.set_custom_root_dir(sandbox_dir + "worlds/")
	repo.set_custom_catalog_path(sandbox_dir + "worlds/world_catalog.json")
	repo.load_all()

	var world_id := "WORLD_CRITICAL_01"
	repo.create_world(world_id, "关键防坏档测试界")

	var mgr := WorldModAffinityManager.new()
	# 预先固化包含两大关键 MOD 的锁文件
	mgr.save_world_mod_lock(world_id, [
		{"pack_id": "mod_core_narrative", "version": "1.0.0"},
		{"pack_id": "mod_dragon_boss", "version": "1.0.0"}
	])

	# 1. 直接通过 AffinityManager 验证缺失拦截
	var partial_installed: Array = [{"pack_id": "mod_core_narrative", "version": "1.0.0"}]
	var mgr_verify := mgr.verify_and_bind_world_mods(world_id, partial_installed, false)
	var mgr_blocked: bool = not bool(mgr_verify.get("success", false)) \
		and str(mgr_verify.get("error", "")) == "ERR_MISSING_CRITICAL_MOD" \
		and (mgr_verify.get("missing_packs", []) as Array).has("mod_dragon_boss")

	# 2. 模拟 WorldGatewayFSM 接入守卫拦截
	var fsm := WorldGatewayFSM.new("acc_pipeline_tester")
	fsm.context.current_phase = WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED
	fsm.context.selected_world_id = world_id

	var enter_res := fsm.enter_world(world_id, false)
	var enter_blocked: bool = not bool(enter_res.get("success", false)) \
		and (str(enter_res.get("error_code", "")) == "ERR_MISSING_CRITICAL_MOD" or str(enter_res.get("error", "")) == "ERR_MISSING_CRITICAL_MOD")

	# 断言状态机阶段被坚决阻断在进入世界之前，未跃迁至 IN_WORLD
	var phase_preserved: bool = fsm.context.current_phase != WorldGatewayModel.GatewayPhase.IN_WORLD

	WorldArchiveRepository.reset_for_tests()

	var passed: bool = mgr_blocked and enter_blocked and phase_preserved
	return {
		"test_id": "TC-NMP-05",
		"name": "关键 MOD 缺失网关拦截防坏档断言 (ERR_MISSING_CRITICAL_MOD)",
		"passed": passed,
		"details": {
			"mgr_blocked": mgr_blocked,
			"enter_blocked": enter_blocked,
			"phase_preserved": phase_preserved
		}
	}

## TC-NMP-06: 允许安全降级时向 WorldInstance 记录 MOD_DETACHED 历史片段
static func test_safe_degrade_and_chronicle_fragment() -> Dictionary:
	WorldArchiveRepository.reset_for_tests()
	var repo := WorldArchiveRepository.get_instance()
	var sandbox_dir := TEST_SANDBOX_BASE + "tc06/"
	repo.set_custom_root_dir(sandbox_dir + "worlds/")
	repo.set_custom_catalog_path(sandbox_dir + "worlds/world_catalog.json")
	repo.load_all()

	var world_id := "WORLD_DEGRADE_01"
	repo.create_world(world_id, "降级追溯测试界")

	var mgr := WorldModAffinityManager.new()
	# 固化包含可剥离外观扩展包的锁文件
	mgr.save_world_mod_lock(world_id, [
		{"pack_id": "mod_base_quest", "version": "1.0.0"},
		{"pack_id": "mod_cosmetic_auras", "version": "1.0.0"}
	])

	# 1. 允许安全降级验证
	var only_base: Array = [{"pack_id": "mod_base_quest", "version": "1.0.0"}]
	var degrade_res := mgr.verify_and_bind_world_mods(world_id, only_base, true)
	var degrade_ok: bool = bool(degrade_res.get("success", false)) \
		and str(degrade_res.get("status", "")) == "DEGRADED" \
		and (degrade_res.get("missing_packs", []) as Array).has("mod_cosmetic_auras")

	# 2. 断言 WorldInstance 历史片段成功记录 MOD_DETACHED
	var w_inst := repo.load_world(world_id)
	var frag_ok: bool = false
	if w_inst != null and not w_inst.history_fragments.is_empty():
		var last_frag: Dictionary = w_inst.history_fragments[w_inst.history_fragments.size() - 1]
		var is_detached: bool = str(last_frag.get("type", "")) == "MOD_DETACHED" or str(last_frag.get("event", "")) == "MOD_DETACHED"
		var has_missing: bool = (last_frag.get("missing_packs", []) as Array).has("mod_cosmetic_auras")
		frag_ok = is_detached and has_missing

	# 3. 验证网关在允许安全降级时成功放行跃迁至 IN_WORLD
	var fsm := WorldGatewayFSM.new("acc_degrade_tester")
	fsm.context.current_phase = WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED
	fsm.context.selected_world_id = world_id

	var gw_enter := fsm.enter_world(world_id, true)
	var gw_passed: bool = bool(gw_enter.get("success", false)) \
		and fsm.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD

	WorldArchiveRepository.reset_for_tests()

	var passed: bool = degrade_ok and frag_ok and gw_passed
	return {
		"test_id": "TC-NMP-06",
		"name": "允许安全降级时向 WorldInstance 记录 MOD_DETACHED 历史片段",
		"passed": passed,
		"details": {
			"degrade_ok": degrade_ok,
			"frag_ok": frag_ok,
			"gw_passed": gw_passed
		}
	}
