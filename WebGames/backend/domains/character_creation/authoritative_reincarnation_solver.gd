# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/authoritative_reincarnation_solver.gd
# 架构定位: Domain Logic Component / Authoritative Solver
# 依赖与触发: 上游: Gateway / WorldGateway / Orchestrator | 下游: DeterministicRNG, GameConfig | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 纯后端角色身世权威解算器；零信任清洗客户端伪造入参，依托伪随机种子、单源配置及已通过预检适配的单机命途 MOD 清单，加权或受控自选解算身世轮盘、种族、因果天赋对与 [1,6] 严格六维属性。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AuthoritativeReincarnationSolver：Domain Logic Component / Authoritative Solver
class_name AuthoritativeReincarnationSolver
extends RefCounted

# ==============================================================================
# 一、权威解算主入口 (Zero-Trust & Controlled MOD Resolution)
# ==============================================================================

## 根据权威角色创建请求 DTO、确定性种子与适配后的 MOD 清单解算身世、种族、性别、出生地、六维属性与天赋对
static func resolve_reincarnation_package(
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    seed_value: int = 0,
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    if creation_request == null:
        return { "success": false, "error_code": "INVALID_REQUEST", "message": "请求对象不可为空" }

    var character_name: String = creation_request.character_name.strip_edges()
    if character_name.is_empty():
        return { "success": false, "error_code": "EMPTY_NAME", "message": "角色名称不可为空" }

    var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)
    if manifest.is_empty() or not bool(manifest.get("has_base_content_mod", false)):
        return {
            "success": false,
            "error_code": "ERR_NO_BASE_CONTENT_MOD",
            "message": "No active base or total-conversion content MOD mounted; character creation cannot fall back to built-in lore."
        }
    var ui_controls: Dictionary = manifest.get("ui_controls", {})

    # 1. 种子确定性收敛（当 MOD 显式开启 allow_attribute_reroll 时允许混入 reroll_nonce）
    var effective_seed: int = _compute_effective_seed(creation_request, character_name, seed_value, ui_controls)
    var rng := DeterministicRNG.from_seed(effective_seed)

    # 2. 身世抽取与受控自选验签（未开启自选或所选 ID 非法时强制忽略 extra_custom_fields 按权重随机抽取）
    var origin_id: String = _resolve_origin_with_mod(rng, creation_request, manifest, ui_controls)
    if origin_id.is_empty():
        return {
            "success": false,
            "error_code": "ERR_NO_BASE_CONTENT_MOD",
            "message": "Active content MOD declares no valid origins_pool entries."
        }
    var origin_config: Dictionary = _resolve_origin_config(origin_id, manifest)
    var race_id: String = _resolve_race_with_mod(origin_id, origin_config, manifest)
    var gender: String = _pick_gender(rng, manifest)
    var birth_region_id: String = _resolve_birth_region_with_mod(origin_id, origin_config, manifest)

    # 3. 基础文案与元数据查询
    var origin_name: String = str(origin_config.get("name", origin_id))
    var origin_description: String = str(origin_config.get("desc", ""))
    var race_name: String = _resolve_race_display_name(race_id, manifest)

    # 4. 权威六维属性解算（点数加权 + 身世加成 + [1, 6] 刚性约束）
    var attributes: Dictionary = _resolve_attributes(rng, origin_config, manifest)

    # 5. 权威因果平衡天赋对选定（支持受控自选验签或加权抽取）
    var traits_result: Dictionary = _resolve_traits_with_mod(rng, creation_request, manifest, ui_controls)

    # 6. 生理概况、钱包与套件/序章路由元数据衍生
    var creation_rules: Dictionary = manifest.get("creation_rules", {})
    var rules_defaults: Dictionary = creation_rules.get("defaults", {})
    var default_gold: int = int(rules_defaults.get("initial_gold_fallback", GameConfig.get_int("domains.character_creation", "defaults/initial_gold_fallback", 0)))
    var initial_gold: int = int(origin_config.get("initial_gold", default_gold))
    var initial_reputation: int = int(origin_config.get("initial_reputation", 0))
    var wallet: Dictionary = {
        "gold": initial_gold,
        "reputation": initial_reputation
    }
    var physiology: Dictionary = _derive_physiology(attributes)
    var starter_kit_id: String = _resolve_origin_starter_kit_id(origin_id, origin_config, manifest)
    var prologue_dag_id: String = _resolve_origin_prologue_dag_id(origin_id, origin_config, manifest)

    return {
        "success": true,
        "seed_used": effective_seed,
        "account_id": creation_request.account_id,
        "slot_id": creation_request.slot_id,
        "world_id": creation_request.world_id,
        "character_name": character_name,
        "origin_id": origin_id,
        "origin_name": origin_name,
        "origin_desc": origin_description,
        "race_id": race_id,
        "race_name": race_name,
        "gender": gender,
        "birth_region_id": birth_region_id,
        "attributes": attributes,
        "selected_traits": traits_result.get("traits", []),
        "traits_details": traits_result.get("traits_details", []),
        "wallet": wallet,
        "initial_gold": initial_gold,
        "physiology": physiology,
        "base_factions": origin_config.get("base_factions", {}),
        "starter_kit_id": starter_kit_id,
        "prologue_dag_id": prologue_dag_id
    }

# ==============================================================================
# 二、种子派生与身世/种族/区域受控解算 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _compute_effective_seed(
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    character_name: String,
    seed_value: int,
    ui_controls: Dictionary
) -> int:
    var effective_seed: int = seed_value
    if effective_seed == 0:
        effective_seed = creation_request.request_seed
    if effective_seed == 0:
        effective_seed = int((creation_request.account_id + character_name + str(creation_request.slot_id)).hash())
    if effective_seed == 0:
        effective_seed = 1337

    if bool(ui_controls.get("allow_attribute_reroll", false)):
        var reroll_nonce: int = int(creation_request.extra_custom_fields.get("reroll_nonce", 0))
        if reroll_nonce != 0:
            effective_seed = int((str(effective_seed) + "_REROLL_" + str(reroll_nonce)).hash())
            if effective_seed == 0:
                effective_seed = 1337 + absi(reroll_nonce)

    return effective_seed

static func _resolve_origin_with_mod(
    rng: DeterministicRNG,
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    manifest: Dictionary,
    ui_controls: Dictionary
) -> String:
    var origins_catalog: Dictionary = _get_merged_origins_catalog(manifest)
    if bool(ui_controls.get("allow_manual_origin_select", false)):
        var selected_origin_id: String = str(creation_request.extra_custom_fields.get("selected_origin_id", "")).strip_edges()
        if not selected_origin_id.is_empty() and origins_catalog.has(selected_origin_id):
            return selected_origin_id

    var pool: Array = manifest.get("origins_pool", [])
    if pool.is_empty():
        pool = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/origins_pool", [])
    return _pick_origin_from_pool(rng, pool)

static func _pick_origin(rng: DeterministicRNG) -> String:
    var pool: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/origins_pool", [])
    return _pick_origin_from_pool(rng, pool)

static func _pick_origin_from_pool(rng: DeterministicRNG, pool: Array) -> String:
    var fallback: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_origin", "")
    if pool.is_empty():
        return fallback
    var picked: Variant = rng.pick_weighted(pool, "weight")
    if picked is Dictionary:
        return str((picked as Dictionary).get("origin_id", fallback))
    return fallback

static func _get_merged_origins_catalog(manifest: Dictionary) -> Dictionary:
    var catalog_variant: Variant = manifest.get("origins_catalog", manifest.get("origins", null))
    if catalog_variant is Dictionary and not (catalog_variant as Dictionary).is_empty():
        return catalog_variant as Dictionary
    return GameConfig.get_dict("domains.character_creation", "origins", {})

static func _resolve_origin_config(origin_id: String, manifest: Dictionary) -> Dictionary:
    var catalog: Dictionary = _get_merged_origins_catalog(manifest)
    if catalog.has(origin_id):
        var entry: Variant = catalog.get(origin_id)
        if entry is Dictionary:
            return entry as Dictionary
    return GameConfig.get_dict("domains.character_creation", "origins/" + origin_id, {})

static func _resolve_race_with_mod(origin_id: String, origin_config: Dictionary, manifest: Dictionary) -> String:
    var race_map: Dictionary = manifest.get("origin_race_map", {})
    if race_map.has(origin_id):
        var mapped_race: String = str(race_map.get(origin_id, "")).strip_edges()
        if not mapped_race.is_empty():
            return mapped_race
    var config_race: String = str(origin_config.get("race_id", origin_config.get("race", ""))).strip_edges()
    if not config_race.is_empty():
        return config_race
    var creation_rules: Dictionary = manifest.get("creation_rules", {})
    var fallback_race: String = str(creation_rules.get("fallback_race", "")).strip_edges()
    if not fallback_race.is_empty():
        return fallback_race
    return _resolve_race(origin_id)

static func _resolve_race(origin_id: String) -> String:
    var race_map: Dictionary = GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/origin_race_map", {})
    var fallback: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_race", "")
    return str(race_map.get(origin_id, fallback))

static func _pick_gender(rng: DeterministicRNG, manifest: Dictionary = {}) -> String:
    var creation_rules: Dictionary = manifest.get("creation_rules", {})
    var pool: Array = creation_rules.get("genders_pool", GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/genders_pool", []))
    var fallback: String = str(creation_rules.get("fallback_gender", GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_gender", "OTHER")))
    if pool.is_empty():
        return fallback
    var picked: Variant = rng.pick_weighted(pool, "weight")
    if picked is Dictionary:
        return str((picked as Dictionary).get("gender", fallback))
    return fallback

static func _resolve_birth_region_with_mod(origin_id: String, origin_config: Dictionary, manifest: Dictionary) -> String:
    var region_map: Dictionary = manifest.get("birth_region_map", {})
    if region_map.has(origin_id):
        var mapped_region: String = str(region_map.get(origin_id, "")).strip_edges()
        if not mapped_region.is_empty():
            return mapped_region
    var config_region: String = str(origin_config.get("birth_region_id", "")).strip_edges()
    if not config_region.is_empty():
        return config_region
    var creation_rules: Dictionary = manifest.get("creation_rules", {})
    var fallback_region: String = str(creation_rules.get("fallback_region", "")).strip_edges()
    if not fallback_region.is_empty():
        return fallback_region
    return _resolve_birth_region(origin_id)

static func _resolve_birth_region(origin_id: String) -> String:
    var region_map: Dictionary = GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/birth_region_map", {})
    var fallback: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_region", "")
    return str(region_map.get(origin_id, fallback))

static func _resolve_origin_starter_kit_id(origin_id: String, origin_config: Dictionary, manifest: Dictionary) -> String:
    var from_config: String = str(origin_config.get("starter_kit_id", "")).strip_edges()
    if not from_config.is_empty():
        return from_config
    var kit_map: Dictionary = manifest.get("origin_kit_map", {})
    return str(kit_map.get(origin_id, "")).strip_edges()

static func _resolve_origin_prologue_dag_id(origin_id: String, origin_config: Dictionary, manifest: Dictionary) -> String:
    var from_config: String = str(origin_config.get("prologue_dag_id", "")).strip_edges()
    if not from_config.is_empty():
        return from_config
    var dag_map: Dictionary = manifest.get("origin_dag_map", {})
    return str(dag_map.get(origin_id, "")).strip_edges()

static func _resolve_race_display_name(race_id: String, manifest: Dictionary = {}) -> String:
    var races_catalog: Dictionary = manifest.get("races_catalog", {})
    var race_config: Dictionary = races_catalog.get(race_id, {})
    if race_config.is_empty():
        race_config = GameConfig.get_dict("domains.character_creation", "races_catalog/" + race_id, {})
    var direct_name: String = str(race_config.get("name", race_config.get("display_name", ""))).strip_edges()
    if not direct_name.is_empty():
        return direct_name
    var name_key: String = str(race_config.get("canonical_name_key", "")).strip_edges()
    if not name_key.is_empty():
        var custom_i18n: Dictionary = manifest.get("custom_i18n", {})
        if custom_i18n.has(name_key):
            return str(custom_i18n[name_key])
        var localized_name: String = LocalizationSolver.resolve_name_key(LocalizationRegistryCatalog.get_shared(), name_key)
        if not localized_name.is_empty() and localized_name != "[%s]" % name_key:
            return localized_name
    return race_id

# ==============================================================================
# 三、六维属性与因果天赋解算 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _resolve_attributes(rng: DeterministicRNG, origin_config: Dictionary, manifest: Dictionary = {}) -> Dictionary:
    var creation_rules: Dictionary = manifest.get("creation_rules", {})
    var rule_attributes: Variant = creation_rules.get("attribute_generation", null)
    var attribute_config: Dictionary = rule_attributes if rule_attributes is Dictionary else GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/attribute_generation", {})
    var keys: Array = attribute_config.get("keys", AttributeConversionEngine.DEFAULT_STAT_LIST)
    var min_value: int = int(attribute_config.get("min_val", 1))
    var max_value: int = int(attribute_config.get("max_val", 6))
    var baseline: int = int(attribute_config.get("baseline", 3))
    var total_points: int = int(attribute_config.get("total_points", 21))

    var attributes: Dictionary = {}
    for stat_key in keys:
        attributes[str(stat_key)] = baseline

    var remaining: int = total_points - (keys.size() * baseline)
    var available_keys: Array = keys.duplicate()
    while remaining > 0 and not available_keys.is_empty():
        var pick_index: int = rng.randi_range(0, available_keys.size() - 1)
        var picked_key: String = str(available_keys[pick_index])
        var current_value: int = int(attributes[picked_key])
        if current_value < max_value:
            attributes[picked_key] = current_value + 1
            remaining -= 1
        else:
            available_keys.remove_at(pick_index)

    var bonus: Dictionary = origin_config.get("attribute_bonus", {})
    for bonus_key in bonus:
        var bonus_key_text: String = str(bonus_key)
        if attributes.has(bonus_key_text):
            attributes[bonus_key_text] = int(attributes[bonus_key_text]) + int(bonus[bonus_key])

    for stat_key in keys:
        var stat_key_text: String = str(stat_key)
        attributes[stat_key_text] = clampi(int(attributes[stat_key_text]), min_value, max_value)

    return attributes

static func _resolve_traits_with_mod(
    rng: DeterministicRNG,
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    manifest: Dictionary,
    ui_controls: Dictionary
) -> Dictionary:
    var pairs: Array = manifest.get("paired_presets", [])
    if pairs.is_empty():
        pairs = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/traits_allocation/paired_presets", [])

    var all_traits_config: Dictionary = manifest.get("traits", manifest.get("traits_catalog", {}))
    if all_traits_config.is_empty():
        all_traits_config = GameConfig.get_dict("domains.character_creation", "traits", {})

    var fallback_positive: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/traits_allocation/fallback_positive", "")
    var fallback_negative: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/traits_allocation/fallback_negative", "")

    var matched_pair: Dictionary = {}
    if bool(ui_controls.get("allow_manual_trait_select", false)):
        matched_pair = _match_manual_trait_pair(creation_request.extra_custom_fields, pairs)

    var positive_trait: String = fallback_positive
    var negative_trait: String = fallback_negative
    if not matched_pair.is_empty():
        positive_trait = str(matched_pair.get("positive", fallback_positive))
        negative_trait = str(matched_pair.get("negative", fallback_negative))
    elif not pairs.is_empty():
        var picked: Variant = rng.pick_weighted(pairs, "weight")
        if picked is Dictionary:
            positive_trait = str((picked as Dictionary).get("positive", fallback_positive))
            negative_trait = str((picked as Dictionary).get("negative", fallback_negative))

    return _build_traits_result(positive_trait, negative_trait, all_traits_config)

static func _match_manual_trait_pair(extra_fields: Dictionary, pairs: Array) -> Dictionary:
    if extra_fields.has("selected_trait_pair_index"):
        var pair_index: int = int(extra_fields.get("selected_trait_pair_index", -1))
        if pair_index >= 0 and pair_index < pairs.size() and pairs[pair_index] is Dictionary:
            return pairs[pair_index] as Dictionary

    var selected_positive: String = str(extra_fields.get("selected_positive_trait", "")).strip_edges()
    if selected_positive.is_empty():
        return {}
    var selected_negative: String = str(extra_fields.get("selected_negative_trait", "")).strip_edges()

    for entry in pairs:
        if _is_matching_preset_entry(entry, selected_positive, selected_negative):
            return entry as Dictionary
    return {}

static func _is_matching_preset_entry(entry: Variant, selected_positive: String, selected_negative: String) -> bool:
    if not (entry is Dictionary):
        return false
    var entry_map: Dictionary = entry
    if str(entry_map.get("positive", "")) != selected_positive:
        return false
    if not selected_negative.is_empty() and str(entry_map.get("negative", "")) != selected_negative:
        return false
    return true

static func _build_traits_result(
    positive_trait: String,
    negative_trait: String,
    all_traits_config: Dictionary
) -> Dictionary:
    var positive_detail: Dictionary = all_traits_config.get(positive_trait, {})
    var negative_detail: Dictionary = all_traits_config.get(negative_trait, {})

    return {
        "traits": [positive_trait, negative_trait],
        "traits_details": [
            {
                "trait_id": positive_trait,
                "name": str(positive_detail.get("name", positive_trait)),
                "type": "POSITIVE",
                "cost": int(positive_detail.get("cost", 3)),
                "desc": str(positive_detail.get("desc", ""))
            },
            {
                "trait_id": negative_trait,
                "name": str(negative_detail.get("name", negative_trait)),
                "type": "NEGATIVE",
                "cost": int(negative_detail.get("cost", -3)),
                "desc": str(negative_detail.get("desc", ""))
            }
        ]
    }

# ==============================================================================
# 四、生理机能概况推导
# ==============================================================================

static func _derive_physiology(attributes: Dictionary) -> Dictionary:
    var constitution_stat: int = int(attributes.get("CON", 3))
    var intelligence_stat: int = int(attributes.get("INT", 3))
    var vitality_stat: int = int(attributes.get("VIT", 3))
    var strength_stat: int = int(attributes.get("STR", 3))

    return {
        "max_hp": constitution_stat * 20,
        "current_hp": constitution_stat * 20,
        "max_mana": intelligence_stat * 15,
        "current_mana": intelligence_stat * 15,
        "max_stamina": vitality_stat * 10,
        "current_stamina": vitality_stat * 10,
        "carry_capacity_kg": 50.0 + (strength_stat * 5.0)
    }
