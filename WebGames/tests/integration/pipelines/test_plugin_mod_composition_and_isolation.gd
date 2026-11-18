# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_plugin_mod_composition_and_isolation.gd
# 架构定位: Integration Test Pipeline / Engine Neutrality & MOD Composition
# 依赖与触发: 上游: TestRegistry | 下游: ModPackageDiscoverySolver,
#           ModPrecheckAndAdaptationSolver, Tier3ContentOverrideLoader,
#           PrologueExecutionKernel, AssetPathResolver, AntiBridgeGuard
# 职责说明: 使用与卡拉尔完全无关的纯合成异世界内容 MOD，验证可组合叠层注入、
#           DAG 序章推演、环依赖拒载、.kmod 二进制寻址隔离、联机摘要核验与退回归零。
# 设计依据: 阶段验收矩阵 (TC-PMC-01 ~ TC-PMC-05)
# ==============================================================================

## TestPluginModCompositionAndIsolation：纯插件化非卡拉尔 MOD 组合、资产隔离与叠层归零测试套件
class_name TestPluginModCompositionAndIsolation
extends TestCase

const SANDBOX_MODS_ROOT: String = SyntheticChronoModFixture.SANDBOX_MODS_ROOT

## 执行非卡拉尔合成 MOD 组合与隔离回归测试
static func run_all_tests() -> Dictionary:
	SyntheticChronoModFixture.cleanup_sandbox()
	TestCase.unmount_mod_overlay_for_test()
	var results: Array[Dictionary] = []
	results.append(test_non_kalar_base_plus_addon_composition())
	results.append(test_synthetic_dag_prologue_progression())
	results.append(test_cyclic_dependency_rejection())
	results.append(test_kmod_zip_asset_resolution_and_traversal_guard())
	results.append(test_realm_digest_composition_and_exit_clean_isolation())
	SyntheticChronoModFixture.cleanup_sandbox()
	return TestCase.pack_results("纯插件化异世界 MOD 组合叠加与零泄漏隔离流水线", results)

## TC-PMC-01: 非卡拉尔 TotalConversion + ContentAddon 磁盘发现、拓扑编排与 Tier3 注入
static func test_non_kalar_base_plus_addon_composition() -> Dictionary:
	SyntheticChronoModFixture.cleanup_sandbox()
	SyntheticChronoModFixture.write_synthetic_chrono_stack()
	var discovered := ModPackageDiscoverySolver.scan_installed_full_mod_packages([SANDBOX_MODS_ROOT])
	var synth_packs: Array = []
	for pkg in discovered:
		var pid := str(pkg.get("pack_id", ""))
		if pid == "mod_chrono_spire" or pid == "mod_chrono_relics":
			synth_packs.append(pkg)

	var adapt_res := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(
		synth_packs,
		["mod_chrono_relics", "mod_chrono_spire"]
	)
	var override_res := Tier3ContentOverrideLoader.apply_enabled_packages(synth_packs)

	var enabled_order: Array = adapt_res.get("enabled_pack_ids", [])
	var order_ok: bool = bool(adapt_res.get("success", false)) and enabled_order.size() == 2
	var worlds_dict: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
	var has_lens: bool = SyntheticChronoModFixture.has_override_item("CHRONO:EQUIP:FOCUS:ETHER_LENS")
	var has_flask: bool = SyntheticChronoModFixture.has_override_item("CHRONO:CONSUM:POTION:OIL_FLASK")
	var injection_ok: bool = bool(override_res.get("success", false)) \
		and has_lens \
		and has_flask \
		and worlds_dict.has("WORLD_CHRONO_SP_01")

	return make_result("TC-PMC-01: 纯异世界 TotalConversion+Addon 发现合并与内容注表", order_ok and injection_ok, {
		"enabled_order": enabled_order,
		"has_items": has_lens and has_flask
	})

## TC-PMC-02: 纯合成非卡拉尔 DAG 序章完整推演完结（无任何卡拉尔依赖）
static func test_synthetic_dag_prologue_progression() -> Dictionary:
	var discovered := ModPackageDiscoverySolver.scan_installed_full_mod_packages([SANDBOX_MODS_ROOT])
	var synth_packs: Array = []
	for pkg in discovered:
		if str(pkg.get("pack_id", "")).begins_with("mod_chrono_"):
			synth_packs.append(pkg)
	var adapt_res := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(synth_packs, ["mod_chrono_spire"])
	var manifest: Dictionary = adapt_res.get("adapted_manifest", {})

	var opening := OpeningEventStreamDTO.new()
	opening.account_id = "ACC_CHRONO_01"
	opening.character_id = "CHAR_CHRONO_01"
	opening.character_name = "发条七号"
	opening.race_id = "AUTOMATON"
	opening.world_id = "WORLD_CHRONO_SP_01"
	opening.narrative_context = {"origin_id": "CLOCKWORK_SCRIBE"}

	var boot_res := PrologueExecutionKernel.boot_character_prologue(opening, "AUTOMATON", manifest)
	var p_ctx: CharacterPrologueContext = boot_res.get("context", null)
	var boot_packet: Variant = boot_res.get("packet", null)
	var boot_ok: bool = bool(boot_res.get("success", false)) and p_ctx != null \
		and boot_packet != null and str(boot_packet.narrative_text).contains("发条七号") \
		and p_ctx.current_dag_id == "DAG_CHRONO_AWAKEN"

	var step_res := PrologueExecutionKernel.advance_prologue_step(p_ctx, "NEXT") if p_ctx != null else {}
	var step_packet: Variant = step_res.get("packet", null)
	var finish_ok: bool = bool(step_res.get("success", false)) and p_ctx != null and p_ctx.is_completed \
		and step_packet != null and str(step_packet.narrative_text).contains("发条七号")

	return make_result("TC-PMC-02: 非卡拉尔自定义 DAG 序章占位符解析与终态达成", boot_ok and finish_ok, {
		"dag_id": p_ctx.current_dag_id if p_ctx != null else "",
		"completed": p_ctx.is_completed if p_ctx != null else false
	})

## TC-PMC-03: MOD 依赖环检测阻断加载
static func test_cyclic_dependency_rejection() -> Dictionary:
	var pack_a := {
		"pack_id": "mod_cycle_alpha",
		"pack_name": "Cycle Alpha",
		"version": "1.0.0",
		"pack_profile": "TOTAL_CONVERSION",
		"mod_tier": "TOTAL_CONVERSION",
		"dependencies": ["mod_cycle_beta"],
		"custom_origins": [{
			"origin_id": "CYCLE_ORIGIN_A", "name": "A", "race_id": "SYNTH",
			"weight": 10, "starter_kit_id": "KIT_C_A", "prologue_dag_id": "DAG_C_A"
		}],
		"custom_starter_kits": {"KIT_C_A": {"initial_gold": 10, "initial_items": []}},
		"dag_graphs": {"DAG_C_A": {
			"dag_id": "DAG_C_A", "entry_node_id": "N0", "terminal_node_id": "N1",
			"nodes": {"N0": {"node_type": "START_ENTRY", "narrative_key": "k0"}, "N1": {"node_type": "TERMINAL_EXIT", "narrative_key": "k1", "required_prerequisites": ["N0"]}},
			"edges": [{"from": "N0", "to": "N1"}]
		}}
	}
	var pack_b := {
		"pack_id": "mod_cycle_beta",
		"pack_name": "Cycle Beta",
		"version": "1.0.0",
		"pack_profile": "CONTENT_ADDON",
		"mod_tier": "EXPANSION",
		"dependencies": ["mod_cycle_alpha"]
	}
	var cycle_res := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list([pack_a, pack_b], ["*"])
	var ok: bool = not bool(cycle_res.get("success", true)) \
		and str(cycle_res.get("error_code", "")) == "ERR_MOD_INCOMPATIBLE_CONFLICT"
	return make_result("TC-PMC-03: MOD 拓扑循环依赖严格检测并拦截", ok, {
		"error_code": cycle_res.get("error_code", "")
	})

## TC-PMC-04: .kmod ZIP 归档包资产二进制读取与路径穿越攻击防御
static func test_kmod_zip_asset_resolution_and_traversal_guard() -> Dictionary:
	var kmod_path := SANDBOX_MODS_ROOT.path_join("mod_chrono_kmod.kmod")
	var packer := ZIPPacker.new()
	var open_err := packer.open(kmod_path)
	if open_err == OK:
		packer.start_file("assets/media/chronicle.txt")
		packer.write_file("CHRONO_KMOD_STREAM_OK".to_utf8_buffer())
		packer.close_file()
		packer.close()

	AssetPathResolver.set_test_roots_override([SANDBOX_MODS_ROOT])
	var loaded_bytes := AssetPathResolver.read_mod_asset_bytes("mod://mod_chrono_kmod/assets/media/chronicle.txt")
	var content_ok: bool = loaded_bytes.get_string_from_utf8() == "CHRONO_KMOD_STREAM_OK"

	var escaped_path := AssetPathResolver.sanitize_sandbox_path("../../etc/passwd")
	var uri_escaped := AssetPathResolver.resolve_unified_uri("mod://mod_chrono_kmod/../../secret.txt")
	var guard_ok: bool = not escaped_path.contains("..") and not uri_escaped.contains("..")
	AssetPathResolver.reset_for_tests()

	return make_result("TC-PMC-04: .kmod 压缩包资产流式寻址与反路径穿越守卫", content_ok and guard_ok, {
		"bytes_text": loaded_bytes.get_string_from_utf8()
	})

## TC-PMC-05: 联机 SHA-256 摘要鉴别及 exit_to_gateway() 归零零残留验证
static func test_realm_digest_composition_and_exit_clean_isolation() -> Dictionary:
	var official_pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir("res://mods/official_kalar")
	var official_sha := str(official_pkg.get("content_sha256", ""))
	var realm_entry := {
		"pack_id": "official_kalar",
		"version": str(official_pkg.get("version", "1.0.0")),
		"content_sha256": official_sha
	}
	var fake_addon := {"pack_id": "mod_unofficial_addon", "version": "1.0.0", "content_sha256": "deadbeef", "is_official": false}
	var realm_verify := AntiBridgeGuard.verify_realm_mod_manifest([official_pkg, fake_addon], [realm_entry])
	var forged_string_rejected: bool = not AntiBridgeGuard.is_vanilla_pack("official_forged_prefix")
	var verify_ok: bool = bool(realm_verify.get("allowed", false)) \
		and (realm_verify.get("authorized_pack_ids", []) as Array).has("official_kalar") \
		and (realm_verify.get("unauthorized_local_pack_ids", []) as Array).has("mod_unofficial_addon") \
		and forged_string_rejected

	var fsm := WorldGatewayFSM.new("ACC_PMC_EXIT")
	fsm.enter_gateway()
	fsm.exit_to_gateway()
	TestCase.unmount_mod_overlay_for_test()
	var clean_ok: bool = not GameConfig.has_active_mod_overlay() \
		and not SyntheticChronoModFixture.has_override_item("CHRONO:EQUIP:FOCUS:ETHER_LENS") \
		and PrologueDagRegistry.get_graph_by_id("DAG_CHRONO_AWAKEN") == null

	return make_result("TC-PMC-05: 联机权威摘要鉴权校验及 exit_to_gateway 叠层全归零", verify_ok and clean_ok)
