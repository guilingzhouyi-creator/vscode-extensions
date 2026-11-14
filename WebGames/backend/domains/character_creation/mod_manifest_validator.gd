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

const ModManifestRuleHelper = preload("res://backend/domains/character_creation/mod_manifest_rule_helper.gd")

const VALID_ATTRIBUTE_KEYS: Array[String] = ["STR", "AGI", "CON", "INT", "SPR", "VIT"]
const VALID_TRAIT_TYPES: Array[String] = ["POSITIVE", "NEGATIVE"]
const ATTR_BONUS_MIN: int = -2
const ATTR_BONUS_MAX: int = 3
const ATTR_NET_SUM_MIN: int = -2
const ATTR_NET_SUM_MAX: int = 4
const INITIAL_GOLD_MIN: int = 0
const INITIAL_GOLD_MAX: int = 1000
const CAUSALITY_NET_TOLERANCE: int = 1

## 校验单个命途 MOD 声明清单的预算边界、因果平衡与初始套件合法性
static func precheck_single_mod(manifest_input: Variant, base_manifest: Variant = null) -> Dictionary:
	var manifest_model: DestinyModManifestDTO = _coerce_to_manifest_dto(manifest_input)
	var diagnostic_entries: Array[Dictionary] = []

	if manifest_model.pack_id.strip_edges().is_empty():
		ModManifestRuleHelper.append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_EMPTY_PACK_ID",
			"MOD pack_id 不可为空",
			"pack.json.pack_id",
			"",
			"请在 pack.json 中填写全小写字母、数字和下划线组成的有效 pack_id"
		)

	ModManifestRuleHelper.validate_ui_capabilities(manifest_model.ui_capabilities, diagnostic_entries)
	_validate_custom_origins(manifest_model.custom_origins, diagnostic_entries)
	ModManifestRuleHelper.validate_origin_references(manifest_model, diagnostic_entries, base_manifest)
	_validate_custom_traits(manifest_model.custom_traits, diagnostic_entries)
	_validate_paired_presets(manifest_model.paired_presets, manifest_model.custom_traits, diagnostic_entries)
	ModManifestRuleHelper.validate_custom_starter_kits(manifest_model.custom_starter_kits, diagnostic_entries)
	ModManifestRuleHelper.validate_dag_graphs(manifest_model.dag_graphs, diagnostic_entries)

	var first_code: String = ""
	var error_code_list: Array = []
	if not diagnostic_entries.is_empty():
		first_code = str(diagnostic_entries[0].get("error_code", ""))
		for diagnostic_entry in diagnostic_entries:
			var error_code: String = str(diagnostic_entry.get("error_code", ""))
			if not error_code.is_empty() and not error_code_list.has(error_code):
				error_code_list.append(error_code)

	var is_valid: bool = diagnostic_entries.is_empty()
	return {
		"valid": is_valid,
		"is_compliant": is_valid,
		"pack_id": manifest_model.pack_id,
		"pack_name": manifest_model.pack_name,
		"error_code": first_code,
		"errors": error_code_list,
		"error_details": diagnostic_entries,
		"diagnostics": diagnostic_entries,
		"manifest": manifest_model
	}

static func _coerce_to_manifest_dto(manifest_input: Variant) -> DestinyModManifestDTO:
	if manifest_input is DestinyModManifestDTO:
		return manifest_input as DestinyModManifestDTO
	if manifest_input is Dictionary:
		return DestinyModManifestDTO.from_dto(manifest_input as Dictionary)
	return DestinyModManifestDTO.new()

static func _validate_custom_origins(custom_origins: Array[Dictionary], diagnostic_entries: Array[Dictionary]) -> void:
	var seen_origin_identifiers: Dictionary = {}
	var origin_index: int = 0
	for origin_entry in custom_origins:
		var origin_identifier: String = str(origin_entry.get("origin_id", "")).strip_edges()
		if not origin_identifier.is_empty():
			if seen_origin_identifiers.has(origin_identifier):
				ModManifestRuleHelper.append_diagnostic(
					diagnostic_entries,
					"ERR_DESTINY_DUPLICATE_ORIGIN_ID",
					"同一 MOD 包内存在重复声明的 origin_id: " + origin_identifier,
					"destinies.custom_origins[%d].origin_id" % origin_index,
					origin_identifier,
					"请确保 custom_origins 中每个条目的 origin_id 全局唯一"
				)
			else:
				seen_origin_identifiers[origin_identifier] = true
		_validate_single_origin_entry(origin_entry, origin_index, diagnostic_entries)
		origin_index += 1

static func _validate_single_origin_entry(
	origin_entry: Dictionary,
	origin_index: int,
	diagnostic_entries: Array[Dictionary]
) -> void:
	var origin_identifier: String = str(origin_entry.get("origin_id", "")).strip_edges()
	var bonus: Variant = origin_entry.get("attribute_bonus", {})
	var net_sum: int = 0
	var is_stat_exceeded: bool = false

	if bonus is Dictionary:
		var bonus_map: Dictionary = bonus
		for attribute_key_variant in bonus_map.keys():
			var attribute_key: String = str(attribute_key_variant).strip_edges()
			if not VALID_ATTRIBUTE_KEYS.has(attribute_key):
				ModManifestRuleHelper.append_diagnostic(
					diagnostic_entries,
					"ERR_DESTINY_UNKNOWN_ATTRIBUTE_KEY",
					"身世包含未定义属性键 '%s': %s" % [attribute_key, origin_identifier],
					"destinies.custom_origins[%d].attribute_bonus.%s" % [origin_index, attribute_key],
					origin_identifier,
					"属性加成键仅允许 STR、AGI、CON、INT、SPR、VIT 六项规范键"
				)
				continue
			var bonus_value: int = int(bonus_map[attribute_key_variant])
			if bonus_value < ATTR_BONUS_MIN or bonus_value > ATTR_BONUS_MAX:
				is_stat_exceeded = true
			net_sum += bonus_value

	if is_stat_exceeded or net_sum < ATTR_NET_SUM_MIN or net_sum > ATTR_NET_SUM_MAX:
		ModManifestRuleHelper.append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_STAT_BUDGET_EXCEEDED",
			"身世属性修正预算超限: " + origin_identifier,
			"destinies.custom_origins[%d].attribute_bonus" % origin_index,
			origin_identifier,
			"请保证单项加成位于 [-2, 3] 且六维净总和位于 [-2, 4]"
		)

	var gold: int = int(origin_entry.get("initial_gold", 0))
	if gold < INITIAL_GOLD_MIN or gold > INITIAL_GOLD_MAX:
		ModManifestRuleHelper.append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_GOLD_CAP_EXCEEDED",
			"身世初始金币超出 [0, 1000] 区间: " + origin_identifier,
			"destinies.custom_origins[%d].initial_gold" % origin_index,
			origin_identifier,
			"请将 initial_gold 调整至 0 到 1000 区间"
		)

static func _validate_custom_traits(custom_traits: Dictionary, diagnostic_entries: Array[Dictionary]) -> void:
	for trait_key_variant in custom_traits.keys():
		var trait_identifier: String = str(trait_key_variant).strip_edges()
		var raw_trait: Variant = custom_traits[trait_key_variant]
		if trait_identifier.is_empty() or not (raw_trait is Dictionary):
			ModManifestRuleHelper.append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_CAUSALITY_IMBALANCE",
				"自定义特质定义结构无效: " + trait_identifier,
				"destinies.custom_traits.%s" % trait_identifier,
				trait_identifier,
				"请确保特质 ID 非空且定义为包含 type 与 cost 的字典"
			)
			continue
		var trait_map: Dictionary = raw_trait
		var raw_type: String = str(trait_map.get("type", trait_map.get("polarity", ""))).strip_edges().to_upper()
		var trait_cost: int = int(trait_map.get("cost", 0))
		var is_polarity_valid: bool = (
			VALID_TRAIT_TYPES.has(raw_type)
			and ((raw_type == "POSITIVE" and trait_cost > 0) or (raw_type == "NEGATIVE" and trait_cost < 0))
		)
		if not is_polarity_valid:
			ModManifestRuleHelper.append_diagnostic(
				diagnostic_entries,
				"ERR_DESTINY_CAUSALITY_IMBALANCE",
				"自定义特质极性与花费符号不匹配或为零: " + trait_identifier,
				"destinies.custom_traits.%s" % trait_identifier,
				trait_identifier,
				"POSITIVE 特质须满足 cost > 0，NEGATIVE 特质须满足 cost < 0"
			)

static func _validate_paired_presets(
	paired_presets: Array[Dictionary],
	custom_traits: Dictionary,
	diagnostic_entries: Array[Dictionary]
) -> void:
	var combined_traits: Dictionary = GameConfig.get_dict("domains.character_creation", "traits", {}).duplicate(true)
	for trait_identifier in custom_traits.keys():
		combined_traits[str(trait_identifier)] = custom_traits[trait_identifier]

	var preset_index: int = 0
	for preset in paired_presets:
		_validate_single_preset_pair(preset, preset_index, combined_traits, diagnostic_entries)
		preset_index += 1

static func _validate_single_preset_pair(
	preset: Dictionary,
	preset_index: int,
	combined_traits: Dictionary,
	diagnostic_entries: Array[Dictionary]
) -> void:
	var positive_identifier: String = str(preset.get("positive", "")).strip_edges()
	var negative_identifier: String = str(preset.get("negative", "")).strip_edges()
	var preset_field_path: String = "destinies.paired_presets[%d]" % preset_index
	if positive_identifier.is_empty() or negative_identifier.is_empty():
		ModManifestRuleHelper.append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_CAUSALITY_IMBALANCE",
			"配对天赋存在空 ID",
			preset_field_path,
			"",
			"请同时填写 positive 与 negative 有效特质标识符"
		)
		return
	if not combined_traits.has(positive_identifier) or not combined_traits.has(negative_identifier):
		ModManifestRuleHelper.append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_CAUSALITY_IMBALANCE",
			"配对天赋引用了未定义的天赋 ID",
			preset_field_path,
			"%s/%s" % [positive_identifier, negative_identifier],
			"请确保配对中引用的正负特质均已声明于 custom_traits 或内置特质库"
		)
		return

	var positive_config: Dictionary = combined_traits.get(positive_identifier, {})
	var negative_config: Dictionary = combined_traits.get(negative_identifier, {})
	var positive_type: String = str(positive_config.get("type", positive_config.get("polarity", ""))).strip_edges().to_upper()
	var negative_type: String = str(negative_config.get("type", negative_config.get("polarity", ""))).strip_edges().to_upper()
	var positive_cost: int = int(positive_config.get("cost", 0))
	var negative_cost: int = int(negative_config.get("cost", 0))

	var is_type_valid: bool = (positive_type == "POSITIVE" and positive_cost > 0 and negative_type == "NEGATIVE" and negative_cost < 0)
	var is_balance_valid: bool = absi(positive_cost + negative_cost) <= CAUSALITY_NET_TOLERANCE
	if not is_type_valid or not is_balance_valid:
		ModManifestRuleHelper.append_diagnostic(
			diagnostic_entries,
			"ERR_DESTINY_CAUSALITY_IMBALANCE",
			"正负天赋极性错误或净代价超出 [-1, 1] 因果平衡限制: %s / %s" % [positive_identifier, negative_identifier],
			preset_field_path,
			"%s/%s" % [positive_identifier, negative_identifier],
			"请配平正负特质 cost，使 positive > 0、negative < 0 且 |positive + negative| <= 1"
		)
