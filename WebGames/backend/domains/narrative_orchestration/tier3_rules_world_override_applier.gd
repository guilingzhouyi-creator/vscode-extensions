# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/tier3_rules_world_override_applier.gd
# 架构定位: Domain Component / Tier 3 Rules & World Topology Override Applier
# 依赖与触发: 上游: Tier3ContentOverrideLoader | 下游: Tier3ContentRecordParser
# 职责说明: 执行 Tier 3 content/rules/ 与 content/world/ 差分载荷向运行时核心公式、创角限制、经济容量及世界拓扑工作表的覆写。
# 退出语义与设计依据: 业务领域第一性原理与非破坏性运行时覆盖契约
# ==============================================================================

## Tier3RulesWorldOverrideApplier：Tier 3 全局规则与世界拓扑差分覆写应用器
class_name Tier3RulesWorldOverrideApplier
extends RefCounted

const TABLE_COMBAT_MECHANICS: String = "domains.combat.mechanics"
const TABLE_COMBAT_FORMULAS: String = "domains.combat.damage_formulas"
const TABLE_CHAR_CREATION: String = "domains.character_creation.core"
const TABLE_ATTRIBUTE_CORE: String = "domains.attribute.core"
const TABLE_CURRENCY_CORE: String = "domains.currency.core"
const TABLE_INVENTORY_CORE: String = "domains.inventory.core"
const TABLE_WORLD_CORE: String = "domains.world.core"
const TABLE_WORLD_GATEWAY_CORE: String = "domains.world_gateway.core"
const TABLE_STARTER_LOADOUT_CORE: String = "domains.starter_loadout.core"
const TABLE_MAGIC_TIERS_CORE: String = "domains.magic_tiers.core"
const TABLE_MAGIC_RULES_CORE: String = "domains.magic_rules.core"
const TABLE_QUALITY_TIERS_CORE: String = "domains.quality_tiers.core"
const TABLE_CHAT_COMMAND_CORE: String = "domains.chat_command.core"
const TABLE_EQUIPMENT_CORE: String = "domains.equipment.core"
const TABLE_LATTICE_CORE: String = "domains.lattice.core"
const TABLE_ADMIN_CORE: String = "infrastructure.admin"

const WORLD_CORE_SECTION_KEYS: Array[String] = [
	"terrain_impedance",
	"astar",
	"swarm_risk",
	"marching",
	"node_defaults",
	"town_defaults",
	"continuity",
	"default_template"
]

const WORLD_TOPOLOGY_KEYS: Array[String] = [
	"map_id",
	"map_name",
	"default_entry_node",
	"nodes",
	"edges"
]

## 应用全局游戏规则与领域常量覆写节段
static func apply_rules_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var any_changed := false
	if payload_map.get("combat_constants") is Dictionary:
		var formulas_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_COMBAT_FORMULAS)
		var combat_constants: Dictionary = payload_map["combat_constants"]
		if Tier3ContentRecordParser.apply_dictionary_sections(combat_constants, combat_constants.keys(), formulas_table, override_mode):
			any_changed = true

	if payload_map.get("mechanics") is Dictionary:
		var mechanics_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_COMBAT_MECHANICS)
		var mechanics_section: Dictionary = payload_map["mechanics"]
		if Tier3ContentRecordParser.apply_dictionary_sections(mechanics_section, mechanics_section.keys(), mechanics_table, override_mode):
			any_changed = true

	if _apply_character_rule_sections(payload_map, override_mode, working_tables, touched_tables):
		any_changed = true

	if payload_map.get("formulas") is Dictionary:
		var attribute_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_ATTRIBUTE_CORE)
		if Tier3ContentRecordParser.apply_dictionary_sections({"formulas": payload_map["formulas"]}, ["formulas"], attribute_table, override_mode):
			any_changed = true

	if payload_map.get("currency_limits") is Dictionary:
		var currency_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_CURRENCY_CORE)
		var currency_section: Dictionary = payload_map["currency_limits"]
		if Tier3ContentRecordParser.apply_dictionary_sections(currency_section, currency_section.keys(), currency_table, override_mode):
			any_changed = true

	if payload_map.get("inventory_limits") is Dictionary:
		var inventory_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_INVENTORY_CORE)
		if Tier3ContentRecordParser.apply_dictionary_sections({"inventory_limits": payload_map["inventory_limits"]}, ["inventory_limits"], inventory_table, override_mode):
			any_changed = true

	if payload_map.get("world_simulation") is Dictionary:
		var world_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_WORLD_CORE)
		if Tier3ContentRecordParser.apply_dictionary_sections({"world_simulation": payload_map["world_simulation"]}, ["world_simulation"], world_table, override_mode):
			any_changed = true

	if _apply_extended_rule_tables(payload_map, override_mode, working_tables, touched_tables):
		any_changed = true

	return any_changed

static func _apply_explicit_tables_map(
	raw_tables: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var any_changed := false
	for raw_table_name in raw_tables.keys():
		var raw_table_value: Variant = raw_tables[raw_table_name]
		if not (raw_table_value is Dictionary):
			continue
		var table_patch := raw_table_value as Dictionary
		var target_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, String(raw_table_name))
		if Tier3ContentRecordParser.apply_dictionary_sections(table_patch, table_patch.keys(), target_table, override_mode):
			any_changed = true
	return any_changed

static func _apply_extended_rule_tables(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var table_bindings: Array[Array] = [
		["starter_loadout", TABLE_STARTER_LOADOUT_CORE, []],
		["magic_tiers", TABLE_MAGIC_TIERS_CORE, []],
		["magic_rules", TABLE_MAGIC_RULES_CORE, []],
		["quality_tiers", TABLE_QUALITY_TIERS_CORE, []],
		["cdkeys", TABLE_CHAT_COMMAND_CORE, ["cdkeys"]],
		["equipment_defaults", TABLE_EQUIPMENT_CORE, []],
		["lattice_defaults", TABLE_LATTICE_CORE, []],
		["admin_sandbox_defaults", TABLE_ADMIN_CORE, ["sandbox"]]
	]
	var any_changed := false
	for binding in table_bindings:
		var source_key := String(binding[0])
		if not (payload_map.get(source_key) is Dictionary):
			continue
		var target_table_name := String(binding[1])
		var target_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, target_table_name)
		var section_patch: Dictionary = payload_map[source_key]
		var wrap_keys: Array = binding[2]
		if not wrap_keys.is_empty():
			var wrapped: Dictionary = {String(wrap_keys[0]): section_patch}
			if Tier3ContentRecordParser.apply_dictionary_sections(wrapped, wrap_keys, target_table, override_mode):
				any_changed = true
		elif Tier3ContentRecordParser.apply_dictionary_sections(section_patch, section_patch.keys(), target_table, override_mode):
			any_changed = true
	if payload_map.get("tables") is Dictionary:
		if _apply_explicit_tables_map(payload_map["tables"] as Dictionary, override_mode, working_tables, touched_tables):
			any_changed = true
	return any_changed

## 应用大地图地形阻抗、行走规则、可选自定义世界拓扑与世界目录地标节段
static func apply_world_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var world_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_WORLD_CORE)
	var changed := Tier3ContentRecordParser.apply_dictionary_sections(payload_map, WORLD_CORE_SECTION_KEYS, world_table, override_mode)

	var topology_patch: Dictionary = {}
	for topology_key in WORLD_TOPOLOGY_KEYS:
		if payload_map.has(topology_key):
			topology_patch[topology_key] = payload_map[topology_key]
	if not topology_patch.is_empty():
		if Tier3ContentRecordParser.apply_dictionary_sections({"mod_world_topology": topology_patch}, ["mod_world_topology"], world_table, override_mode):
			changed = true
	if payload_map.get("landmarks") is Array:
		if Tier3ContentRecordParser.apply_dictionary_sections({"landmarks": payload_map["landmarks"]}, ["landmarks"], world_table, override_mode):
			changed = true
	if not changed:
		touched_tables.erase(TABLE_WORLD_CORE)

	var raw_worlds: Variant = payload_map.get("worlds_catalog", null)
	if raw_worlds is Array or raw_worlds is Dictionary:
		var gateway_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_WORLD_GATEWAY_CORE)
		if Tier3ContentRecordParser.apply_dictionary_sections({"worlds_catalog": raw_worlds}, ["worlds_catalog"], gateway_table, override_mode):
			changed = true
	var raw_regions: Variant = payload_map.get("birth_regions", null)
	if raw_regions is Array or raw_regions is Dictionary:
		var creation_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_CHAR_CREATION)
		if Tier3ContentRecordParser.apply_dictionary_sections({"birth_regions": raw_regions}, ["birth_regions"], creation_table, override_mode):
			changed = true

	return changed

static func _apply_character_rule_sections(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var character_creation_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_CHAR_CREATION)
	var changed := false
	if payload_map.get("character_rules") is Dictionary:
		var character_rules: Dictionary = payload_map["character_rules"]
		if Tier3ContentRecordParser.apply_dictionary_sections(character_rules, character_rules.keys(), character_creation_table, override_mode):
			changed = true
	if payload_map.get("character_limits") is Dictionary:
		if Tier3ContentRecordParser.apply_dictionary_sections({"character_limits": payload_map["character_limits"]}, ["character_limits"], character_creation_table, override_mode):
			changed = true
	if not changed:
		touched_tables.erase(TABLE_CHAR_CREATION)
	return changed
