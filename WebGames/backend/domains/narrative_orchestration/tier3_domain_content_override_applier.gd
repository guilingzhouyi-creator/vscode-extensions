# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/tier3_domain_content_override_applier.gd
# 架构定位: Domain Component / Tier 3 Entities, Quests, Events, Narratives, Copywriting & Cutscenes Override Applier
# 依赖与触发: 上游: Tier3ContentOverrideLoader | 下游: Tier3ContentRecordParser
# 职责说明: 执行 Tier 3 content/{entities,quests,events,narratives,copywriting,races}/ 与 cutscenes/ 差分载荷向运行时工作配置表的 MERGE / REPLACE_ENTRY / TOTAL_PURGE 写入，并支持将 OFFICIAL_BASE/TOTAL_CONVERSION 的 destinies 种族与开局套装注入当前栈配置层。
# 退出语义与设计依据: 业务领域第一性原理与非破坏性运行时覆盖契约
# ==============================================================================

## Tier3DomainContentOverrideApplier：实体、任务、事件、叙事、文案与过场全品类差分覆写应用器
class_name Tier3DomainContentOverrideApplier
extends RefCounted

const TABLE_NPC_CORE: String = "domains.npc.core"
const TABLE_MONSTER_CORE: String = "domains.monster.core"
const TABLE_ELITE_CORE: String = "domains.elite.core"
const TABLE_WORLD_BOSS_CORE: String = "domains.world_boss.core"
const TABLE_QUEST_CORE: String = "domains.quest.core"
const TABLE_COMMISSION_QUEST_CORE: String = "domains.commission_quest.core"
const TABLE_EVENT_PROB_CORE: String = "domains.event_probability.core"
const TABLE_SOVEREIGNTY_CORE: String = "domains.sovereignty.core"
const TABLE_GACHA_CORE: String = "domains.gacha.core"
const TABLE_CHAR_CREATION: String = "domains.character_creation.core"
const TABLE_ATTRIBUTE_CORE: String = "domains.attribute.core"
const TABLE_STARTER_LOADOUT_CORE: String = "domains.starter_loadout.core"
const TABLE_CUTSCENE_REGISTRY: String = "infrastructure.cutscene_registry"
const TABLE_CUTSCENE_HOOKS: String = "infrastructure.cutscene_hooks"

## 合并字典覆盖区段到指定配置工作表
static func merge_dict_payload_into_table(
	patch_payload: Variant,
	table_name: String,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	if not (patch_payload is Dictionary):
		return false
	var patch_map := patch_payload as Dictionary
	if patch_map.is_empty():
		return false
	var target_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, table_name)
	return Tier3ContentRecordParser.apply_dictionary_sections(patch_map, patch_map.keys(), target_table, override_mode)

## 应用实体原型差分载荷（content/entities/*.json -> npcs/monsters/elites/world_bosses）
static func apply_entities_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var changed := false
	var mapping: Array[Array] = [
		["npcs", TABLE_NPC_CORE],
		["monsters", TABLE_MONSTER_CORE],
		["elites", TABLE_ELITE_CORE],
		["world_bosses", TABLE_WORLD_BOSS_CORE]
	]
	for pair in mapping:
		if merge_dict_payload_into_table(payload_map.get(pair[0]), String(pair[1]), override_mode, working_tables, touched_tables):
			changed = true
	return changed

## 应用任务与悬赏原型差分载荷（content/quests/*.json）
static func apply_quests_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var changed := false
	var quest_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_QUEST_CORE)
	if Tier3ContentRecordParser.apply_dictionary_sections(payload_map, ["quest_defaults", "reward_items", "quests"], quest_table, override_mode):
		changed = true
	else:
		touched_tables.erase(TABLE_QUEST_CORE)
	if merge_dict_payload_into_table(payload_map.get("commission_quests"), TABLE_COMMISSION_QUEST_CORE, override_mode, working_tables, touched_tables):
		changed = true
	return changed

## 应用世界事件概率、政权默认与卡池主题差分载荷（content/events/*.json）
static func apply_events_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var changed := false
	if payload_map.get("events") is Dictionary:
		var ev_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_EVENT_PROB_CORE)
		if Tier3ContentRecordParser.apply_dictionary_sections({"events": payload_map["events"]}, ["events"], ev_table, override_mode):
			changed = true
	if merge_dict_payload_into_table(payload_map.get("sovereignty"), TABLE_SOVEREIGNTY_CORE, override_mode, working_tables, touched_tables):
		changed = true
	if merge_dict_payload_into_table(payload_map.get("gacha_banners"), TABLE_GACHA_CORE, override_mode, working_tables, touched_tables):
		changed = true
	return changed

## 应用领域叙事与序章多语言表覆写（content/narratives/*.json）
static func apply_narratives_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var changed := false
	var raw_tables: Variant = payload_map.get("tables", null)
	if raw_tables is Dictionary:
		var tables_map := raw_tables as Dictionary
		for raw_name in tables_map.keys():
			if merge_dict_payload_into_table(tables_map[raw_name], String(raw_name), override_mode, working_tables, touched_tables):
				changed = true
	elif payload_map.has("target_table") and (payload_map.get("entries") is Dictionary):
		var tname := String(payload_map.get("target_table", "")).strip_edges()
		if not tname.is_empty():
			if merge_dict_payload_into_table(payload_map.get("entries"), tname, override_mode, working_tables, touched_tables):
				changed = true
	return changed

## 应用物品与世界事件条件文案覆写（content/copywriting/*.json）
static func apply_copywriting_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var source: Dictionary = (payload_map.get("copywriting") as Dictionary) if (payload_map.get("copywriting") is Dictionary) else payload_map
	var changed := false
	for sub_key in ["item", "narrative", "probability", "bulletin"]:
		if merge_dict_payload_into_table(source.get(sub_key), "copywriting." + sub_key, override_mode, working_tables, touched_tables):
			changed = true
	return changed

## 应用过场媒体清单与触发 Hook 规则（cutscenes/*.json）
static func apply_cutscenes_override(
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary
) -> bool:
	var changed := false
	if payload_map.get("cutscenes") is Dictionary:
		var cutscene_registry_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_CUTSCENE_REGISTRY)
		if Tier3ContentRecordParser.apply_dictionary_sections({"cutscenes": payload_map["cutscenes"]}, ["cutscenes"], cutscene_registry_table, override_mode):
			changed = true
	if payload_map.get("hooks") is Array:
		var cutscene_hook_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_CUTSCENE_HOOKS)
		if Tier3ContentRecordParser.apply_dictionary_sections({"hooks": payload_map["hooks"]}, ["hooks"], cutscene_hook_table, override_mode):
			changed = true
	return changed
