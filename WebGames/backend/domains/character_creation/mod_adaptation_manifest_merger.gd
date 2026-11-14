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

    var allow_manual_origin: bool = false
    var allow_manual_trait: bool = false
    var allow_reroll: bool = false

    for manifest_dto in enabled_manifests:
        if str(manifest_dto.ui_capabilities.get("origin_selection_mode", "")) == "ALLOW_MANUAL":
            allow_manual_origin = true
        if str(manifest_dto.ui_capabilities.get("trait_selection_mode", "")) == "ALLOW_MANUAL":
            allow_manual_trait = true
        if bool(manifest_dto.ui_capabilities.get("allow_attribute_reroll", false)):
            allow_reroll = true

        _merge_single_pack_assets(manifest_dto, accumulator)

    var traits_dict: Dictionary = accumulator["traits"]
    var origins_catalog: Dictionary = accumulator["origins_catalog"]
    return {
        "enabled_pack_ids": enabled_ids.duplicate(),
        "ui_controls": {
            "allow_manual_origin_select": allow_manual_origin,
            "allow_manual_trait_select": allow_manual_trait,
            "allow_attribute_reroll": allow_reroll,
            "origin_selection_mode": "ALLOW_MANUAL" if allow_manual_origin else "FORCE_RANDOM",
            "trait_selection_mode": "ALLOW_MANUAL" if allow_manual_trait else "FORCE_RANDOM"
        },
        "origins_pool": accumulator["origins_pool"],
        "origins_catalog": origins_catalog,
        "origins": origins_catalog,
        "origin_race_map": accumulator["origin_race_map"],
        "birth_region_map": accumulator["birth_region_map"],
        "traits": traits_dict,
        "traits_catalog": traits_dict,
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
    var origins_pool: Array[Dictionary] = []
    var raw_base_pool: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/origins_pool", [])
    origins_pool.assign(raw_base_pool.duplicate(true))

    var paired_presets: Array[Dictionary] = []
    var raw_base_pairs: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/traits_allocation/paired_presets", [])
    paired_presets.assign(raw_base_pairs.duplicate(true))

    var custom_routing_rules: Array[Dictionary] = []
    return {
        "origins_pool": origins_pool,
        "origins_catalog": GameConfig.get_dict("domains.character_creation", "origins", {}).duplicate(true),
        "origin_race_map": GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/origin_race_map", {}).duplicate(true),
        "birth_region_map": GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/birth_region_map", {}).duplicate(true),
        "traits": GameConfig.get_dict("domains.character_creation", "traits", {}).duplicate(true),
        "paired_presets": paired_presets,
        "starter_kits": GameConfig.get_dict("domains.starter_loadout", "starter_kits", {}).duplicate(true),
        "race_kit_map": GameConfig.get_dict("domains.starter_loadout", "race_kit_map", {}).duplicate(true),
        "origin_kit_map": {},
        "origin_dag_map": {},
        "custom_routing_rules": custom_routing_rules,
        "dag_graphs": {},
        "custom_i18n": {}
    }


static func _merge_single_pack_assets(manifest_dto: DestinyModManifestDTO, accumulator: Dictionary) -> void:
    var origins_pool: Array[Dictionary] = accumulator["origins_pool"]
    var origins_catalog: Dictionary = accumulator["origins_catalog"]
    var origin_race_map: Dictionary = accumulator["origin_race_map"]
    var birth_region_map: Dictionary = accumulator["birth_region_map"]
    var traits: Dictionary = accumulator["traits"]
    var paired_presets: Array[Dictionary] = accumulator["paired_presets"]
    var starter_kits: Dictionary = accumulator["starter_kits"]
    var custom_routing_rules: Array[Dictionary] = accumulator["custom_routing_rules"]
    var dag_graphs: Dictionary = accumulator["dag_graphs"]
    var custom_i18n: Dictionary = accumulator["custom_i18n"]

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

    var race_id: String = str(origin_entry.get("race_id", origin_entry.get("race", "HUMAN"))).strip_edges()
    if race_id.is_empty():
        race_id = "HUMAN"
    var region_id: String = str(origin_entry.get("birth_region_id", "CENTRAL_CONTINENT")).strip_edges()
    if region_id.is_empty():
        region_id = "CENTRAL_CONTINENT"
    var kit_id: String = str(origin_entry.get("starter_kit_id", "")).strip_edges()
    var dag_id: String = str(origin_entry.get("prologue_dag_id", "")).strip_edges()

    var catalog_entry: Dictionary = origin_entry.duplicate(true)
    catalog_entry["origin_id"] = origin_id
    catalog_entry["race"] = race_id
    catalog_entry["race_id"] = race_id
    catalog_entry["birth_region_id"] = region_id
    catalog_entry["pack_id"] = pack_id
    origins_catalog[origin_id] = catalog_entry

    origin_race_map[origin_id] = race_id
    birth_region_map[origin_id] = region_id
    if not kit_id.is_empty():
        origin_kit_map[origin_id] = kit_id
    if not dag_id.is_empty():
        origin_dag_map[origin_id] = dag_id
