# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/mod_manifest_validator.gd
# 架构定位: Domain Logic Component / Single-Pack Manifest Validator
# 依赖与触发: 上游: ModPrecheckAndAdaptationSolver | 下游: DestinyModManifestDTO, GameConfig | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 负责单包命途 MOD 清单的数据合规性校验、身世数值预算审查、因果天平代数和判定与初始行囊上限守卫。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约 (Inv-DESTINY-PRECHECK-1)
# ==============================================================================

## ModManifestValidator：单包命途 MOD 清单静态合规性校验器
class_name ModManifestValidator
extends RefCounted

const VALID_UI_MODES: Array[String] = ["INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"]
const ATTR_BONUS_MIN: int = -2
const ATTR_BONUS_MAX: int = 3
const ATTR_NET_SUM_MIN: int = -2
const ATTR_NET_SUM_MAX: int = 4
const INITIAL_GOLD_MIN: int = 0
const INITIAL_GOLD_MAX: int = 1000
const CAUSALITY_NET_TOLERANCE: int = 1
const STARTER_KIT_MAX_ITEMS: int = 10

## 校验单个命途 MOD 声明清单的预算边界、因果平衡与初始套件合法性
static func precheck_single_mod(manifest_input: Variant, base_manifest: Variant = null) -> Dictionary:
	var manifest_dto: DestinyModManifestDTO = _coerce_to_manifest_dto(manifest_input)
	var errors: Array[Dictionary] = []

	if manifest_dto.pack_id.strip_edges().is_empty():
		_append_error(errors, "ERR_DESTINY_EMPTY_PACK_ID", "MOD pack_id 不可为空")

	_validate_ui_capabilities(manifest_dto.ui_capabilities, errors)
	_validate_custom_origins(manifest_dto.custom_origins, errors)
	_validate_origin_references(manifest_dto, errors, base_manifest)
	_validate_paired_presets(manifest_dto.paired_presets, manifest_dto.custom_traits, errors)
	_validate_custom_starter_kits(manifest_dto.custom_starter_kits, errors)
	_validate_dag_graphs(manifest_dto.dag_graphs, errors)

	var first_code: String = ""
	var error_code_list: Array = []
	if not errors.is_empty():
		first_code = str(errors[0].get("error_code", ""))
		for error_entry in errors:
			var error_code: String = str(error_entry.get("error_code", ""))
			if not error_code.is_empty() and not error_code_list.has(error_code):
				error_code_list.append(error_code)

	var is_ok: bool = errors.is_empty()
	return {
		"valid": is_ok,
		"is_compliant": is_ok,
		"pack_id": manifest_dto.pack_id,
		"pack_name": manifest_dto.pack_name,
		"error_code": first_code,
		"errors": error_code_list,
		"error_details": errors,
		"manifest": manifest_dto
	}

static func _coerce_to_manifest_dto(manifest_input: Variant) -> DestinyModManifestDTO:
	if manifest_input is DestinyModManifestDTO:
		return manifest_input as DestinyModManifestDTO
	if manifest_input is Dictionary:
		return DestinyModManifestDTO.from_dto(manifest_input as Dictionary)
	return DestinyModManifestDTO.new()

static func _append_error(errors: Array[Dictionary], code: String, message: String) -> void:
	errors.append({
		"error_code": code,
		"message": message
	})

static func _validate_ui_capabilities(ui_capabilities: Dictionary, errors: Array[Dictionary]) -> void:
	if ui_capabilities.has("origin_selection_mode"):
		var origin_mode: String = str(ui_capabilities.get("origin_selection_mode", "")).strip_edges()
		if not origin_mode.is_empty() and not VALID_UI_MODES.has(origin_mode):
			_append_error(errors, "ERR_DESTINY_INVALID_UI_MODE", "非法的 origin_selection_mode: " + origin_mode)

	if ui_capabilities.has("trait_selection_mode"):
		var trait_mode: String = str(ui_capabilities.get("trait_selection_mode", "")).strip_edges()
		if not trait_mode.is_empty() and not VALID_UI_MODES.has(trait_mode):
			_append_error(errors, "ERR_DESTINY_INVALID_UI_MODE", "非法的 trait_selection_mode: " + trait_mode)

static func _validate_custom_origins(custom_origins: Array[Dictionary], errors: Array[Dictionary]) -> void:
	for origin_entry in custom_origins:
		_validate_single_origin_entry(origin_entry, errors)

static func _validate_single_origin_entry(origin_entry: Dictionary, errors: Array[Dictionary]) -> void:
	var origin_id: String = str(origin_entry.get("origin_id", "")).strip_edges()
	var bonus: Variant = origin_entry.get("attribute_bonus", {})
	var net_sum: int = 0
	var stat_exceeded: bool = false

	if bonus is Dictionary:
		var bonus_dict: Dictionary = bonus
		for stat_key in bonus_dict.keys():
			var bonus_value: int = int(bonus_dict[stat_key])
			if bonus_value < ATTR_BONUS_MIN or bonus_value > ATTR_BONUS_MAX:
				stat_exceeded = true
			net_sum += bonus_value

	if stat_exceeded or net_sum < ATTR_NET_SUM_MIN or net_sum > ATTR_NET_SUM_MAX:
		_append_error(
			errors,
			"ERR_DESTINY_STAT_BUDGET_EXCEEDED",
			"身世属性修正预算超限: " + origin_id
		)

	var gold: int = int(origin_entry.get("initial_gold", 0))
	if gold < INITIAL_GOLD_MIN or gold > INITIAL_GOLD_MAX:
		_append_error(
			errors,
			"ERR_DESTINY_GOLD_CAP_EXCEEDED",
			"身世初始金币超出 [0, 1000] 区间: " + origin_id
		)

static func _validate_paired_presets(
	paired_presets: Array[Dictionary],
	custom_traits: Dictionary,
	errors: Array[Dictionary]
) -> void:
	var combined_traits: Dictionary = GameConfig.get_dict("domains.character_creation", "traits", {}).duplicate(true)
	for trait_id in custom_traits.keys():
		combined_traits[str(trait_id)] = custom_traits[trait_id]

	for preset in paired_presets:
		_validate_single_preset_pair(preset, combined_traits, errors)

static func _validate_single_preset_pair(
	preset: Dictionary,
	combined_traits: Dictionary,
	errors: Array[Dictionary]
) -> void:
	var positive_id: String = str(preset.get("positive", "")).strip_edges()
	var negative_id: String = str(preset.get("negative", "")).strip_edges()
	if positive_id.is_empty() or negative_id.is_empty():
		_append_error(errors, "ERR_DESTINY_CAUSALITY_IMBALANCE", "配对天赋存在空 ID")
		return
	if not combined_traits.has(positive_id) or not combined_traits.has(negative_id):
		_append_error(errors, "ERR_DESTINY_CAUSALITY_IMBALANCE", "配对天赋引用了未定义的天赋 ID")
		return

	var positive_config: Dictionary = combined_traits.get(positive_id, {})
	var negative_config: Dictionary = combined_traits.get(negative_id, {})
	var positive_type: String = str(positive_config.get("type", ""))
	var negative_type: String = str(negative_config.get("type", ""))
	var positive_cost: int = int(positive_config.get("cost", 0))
	var negative_cost: int = int(negative_config.get("cost", 0))

	var type_valid: bool = (positive_type == "POSITIVE" and positive_cost > 0 and negative_type == "NEGATIVE" and negative_cost < 0)
	var balance_valid: bool = absi(positive_cost + negative_cost) <= CAUSALITY_NET_TOLERANCE
	if not type_valid or not balance_valid:
		_append_error(
			errors,
			"ERR_DESTINY_CAUSALITY_IMBALANCE",
			"正负天赋极性错误或净代价超出 [-1, 1] 因果平衡限制: %s / %s" % [positive_id, negative_id]
		)

static func _validate_custom_starter_kits(custom_kits: Dictionary, errors: Array[Dictionary]) -> void:
	for kit_id in custom_kits.keys():
		_validate_single_starter_kit(str(kit_id), custom_kits[kit_id], errors)

static func _validate_single_starter_kit(
	kit_id: String,
	raw_kit: Variant,
	errors: Array[Dictionary]
) -> void:
	if kit_id.strip_edges().is_empty() or not (raw_kit is Dictionary):
		_append_error(errors, "ERR_DESTINY_KIT_INVALID", "初始套件定义结构非法: " + kit_id)
		return

	var kit_dict: Dictionary = raw_kit
	var items_value: Variant = kit_dict.get("initial_items", [])
	if not (items_value is Array):
		_append_error(errors, "ERR_DESTINY_KIT_INVALID", "套件 initial_items 必须为数组: " + kit_id)
		return

	var items_array: Array = items_value
	var total_count: int = 0
	for item_entry in items_array:
		var step_count: int = _validate_and_count_kit_item(item_entry)
		if step_count <= 0:
			_append_error(errors, "ERR_DESTINY_KIT_INVALID", "套件物品 canonical_id 为空或数量非法: " + kit_id)
			return
		total_count += step_count

	if total_count > STARTER_KIT_MAX_ITEMS:
		_append_error(errors, "ERR_DESTINY_KIT_INVALID", "单套件物品总数超过上限 10: " + kit_id)

static func _validate_and_count_kit_item(item_entry: Variant) -> int:
	if not (item_entry is Dictionary):
		return -1
	var item_dict: Dictionary = item_entry
	var canonical_id: String = str(item_dict.get("canonical_id", "")).strip_edges()
	var count: int = int(item_dict.get("count", 1))
	if canonical_id.is_empty() or count <= 0:
		return -1
	return count

static func _validate_origin_references(manifest_dto: DestinyModManifestDTO, errors: Array[Dictionary], _base_manifest: Variant = null) -> void:
	var builtin_kits: Dictionary = GameConfig.get_dict("domains.starter_loadout", "starter_kits", {})
	var builtin_dags: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
	for origin_entry in manifest_dto.custom_origins:
		var kit_id: String = str(origin_entry.get("starter_kit_id", "")).strip_edges()
		if not kit_id.is_empty() and not manifest_dto.custom_starter_kits.has(kit_id) and not builtin_kits.has(kit_id):
			_append_error(errors, "ERR_DESTINY_UNKNOWN_KIT_REF", "未定义的套件引用: " + kit_id)
		var dag_id: String = str(origin_entry.get("prologue_dag_id", "")).strip_edges()
		if not manifest_dto.dag_graphs.is_empty() and not dag_id.is_empty() and not manifest_dto.dag_graphs.has(dag_id) and not builtin_dags.has(dag_id):
			_append_error(errors, "ERR_DESTINY_UNKNOWN_DAG_REF", "未定义的剧情DAG引用: " + dag_id)

static func _validate_dag_graphs(dag_graphs: Dictionary, errors: Array[Dictionary]) -> void:
	for graph_id in dag_graphs.keys():
		var raw_graph: Variant = dag_graphs[graph_id]
		if not (raw_graph is Dictionary):
			_append_error(errors, "ERR_DESTINY_INVALID_DAG_GRAPH", "非法DAG定义: " + str(graph_id))
			continue
		var graph_model := PrologueDagRegistry.assemble_graph_from_raw(str(graph_id), raw_graph as Dictionary)
		var validation_result := CausalityDagValidator.validate_graph(graph_model)
		if not bool(validation_result.get("is_valid", false)):
			_append_error(errors, "ERR_DESTINY_INVALID_DAG_GRAPH", "DAG校验失败: %s" % str(graph_id))
