# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/authoritative_reincarnation_solver.gd
# 架构定位: Domain Logic Component / Authoritative Solver
# 跨域依赖: 上游: Gateway / WorldGateway / Orchestrator | 下游: DeterministicRNG, GameConfig | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 纯后端角色身世权威解算器；零信任清洗客户端伪造入参，依托伪随机种子与单源配置加权解算身世轮盘、种族、因果天赋对与 [1,6] 严格六维属性。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name AuthoritativeReincarnationSolver
extends RefCounted

# ==============================================================================
# 一、权威解算主入口 (Zero-Trust Resolution)
# ==============================================================================

## 根据权威角色创建请求 DTO 与种子解算身世、种族、性别、出生地、六维属性与天赋对
static func resolve_reincarnation_package(
	req: AuthoritativeCharacterCreationRequestDTO,
	seed_val: int = 0
) -> Dictionary:
	if req == null:
		return { "success": false, "error_code": "INVALID_REQUEST", "message": "请求对象不可为空" }

	var char_name: String = req.character_name.strip_edges()
	if char_name.is_empty():
		return { "success": false, "error_code": "EMPTY_NAME", "message": "角色名称不可为空" }

	# 1. 种子确定性收敛（优先显式参，次取请求种子，终以三元哈希保底）
	var effective_seed: int = seed_val
	if effective_seed == 0:
		effective_seed = req.request_seed
	if effective_seed == 0:
		effective_seed = int((req.account_id + char_name + str(req.slot_id)).hash())
	if effective_seed == 0:
		effective_seed = 1337

	var rng := DeterministicRNG.from_seed(effective_seed)

	# 2. 零信任身世轮盘抽取：强制忽略 req.extra_custom_fields 中任何伪造属性/种族
	var origin_id: String = _pick_origin(rng)
	var race_id: String = _resolve_race(origin_id)
	var gender: String = _pick_gender(rng)
	var birth_region_id: String = _resolve_birth_region(origin_id)

	# 3. 基础文案与元数据查询
	var origin_cfg: Dictionary = GameConfig.get_dict("domains.character_creation", "origins/" + origin_id, {})
	var origin_name: String = str(origin_cfg.get("name", origin_id))
	var origin_desc: String = str(origin_cfg.get("desc", ""))
	var race_name: String = _resolve_race_display_name(race_id)

	# 4. 权威六维属性解算（点数加权 + 身世加成 + [1, 6] 刚性约束）
	var attributes: Dictionary = _resolve_attributes(rng, origin_cfg)

	# 5. 权威因果平衡天赋对选定
	var traits_res: Dictionary = _resolve_traits(rng)

	# 6. 生理概况与钱包衍生
	var initial_gold: int = int(origin_cfg.get("initial_gold", GameConfig.get_int("domains.character_creation", "defaults/initial_gold_fallback", 50)))
	var initial_reputation: int = int(origin_cfg.get("initial_reputation", 0))
	var wallet: Dictionary = {
		"gold": initial_gold,
		"reputation": initial_reputation
	}
	var physiology: Dictionary = _derive_physiology(attributes)

	return {
		"success": true,
		"seed_used": effective_seed,
		"account_id": req.account_id,
		"slot_id": req.slot_id,
		"world_id": req.world_id,
		"character_name": char_name,
		"origin_id": origin_id,
		"origin_name": origin_name,
		"origin_desc": origin_desc,
		"race_id": race_id,
		"race_name": race_name,
		"gender": gender,
		"birth_region_id": birth_region_id,
		"attributes": attributes,
		"selected_traits": traits_res.get("traits", []),
		"traits_details": traits_res.get("traits_details", []),
		"wallet": wallet,
		"physiology": physiology,
		"base_factions": origin_cfg.get("base_factions", {})
	}

# ==============================================================================
# 二、身世轮盘与种族/性别/区域抽取
# ==============================================================================

static func _pick_origin(rng: DeterministicRNG) -> String:
	var pool: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/origins_pool", [])
	var fallback: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_origin", "IMPERIAL_NOBLE")
	if pool.is_empty():
		return fallback
	var picked: Variant = rng.pick_weighted(pool, "weight")
	if picked is Dictionary:
		return str(picked.get("origin_id", fallback))
	return fallback

static func _resolve_race(origin_id: String) -> String:
	var race_map: Dictionary = GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/origin_race_map", {})
	var fallback: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_race", "HUMAN")
	return str(race_map.get(origin_id, fallback))

static func _pick_gender(rng: DeterministicRNG) -> String:
	var pool: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/genders_pool", [])
	var fallback: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_gender", "MALE")
	if pool.is_empty():
		return fallback
	var picked: Variant = rng.pick_weighted(pool, "weight")
	if picked is Dictionary:
		return str(picked.get("gender", fallback))
	return fallback

static func _resolve_birth_region(origin_id: String) -> String:
	var region_map: Dictionary = GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/birth_region_map", {})
	var fallback: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/fallback_region", "CENTRAL_CONTINENT")
	return str(region_map.get(origin_id, fallback))

static func _resolve_race_display_name(race_id: String) -> String:
	var race_cfg: Dictionary = GameConfig.get_dict("domains.character_creation", "races_catalog/" + race_id, {})
	var name_key: String = str(race_cfg.get("canonical_name_key", ""))
	if not name_key.is_empty():
		var loc_name: String = GameConfig.get_string("i18n.core", name_key, "")
		if not loc_name.is_empty():
			return loc_name
	match race_id:
		"HUMAN":
			return "人类"
		"ELF", "HIGH_ELF":
			return "精灵"
		"MOUNTAIN_DWARF":
			return "矮人"
		"TIEFLING_OR_HUMAN":
			return "异界混血"
		_:
			return race_id

# ==============================================================================
# 三、六维属性与因果天赋解算
# ==============================================================================

static func _resolve_attributes(rng: DeterministicRNG, origin_cfg: Dictionary) -> Dictionary:
	var attr_cfg: Dictionary = GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/attribute_generation", {})
	var keys: Array = attr_cfg.get("keys", ["STR", "CON", "INT", "AGI", "SPR", "VIT"])
	var min_val: int = int(attr_cfg.get("min_val", 1))
	var max_val: int = int(attr_cfg.get("max_val", 6))
	var baseline: int = int(attr_cfg.get("baseline", 3))
	var total_points: int = int(attr_cfg.get("total_points", 21))

	var attrs: Dictionary = {}
	for k in keys:
		attrs[str(k)] = baseline

	var remaining: int = total_points - (keys.size() * baseline)
	var available_keys: Array = keys.duplicate()
	while remaining > 0 and not available_keys.is_empty():
		var pick_idx: int = rng.randi_range(0, available_keys.size() - 1)
		var k_picked: String = str(available_keys[pick_idx])
		var curr_val: int = int(attrs[k_picked])
		if curr_val < max_val:
			attrs[k_picked] = curr_val + 1
			remaining -= 1
		else:
			available_keys.remove_at(pick_idx)

	var bonus: Dictionary = origin_cfg.get("attribute_bonus", {})
	for bonus_k in bonus:
		var k_str: String = str(bonus_k)
		if attrs.has(k_str):
			attrs[k_str] = int(attrs[k_str]) + int(bonus[bonus_k])

	for k in keys:
		var k_str: String = str(k)
		attrs[k_str] = clampi(int(attrs[k_str]), min_val, max_val)

	return attrs

static func _resolve_traits(rng: DeterministicRNG) -> Dictionary:
	var pairs: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/traits_allocation/paired_presets", [])
	var fallback_pos: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/traits_allocation/fallback_positive", "PRIMORDIAL_RESONANCE")
	var fallback_neg: String = GameConfig.get_string("domains.character_creation", "authoritative_reincarnation/traits_allocation/fallback_negative", "HEART_CORE_FISSURE")

	var pos_trait: String = fallback_pos
	var neg_trait: String = fallback_neg
	if not pairs.is_empty():
		var picked: Variant = rng.pick_weighted(pairs, "weight")
		if picked is Dictionary:
			pos_trait = str(picked.get("positive", fallback_pos))
			neg_trait = str(picked.get("negative", fallback_neg))

	var all_traits_cfg: Dictionary = GameConfig.get_dict("domains.character_creation", "traits", {})
	var pos_detail: Dictionary = all_traits_cfg.get(pos_trait, {})
	var neg_detail: Dictionary = all_traits_cfg.get(neg_trait, {})

	return {
		"traits": [pos_trait, neg_trait],
		"traits_details": [
			{
				"trait_id": pos_trait,
				"name": str(pos_detail.get("name", pos_trait)),
				"type": "POSITIVE",
				"cost": int(pos_detail.get("cost", 3)),
				"desc": str(pos_detail.get("desc", ""))
			},
			{
				"trait_id": neg_trait,
				"name": str(neg_detail.get("name", neg_trait)),
				"type": "NEGATIVE",
				"cost": int(neg_detail.get("cost", -3)),
				"desc": str(neg_detail.get("desc", ""))
			}
		]
	}

# ==============================================================================
# 四、生理机能概况推导
# ==============================================================================

static func _derive_physiology(attributes: Dictionary) -> Dictionary:
	var con: int = int(attributes.get("CON", 3))
	var int_stat: int = int(attributes.get("INT", 3))
	var vit: int = int(attributes.get("VIT", 3))
	var str_stat: int = int(attributes.get("STR", 3))

	return {
		"max_hp": con * 20,
		"current_hp": con * 20,
		"max_mana": int_stat * 15,
		"current_mana": int_stat * 15,
		"max_stamina": vit * 10,
		"current_stamina": vit * 10,
		"carry_capacity_kg": 50.0 + (str_stat * 5.0)
	}
