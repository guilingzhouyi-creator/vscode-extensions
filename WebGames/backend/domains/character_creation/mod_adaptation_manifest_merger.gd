# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/mod_adaptation_manifest_merger.gd
# 架构定位: Domain Logic Component / Mod Manifest Merger
# 依赖与触发: 上游: ModPrecheckAndAdaptationSolver | 下游: DestinyModManifestDTO, GameConfig | 配置: config/domains/character_creation/core.json, config/domains/starter_loadout/core.json | 信号: 无
# 职责说明: 执行基础创角资源池与多组已校验合规命途 MOD 清单的无损合并适配。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ModAdaptationManifestMerger：Domain Logic Component / Mod Manifest Merger
class_name ModAdaptationManifestMerger
extends RefCounted


## 将基础配置池与按拓扑序排列的已启用合规 MOD 清单无损合并为运行期适配清单
static func build_adapted_manifest(
    enabled_manifests: Array[DestinyModManifestDTO],
    enabled_ids: Array[String]
) -> Dictionary:
    var accumulator: Dictionary = _create_base_merge_accumulator()

    var is_manual_origin_allowed: bool = false
    var is_manual_trait_allowed: bool = false
    var is_attribute_reroll_allowed: bool = false
    var has_base_content_mod: bool = false
    var official_base_pack_id: String = ""
    var pack_profiles: Dictionary = {}

    for manifest_dto in enabled_manifests:
        var normalized_profile: String = manifest_dto.pack_profile.strip_edges().to_upper()
        if normalized_profile.is_empty():
            normalized_profile = "CONTENT_ADDON"
        pack_profiles[manifest_dto.pack_id] = normalized_profile
        if normalized_profile in ["OFFICIAL_BASE", "TOTAL_CONVERSION"]:
            has_base_content_mod = true
            if normalized_profile == "OFFICIAL_BASE" and official_base_pack_id.is_empty():
                official_base_pack_id = manifest_dto.pack_id

        if str(manifest_dto.ui_capabilities.get("origin_selection_mode", "")) == "ALLOW_MANUAL":
            is_manual_origin_allowed = true
        if str(manifest_dto.ui_capabilities.get("trait_selection_mode", "")) == "ALLOW_MANUAL":
            is_manual_trait_allowed = true
        if bool(manifest_dto.ui_capabilities.get("allow_attribute_reroll", false)):
            is_attribute_reroll_allowed = true

        _merge_single_pack_assets(manifest_dto, accumulator)

    var traits_map: Dictionary = accumulator["traits"]
    var origins_catalog: Dictionary = accumulator["origins_catalog"]
    return {
        "enabled_pack_ids": enabled_ids.duplicate(),
        "has_base_content_mod": has_base_content_mod,
        "official_base_pack_id": official_base_pack_id,
        "pack_profiles": pack_profiles,
        "ui_controls": {
            "allow_manual_origin_select": is_manual_origin_allowed,
            "allow_manual_trait_select": is_manual_trait_allowed,
            "allow_attribute_reroll": is_attribute_reroll_allowed,
            "origin_selection_mode": "ALLOW_MANUAL" if is_manual_origin_allowed else "FORCE_RANDOM",
            "trait_selection_mode": "ALLOW_MANUAL" if is_manual_trait_allowed else "FORCE_RANDOM"
        },
        "races_catalog": accumulator["races_catalog"],
        "creation_rules": accumulator["creation_rules"],
        "origins_pool": accumulator["origins_pool"],
        "origins_catalog": origins_catalog,
        "origins": origins_catalog,
        "origin_race_map": accumulator["origin_race_map"],
        "birth_region_map": accumulator["birth_region_map"],
        "traits": traits_map,
        "traits_catalog": traits_map,
        "paired_presets": accumulator["paired_presets"],
        "starter_kits": accumulator["starter_kits"],
        "race_kit_map": accumulator["race_kit_map"],
        "origin_kit_map": accumulator["origin_kit_map"],
        "origin_dag_map": accumulator["origin_dag_map"],
        "custom_routing_rules": accumulator["custom_routing_rules"],
        "dag_graphs": accumulator["dag_graphs"],
        "custom_i18n": accumulator["custom_i18n"]
    }


static func _create_base_merge_accumulator() -> Dictionary:
    var base_cc: Dictionary = GameConfig.get_base_table_copy("domains.character_creation")
    var base_loadout: Dictionary = GameConfig.get_base_table_copy("domains.starter_loadout")
    var reincarnation_table: Dictionary = (base_cc.get("authoritative_reincarnation", {}) as Dictionary) if (base_cc.get("authoritative_reincarnation") is Dictionary) else {}
    var traits_allocation: Dictionary = (reincarnation_table.get("traits_allocation", {}) as Dictionary) if (reincarnation_table.get("traits_allocation") is Dictionary) else {}

    var origins_pool: Array[Dictionary] = []
    var raw_base_pool: Array = (reincarnation_table.get("origins_pool", []) as Array) if (reincarnation_table.get("origins_pool") is Array) else []
    origins_pool.assign(raw_base_pool.duplicate(true))

    var paired_presets: Array[Dictionary] = []
    var raw_base_pairs: Array = (traits_allocation.get("paired_presets", []) as Array) if (traits_allocation.get("paired_presets") is Array) else []
    paired_presets.assign(raw_base_pairs.duplicate(true))

    var custom_routing_rules: Array[Dictionary] = []
    return {
        "races_catalog": ((base_cc.get("races_catalog", {}) as Dictionary) if (base_cc.get("races_catalog") is Dictionary) else {}).duplicate(true),
        "creation_rules": {},
        "origins_pool": origins_pool,
        "origins_catalog": ((base_cc.get("origins", {}) as Dictionary) if (base_cc.get("origins") is Dictionary) else {}).duplicate(true),
        "origin_race_map": ((reincarnation_table.get("origin_race_map", {}) as Dictionary) if (reincarnation_table.get("origin_race_map") is Dictionary) else {}).duplicate(true),
        "birth_region_map": ((reincarnation_table.get("birth_region_map", {}) as Dictionary) if (reincarnation_table.get("birth_region_map") is Dictionary) else {}).duplicate(true),
        "traits": ((base_cc.get("traits", {}) as Dictionary) if (base_cc.get("traits") is Dictionary) else {}).duplicate(true),
        "paired_presets": paired_presets,
        "starter_kits": ((base_loadout.get("starter_kits", {}) as Dictionary) if (base_loadout.get("starter_kits") is Dictionary) else {}).duplicate(true),
        "race_kit_map": ((base_loadout.get("race_kit_map", {}) as Dictionary) if (base_loadout.get("race_kit_map") is Dictionary) else {}).duplicate(true),
        "origin_kit_map": {},
        "origin_dag_map": {},
        "custom_routing_rules": custom_routing_rules,
        "dag_graphs": {},
        "custom_i18n": {}
    }


static func _merge_single_pack_assets(manifest_dto: DestinyModManifestDTO, accumulator: Dictionary) -> void:
    var races_catalog: Dictionary = accumulator["races_catalog"]
    var creation_rules: Dictionary = accumulator["creation_rules"]
    var traits: Dictionary = accumulator["traits"]
    var paired_presets: Array[Dictionary] = accumulator["paired_presets"]
    var starter_kits: Dictionary = accumulator["starter_kits"]
    var custom_routing_rules: Array[Dictionary] = accumulator["custom_routing_rules"]
    var dag_graphs: Dictionary = accumulator["dag_graphs"]
    var custom_i18n: Dictionary = accumulator["custom_i18n"]

    if not manifest_dto.custom_races.is_empty():
        races_catalog.merge(manifest_dto.custom_races.duplicate(true), true)

    if not manifest_dto.creation_rule_overrides.is_empty():
        creation_rules.merge(manifest_dto.creation_rule_overrides.duplicate(true), true)

    for origin_entry in manifest_dto.custom_origins:
        _register_custom_origin(origin_entry, manifest_dto.pack_id, accumulator)

    if not manifest_dto.custom_traits.is_empty():
        traits.merge(manifest_dto.custom_traits.duplicate(true), true)

    if not manifest_dto.paired_presets.is_empty():
        paired_presets.append_array(manifest_dto.paired_presets.duplicate(true))

    if not manifest_dto.custom_starter_kits.is_empty():
        starter_kits.merge(manifest_dto.custom_starter_kits.duplicate(true), true)

    if not manifest_dto.custom_routing_rules.is_empty():
        custom_routing_rules.append_array(manifest_dto.custom_routing_rules.duplicate(true))

    if not manifest_dto.dag_graphs.is_empty():
        dag_graphs.merge(manifest_dto.dag_graphs, true)

    if not manifest_dto.custom_i18n.is_empty():
        custom_i18n.merge(manifest_dto.custom_i18n, true)


static func _register_custom_origin(origin_entry: Dictionary, pack_id: String, accumulator: Dictionary) -> void:
    var origins_pool: Array[Dictionary] = accumulator["origins_pool"]
    var origins_catalog: Dictionary = accumulator["origins_catalog"]
    var origin_race_map: Dictionary = accumulator["origin_race_map"]
    var birth_region_map: Dictionary = accumulator["birth_region_map"]
    var origin_kit_map: Dictionary = accumulator["origin_kit_map"]
    var origin_dag_map: Dictionary = accumulator["origin_dag_map"]

    var origin_id: String = str(origin_entry.get("origin_id", "")).strip_edges()
    if origin_id.is_empty():
        return
    var weight: int = maxi(1, int(origin_entry.get("weight", 20)))
    origins_pool.append({
        "origin_id": origin_id,
        "weight": weight,
        "pack_id": pack_id
    })

    var race_id: String = str(origin_entry.get("race_id", origin_entry.get("race", ""))).strip_edges()
    var region_id: String = str(origin_entry.get("birth_region_id", "")).strip_edges()
    var kit_id: String = str(origin_entry.get("starter_kit_id", "")).strip_edges()
    var dag_id: String = str(origin_entry.get("prologue_dag_id", "")).strip_edges()

    var catalog_entry: Dictionary = origin_entry.duplicate(true)
    catalog_entry["origin_id"] = origin_id
    if not race_id.is_empty():
        catalog_entry["race"] = race_id
        catalog_entry["race_id"] = race_id
        origin_race_map[origin_id] = race_id
    if not region_id.is_empty():
        catalog_entry["birth_region_id"] = region_id
        birth_region_map[origin_id] = region_id
    catalog_entry["pack_id"] = pack_id
    origins_catalog[origin_id] = catalog_entry

    if not kit_id.is_empty():
        origin_kit_map[origin_id] = kit_id
    if not dag_id.is_empty():
        origin_dag_map[origin_id] = dag_id
