# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/tier3_identity_destiny_applier.gd
# 架构定位: Domain Component / Tier 3 Races, Destinies, Kits & Prologue Routing Override Applier
# 依赖与触发: 上游: Tier3ContentOverrideLoader | 下游: Tier3ContentRecordParser, Tier3DomainContentOverrideApplier | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 执行 Tier 3 种族目录、命途套件（origins/traits/starter_kits）与基础内容包创角规则向工作配置表层的投射与覆写。
# 退出语义与设计依据: 业务领域第一性原理与非破坏性运行时覆盖契约
# ==============================================================================

## Tier3IdentityDestinyApplier：种族、命途、出身、特质、开局套装与序章路由差分覆写应用器
class_name Tier3IdentityDestinyApplier
extends RefCounted

const TABLE_CHAR_CREATION: String = "domains.character_creation.core"
const TABLE_ATTRIBUTE_CORE: String = "domains.attribute.core"
const TABLE_STARTER_LOADOUT_CORE: String = "domains.starter_loadout.core"


static func _register_single_race_entry(
    race_candidate: Variant,
    races_catalog_map: Dictionary,
    coefficients_by_race: Dictionary
) -> void:
    if not (race_candidate is Dictionary):
        return
    var source_race := race_candidate as Dictionary
    var race_identifier := String(source_race.get("race_id", "")).strip_edges()
    if race_identifier.is_empty():
        return
    var race_record := source_race.duplicate(true)
    races_catalog_map[race_identifier] = race_record
    if race_record.get("attribute_coefficients") is Dictionary:
        coefficients_by_race[race_identifier] = (race_record["attribute_coefficients"] as Dictionary).duplicate(true)


static func _register_single_dict_race_item(
    normalized_race_key: String,
    race_entry: Variant,
    races_catalog_map: Dictionary,
    coefficients_by_race: Dictionary
) -> void:
    if race_entry is Dictionary:
        var race_record := (race_entry as Dictionary).duplicate(true)
        var resolved_id := String(race_record.get("race_id", normalized_race_key)).strip_edges()
        if resolved_id.is_empty():
            resolved_id = normalized_race_key
        races_catalog_map[resolved_id] = race_record
        if race_record.get("attribute_coefficients") is Dictionary:
            coefficients_by_race[resolved_id] = (race_record["attribute_coefficients"] as Dictionary).duplicate(true)
    else:
        races_catalog_map[normalized_race_key] = race_entry


static func _register_dict_race_entries(
    raw_race_table: Dictionary,
    races_catalog_map: Dictionary,
    coefficients_by_race: Dictionary
) -> void:
    for race_key in raw_race_table.keys():
        var normalized_race_key := String(race_key).strip_edges()
        if normalized_race_key.is_empty():
            continue
        _register_single_dict_race_item(
            normalized_race_key,
            raw_race_table[race_key],
            races_catalog_map,
            coefficients_by_race
        )


## 应用种族目录及基础属性修正系数（content/races/*.json 或 destinies.custom_races）
static func apply_races_override(
    payload_map: Dictionary,
    override_mode: String,
    working_tables: Dictionary,
    touched_tables: Dictionary
) -> bool:
    var races_catalog_map: Dictionary = {}
    var coefficients_by_race: Dictionary = {}
    var raw_races: Variant = payload_map.get("races_catalog", payload_map.get("custom_races", null))
    if raw_races is Dictionary:
        _register_dict_race_entries(raw_races as Dictionary, races_catalog_map, coefficients_by_race)
    elif raw_races is Array:
        for race_candidate in (raw_races as Array):
            _register_single_race_entry(race_candidate, races_catalog_map, coefficients_by_race)
    var changed := false
    if not races_catalog_map.is_empty():
        var creation_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_CHAR_CREATION)
        if Tier3ContentRecordParser.apply_dictionary_sections({"races_catalog": races_catalog_map}, ["races_catalog"], creation_table, override_mode):
            changed = true
    if not coefficients_by_race.is_empty():
        var attribute_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_ATTRIBUTE_CORE)
        if Tier3ContentRecordParser.apply_dictionary_sections({"race_coefficients": coefficients_by_race}, ["race_coefficients"], attribute_table, override_mode):
            changed = true
    return changed


## 将基础内容包或扩展包的 destinies/routing_rules/dag_graphs 同步投射到工作配置表层（按包独立隔离）
static func apply_base_package_destinies_projection(
    package_entry: Dictionary,
    working_tables: Dictionary,
    touched_tables: Dictionary
) -> bool:
    var profile := String(package_entry.get("pack_profile", "")).strip_edges().to_upper()
    var has_races := package_entry.has("custom_races") or package_entry.has("creation_rule_overrides")
    var has_destiny_or_dag := package_entry.has("custom_origins") or package_entry.has("custom_traits") \
        or package_entry.has("custom_starter_kits") or package_entry.has("dag_graphs") \
        or package_entry.has("prologue_routing_rules") or package_entry.has("custom_routing_rules")
    if profile != "OFFICIAL_BASE" and profile != "TOTAL_CONVERSION" and not has_races and not has_destiny_or_dag:
        return false
    var mode := Tier3ContentRecordParser.MODE_TOTAL_PURGE if profile == "TOTAL_CONVERSION" else Tier3ContentRecordParser.MODE_MERGE
    var changed := false
    if has_races:
        if apply_races_override(package_entry, mode, working_tables, touched_tables):
            changed = true
    if package_entry.get("creation_rule_overrides") is Dictionary:
        if Tier3DomainContentOverrideApplier.merge_dict_payload_into_table(package_entry["creation_rule_overrides"], TABLE_CHAR_CREATION, mode, working_tables, touched_tables):
            changed = true
    if _project_destiny_kits_and_dags(package_entry, mode, working_tables, touched_tables):
        changed = true
    return changed


static func _register_single_kit_entry(
    kit_candidate: Variant,
    starter_kits_table: Dictionary,
    race_kit_map: Dictionary
) -> void:
    if not (kit_candidate is Dictionary):
        return
    var source_kit := kit_candidate as Dictionary
    var kit_identifier := String(source_kit.get("kit_id", "")).strip_edges()
    if kit_identifier.is_empty():
        return
    var kit_record := source_kit.duplicate(true)
    starter_kits_table[kit_identifier] = kit_record
    var target_race := String(kit_record.get("race_id", "")).strip_edges()
    if not target_race.is_empty():
        race_kit_map[target_race] = kit_identifier


static func _collect_keyed_records(raw_entries: Variant, key_field: String) -> Dictionary:
    var collected_table: Dictionary = {}
    if raw_entries is Array:
        for candidate_entry in (raw_entries as Array):
            _insert_keyed_record(collected_table, candidate_entry, key_field)
    return collected_table

static func _insert_keyed_record(collected_table: Dictionary, candidate_entry: Variant, key_field: String) -> void:
    if not (candidate_entry is Dictionary):
        return
    var record := candidate_entry as Dictionary
    var record_key := String(record.get(key_field, "")).strip_edges()
    if not record_key.is_empty():
        collected_table[record_key] = record.duplicate(true)


static func _normalize_routing_rule_entry(raw_rule: Variant) -> Dictionary:
    if not (raw_rule is Dictionary):
        return {}
    var source_rule := raw_rule as Dictionary
    var target_dag_id := String(source_rule.get("target_dag_id", source_rule.get("dag_id", ""))).strip_edges()
    if target_dag_id.is_empty():
        return {}
    if source_rule.get("match_condition") is Dictionary:
        var matched_rule := source_rule.duplicate(true)
        matched_rule["target_dag_id"] = target_dag_id
        return matched_rule
    var match_condition: Dictionary = {}
    var rule_race := String(source_rule.get("race_id", source_rule.get("race", ""))).strip_edges()
    if not rule_race.is_empty():
        match_condition["race_id"] = rule_race
    var rule_origin := String(source_rule.get("origin_id", source_rule.get("origin", ""))).strip_edges()
    if not rule_origin.is_empty():
        match_condition["origin_id"] = rule_origin
    if bool(source_rule.get("is_default", false)):
        match_condition["is_default"] = true
    if match_condition.is_empty():
        return {}
    var normalized := source_rule.duplicate(true)
    normalized["target_dag_id"] = target_dag_id
    normalized["match_condition"] = match_condition
    return normalized


static func _project_destiny_kits_and_dags(
    package_entry: Dictionary,
    mode: String,
    working_tables: Dictionary,
    touched_tables: Dictionary
) -> bool:
    var changed := false
    var kits_raw: Variant = package_entry.get("custom_starter_kits", null)
    if kits_raw is Array and not (kits_raw as Array).is_empty():
        var starter_kits_table: Dictionary = {}
        var race_kit_map: Dictionary = {}
        for kit_candidate in (kits_raw as Array):
            _register_single_kit_entry(kit_candidate, starter_kits_table, race_kit_map)
        var starter_loadout_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, TABLE_STARTER_LOADOUT_CORE)
        if Tier3ContentRecordParser.apply_dictionary_sections({"starter_kits": starter_kits_table, "race_kit_map": race_kit_map}, ["starter_kits", "race_kit_map"], starter_loadout_table, mode):
            changed = true
    elif kits_raw is Dictionary and not (kits_raw as Dictionary).is_empty():
        if Tier3DomainContentOverrideApplier.merge_dict_payload_into_table({"starter_kits": kits_raw}, TABLE_STARTER_LOADOUT_CORE, mode, working_tables, touched_tables):
            changed = true

    var origins_table := _collect_keyed_records(package_entry.get("custom_origins", null), "origin_id")
    if not origins_table.is_empty():
        if Tier3DomainContentOverrideApplier.merge_dict_payload_into_table({"origins": origins_table}, TABLE_CHAR_CREATION, mode, working_tables, touched_tables):
            changed = true

    var traits_table := _collect_keyed_records(package_entry.get("custom_traits", null), "trait_id")
    if not traits_table.is_empty():
        if Tier3DomainContentOverrideApplier.merge_dict_payload_into_table({"traits": traits_table}, TABLE_CHAR_CREATION, mode, working_tables, touched_tables):
            changed = true

    var dag_graphs_raw: Variant = package_entry.get("dag_graphs", null)
    if dag_graphs_raw is Dictionary and not (dag_graphs_raw as Dictionary).is_empty():
        if Tier3DomainContentOverrideApplier.merge_dict_payload_into_table({"dag_graphs": dag_graphs_raw}, "narratives.prologue_dag_catalog", mode, working_tables, touched_tables):
            changed = true

    var routing_rules: Array[Dictionary] = []
    var raw_rules: Variant = package_entry.get("prologue_routing_rules", package_entry.get("custom_routing_rules", null))
    if raw_rules is Array:
        for raw_rule in (raw_rules as Array):
            var normalized_rule := _normalize_routing_rule_entry(raw_rule)
            if not normalized_rule.is_empty():
                routing_rules.append(normalized_rule)
    if not routing_rules.is_empty():
        var combined_rules: Array = []
        if mode == Tier3ContentRecordParser.MODE_MERGE:
            var catalog_table := Tier3ContentRecordParser.ensure_working_table(working_tables, touched_tables, "narratives.prologue_dag_catalog")
            var existing_rules: Variant = catalog_table.get("prologue_routing_rules", [])
            if existing_rules is Array:
                combined_rules.append_array((existing_rules as Array).duplicate(true))
        combined_rules.append_array(routing_rules)
        if Tier3DomainContentOverrideApplier.merge_dict_payload_into_table({"prologue_routing_rules": combined_rules}, "narratives.prologue_dag_catalog", mode, working_tables, touched_tables):
            changed = true
    return changed
