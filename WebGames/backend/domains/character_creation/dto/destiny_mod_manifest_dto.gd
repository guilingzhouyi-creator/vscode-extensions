# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/destiny_mod_manifest_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 跨域依赖: 上游: WorldGateway / ModPrecheckAndAdaptationSolver | 下游: AuthoritativeReincarnationSolver, StarterLoadoutDispatcher | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 单机命途显性 MOD 声明清单数据传输对象；承载单包元数据、前端 UI 策略能力声明、自定义身世池、因果天赋、配对预设、初始套件与专属序章路由规则。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name DestinyModManifestDTO
extends RefCounted

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

# ==============================================================================
# 二、对象池与状态重置契约 (ADV-POOL-001)
# ==============================================================================

func reset_state() -> void:
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

# ==============================================================================
# 三、序列化与工厂反序列化契约
# ==============================================================================

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
        "custom_routing_rules": custom_routing_rules.duplicate(true)
    }

static func from_dto(d: Dictionary, fallback_pack_id: String = "") -> DestinyModManifestDTO:
    var dto := DestinyModManifestDTO.new()
    if d.is_empty():
        dto.pack_id = fallback_pack_id.strip_edges()
        dto.pack_name = dto.pack_id
        return dto

    var raw_id: String = str(d.get("pack_id", "")).strip_edges()
    dto.pack_id = raw_id if not raw_id.is_empty() else fallback_pack_id.strip_edges()
    var raw_name: String = str(d.get("pack_name", "")).strip_edges()
    dto.pack_name = raw_name if not raw_name.is_empty() else dto.pack_id
    dto.version = str(d.get("version", "1.0.0"))
    dto.priority = int(d.get("priority", 100))

    _populate_string_array(d.get("dependencies", []), dto.dependencies)
    _populate_string_array(d.get("incompatible_packs", []), dto.incompatible_packs)

    var raw_ui: Variant = d.get("ui_capabilities", {})
    if raw_ui is Dictionary:
        dto.ui_capabilities = (raw_ui as Dictionary).duplicate(true)

    _populate_origins_array(d.get("custom_origins", []), dto.custom_origins)

    var raw_traits: Variant = d.get("custom_traits", {})
    if raw_traits is Dictionary:
        dto.custom_traits = (raw_traits as Dictionary).duplicate(true)

    _populate_dict_array(d.get("paired_presets", []), dto.paired_presets)

    var raw_kits: Variant = d.get("custom_starter_kits", {})
    if raw_kits is Dictionary:
        dto.custom_starter_kits = (raw_kits as Dictionary).duplicate(true)

    _populate_dict_array(d.get("custom_routing_rules", []), dto.custom_routing_rules)
    return dto

# ==============================================================================
# 四、内部类型转换辅助方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _populate_string_array(raw_val: Variant, target: Array[String]) -> void:
    target.clear()
    if not (raw_val is Array):
        return
    var arr: Array = raw_val
    for item in arr:
        var s: String = str(item).strip_edges()
        if not s.is_empty():
            target.append(s)

static func _populate_dict_array(raw_val: Variant, target: Array[Dictionary]) -> void:
    target.clear()
    if not (raw_val is Array):
        return
    var arr: Array = raw_val
    for item in arr:
        if item is Dictionary:
            target.append((item as Dictionary).duplicate(true))

static func _populate_origins_array(raw_val: Variant, target: Array[Dictionary]) -> void:
    target.clear()
    if raw_val is Array:
        _populate_dict_array(raw_val, target)
        return
    if raw_val is Dictionary:
        var dict_val: Dictionary = raw_val
        for orig_key in dict_val.keys():
            _append_origin_from_map_entry(str(orig_key), dict_val[orig_key], target)

static func _append_origin_from_map_entry(
    orig_key: String,
    raw_entry: Variant,
    target: Array[Dictionary]
) -> void:
    if not (raw_entry is Dictionary):
        return
    var entry_copy: Dictionary = (raw_entry as Dictionary).duplicate(true)
    if not entry_copy.has("origin_id"):
        entry_copy["origin_id"] = orig_key
    target.append(entry_copy)
