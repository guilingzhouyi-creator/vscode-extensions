# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/starter_loadout_dispatcher.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/starter_loadout/core.json | 信号: EventBus 领域广播
# 职责说明: 配置与单机命途 MOD 联动驱动的新手初始物资发放与物理水化，含绝对幂等保护：优先按 origin_id 匹配 adapted_mod_manifest 自定义套件，未命中则回退按 race_id 从 starter_loadout 发放并水化注入 CharacterProfile。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## StarterLoadoutDispatcher：Domain Logic Component
class_name StarterLoadoutDispatcher
extends RefCounted

# ==============================================================================
# 一、序章上下文新手物资发放（既有契约，100% 向后兼容）
# ==============================================================================

## 为角色序章发放新手初始物资（幂等防重复保护；上下文原地标记已发放）
static func dispatch_starter_kit(
    ctx: CharacterPrologueContext,
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    if ctx == null or ctx.character_id.is_empty():
        return { "success": false, "error_code": "INVALID_CONTEXT" }

    # 1. 幂等防护：检查是否已发放过新手装备
    if bool(ctx.runtime_placeholders.get("STARTER_KIT_GRANTED", false)):
        return {
            "success": true,
            "code": "ALREADY_GRANTED",
            "message": "该角色已领取过新手装备，触发幂等跳过"
        }

    # 2. 读取配置或 MOD 清单决定套件 ID
    var manifest: Dictionary = _unwrap_adapted_manifest(adapted_mod_manifest)
    var kit_id := ctx.assigned_starter_kit_id
    if kit_id.is_empty():
        kit_id = GameConfig.get_string("domains.starter_loadout", "race_kit_map/" + ctx.race_id, "")
        if kit_id.is_empty():
            kit_id = GameConfig.get_string("domains.starter_loadout", "defaults/fallback_kit", "KIT_HUMAN_DEFAULT")
        ctx.assigned_starter_kit_id = kit_id

    var kit_cfg: Dictionary = _lookup_kit_config_by_id(kit_id, manifest)
    if kit_cfg.is_empty():
        kit_cfg = {
            "initial_gold": GameConfig.get_int("domains.starter_loadout", "defaults/initial_gold", 50),
            "initial_items": []
        }

    var gold: int = int(kit_cfg.get("initial_gold", 50))
    var items: Array = kit_cfg.get("initial_items", [])

    # 3. 标记已发放
    ctx.runtime_placeholders["STARTER_KIT_GRANTED"] = true
    ctx.runtime_placeholders["STARTER_GOLD"] = gold

    return {
        "success": true,
        "code": "KIT_DISPATCHED",
        "gold": gold,
        "items": items,
        "kit_id": kit_id
    }

# ==============================================================================
# 二、角色档案背包装备物理水化装配 (Physical Loadout Hydration)
# ==============================================================================

## 将新手套件物理水化装配入角色档案 profile（优先按 origin_id 查找 MOD 套件，未命中回退按 race_id 发放）
static func hydrate_starter_loadout_into_profile(
    profile: CharacterProfile,
    race_id: String,
    origin_id: String = "",
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    if profile == null:
        return { "success": false, "error_code": "INVALID_PROFILE", "message": "角色档案对象不可为空" }

    # 1. 优先按 origin_id 查找 adapted_mod_manifest 中的 origin_kit_map 或身世绑定的 starter_kit_id，未命中回退按 race_id 解析
    var resolved: Dictionary = _resolve_effective_kit(race_id, origin_id, adapted_mod_manifest)
    var kit_id: String = str(resolved.get("kit_id", ""))
    var kit_cfg: Dictionary = resolved.get("kit_cfg", {})

    # 2. 初始货币入账
    var gold: int = int(kit_cfg.get("initial_gold", 50))
    if not profile.personal_resources.has("gold"):
        profile.personal_resources["gold"] = gold
    else:
        profile.personal_resources["gold"] = int(profile.personal_resources["gold"]) + gold

    # 3. 实例化 WearableInventoryAggregate
    var inventory_agg := WearableInventoryAggregate.new()
    if not profile.character_id.is_empty():
        inventory_agg.owner_account_id = profile.character_id

    # 4. 物品元数据哈希预取（ADV-PRF-001：循环前构建 O(1) 字典查找集）
    var items_spec_map: Dictionary = _build_items_spec_lookup()

    # 5. 物品物理水化与装配/入包
    var raw_items: Array = kit_cfg.get("initial_items", [])
    var display_weapon: String = str(kit_cfg.get("display_weapon", ""))
    var summary_array: Array[Dictionary] = []

    for entry in raw_items:
        if not (entry is Dictionary):
            continue
        var cid: String = str(entry.get("canonical_id", ""))
        if cid.is_empty():
            continue
        var count: int = maxi(1, int(entry.get("count", 1)))
        var spec_dict: Dictionary = items_spec_map.get(cid, {})

        _hydrate_item_batch(
            inventory_agg,
            cid,
            count,
            display_weapon,
            spec_dict,
            summary_array
        )

    # 6. 度量刷新并原子同步写入 profile
    inventory_agg.refresh_cached_metrics()
    var serialized_inv: Dictionary = inventory_agg.serialize()
    profile.inventory = serialized_inv
    profile.equipment = serialized_inv.get("equipped_payloads", {})

    return {
        "success": true,
        "inventory": inventory_agg,
        "starter_items_summary": summary_array,
        "kit_id": kit_id,
        "gold_granted": gold
    }

# ==============================================================================
# 三、套件多级路由解析与物理水化内部工具方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _unwrap_adapted_manifest(raw_manifest: Dictionary) -> Dictionary:
    if raw_manifest.is_empty():
        return {}
    var inner: Variant = raw_manifest.get("adapted_manifest", null)
    if inner is Dictionary:
        return inner as Dictionary
    return raw_manifest

static func _resolve_effective_kit(
    race_id: String,
    origin_id: String,
    adapted_mod_manifest: Dictionary
) -> Dictionary:
    var manifest: Dictionary = _unwrap_adapted_manifest(adapted_mod_manifest)
    var kit_id: String = _resolve_mod_kit_id_for_origin(origin_id, manifest)
    var kit_cfg: Dictionary = {}

    if not kit_id.is_empty():
        kit_cfg = _lookup_kit_config_by_id(kit_id, manifest)

    if kit_cfg.is_empty():
        kit_id = GameConfig.get_string("domains.starter_loadout", "race_kit_map/" + race_id, "")
        if kit_id.is_empty():
            kit_id = GameConfig.get_string("domains.starter_loadout", "defaults/fallback_kit", "KIT_HUMAN_DEFAULT")
        kit_cfg = _lookup_kit_config_by_id(kit_id, manifest)

    if kit_cfg.is_empty():
        kit_cfg = {
            "initial_gold": GameConfig.get_int("domains.starter_loadout", "defaults/initial_gold", 50),
            "initial_items": []
        }

    return {
        "kit_id": kit_id,
        "kit_cfg": kit_cfg
    }

static func _resolve_mod_kit_id_for_origin(origin_id: String, manifest: Dictionary) -> String:
    var clean_origin: String = origin_id.strip_edges()
    if clean_origin.is_empty() or manifest.is_empty():
        return ""

    var origin_kit_map: Dictionary = manifest.get("origin_kit_map", {})
    if origin_kit_map.has(clean_origin):
        var mapped_id: String = str(origin_kit_map.get(clean_origin, "")).strip_edges()
        if not mapped_id.is_empty():
            return mapped_id

    var origins_cat: Dictionary = manifest.get("origins_catalog", manifest.get("origins", {}))
    if origins_cat.has(clean_origin):
        var orig_entry: Variant = origins_cat.get(clean_origin)
        if orig_entry is Dictionary:
            var bound_kit: String = str((orig_entry as Dictionary).get("starter_kit_id", "")).strip_edges()
            if not bound_kit.is_empty():
                return bound_kit

    var custom_origins: Variant = manifest.get("custom_origins", [])
    if custom_origins is Array:
        var from_arr: String = _find_kit_id_in_origins_array(clean_origin, custom_origins as Array)
        if not from_arr.is_empty():
            return from_arr

    return ""

static func _find_kit_id_in_origins_array(origin_id: String, custom_origins: Array) -> String:
    for item in custom_origins:
        if item is Dictionary:
            var d: Dictionary = item
            if str(d.get("origin_id", "")).strip_edges() == origin_id:
                return str(d.get("starter_kit_id", "")).strip_edges()
    return ""

static func _lookup_kit_config_by_id(kit_id: String, manifest: Dictionary) -> Dictionary:
    if kit_id.is_empty():
        return {}
    if not manifest.is_empty():
        var mod_kits: Dictionary = manifest.get("starter_kits", manifest.get("custom_starter_kits", {}))
        if mod_kits.has(kit_id) and mod_kits[kit_id] is Dictionary:
            return mod_kits[kit_id] as Dictionary
    return GameConfig.get_dict("domains.starter_loadout", "starter_kits/" + kit_id, {})

static func _build_items_spec_lookup() -> Dictionary:
    var all_items: Array = GameConfig.get_array("items.core", "items", [])
    var items_spec_map: Dictionary = {}
    for spec in all_items:
        if spec is Dictionary:
            var spec_cid: String = str(spec.get("canonical_id", ""))
            if not spec_cid.is_empty():
                items_spec_map[spec_cid] = spec
    return items_spec_map

static func _hydrate_item_batch(
    inv: WearableInventoryAggregate,
    cid: String,
    count: int,
    display_weapon: String,
    spec: Dictionary,
    out_summary: Array[Dictionary]
) -> void:
    var category: String = _resolve_item_category(cid, spec)
    var mass_kg: float = float(spec.get("default_mass_kg", 1.0))
    var volume_slots: int = int(spec.get("default_volume_slots", 1))
    var custom_name: String = _resolve_item_name(cid, spec)

    for _i in range(count):
        _instantiate_and_equip_or_store(
            inv,
            cid,
            category,
            mass_kg,
            volume_slots,
            custom_name,
            display_weapon,
            out_summary
        )

static func _instantiate_and_equip_or_store(
    inv: WearableInventoryAggregate,
    cid: String,
    category: String,
    mass_kg: float,
    volume_slots: int,
    custom_name: String,
    display_weapon: String,
    out_summary: Array[Dictionary]
) -> void:
    var item := ItemEntity.new()
    item.item_id = cid
    item.template_id = cid
    item.custom_name = custom_name
    item.category = category
    item.mass_kg = mass_kg
    item.volume_slots = volume_slots
    item.item_uid = WearableInventoryAggregate.ItemUIDGenerator.generate_uid("SRV_")

    var equipped_slot: String = ""
    # 若为主手武器且主手空闲，则优先装备
    if (cid == display_weapon or category.begins_with("WEAPON_")) and inv.equipped_slots.get("MAIN_HAND") == null:
        if inv.equip_item("MAIN_HAND", item):
            equipped_slot = "MAIN_HAND"

    if equipped_slot.is_empty():
        if not inv.add_item(item):
            # 裸身容量为 0 时安全保底：直接入 storage_items 确保新手初始物资不丢失
            item.container_state = "INVENTORY"
            item.owner_account_id = inv.owner_account_id
            inv.storage_items.append(item)
        equipped_slot = "INVENTORY"

    out_summary.append({
        "canonical_id": cid,
        "item_id": item.item_id,
        "item_uid": item.item_uid,
        "custom_name": custom_name,
        "category": category,
        "count": 1,
        "slot": equipped_slot
    })

static func _resolve_item_category(cid: String, spec: Dictionary) -> String:
    var minor: String = str(spec.get("category_minor", ""))
    if not minor.is_empty():
        return minor
    if cid.contains("WEAPON_BLADE"):
        return ItemEntity.CATEGORY_WEAPON_BLADE
    if cid.contains("WEAPON_BLUNT"):
        return ItemEntity.CATEGORY_WEAPON_BLUNT
    if cid.contains("WEAPON_POLE"):
        return ItemEntity.CATEGORY_WEAPON_POLE
    if cid.contains("ARMOR"):
        return ItemEntity.CATEGORY_ARMOR_EQUIPMENT
    if cid.contains("CONSUM"):
        return ItemEntity.CATEGORY_CONSUMABLE_POTION
    return ItemEntity.CATEGORY_QUEST_MISC

static func _resolve_item_name(cid: String, spec: Dictionary) -> String:
    var aliases: Array = spec.get("search_aliases", [])
    if not aliases.is_empty():
        return str(aliases[0])
    var eng: String = str(spec.get("english_name", ""))
    if not eng.is_empty():
        return eng
    match cid:
        "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD":
            return "铁剑"
        "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD":
            return "秘银长剑"
        "KALAR:CONSUM:ALCHEMY:POTION_MANA":
            return "法力药水"
        _:
            var parts: PackedStringArray = cid.split(":")
            return parts[parts.size() - 1] if parts.size() > 0 else cid
