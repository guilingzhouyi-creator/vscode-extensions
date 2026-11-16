# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/tier3_item_skill_override_applier.gd
# 架构定位: Domain Component / Tier 3 Items & Skills Override Applier
# 依赖与触发: 上游: Tier3ContentOverrideLoader | 下游: Tier3ContentRecordParser
# 职责说明: 执行 Tier 3 content/items/ 与 content/skills/ 差分载荷向运行时工作配置表（items.mod_overrides 与 domains.combat.mechanics）的 MERGE / REPLACE_ENTRY / TOTAL_PURGE 写入。
# 退出语义与设计依据: 业务领域第一性原理与非破坏性运行时覆盖契约
# ==============================================================================

## Tier3ItemSkillOverrideApplier：Tier 3 物品原型与技能动作差分覆写应用器
class_name Tier3ItemSkillOverrideApplier
extends RefCounted

const TABLE_ITEMS_OVERRIDES: String = "items.mod_overrides"
const TABLE_COMBAT_MECHANICS: String = "domains.combat.mechanics"

## 应用单份物品差分载荷（支持 items 与 weapons 数组、canonical_id 就地覆写或全量清洗）
static func apply_items_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary,
	purged_prefixes: Array[String]
) -> bool:
	var incoming_items: Array = _extract_items_array(payload_map)
	if incoming_items.is_empty() and override_mode != Tier3ContentRecordParser.MODE_TOTAL_PURGE:
		return false

	if override_mode == Tier3ContentRecordParser.MODE_TOTAL_PURGE:
		_purge_prefix_in_working_tables(working_tables, touched_tables, purged_prefixes, "items.")
		var purged_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_ITEMS_OVERRIDES)
		var collected_items: Array = []
		for incoming_entry in incoming_items:
			_append_dict_copy(collected_items, incoming_entry)
		purged_table["items"] = collected_items
		return true

	var mod_items_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_ITEMS_OVERRIDES)
	if not (mod_items_table.get("items") is Array):
		mod_items_table["items"] = []
	var append_target_list: Array = mod_items_table["items"]

	for raw_item in incoming_items:
		_merge_single_incoming_item(raw_item, working_tables, touched_tables, append_target_list, override_mode)
	return true

static func _append_dict_copy(target_list: Array, candidate: Variant) -> void:
	if candidate is Dictionary:
		target_list.append((candidate as Dictionary).duplicate(true))

static func _merge_single_incoming_item(
	raw_item: Variant,
	working_tables: Dictionary,
	touched_tables: Dictionary,
	append_target_list: Array,
	override_mode: String
) -> void:
	if not (raw_item is Dictionary):
		return
	var item_dictionary: Dictionary = raw_item
	var canonical_identifier := String(item_dictionary.get("canonical_id", "")).strip_edges()
	if canonical_identifier.is_empty():
		return
	var existing_location := _find_existing_item_location(working_tables, canonical_identifier)
	if bool(existing_location.get("found", false)):
		_replace_or_merge_item_at_location(working_tables, touched_tables, existing_location, item_dictionary, override_mode)
	else:
		append_target_list.append(item_dictionary.duplicate(true))

## 应用单份技能动作与卡牌差分载荷至 domains.combat.mechanics
static func apply_skills_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var has_verbs: bool = payload_map.get("verbs") is Dictionary
	var has_cards: bool = payload_map.get("skill_cards") is Array
	if not has_verbs and not has_cards and override_mode != Tier3ContentRecordParser.MODE_TOTAL_PURGE:
		return false

	var mechanics_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_COMBAT_MECHANICS)
	if has_verbs or override_mode == Tier3ContentRecordParser.MODE_TOTAL_PURGE:
		_apply_verbs_section(mechanics_table, payload_map, has_verbs, override_mode)

	if has_cards or override_mode == Tier3ContentRecordParser.MODE_TOTAL_PURGE:
		var incoming_cards: Array = (payload_map.get("skill_cards", []) as Array) if has_cards else []
		if override_mode == Tier3ContentRecordParser.MODE_TOTAL_PURGE:
			mechanics_table["skill_cards"] = incoming_cards.duplicate(true)
		else:
			if not (mechanics_table.get("skill_cards") is Array):
				mechanics_table["skill_cards"] = []
			var target_cards: Array = mechanics_table["skill_cards"]
			var replace_whole := override_mode == Tier3ContentRecordParser.MODE_REPLACE_ENTRY
			for raw_card in incoming_cards:
				if raw_card is Dictionary:
					_upsert_skill_card(target_cards, raw_card as Dictionary, replace_whole)
	return true

static func _purge_prefix_in_working_tables(
	working_tables: Dictionary,
	touched_tables: Dictionary,
	purged_prefixes: Array[String],
	prefix_text: String
) -> void:
	if not purged_prefixes.has(prefix_text):
		purged_prefixes.append(prefix_text)
	var keys_to_erase: Array[String] = []
	for existing_key in working_tables.keys():
		var table_key_name := String(existing_key)
		if table_key_name.begins_with(prefix_text):
			keys_to_erase.append(table_key_name)
	for erase_key in keys_to_erase:
		working_tables.erase(erase_key)
		touched_tables.erase(erase_key)

static func _extract_items_array(payload_map: Dictionary) -> Array:
	if payload_map.get("items") is Array:
		return payload_map.get("items") as Array
	if payload_map.get("weapons") is Array:
		return payload_map.get("weapons") as Array
	return []

static func _find_existing_item_location(working_tables: Dictionary, canonical_identifier: String) -> Dictionary:
	for table_key_variant in working_tables.keys():
		var table_name := String(table_key_variant)
		if not table_name.begins_with("items."):
			continue
		var table_map_variant: Variant = working_tables[table_name]
		if not (table_map_variant is Dictionary):
			continue
		var items_variant: Variant = (table_map_variant as Dictionary).get("items", null)
		if not (items_variant is Array):
			continue
		var items_array: Array = items_variant
		var array_index: int = 0
		for existing_entry in items_array:
			if existing_entry is Dictionary and String((existing_entry as Dictionary).get("canonical_id", "")) == canonical_identifier:
				return {"found": true, "table_name": table_name, "array_index": array_index}
			array_index += 1
	return {"found": false}

static func _replace_or_merge_item_at_location(
	working_tables: Dictionary,
	touched_tables: Dictionary,
	existing_location: Dictionary,
	item_dictionary: Dictionary,
	override_mode: String
) -> void:
	var target_table_name := String(existing_location.get("table_name", ""))
	var target_index := int(existing_location.get("array_index", -1))
	var target_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, target_table_name)
	var target_items: Array = target_table["items"]
	if override_mode == Tier3ContentRecordParser.MODE_REPLACE_ENTRY:
		target_items[target_index] = item_dictionary.duplicate(true)
	else:
		var merged_item: Dictionary = (target_items[target_index] as Dictionary).duplicate(true)
		Tier3ContentRecordParser.deep_merge_dictionary(merged_item, item_dictionary)
		target_items[target_index] = merged_item

static func _apply_verbs_section(
	mechanics_table: Dictionary,
	payload_map: Dictionary,
	has_verbs: bool,
	override_mode: String
) -> void:
	var incoming_verbs: Dictionary = (payload_map.get("verbs", {}) as Dictionary) if has_verbs else {}
	var existing_verbs: Dictionary = (mechanics_table.get("verbs", {}) as Dictionary) if (mechanics_table.get("verbs") is Dictionary) else {}
	if override_mode == Tier3ContentRecordParser.MODE_TOTAL_PURGE:
		var purged_verbs: Dictionary = {}
		if existing_verbs.has("_fallback") and not incoming_verbs.has("_fallback"):
			purged_verbs["_fallback"] = (existing_verbs["_fallback"] as Dictionary).duplicate(true)
		Tier3ContentRecordParser.deep_merge_dictionary(purged_verbs, incoming_verbs)
		mechanics_table["verbs"] = purged_verbs
		return
	if not (mechanics_table.get("verbs") is Dictionary):
		mechanics_table["verbs"] = {}
	if override_mode == Tier3ContentRecordParser.MODE_REPLACE_ENTRY:
		var target_verbs_map: Dictionary = mechanics_table["verbs"]
		for verb_key in incoming_verbs.keys():
			_assign_verb_entry(target_verbs_map, verb_key, incoming_verbs[verb_key])
		return
	Tier3ContentRecordParser.deep_merge_dictionary(mechanics_table["verbs"] as Dictionary, incoming_verbs)

static func _assign_verb_entry(target_verbs_map: Dictionary, verb_key: Variant, incoming_verb_value: Variant) -> void:
	if incoming_verb_value is Dictionary:
		target_verbs_map[verb_key] = (incoming_verb_value as Dictionary).duplicate(true)
	else:
		target_verbs_map[verb_key] = incoming_verb_value

static func _upsert_skill_card(cards_array: Array, card_dictionary: Dictionary, replace_whole: bool) -> void:
	var target_card_identifier := String(card_dictionary.get("card_id", "")).strip_edges()
	if target_card_identifier.is_empty():
		return
	var matched_index: int = _find_card_index(cards_array, target_card_identifier)
	if matched_index >= 0:
		if replace_whole:
			cards_array[matched_index] = card_dictionary.duplicate(true)
		else:
			var merged_card: Dictionary = (cards_array[matched_index] as Dictionary).duplicate(true)
			Tier3ContentRecordParser.deep_merge_dictionary(merged_card, card_dictionary)
			cards_array[matched_index] = merged_card
		return
	cards_array.append(card_dictionary.duplicate(true))

static func _find_card_index(cards_array: Array, target_card_identifier: String) -> int:
	var card_index: int = 0
	for existing_card in cards_array:
		if existing_card is Dictionary and String((existing_card as Dictionary).get("card_id", "")) == target_card_identifier:
			return card_index
		card_index += 1
	return -1
