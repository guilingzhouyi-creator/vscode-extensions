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
var root_path: String = ""
var dag_graphs: Dictionary = {}
var custom_i18n: Dictionary = {}

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
    root_path = ""
    dag_graphs.clear()
    custom_i18n.clear()

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
        "custom_routing_rules": custom_routing_rules.duplicate(true),
        "root_path": root_path,
        "dag_graphs": dag_graphs.duplicate(true),
        "custom_i18n": custom_i18n.duplicate(true)
    }

## 从输入字典反序列化还原传输对象
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
    dto.root_path = str(d.get("root_path", ""))

    var raw_dags: Variant = d.get("dag_graphs", {})
    if raw_dags is Dictionary:
        dto.dag_graphs = (raw_dags as Dictionary).duplicate(true)

    var raw_i18n: Variant = d.get("custom_i18n", {})
    if raw_i18n is Dictionary:
        dto.custom_i18n = (raw_i18n as Dictionary).duplicate(true)

    _populate_string_array(d.get("dependencies", []), dto.dependencies)
    _populate_string_array(d.get("incompatible_packs", []), dto.incompatible_packs)

    var raw_ui: Variant = d.get("ui_capabilities", {})
    if raw_ui is Dictionary:
        dto.ui_capabilities = (raw_ui as Dictionary).duplicate(true)

    _populate_origins_array(d.get("custom_origins", []), dto.custom_origins)
    _populate_traits_dict(d.get("custom_traits", {}), dto.custom_traits)
    _populate_dict_array(d.get("paired_presets", []), dto.paired_presets)
    _populate_starter_kits_dict(d.get("custom_starter_kits", {}), dto.custom_starter_kits)

    var raw_rules: Variant = d.get("custom_routing_rules", d.get("routing_rules", []))
    _populate_dict_array(raw_rules, dto.custom_routing_rules)
    return dto

# ==============================================================================
# 四、内部类型转换与归一化辅助方法 (CC <= 15, Depth <= 3)
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
        for item in (raw_val as Array):
            if item is Dictionary:
                var entry: Dictionary = (item as Dictionary).duplicate(true)
                _normalize_origin_entry(entry)
                target.append(entry)
        return
    if raw_val is Dictionary:
        var dict_val: Dictionary = raw_val
        for orig_key in dict_val.keys():
            var raw_entry: Variant = dict_val[orig_key]
            if raw_entry is Dictionary:
                var entry: Dictionary = (raw_entry as Dictionary).duplicate(true)
                _normalize_origin_entry(entry, str(orig_key))
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

static func _populate_traits_dict(raw_val: Variant, target: Dictionary) -> void:
    target.clear()
    if raw_val is Array:
        for item in (raw_val as Array):
            if item is Dictionary:
                var d_item: Dictionary = (item as Dictionary).duplicate(true)
                var tid: String = str(d_item.get("trait_id", "")).strip_edges()
                if not tid.is_empty():
                    _normalize_trait_dict(d_item)
                    target[tid] = d_item
    elif raw_val is Dictionary:
        var dict_val: Dictionary = raw_val
        for k in dict_val.keys():
            var entry: Variant = dict_val[k]
            if entry is Dictionary:
                var d_entry: Dictionary = (entry as Dictionary).duplicate(true)
                if not d_entry.has("trait_id"):
                    d_entry["trait_id"] = str(k)
                _normalize_trait_dict(d_entry)
                target[str(k)] = d_entry

static func _normalize_trait_dict(d: Dictionary) -> void:
    if d.has("polarity"):
        var pol: String = str(d.get("polarity", "")).to_upper()
        if pol.contains("POS"):
            d["type"] = "POSITIVE"
        elif pol.contains("NEG"):
            d["type"] = "NEGATIVE"
        elif not d.has("type"):
            d["type"] = pol
    elif not d.has("polarity") and d.has("type"):
        d["polarity"] = d["type"]

static func _populate_starter_kits_dict(raw_val: Variant, target: Dictionary) -> void:
    target.clear()
    if raw_val is Array:
        for item in (raw_val as Array):
            if item is Dictionary:
                var d_item: Dictionary = (item as Dictionary).duplicate(true)
                var kid: String = str(d_item.get("kit_id", "")).strip_edges()
                if not kid.is_empty():
                    _normalize_kit_dict(d_item)
                    target[kid] = d_item
    elif raw_val is Dictionary:
        var dict_val: Dictionary = raw_val
        for k in dict_val.keys():
            var entry: Variant = dict_val[k]
            if entry is Dictionary:
                var d_entry: Dictionary = (entry as Dictionary).duplicate(true)
                if not d_entry.has("kit_id"):
                    d_entry["kit_id"] = str(k)
                _normalize_kit_dict(d_entry)
                target[str(k)] = d_entry

static func _normalize_kit_dict(kit: Dictionary) -> void:
    if kit.has("initial_gold") and not kit.has("bonus_gold"):
        kit["bonus_gold"] = kit["initial_gold"]
    elif kit.has("bonus_gold") and not kit.has("initial_gold"):
        kit["initial_gold"] = kit["bonus_gold"]
    elif not kit.has("initial_gold") and not kit.has("bonus_gold"):
        kit["initial_gold"] = 50
        kit["bonus_gold"] = 50

    var has_init := kit.has("initial_items") and kit["initial_items"] is Array
    var has_items := kit.has("items") and kit["items"] is Array

    if has_init and not has_items:
        var new_items: Array[Dictionary] = []
        for it in (kit["initial_items"] as Array):
            if it is Dictionary:
                var cid: String = str(it.get("canonical_id", it.get("item_id", "")))
                var cnt: int = int(it.get("count", it.get("quantity", 1)))
                var slot_val: String = str(it.get("slot", "INVENTORY"))
                new_items.append({"item_id": cid, "quantity": cnt, "slot": slot_val})
        kit["items"] = new_items
    elif has_items and not has_init:
        var new_init: Array[Dictionary] = []
        for it in (kit["items"] as Array):
            if it is Dictionary:
                var cid: String = str(it.get("item_id", it.get("canonical_id", "")))
                var cnt: int = int(it.get("quantity", it.get("count", 1)))
                new_init.append({"canonical_id": cid, "count": cnt})
        kit["initial_items"] = new_init
