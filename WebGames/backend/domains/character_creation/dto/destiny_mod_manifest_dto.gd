# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/destiny_mod_manifest_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 依赖与触发: 上游: WorldGateway / ModPrecheckAndAdaptationSolver | 下游: AuthoritativeReincarnationSolver, StarterLoadoutDispatcher | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 单机命途显性 MOD 声明清单数据传输对象；承载单包元数据、前端 UI 策略能力声明、自定义身世池、因果天赋、配对预设、初始套件与专属序章路由规则。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## DestinyModManifestDTO：Data Transfer Object (DTO)
class_name DestinyModManifestDTO
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

# ==============================================================================
# 一、模组声明清单契约字段
# ==============================================================================

var pack_id: String = ""
var pack_name: String = ""
var version: String = "1.0.0"
var priority: int = 100
var dependencies: Array[String] = []
var incompatible_packs: Array[String] = []
var ui_capabilities: Dictionary = {}
var custom_origins: Array[Dictionary] = []
var custom_traits: Dictionary = {}
var paired_presets: Array[Dictionary] = []
var custom_starter_kits: Dictionary = {}
var custom_routing_rules: Array[Dictionary] = []
var root_path: String = ""
var dag_graphs: Dictionary = {}
var custom_i18n: Dictionary = {}

# ==============================================================================
# 二、对象池与状态重置契约 (ADV-POOL-001)
# ==============================================================================
## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
    super.reset_state()
    pack_id = ""
    pack_name = ""
    version = "1.0.0"
    priority = 100
    dependencies.clear()
    incompatible_packs.clear()
    ui_capabilities.clear()
    custom_origins.clear()
    custom_traits.clear()
    paired_presets.clear()
    custom_starter_kits.clear()
    custom_routing_rules.clear()
    root_path = ""
    dag_graphs.clear()
    custom_i18n.clear()

# ==============================================================================
# 三、序列化与工厂反序列化契约
# ==============================================================================

## 序列化当前命途清单为通用字典传输结构
func to_dto() -> Dictionary:
    return {
        "pack_id": pack_id,
        "pack_name": pack_name,
        "version": version,
        "priority": priority,
        "dependencies": dependencies.duplicate(),
        "incompatible_packs": incompatible_packs.duplicate(),
        "ui_capabilities": ui_capabilities.duplicate(true),
        "custom_origins": custom_origins.duplicate(true),
        "custom_traits": custom_traits.duplicate(true),
        "paired_presets": paired_presets.duplicate(true),
        "custom_starter_kits": custom_starter_kits.duplicate(true),
        "custom_routing_rules": custom_routing_rules.duplicate(true),
        "root_path": root_path,
        "dag_graphs": dag_graphs.duplicate(true),
        "custom_i18n": custom_i18n.duplicate(true)
    }

## 统一解包外层或内层 adapted_manifest 适配器信封（供角色创建与叙事路由复用）
static func unwrap_adapted_manifest(raw_manifest: Dictionary) -> Dictionary:
    if raw_manifest.is_empty():
        return {}
    var inner: Variant = raw_manifest.get("adapted_manifest", null)
    if inner is Dictionary:
        return inner as Dictionary
    return raw_manifest

## 从输入字典反序列化还原传输对象
static func from_dto(raw_data: Dictionary, fallback_pack_id: String = "") -> DestinyModManifestDTO:
    var manifest_dto := DestinyModManifestDTO.new()
    if raw_data.is_empty():
        manifest_dto.pack_id = fallback_pack_id.strip_edges()
        manifest_dto.pack_name = manifest_dto.pack_id
        return manifest_dto

    var raw_id: String = str(raw_data.get("pack_id", "")).strip_edges()
    manifest_dto.pack_id = raw_id if not raw_id.is_empty() else fallback_pack_id.strip_edges()
    var raw_name: String = str(raw_data.get("pack_name", "")).strip_edges()
    manifest_dto.pack_name = raw_name if not raw_name.is_empty() else manifest_dto.pack_id
    manifest_dto.version = str(raw_data.get("version", "1.0.0"))
    manifest_dto.priority = int(raw_data.get("priority", 100))
    manifest_dto.root_path = str(raw_data.get("root_path", ""))

    var raw_dag_graphs: Variant = raw_data.get("dag_graphs", {})
    if raw_dag_graphs is Dictionary:
        manifest_dto.dag_graphs = (raw_dag_graphs as Dictionary).duplicate(true)

    var raw_i18n: Variant = raw_data.get("custom_i18n", {})
    if raw_i18n is Dictionary:
        manifest_dto.custom_i18n = (raw_i18n as Dictionary).duplicate(true)

    _populate_string_array(raw_data.get("dependencies", []), manifest_dto.dependencies)
    _populate_string_array(raw_data.get("incompatible_packs", []), manifest_dto.incompatible_packs)

    var raw_ui_capabilities: Variant = raw_data.get("ui_capabilities", {})
    if raw_ui_capabilities is Dictionary:
        manifest_dto.ui_capabilities = (raw_ui_capabilities as Dictionary).duplicate(true)

    _populate_origins_array(raw_data.get("custom_origins", []), manifest_dto.custom_origins)
    _populate_indexed_dict(raw_data.get("custom_traits", {}), manifest_dto.custom_traits, "trait_id", Callable(DestinyModManifestDTO, "_normalize_trait_dict"))
    _populate_dict_array(raw_data.get("paired_presets", []), manifest_dto.paired_presets)
    _populate_indexed_dict(raw_data.get("custom_starter_kits", {}), manifest_dto.custom_starter_kits, "kit_id", Callable(DestinyModManifestDTO, "_normalize_kit_dict"))

    var raw_rules: Variant = raw_data.get("custom_routing_rules", raw_data.get("routing_rules", []))
    _populate_dict_array(raw_rules, manifest_dto.custom_routing_rules)
    return manifest_dto

# ==============================================================================
# 四、内部类型转换与归一化辅助方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _populate_string_array(raw_value: Variant, target: Array[String]) -> void:
    target.clear()
    if not (raw_value is Array):
        return
    var source_array: Array = raw_value
    for item in source_array:
        var trimmed_text: String = str(item).strip_edges()
        if not trimmed_text.is_empty():
            target.append(trimmed_text)

static func _populate_dict_array(raw_value: Variant, target: Array[Dictionary]) -> void:
    target.clear()
    if not (raw_value is Array):
        return
    var cloned_array: Array = (raw_value as Array).duplicate(true)
    for item in cloned_array:
        if item is Dictionary:
            target.append(item as Dictionary)

static func _populate_origins_array(raw_value: Variant, target: Array[Dictionary]) -> void:
    target.clear()
    if raw_value is Array:
        var cloned_array: Array = (raw_value as Array).duplicate(true)
        for item in cloned_array:
            if item is Dictionary:
                var entry: Dictionary = item as Dictionary
                _normalize_origin_entry(entry)
                target.append(entry)
        return
    if raw_value is Dictionary:
        var cloned_dict: Dictionary = (raw_value as Dictionary).duplicate(true)
        for origin_key in cloned_dict.keys():
            var raw_entry: Variant = cloned_dict[origin_key]
            if raw_entry is Dictionary:
                var entry: Dictionary = raw_entry as Dictionary
                _normalize_origin_entry(entry, str(origin_key))
                target.append(entry)

static func _normalize_origin_entry(entry: Dictionary, default_id: String = "") -> void:
    if not entry.has("origin_id") and not default_id.is_empty():
        entry["origin_id"] = default_id
    if entry.has("race") and not entry.has("race_id"):
        entry["race_id"] = entry["race"]
    elif entry.has("race_id") and not entry.has("race"):
        entry["race"] = entry["race_id"]
    if entry.has("birth_region") and not entry.has("birth_region_id"):
        entry["birth_region_id"] = entry["birth_region"]
    elif entry.has("birth_region_id") and not entry.has("birth_region"):
        entry["birth_region"] = entry["birth_region_id"]

static func _populate_indexed_dict(raw_value: Variant, target: Dictionary, id_key: String, normalizer: Callable) -> void:
    target.clear()
    if raw_value is Array:
        var cloned_array: Array = (raw_value as Array).duplicate(true)
        for item in cloned_array:
            if item is Dictionary:
                var item_dict: Dictionary = item as Dictionary
                var key_id: String = str(item_dict.get(id_key, "")).strip_edges()
                if not key_id.is_empty():
                    normalizer.call(item_dict)
                    target[key_id] = item_dict
    elif raw_value is Dictionary:
        var cloned_dict: Dictionary = (raw_value as Dictionary).duplicate(true)
        for entry_key in cloned_dict.keys():
            var entry: Variant = cloned_dict[entry_key]
            if entry is Dictionary:
                var entry_dict: Dictionary = entry as Dictionary
                if not entry_dict.has(id_key):
                    entry_dict[id_key] = str(entry_key)
                normalizer.call(entry_dict)
                target[str(entry_key)] = entry_dict

static func _normalize_trait_dict(trait_dict: Dictionary) -> void:
    if trait_dict.has("polarity"):
        var polarity_text: String = str(trait_dict.get("polarity", "")).to_upper()
        if polarity_text.contains("POS"):
            trait_dict["type"] = "POSITIVE"
        elif polarity_text.contains("NEG"):
            trait_dict["type"] = "NEGATIVE"
        elif not trait_dict.has("type"):
            trait_dict["type"] = polarity_text
    elif not trait_dict.has("polarity") and trait_dict.has("type"):
        trait_dict["polarity"] = trait_dict["type"]

static func _normalize_kit_gold(kit: Dictionary) -> void:
    var has_initial_gold: bool = kit.has("initial_gold")
    var has_bonus: bool = kit.has("bonus_gold")
    if has_initial_gold and not has_bonus:
        kit["bonus_gold"] = kit["initial_gold"]
    elif has_bonus and not has_initial_gold:
        kit["initial_gold"] = kit["bonus_gold"]
    elif not has_initial_gold and not has_bonus:
        kit["initial_gold"] = 50
        kit["bonus_gold"] = 50

static func _build_items_from_init(initial_items: Array) -> Array[Dictionary]:
    var new_items: Array[Dictionary] = []
    for item_entry in initial_items:
        if item_entry is Dictionary:
            var canonical_id: String = str(item_entry.get("canonical_id", item_entry.get("item_id", "")))
            var item_count: int = int(item_entry.get("count", item_entry.get("quantity", 1)))
            var slot_name: String = str(item_entry.get("slot", "INVENTORY"))
            new_items.append({"item_id": canonical_id, "quantity": item_count, "slot": slot_name})
    return new_items

static func _build_init_from_items(items_array: Array) -> Array[Dictionary]:
    var converted_initial_items: Array[Dictionary] = []
    for item_entry in items_array:
        if item_entry is Dictionary:
            var canonical_id: String = str(item_entry.get("item_id", item_entry.get("canonical_id", "")))
            var item_count: int = int(item_entry.get("quantity", item_entry.get("count", 1)))
            converted_initial_items.append({"canonical_id": canonical_id, "count": item_count})
    return converted_initial_items

static func _normalize_kit_dict(kit: Dictionary) -> void:
    _normalize_kit_gold(kit)
    var has_initial_items := kit.has("initial_items") and kit["initial_items"] is Array
    var has_items := kit.has("items") and kit["items"] is Array

    if has_initial_items and not has_items:
        kit["items"] = _build_items_from_init(kit["initial_items"] as Array)
    elif has_items and not has_initial_items:
        kit["initial_items"] = _build_init_from_items(kit["items"] as Array)
