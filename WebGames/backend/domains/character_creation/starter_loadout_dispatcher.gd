# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/starter_loadout_dispatcher.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/starter_loadout/core.json | 信号: EventBus 领域广播
# 职责说明: 配置与单机命途 MOD 联动驱动的新手初始物资发放与实体装配，含绝对幂等保护：优先按 origin_id 匹配 adapted_mod_manifest 自定义套件，未命中则回退按 race_id 从 starter_loadout 发放并装配注入 CharacterProfile。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## StarterLoadoutDispatcher：Domain Logic Component
class_name StarterLoadoutDispatcher
extends RefCounted

# ==============================================================================
# 一、序章上下文新手物资发放（幂等装填与 MOD 优先匹配）
# ==============================================================================

## 为角色序章发放新手初始物资（幂等防重复保护；上下文原地标记已发放）
static func dispatch_starter_kit(
    prologue_context: CharacterPrologueContext,
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    if prologue_context == null or prologue_context.character_id.is_empty():
        return { "success": false, "error_code": "INVALID_CONTEXT" }

    # 1. 幂等防护：检查是否已发放过新手装备
    if bool(prologue_context.runtime_placeholders.get("STARTER_KIT_GRANTED", false)):
        return {
            "success": true,
            "code": "ALREADY_GRANTED",
            "message": "该角色已领取过新手装备，触发幂等跳过"
        }

    # 2. 读取配置或 MOD 清单决定套件 ID（禁止硬编码 Kalar 套件默认回退）
    var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)
    var kit_id := prologue_context.assigned_starter_kit_id
    if kit_id.is_empty():
        var mod_race_kits: Dictionary = manifest.get("race_kit_map", {})
        if mod_race_kits.has(prologue_context.race_id):
            kit_id = str(mod_race_kits.get(prologue_context.race_id, "")).strip_edges()
        if kit_id.is_empty():
            kit_id = GameConfig.get_string("domains.starter_loadout", "race_kit_map/" + prologue_context.race_id, "")
        if kit_id.is_empty():
            var creation_rules: Dictionary = manifest.get("creation_rules", {})
            kit_id = str(creation_rules.get("fallback_kit", GameConfig.get_string("domains.starter_loadout", "defaults/fallback_kit", ""))).strip_edges()
        prologue_context.assigned_starter_kit_id = kit_id

    var kit_config: Dictionary = _lookup_kit_config_by_id(kit_id, manifest)
    if kit_config.is_empty() and manifest.is_empty() and GameConfig.get_dict("domains.starter_loadout", "starter_kits", {}).is_empty():
        return {
            "success": false,
            "error_code": "ERR_NO_BASE_CONTENT_MOD",
            "message": "No active content MOD or starter kit catalog mounted."
        }
    if kit_config.is_empty():
        kit_config = {
            "initial_gold": GameConfig.get_int("domains.starter_loadout", "defaults/initial_gold", 0),
            "initial_items": []
        }

    var gold: int = int(kit_config.get("initial_gold", 0))
    var items: Array = kit_config.get("initial_items", [])

    # 3. 标记已发放
    prologue_context.runtime_placeholders["STARTER_KIT_GRANTED"] = true
    prologue_context.runtime_placeholders["STARTER_GOLD"] = gold

    return {
        "success": true,
        "code": "KIT_DISPATCHED",
        "gold": gold,
        "items": items,
        "kit_id": kit_id
    }

# ==============================================================================
# 二、角色档案背包装备实体装配 (Physical Loadout Assembly)
# ==============================================================================

## 将新手套件实体装配入角色档案 profile（优先按 origin_id 查找 MOD 套件，未命中回退按 race_id 发放）
static func hydrate_starter_loadout_into_profile(
    profile: CharacterProfile,
    race_id: String,
    origin_id: String = "",
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    if profile == null:
        return { "success": false, "error_code": "INVALID_PROFILE", "message": "角色档案对象不可为空" }

    # 1. 优先按 origin_id 查找 adapted_mod_manifest 中的 origin_kit_map 或身世绑定的 starter_kit_id，未命中按 race_id 解析
    var resolved: Dictionary = _resolve_effective_kit(race_id, origin_id, adapted_mod_manifest)
    if resolved.has("error_code") and not String(resolved.get("error_code", "")).is_empty():
        return resolved
    var kit_id: String = str(resolved.get("kit_id", ""))
    var kit_config: Dictionary = resolved.get("kit_cfg", {})

    # 2. 初始货币入账
    var gold: int = int(kit_config.get("initial_gold", 0))
    if not profile.personal_resources.has("gold"):
        profile.personal_resources["gold"] = gold
    else:
        profile.personal_resources["gold"] = int(profile.personal_resources["gold"]) + gold

    # 3. 实例化 WearableInventoryAggregate
    var inventory_aggregate := WearableInventoryAggregate.new()
    if not profile.character_id.is_empty():
        inventory_aggregate.owner_account_id = profile.character_id

    # 4. 物品元数据哈希预取（ADV-PRF-001：循环前构建 O(1) 字典查找集）
    var item_specification_map: Dictionary = _build_items_spec_lookup()

    # 5. 物品实体装配与入包
    var raw_items: Array = kit_config.get("initial_items", [])
    var display_weapon: String = str(kit_config.get("display_weapon", ""))
    var summary_array: Array[Dictionary] = []
    var empty_specification: Dictionary = {}

    for entry in raw_items:
        if not (entry is Dictionary):
            continue
        var canonical_id: String = str(entry.get("canonical_id", ""))
        if canonical_id.is_empty():
            continue
        var count: int = maxi(1, int(entry.get("count", 1)))
        var raw_specification: Variant = item_specification_map.get(canonical_id)
        var specification_map: Dictionary = raw_specification if raw_specification is Dictionary else empty_specification

        _equip_item_batch(
            inventory_aggregate,
            canonical_id,
            count,
            display_weapon,
            specification_map,
            summary_array
        )

    # 6. 度量刷新并原子同步写入 profile
    inventory_aggregate.refresh_cached_metrics()
    var serialized_inventory: Dictionary = inventory_aggregate.serialize()
    profile.inventory = serialized_inventory
    profile.equipment = serialized_inventory.get("equipped_payloads", {})

    return {
        "success": true,
        "inventory": inventory_aggregate,
        "starter_items_summary": summary_array,
        "kit_id": kit_id,
        "gold_granted": gold
    }

# ==============================================================================
# 三、套件多级路由解析与实体装配内部工具方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _resolve_effective_kit(
    race_id: String,
    origin_id: String,
    adapted_mod_manifest: Dictionary
) -> Dictionary:
    var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)
    var kit_id: String = _resolve_mod_kit_id_for_origin(origin_id, manifest)
    var kit_config: Dictionary = {}

    if not kit_id.is_empty():
        kit_config = _lookup_kit_config_by_id(kit_id, manifest)

    if kit_config.is_empty():
        var mod_race_kits: Dictionary = manifest.get("race_kit_map", {})
        if mod_race_kits.has(race_id):
            kit_id = str(mod_race_kits.get(race_id, "")).strip_edges()
        if kit_id.is_empty():
            kit_id = GameConfig.get_string("domains.starter_loadout", "race_kit_map/" + race_id, "")
        if kit_id.is_empty():
            var creation_rules: Dictionary = manifest.get("creation_rules", {})
            kit_id = str(creation_rules.get("fallback_kit", GameConfig.get_string("domains.starter_loadout", "defaults/fallback_kit", ""))).strip_edges()
        kit_config = _lookup_kit_config_by_id(kit_id, manifest)

    if kit_config.is_empty() and manifest.is_empty() and GameConfig.get_dict("domains.starter_loadout", "starter_kits", {}).is_empty():
        return {
            "success": false,
            "error_code": "ERR_NO_BASE_CONTENT_MOD",
            "message": "No active content MOD or starter kit catalog mounted."
        }

    if kit_config.is_empty():
        kit_config = {
            "initial_gold": GameConfig.get_int("domains.starter_loadout", "defaults/initial_gold", 0),
            "initial_items": []
        }

    return {
        "kit_id": kit_id,
        "kit_cfg": kit_config
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

    var origins_catalog: Dictionary = manifest.get("origins_catalog", {})
    if origins_catalog.has(clean_origin):
        var origin_entry: Variant = origins_catalog.get(clean_origin)
        if origin_entry is Dictionary:
            var bound_kit: String = str((origin_entry as Dictionary).get("starter_kit_id", "")).strip_edges()
            if not bound_kit.is_empty():
                return bound_kit

    var custom_origins: Variant = manifest.get("custom_origins", [])
    if custom_origins is Array:
        var from_array: String = _find_kit_id_in_origins_array(clean_origin, custom_origins as Array)
        if not from_array.is_empty():
            return from_array

    return ""

static func _find_kit_id_in_origins_array(origin_id: String, custom_origins: Array) -> String:
    for origin_entry in custom_origins:
        if origin_entry is Dictionary:
            var origin_map: Dictionary = origin_entry
            if str(origin_map.get("origin_id", "")).strip_edges() == origin_id:
                return str(origin_map.get("starter_kit_id", "")).strip_edges()
    return ""

static func _lookup_kit_config_by_id(kit_id: String, manifest: Dictionary) -> Dictionary:
    if kit_id.is_empty():
        return {}
    if not manifest.is_empty():
        var mod_kits: Dictionary = manifest.get("custom_starter_kits", {})
        if mod_kits.has(kit_id) and mod_kits[kit_id] is Dictionary:
            return mod_kits[kit_id] as Dictionary
    return GameConfig.get_dict("domains.starter_loadout", "starter_kits/" + kit_id, {})

static func _build_items_spec_lookup() -> Dictionary:
    var item_specification_map: Dictionary = {}
    var table_names: Array = GameConfig.get_table_names()
    for table_name_variant in table_names:
        var item_table_name := str(table_name_variant)
        if item_table_name.begins_with("items."):
            _merge_named_item_table(item_table_name, item_specification_map)
    return item_specification_map

static func _merge_named_item_table(item_table_name: String, item_specification_map: Dictionary) -> void:
    var table_payload: Variant = GameConfig.get_table(item_table_name, {})
    if table_payload is Dictionary and (table_payload as Dictionary).get("items") is Array:
        _merge_items_array_into_lookup((table_payload as Dictionary).get("items") as Array, item_specification_map)


static func _merge_items_array_into_lookup(items_array: Array, target_lookup: Dictionary) -> void:
    for item_entry in items_array:
        if item_entry is Dictionary:
            var entry_canonical_id: String = str((item_entry as Dictionary).get("canonical_id", "")).strip_edges()
            if not entry_canonical_id.is_empty():
                target_lookup[entry_canonical_id] = item_entry

static func _equip_item_batch(
    inventory_aggregate: WearableInventoryAggregate,
    canonical_id: String,
    count: int,
    display_weapon: String,
    item_specification: Dictionary,
    summary_entries: Array[Dictionary]
) -> void:
    var category: String = _resolve_item_category(canonical_id, item_specification)
    var mass_kg: float = float(item_specification.get("default_mass_kg", 1.0))
    var volume_slots: int = int(item_specification.get("default_volume_slots", 1))
    var custom_name: String = _resolve_item_name(canonical_id, item_specification)

    for _item_index in range(count):
        _instantiate_and_equip_or_store(
            inventory_aggregate,
            canonical_id,
            category,
            mass_kg,
            volume_slots,
            custom_name,
            display_weapon,
            summary_entries
        )

static func _instantiate_and_equip_or_store(
    inventory_aggregate: WearableInventoryAggregate,
    canonical_id: String,
    category: String,
    mass_kg: float,
    volume_slots: int,
    custom_name: String,
    display_weapon: String,
    summary_entries: Array[Dictionary]
) -> void:
    var spawned_item := ItemEntity.new()
    spawned_item.item_id = canonical_id
    spawned_item.template_id = canonical_id
    spawned_item.custom_name = custom_name
    spawned_item.category = category
    spawned_item.mass_kg = mass_kg
    spawned_item.volume_slots = volume_slots
    spawned_item.item_uid = ItemUIDGenerator.generate_uid("SRV_")

    var equipped_slot: String = ""
    # 若为主手武器且主手空闲，则优先装备
    if (canonical_id == display_weapon or category.begins_with("WEAPON_")) and inventory_aggregate.equipped_slots.get("MAIN_HAND") == null:
        if inventory_aggregate.equip_item("MAIN_HAND", spawned_item):
            equipped_slot = "MAIN_HAND"

    if equipped_slot.is_empty():
        if not inventory_aggregate.add_item(spawned_item):
            # 裸身容量为 0 时安全回退：直接入 storage_items 确保新手初始物资不丢失
            spawned_item.container_state = "INVENTORY"
            spawned_item.owner_account_id = inventory_aggregate.owner_account_id
            inventory_aggregate.storage_items.append(spawned_item)
        equipped_slot = "INVENTORY"

    summary_entries.append({
        "canonical_id": canonical_id,
        "item_id": spawned_item.item_id,
        "item_uid": spawned_item.item_uid,
        "custom_name": custom_name,
        "category": category,
        "count": 1,
        "slot": equipped_slot
    })

static func _resolve_item_category(canonical_id: String, item_specification: Dictionary) -> String:
    var minor_category: String = str(item_specification.get("category_minor", ""))
    if not minor_category.is_empty():
        return minor_category
    if canonical_id.contains("WEAPON_BLADE"):
        return ItemEntity.CATEGORY_WEAPON_BLADE
    if canonical_id.contains("WEAPON_BLUNT"):
        return ItemEntity.CATEGORY_WEAPON_BLUNT
    if canonical_id.contains("WEAPON_POLE"):
        return ItemEntity.CATEGORY_WEAPON_POLE
    if canonical_id.contains("ARMOR"):
        return ItemEntity.CATEGORY_ARMOR_EQUIPMENT
    if canonical_id.contains("CONSUM"):
        return ItemEntity.CATEGORY_CONSUMABLE_POTION
    return ItemEntity.CATEGORY_QUEST_MISC

static func _resolve_item_name(canonical_id: String, item_specification: Dictionary) -> String:
    var display_name: String = str(item_specification.get("display_name", item_specification.get("name", ""))).strip_edges()
    if not display_name.is_empty():
        return display_name
    var aliases: Array = item_specification.get("search_aliases", [])
    if not aliases.is_empty():
        return str(aliases[0])
    var english_name: String = str(item_specification.get("english_name", "")).strip_edges()
    if not english_name.is_empty():
        return english_name
    var name_key: String = str(item_specification.get("loc_name_key", "")).strip_edges()
    if name_key.is_empty():
        name_key = str(item_specification.get("canonical_name_key", "")).strip_edges()
    if not name_key.is_empty():
        var localized_name: String = LocalizationSolver.resolve_name_key(LocalizationRegistryCatalog.get_shared(), name_key)
        if not localized_name.is_empty() and localized_name != "[%s]" % name_key:
            return localized_name
    var parts: PackedStringArray = canonical_id.split(":")
    return parts[parts.size() - 1] if parts.size() > 0 else canonical_id
