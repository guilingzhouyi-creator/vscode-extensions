# ==============================================================================
# 单元测试：Phase 68 数据域划分与统一域契约 (Save Domain Contracts)
# 文件路径: res://tests/unit/infrastructure/test_save_domain_contracts.gd
# 职责: 验证数据域单一所有权、统一域契约接口、信封契约保持、
#       配置/运行时分离与三级版本模型（TC-SV-01 ~ TC-SV-05）。
# ==============================================================================
class_name TestSaveDomainContracts extends RefCounted

const SaveDomainContract = preload("res://backend/domains/persistence_protocol/save_domain_contract.gd")
const SaveValidationService = preload("res://backend/domains/persistence_protocol/save_validation_service.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const SaveMigrationEngine = preload("res://backend/domains/persistence_protocol/save_migration_engine.gd")
const EditorHotReloadManager = preload("res://backend/domains/persistence_protocol/editor_hot_reload_manager.gd")
const RuntimeModeGate = preload("res://backend/domains/persistence_protocol/runtime_mode_gate.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_domain_single_ownership())
	results.append(test_unified_contract_signatures())
	results.append(test_envelope_contract_integrity())
	results.append(test_config_runtime_separation())
	results.append(test_three_tier_version_model())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "Phase 68: 存档数据域划分与统一数据契约",
		"all_passed": all_passed,
		"results": results
	}

## TC-SV-01: 数据域划分单一所有权校验（Inv-SV-1）
static func test_domain_single_ownership() -> Dictionary:
	var manifest: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
	var save_domains: Array[String] = []
	var duplicates: Array[String] = []

	for entry in manifest:
		var save_cfg: Dictionary = entry.get("save", {})
		if bool(save_cfg.get("enabled", false)):
			var id := String(entry.get("id", ""))
			if save_domains.has(id):
				duplicates.append(id)
			else:
				save_domains.append(id)

	# 核心业务持久化域必须齐备（至少 10 个关键域已登记）
	var required_key_domains: Array[String] = [
		"inventory", "world_navigation", "lattice_skill_book", "persistence_protocol",
		"lifecycle_physiology", "quest_causality", "currency_economy", "account",
		"character_creation", "game_settings"
	]
	var missing: Array[String] = []
	for req in required_key_domains:
		if not save_domains.has(req):
			missing.append(req)

	var passed := duplicates.is_empty() and missing.is_empty() and save_domains.size() >= 10
	return {
		"test": "TC-SV-01: 数据域划分单一所有权与关键业务域覆盖",
		"passed": passed,
		"duplicates": duplicates,
		"missing": missing,
		"registered_count": save_domains.size()
	}

## TC-SV-02: 统一域契约签名与纯值类型约束（Inv-SV-2/5）
static func test_unified_contract_signatures() -> Dictionary:
	# 构造虚拟数据提供者与接收者
	SaveDataAccessLayer.reset_for_tests()
	var test_inv := WearableInventoryAggregate.new()
	test_inv.owner_account_id = "test_player_001"

	# 1. 验证 WearableInventoryAggregate 实现统一接口
	var has_serialize: bool = test_inv.has_method("serialize")
	var serialized: Dictionary = test_inv.serialize() if has_serialize else {}
	var has_deserialize: bool = test_inv.has_method("deserialize")

	# 2. 验证纯值类型字典（无 Node、无 Object 句柄残留）
	var is_value_type: bool = true
	for k in serialized.keys():
		var val: Variant = serialized[k]
		if val is Object and not (val is RefCounted):
			is_value_type = false
			break

	# 3. 注册到统一访问层并装配
	SaveDataAccessLayer.register_provider("inventory", test_inv)
	var contract: Variant = SaveDataAccessLayer.get_contract("inventory")
	var contract_ok: bool = contract != null and contract.is_provider_registered()

	var payload: Dictionary = SaveDataAccessLayer.build_save_payload(["inventory"])
	var payload_data: Dictionary = payload.get("data", {})
	var assembled_ok: bool = payload_data.has("inventory")

	var passed: bool = has_serialize and has_deserialize and is_value_type and contract_ok and assembled_ok
	return {
		"test": "TC-SV-02: 统一域契约规范化序列化接口与纯值类型断言",
		"passed": passed,
		"has_serialize": has_serialize,
		"has_deserialize": has_deserialize,
		"is_value_type": is_value_type,
		"assembled_ok": assembled_ok
	}

## TC-SV-03: 信封契约保持与原子写签名机制（Inv-SV-2）
static func test_envelope_contract_integrity() -> Dictionary:
	var slot := "test_envelope_slot_p68"
	var payload := {
		"data": {
			"inventory": { "equipped_payloads": {}, "owner_account_id": "acc_001" },
			"account": { "account_id": "acc_001", "level": 10 }
		}
	}

	var save_res := SaveDataAccessLayer.save_game(slot, payload)
	if not bool(save_res.get("success", false)):
		return { "test": "TC-SV-03: 信封契约保持与原子读写验证", "passed": false, "reason": "save_failed" }

	var load_res := SaveDataAccessLayer.load_game(slot)
	var load_ok: bool = bool(load_res.get("success", false))
	var meta: Dictionary = load_res.get("meta", {})
	var data_json: String = String(meta.get("data_json", ""))
	var sha256: String = String(meta.get("signature_sha256", ""))

	# 验证 SHA-256 签名指向 data_json 字符串本身（单字段信封契约）
	var calculated_sha: String = SaveManager.compute_sha256(data_json)
	var sign_matches: bool = (calculated_sha == sha256)

	var passed: bool = load_ok and sign_matches and not data_json.is_empty()
	return {
		"test": "TC-SV-03: 信封契约保持与 data_json 单字段签名哈希校验",
		"passed": passed,
		"sha256_match": sign_matches
	}

## TC-SV-04: 配置/运行时分离（Inv-SV-3）
static func test_config_runtime_separation() -> Dictionary:
	var item := ItemEntity.new()
	item.item_id = "test_sword_01"
	item.item_uid = "item_uid_9999"
	item.template_id = "IRON_SWORD"
	item.custom_name = "青锋剑"

	var serialized := item.serialize()
	# 验证：存档中只保存持有实例状态与判别式，绝不保存全量静态物品配置定义
	var has_uid := serialized.has("item_uid")
	var has_id := serialized.has("item_id")
	# 物品定义中的全局静态文案、通用数值模板等不应重复存储
	var serialized_json := JSON.stringify(serialized)
	var no_scene_leaks := not serialized_json.contains("res://")

	# 技能格栅 AST 序列化验证
	var ast := SkillSubgraphAST.new()
	ast.signature_hash = "sig_hash_abc"
	var ast_serialized := ast.serialize()
	var ast_has_sig := ast_serialized.has("signature_hash")

	var passed := has_uid and has_id and no_scene_leaks and ast_has_sig
	return {
		"test": "TC-SV-04: 配置定义与运行时持有数据严格分离断言",
		"passed": passed,
		"has_uid": has_uid,
		"no_scene_leaks": no_scene_leaks
	}

## TC-SV-05: 三级版本模型识别与配置自洽（Inv-SV-4）
static func test_three_tier_version_model() -> Dictionary:
	# 1. Save Version (信封格式版本，persistence.json format_version)
	var save_ver: String = GameConfig.get_string("infrastructure.persistence", "format_version", "")
	# 2. Schema Version (布局版本，persistence.json schema_version)
	var schema_ver: int = GameConfig.get_int("infrastructure.persistence", "schema_version", 0)
	# 3. Domain Version (各域独立版本)
	var inv_contract: Variant = SaveDataAccessLayer.get_contract("inventory")
	var domain_ver: int = int(inv_contract.domain_version) if inv_contract != null else 0

	var passed: bool = not save_ver.is_empty() and schema_ver >= 1 and domain_ver >= 1
	return {
		"test": "TC-SV-05: 三级版本模型（Domain/Schema/Save）结构与配置自洽断言",
		"passed": passed,
		"save_version": save_ver,
		"schema_version": schema_ver,
		"inventory_domain_version": domain_ver
	}
