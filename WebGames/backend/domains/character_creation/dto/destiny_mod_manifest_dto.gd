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

# ==============================================================================
# 一、模组声明清单契约字段
# ==============================================================================

var pack_id: String = ""
var pack_name: String = ""
var version: String = "1.0.0"
var priority: int = 100
var pack_profile: String = "CONTENT_ADDON"
var is_official: bool = false
var content_sha256: String = ""
var has_prologue_dag: bool = true
var dependencies: Array[String] = []
var incompatible_packs: Array[String] = []
var ui_capabilities: Dictionary = {}
var custom_races: Dictionary = {}
var creation_rule_overrides: Dictionary = {}
var custom_origins: Array[Dictionary] = []
var custom_traits: Dictionary = {}
var paired_presets: Array[Dictionary] = []
var custom_starter_kits: Dictionary = {}
var custom_routing_rules: Array[Dictionary] = []
var prologue_routing_rules: Array[Dictionary] = []
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
    pack_profile = "CONTENT_ADDON"
    is_official = false
    content_sha256 = ""
    has_prologue_dag = true
    dependencies.clear()
    incompatible_packs.clear()
    ui_capabilities.clear()
    custom_races.clear()
    creation_rule_overrides.clear()
    custom_origins.clear()
    custom_traits.clear()
    paired_presets.clear()
    custom_starter_kits.clear()
    custom_routing_rules.clear()
    prologue_routing_rules.clear()
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
        "pack_profile": pack_profile,
        "is_official": is_official,
        "content_sha256": content_sha256,
        "has_prologue_dag": has_prologue_dag,
        "dependencies": dependencies.duplicate(),
        "incompatible_packs": incompatible_packs.duplicate(),
        "ui_capabilities": ui_capabilities.duplicate(true),
        "custom_races": custom_races.duplicate(true),
        "creation_rule_overrides": creation_rule_overrides.duplicate(true),
        "custom_origins": custom_origins.duplicate(true),
        "custom_traits": custom_traits.duplicate(true),
        "paired_presets": paired_presets.duplicate(true),
        "custom_starter_kits": custom_starter_kits.duplicate(true),
        "custom_routing_rules": custom_routing_rules.duplicate(true),
        "prologue_routing_rules": prologue_routing_rules.duplicate(true),
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
static func from_dto(serialized_manifest: Dictionary, fallback_pack_id: String = "") -> DestinyModManifestDTO:
    var manifest_dto := DestinyModManifestDTO.new()
    if serialized_manifest.is_empty():
        manifest_dto.pack_id = fallback_pack_id.strip_edges()
        manifest_dto.pack_name = manifest_dto.pack_id
        return manifest_dto

    var raw_id: String = str(serialized_manifest.get("pack_id", "")).strip_edges()
    manifest_dto.pack_id = raw_id if not raw_id.is_empty() else fallback_pack_id.strip_edges()
    var raw_name: String = str(serialized_manifest.get("pack_name", "")).strip_edges()
    manifest_dto.pack_name = raw_name if not raw_name.is_empty() else manifest_dto.pack_id
    manifest_dto.version = str(serialized_manifest.get("version", "1.0.0"))
    manifest_dto.priority = int(serialized_manifest.get("priority", 100))
    var raw_profile: String = str(serialized_manifest.get("pack_profile", "")).strip_edges().to_upper()
    manifest_dto.pack_profile = raw_profile if not raw_profile.is_empty() else "CONTENT_ADDON"
    manifest_dto.is_official = bool(serialized_manifest.get("is_official", manifest_dto.pack_profile == "OFFICIAL_BASE"))
    manifest_dto.content_sha256 = str(serialized_manifest.get("content_sha256", "")).strip_edges()
    manifest_dto.has_prologue_dag = bool(serialized_manifest.get("has_prologue_dag", true))
    manifest_dto.root_path = str(serialized_manifest.get("root_path", ""))

    var raw_dag_graphs: Variant = serialized_manifest.get("dag_graphs", {})
    if raw_dag_graphs is Dictionary:
        manifest_dto.dag_graphs = (raw_dag_graphs as Dictionary).duplicate(true)

    var raw_i18n: Variant = serialized_manifest.get("custom_i18n", {})
    if raw_i18n is Dictionary:
        manifest_dto.custom_i18n = (raw_i18n as Dictionary).duplicate(true)

    _populate_string_array(serialized_manifest.get("dependencies", []), manifest_dto.dependencies)
    _populate_string_array(serialized_manifest.get("incompatible_packs", []), manifest_dto.incompatible_packs)

    var raw_ui_capabilities: Variant = serialized_manifest.get("ui_capabilities", {})
    if raw_ui_capabilities is Dictionary:
        manifest_dto.ui_capabilities = (raw_ui_capabilities as Dictionary).duplicate(true)

    _populate_indexed_dict(serialized_manifest.get("custom_races", {}), manifest_dto.custom_races, "race_id", Callable(DestinyModManifestDTO, "_normalize_race_dict"))
    var raw_rule_overrides: Variant = serialized_manifest.get("creation_rule_overrides", {})
    if raw_rule_overrides is Dictionary:
        manifest_dto.creation_rule_overrides = (raw_rule_overrides as Dictionary).duplicate(true)

    _populate_origins_array(serialized_manifest.get("custom_origins", []), manifest_dto.custom_origins)
    _populate_indexed_dict(serialized_manifest.get("custom_traits", {}), manifest_dto.custom_traits, "trait_id", Callable(DestinyModManifestDTO, "_normalize_trait_dict"))
    _populate_dict_array(serialized_manifest.get("paired_presets", []), manifest_dto.paired_presets)
    _populate_indexed_dict(serialized_manifest.get("custom_starter_kits", {}), manifest_dto.custom_starter_kits, "kit_id", Callable(DestinyModManifestDTO, "_normalize_kit_dict"))

    _populate_dict_array(serialized_manifest.get("custom_routing_rules", []), manifest_dto.custom_routing_rules)
    _populate_dict_array(serialized_manifest.get("prologue_routing_rules", []), manifest_dto.prologue_routing_rules)
    return manifest_dto

# ==============================================================================
# 四、内部类型转换与归一化辅助方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _populate_string_array(raw_value: Variant, target: Array[String]) -> void:
    target.clear()
    if not (raw_value is Array):
        return
    var source_array: Array = raw_value
    for raw_entry in source_array:
        var trimmed_text: String = str(raw_entry).strip_edges()
        if not trimmed_text.is_empty():
            target.append(trimmed_text)

static func _populate_dict_array(raw_value: Variant, target: Array[Dictionary]) -> void:
    target.clear()
    if not (raw_value is Array):
        return
    var cloned_array: Array = (raw_value as Array).duplicate(true)
    for raw_entry in cloned_array:
        if raw_entry is Dictionary:
            target.append(raw_entry as Dictionary)

static func _populate_origins_array(raw_value: Variant, target: Array[Dictionary]) -> void:
    target.clear()
    if raw_value is Array:
        var cloned_array: Array = (raw_value as Array).duplicate(true)
        for origin_entry in cloned_array:
            if origin_entry is Dictionary:
                var entry: Dictionary = origin_entry as Dictionary
                _normalize_origin_entry(entry)
                target.append(entry)
        return
    if raw_value is Dictionary:
        var cloned_origin_map: Dictionary = (raw_value as Dictionary).duplicate(true)
        for origin_key in cloned_origin_map.keys():
            var raw_entry: Variant = cloned_origin_map[origin_key]
            if raw_entry is Dictionary:
                var entry: Dictionary = raw_entry as Dictionary
                _normalize_origin_entry(entry, str(origin_key))
                target.append(entry)

static func _normalize_origin_entry(entry: Dictionary, default_id: String = "") -> void:
    if not entry.has("origin_id") and not default_id.is_empty():
        entry["origin_id"] = default_id

static func _populate_indexed_dict(raw_value: Variant, target: Dictionary, id_key: String, normalizer: Callable) -> void:
    target.clear()
    if raw_value is Array:
        var cloned_array: Array = (raw_value as Array).duplicate(true)
        for array_entry in cloned_array:
            if array_entry is Dictionary:
                var entry_map: Dictionary = array_entry as Dictionary
                var key_id: String = str(entry_map.get(id_key, "")).strip_edges()
                if not key_id.is_empty():
                    normalizer.call(entry_map)
                    target[key_id] = entry_map
    elif raw_value is Dictionary:
        var cloned_entries_map: Dictionary = (raw_value as Dictionary).duplicate(true)
        for entry_key in cloned_entries_map.keys():
            var entry: Variant = cloned_entries_map[entry_key]
            if entry is Dictionary:
                var entry_map: Dictionary = entry as Dictionary
                if not entry_map.has(id_key):
                    entry_map[id_key] = str(entry_key)
                normalizer.call(entry_map)
                target[str(entry_key)] = entry_map

static func _normalize_race_dict(_race_entry: Dictionary) -> void:
    pass


static func _normalize_trait_dict(_trait_entry: Dictionary) -> void:
    pass

static func _normalize_kit_dict(kit: Dictionary) -> void:
    if not kit.has("initial_gold"):
        kit["initial_gold"] = 0
    if not (kit.has("initial_items") and kit["initial_items"] is Array):
        kit["initial_items"] = []
