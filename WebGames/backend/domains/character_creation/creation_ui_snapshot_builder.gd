# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/creation_ui_snapshot_builder.gd
# 架构定位: Domain Logic Component / Character Creation UI Snapshot Builder
# 依赖与触发: 上游: ModPrecheckAndAdaptationSolver | 下游: 前端创角受控展示视图 | 配置: 无直读 | 信号: 无
# 职责说明: 基于无损合并后的创角适配清单，构造前端视图只读消费的创角 UI 快照 (creation_ui_snapshot)。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CreationUiSnapshotBuilder：Domain Logic Component / Character Creation UI Snapshot Builder
class_name CreationUiSnapshotBuilder
extends RefCounted


## 基于合并后适配清单生成前端视图消费的创角只读 UI 快照
static func build_creation_ui_snapshot(
    adapted_manifest: Dictionary,
    precheck_checklist: Array[Dictionary],
    enabled_ids: Array[String]
) -> Dictionary:
    var origins_pool: Array = adapted_manifest.get("origins_pool", [])
    var origins_catalog: Dictionary = adapted_manifest.get("origins_catalog", {})
    var origin_race_map: Dictionary = adapted_manifest.get("origin_race_map", {})
    var birth_region_map: Dictionary = adapted_manifest.get("birth_region_map", {})
    var traits: Dictionary = adapted_manifest.get("traits", {})
    var paired_presets: Array = adapted_manifest.get("paired_presets", [])

    var available_origins: Array[Dictionary] = []
    for pool_entry in origins_pool:
        if pool_entry is Dictionary:
            _append_ui_origin_snapshot_item(
                pool_entry as Dictionary,
                origins_catalog,
                origin_race_map,
                birth_region_map,
                available_origins
            )

    var available_trait_pairs: Array[Dictionary] = []
    for pair_index in range(paired_presets.size()):
        var preset_entry: Variant = paired_presets[pair_index]
        if preset_entry is Dictionary:
            _append_ui_trait_pair_snapshot_item(pair_index, preset_entry as Dictionary, traits, available_trait_pairs)

    return {
        "enabled_pack_ids": enabled_ids.duplicate(),
        "precheck_checklist": precheck_checklist.duplicate(true),
        "has_base_content_mod": bool(adapted_manifest.get("has_base_content_mod", not available_origins.is_empty())),
        "ui_controls": (adapted_manifest.get("ui_controls", {}) as Dictionary).duplicate(true),
        "available_races": (adapted_manifest.get("races_catalog", {}) as Dictionary).duplicate(true),
        "available_origins": available_origins,
        "available_trait_pairs": available_trait_pairs,
        "traits_catalog": traits.duplicate(true)
    }


static func _append_ui_origin_snapshot_item(
    pool_entry: Dictionary,
    origins_catalog: Dictionary,
    origin_race_map: Dictionary,
    birth_region_map: Dictionary,
    out_origins: Array[Dictionary]
) -> void:
    var origin_id: String = str(pool_entry.get("origin_id", ""))
    var origin_config: Dictionary = origins_catalog.get(origin_id, {})
    out_origins.append({
        "origin_id": origin_id,
        "name": str(origin_config.get("name", origin_id)),
        "race_id": str(origin_race_map.get(origin_id, origin_config.get("race_id", origin_config.get("race", "")))),
        "birth_region_id": str(birth_region_map.get(origin_id, origin_config.get("birth_region_id", ""))),
        "desc": str(origin_config.get("desc", "")),
        "weight": int(pool_entry.get("weight", origin_config.get("weight", 20))),
        "initial_gold": int(origin_config.get("initial_gold", 0)),
        "attribute_bonus": (origin_config.get("attribute_bonus", {}) as Dictionary).duplicate(true),
        "starter_kit_id": str(origin_config.get("starter_kit_id", "")),
        "prologue_dag_id": str(origin_config.get("prologue_dag_id", "")),
        "pack_id": str(origin_config.get("pack_id", ""))
    })


static func _append_ui_trait_pair_snapshot_item(
    pair_index: int,
    preset: Dictionary,
    traits: Dictionary,
    out_pairs: Array[Dictionary]
) -> void:
    var positive_id: String = str(preset.get("positive", ""))
    var negative_id: String = str(preset.get("negative", ""))
    var positive_config: Dictionary = traits.get(positive_id, {})
    var negative_config: Dictionary = traits.get(negative_id, {})
    out_pairs.append({
        "pair_index": pair_index,
        "positive": positive_id,
        "positive_name": str(positive_config.get("name", positive_id)),
        "positive_cost": int(positive_config.get("cost", 0)),
        "negative": negative_id,
        "negative_name": str(negative_config.get("name", negative_id)),
        "negative_cost": int(negative_config.get("cost", 0)),
        "weight": int(preset.get("weight", 50))
    })
