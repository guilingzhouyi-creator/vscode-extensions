# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/mod_manifest_rule_helper.gd
# 架构定位: Domain Validation Helper / Starter Kit, Reference & DAG Rules
# 依赖与触发: 上游: ModManifestValidator | 下游: DestinyModManifestDTO, GameConfig, PrologueDagRegistry, CausalityDagValidator
# 职责说明: 承载命途 MOD 清单的结构化诊断条目封装、界面能力模式校验、初始套件校验、跨表引用校验与序章 DAG 图元校验。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约 (Inv-DESTINY-PRECHECK-1)
# ==============================================================================

## ModManifestRuleHelper：命途 MOD 清单规则与引用校验助手
class_name ModManifestRuleHelper
extends RefCounted

const VALID_UI_MODES: Array[String] = ["INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"]
const STARTER_KIT_MAX_ITEMS: int = 10

## 向结构化诊断收集列表追加标准错因条目
static func append_diagnostic(
	diagnostic_entries: Array[Dictionary],
	code: String,
	message: String,
	field_path: String = "",
	entity_identifier: String = "",
	fix_suggestion: String = ""
) -> void:
	diagnostic_entries.append({
		"error_code": code,
		"code": code,
		"message": message,
		"field_path": field_path,
		"entity_id": entity_identifier,
		"fix_suggestion": fix_suggestion
	})

## 校验界面身世与特质选择模式声明
static func validate_ui_capabilities(ui_capabilities: Dictionary, diagnostic_entries: Array[Dictionary]) -> void:
	if ui_capabilities.has("origin_selection_mode"):
		var origin_mode: String = str(ui_capabilities.get("origin_selection_mode", "")).strip_edges()
		if not origin_mode.is_empty() and not VALID_UI_MODES.has(origin_mode):
			append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_INVALID_UI_MODE",
				"非法的 origin_selection_mode: " + origin_mode,
				"destinies.ui_capabilities.origin_selection_mode",
				origin_mode,
				"请将该字段修改为 INHERIT、ALLOW_MANUAL 或 FORCE_RANDOM"
			)

	if ui_capabilities.has("trait_selection_mode"):
		var trait_mode: String = str(ui_capabilities.get("trait_selection_mode", "")).strip_edges()
		if not trait_mode.is_empty() and not VALID_UI_MODES.has(trait_mode):
			append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_INVALID_UI_MODE",
				"非法的 trait_selection_mode: " + trait_mode,
				"destinies.ui_capabilities.trait_selection_mode",
				trait_mode,
				"请将该字段修改为 INHERIT、ALLOW_MANUAL 或 FORCE_RANDOM"
			)

## 校验自定义初始行囊套件集合及件数上限
static func validate_custom_starter_kits(
	custom_kits: Dictionary,
	diagnostic_entries: Array[Dictionary],
	enforce_addon_caps: bool = true
) -> void:
	for kit_identifier in custom_kits.keys():
		_validate_single_starter_kit(str(kit_identifier), custom_kits[kit_identifier], diagnostic_entries, enforce_addon_caps)

static func _validate_single_starter_kit(
	kit_identifier: String,
	raw_kit: Variant,
	diagnostic_entries: Array[Dictionary],
	enforce_addon_caps: bool = true
) -> void:
	var kit_field_path: String = "destinies.custom_starter_kits.%s" % kit_identifier
	if kit_identifier.strip_edges().is_empty() or not (raw_kit is Dictionary):
		append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_KIT_INVALID",
			"初始套件定义结构非法: " + kit_identifier,
			kit_field_path,
			kit_identifier,
			"请确保套件 ID 非空且定义为标准字典对象"
		)
		return

	var kit_map: Dictionary = raw_kit
	var items_value: Variant = kit_map.get("initial_items", [])
	if not (items_value is Array):
		append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_KIT_INVALID",
			"套件 initial_items 必须为数组: " + kit_identifier,
			kit_field_path + ".initial_items",
			kit_identifier,
			"请将 initial_items 声明为物品条目对象数组"
		)
		return

	var items_array: Array = items_value
	var total_count: int = 0
	for item_entry in items_array:
		var step_count: int = _validate_and_count_kit_item(item_entry)
		if step_count <= 0:
			append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_KIT_INVALID",
				"套件物品 canonical_id 为空或数量非法: " + kit_identifier,
				kit_field_path + ".initial_items",
				kit_identifier,
				"请确保每项物品包含非空 canonical_id 且 count >= 1"
			)
			return
		total_count += step_count

	if enforce_addon_caps and total_count > STARTER_KIT_MAX_ITEMS:
		append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_KIT_INVALID",
			"单套件物品总数超过上限 10: " + kit_identifier,
			kit_field_path + ".initial_items",
			kit_identifier,
			"请将单个初始套件内物品总件数缩减至 10 件以内"
		)

static func _validate_and_count_kit_item(item_entry: Variant) -> int:
	if not (item_entry is Dictionary):
		return -1
	var item_entry_map: Dictionary = item_entry
	var canonical_identifier: String = str(item_entry_map.get("canonical_id", "")).strip_edges()
	var count: int = int(item_entry_map.get("count", 1))
	if canonical_identifier.is_empty() or count <= 0:
		return -1
	return count

## 校验身世条目声明的初始套件与序章 DAG 引用有效性（联合配置与基础包引用上下文）
static func validate_origin_references(
	manifest_model: DestinyModManifestDTO,
	diagnostic_entries: Array[Dictionary],
	base_manifest: Variant = null
) -> void:
	var combined_kits: Dictionary = GameConfig.get_dict("domains.starter_loadout", "starter_kits", {}).duplicate()
	var combined_dags: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {}).duplicate()
	if base_manifest is Dictionary:
		var base_map: Dictionary = base_manifest as Dictionary
		var extra_kits: Variant = base_map.get("custom_starter_kits", {})
		if extra_kits is Dictionary:
			combined_kits.merge(extra_kits as Dictionary, true)
		var extra_dags: Variant = base_map.get("dag_graphs", {})
		if extra_dags is Dictionary:
			combined_dags.merge(extra_dags as Dictionary, true)
	elif base_manifest is DestinyModManifestDTO:
		var base_dto := base_manifest as DestinyModManifestDTO
		combined_kits.merge(base_dto.custom_starter_kits, true)
		combined_dags.merge(base_dto.dag_graphs, true)

	var origin_index: int = 0
	for origin_entry in manifest_model.custom_origins:
		var origin_identifier: String = str(origin_entry.get("origin_id", "")).strip_edges()
		var kit_identifier: String = str(origin_entry.get("starter_kit_id", "")).strip_edges()
		if not kit_identifier.is_empty() and not manifest_model.custom_starter_kits.has(kit_identifier) and not combined_kits.has(kit_identifier):
			append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_UNKNOWN_KIT_REF",
				"未定义的套件引用: " + kit_identifier,
				"destinies.custom_origins[%d].starter_kit_id" % origin_index,
				origin_identifier,
				"请改用 custom_starter_kits 或已启用基础包中声明的套件 ID"
			)
		var dag_identifier: String = str(origin_entry.get("prologue_dag_id", "")).strip_edges()
		var has_declared_dags: bool = not manifest_model.dag_graphs.is_empty() or not combined_dags.is_empty()
		if has_declared_dags and not dag_identifier.is_empty() and not manifest_model.dag_graphs.has(dag_identifier) and not combined_dags.has(dag_identifier):
			append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_UNKNOWN_DAG_REF",
				"未定义的剧情DAG引用: " + dag_identifier,
				"destinies.custom_origins[%d].prologue_dag_id" % origin_index,
				origin_identifier,
				"请确认 dag_graphs/ 或已启用基础包下存在对应图元文件"
			)
		origin_index += 1

## 校验清单附带的全部序章 DAG 图元拓扑合法性
static func validate_dag_graphs(dag_graphs: Dictionary, diagnostic_entries: Array[Dictionary]) -> void:
	for graph_identifier_variant in dag_graphs.keys():
		var graph_identifier: String = str(graph_identifier_variant)
		var raw_graph: Variant = dag_graphs[graph_identifier_variant]
		if not (raw_graph is Dictionary):
			append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_INVALID_DAG_GRAPH",
				"非法DAG定义: " + graph_identifier,
				"dag_graphs." + graph_identifier,
				graph_identifier,
				"请将 DAG 图元定义调整为标准 JSON 对象"
			)
			continue
		var graph_model := PrologueDagRegistry.assemble_graph_from_raw(graph_identifier, raw_graph as Dictionary)
		var validation_result := CausalityDagValidator.validate_graph(graph_model)
		if not bool(validation_result.get("is_valid", false)):
			append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_INVALID_DAG_GRAPH",
				"DAG校验失败: %s" % graph_identifier,
				"dag_graphs." + graph_identifier,
				graph_identifier,
				"请检查该 DAG 图元是否具有唯一 START_ENTRY、至少一个 TERMINAL_EXIT 且无环无孤立节点"
			)
