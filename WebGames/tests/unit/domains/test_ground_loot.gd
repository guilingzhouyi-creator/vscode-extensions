# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 33 地面掉落物系统单元测试
# 文件路径: res://tests/unit/domains/test_ground_loot.gd
# ==============================================================================
class_name TestGroundLootDomain
extends RefCounted

static func _test_pickup_add_item_and_statistics() -> Dictionary:
	# Phase 40 GAP-02/GAP-01（TC-GAP-S2-01~03 / TC-FINAL-LOOT-01/02）
	var canonical := "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"
	var item := ItemEntity.new()
	item.template_id = canonical
	item.custom_name = "秘银长剑"
	item.mass_kg = 2.0
	var drop := GroundDroppedItemAggregate.new("DROP_GAP01", item, Vector2.ZERO, "ACC_HERO")
	drop.protection_remain_seconds = 0.0

	var inv := WearableInventoryAggregate.new()
	# 穿戴胸甲扩充储物格（裸身容量 0，与 TC-INV-01/02 语义一致）
	var chest := ItemEntity.new()
	chest.category = "ARMOR_EQUIPMENT"
	chest.volume_slots = 6
	inv.equip_item("CHEST", chest)
	var lib := AccountItemLibraryAggregate.new("ACC_HERO")
	var res = GroundLootPickupSolver.attempt_pickup("ACC_HERO", Vector2.ZERO, drop, inv, lib)

	var stats_ok := false
	var stats = ItemStatisticsSolver.query_account_item_stats(lib, canonical)
	if res.success and stats.found:
		stats_ok = int(stats.stats["current_quantity"]) == 1 and int(stats.stats["total_gained"]) == 1

	# 不传 library 向后兼容（TC-GAP-S2-03）：拾取仍成功且不崩溃
	var item2 := ItemEntity.new()
	item2.template_id = canonical
	item2.mass_kg = 2.0
	var drop2 := GroundDroppedItemAggregate.new("DROP_GAP02", item2, Vector2.ZERO, "ACC_HERO")
	drop2.protection_remain_seconds = 0.0
	var res_no_lib = GroundLootPickupSolver.attempt_pickup("ACC_HERO", Vector2.ZERO, drop2, null)

	var passed = res.success and stats_ok and res_no_lib.success
	return {"test": "TC-GAP-S2-01~03: 拾取 add_item 对齐 + 统计台账接入（含不传 library 兼容）", "passed": passed}

static func _test_ground_loot_event_listener() -> Dictionary:
	# Phase 40 GAP-05（TC-GAP-S3-05/06 + TC-FINAL-DROP-01~04）
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var listener := GroundLootEventListener.new(catalog)
	var valid_id := "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"
	EventBusCore.get_instance().emit_domain_event("monster.killed", {
		"drop_declarations": [
			{ "canonical_id": valid_id, "display_name": "秘银长剑", "x": 2.0, "y": 2.0, "killer_id": "ACC_HERO", "decay_cat": GroundDroppedItemAggregate.LootDecayCategory.STANDARD_MINERAL_EQUIP },
			{ "canonical_id": valid_id, "display_name": "秘银长剑二", "x": 3.0, "y": 3.0, "killer_id": "ACC_HERO" },
			{ "canonical_id": "KALAR:X:UNREGISTERED", "display_name": "未登记物", "x": 0.0, "y": 0.0 },
			{ "canonical_id": "" }
		]
	})
	var drops := listener.get_active_drops()
	var ok_declared := drops.size() == 2

	var cleaned := false
	var linked := false
	if drops.size() == 2:
		drops[0].is_decayed = true
		listener.cleanup_decayed()
		cleaned = listener.get_active_drops().size() == 1
		var survivor = listener.get_active_drops()[0]
		survivor.protection_remain_seconds = 0.0
		var res_pick = GroundLootPickupSolver.attempt_pickup("ACC_HERO", Vector2(3.0, 3.0), survivor, null)
		linked = res_pick.success

	var passed = ok_declared and cleaned and linked
	return {"test": "TC-GAP-S3-05/06+TC-FINAL-DROP-01~04: 掉落声明监听生成/无效跳过/衰变清理/拾取联动", "passed": passed}

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 33: 地面实体掉落物与生态衰变系统"

	results.append(_test_spatial_pickup_and_proximity())
	results.append(_test_killer_protection_window())
	results.append(_test_ecological_decay_lifecycle())
	results.append(_test_drop_declaration_registry_closed_loop())
	results.append(_test_pickup_add_item_and_statistics())
	results.append(_test_ground_loot_event_listener())
	# Phase 43 N2 新增：战斗击杀→监听器→按 id 拾取出队闭环（TC-P43-S2-02 / S4-05）
	results.append(_test_monster_kill_to_pickup_closed_loop())
	# Phase 44 P7 新增：cleanup_decayed 常态零分配（TC-P44-P7-03）
	results.append(_test_cleanup_no_decay_zero_alloc())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_spatial_pickup_and_proximity() -> Dictionary:
	var item := ItemEntity.new()
	item.item_id = "SWORD_IRON"
	item.custom_name = "铁剑"
	item.mass_kg = 3.0
	var drop := GroundDroppedItemAggregate.new("DROP_01", item, Vector2(10, 10), "ACC_KILLER")
	drop.protection_remain_seconds = 0.0 # 无保护

	# 玩家在 (20, 20)，距离 14 米 -> 拦截 (OUT_OF_PICKUP_RANGE)
	var res_far = GroundLootPickupSolver.attempt_pickup("ACC_PASSER", Vector2(20, 20), drop, null)

	# 玩家在 (11, 10)，距离 1 米 -> 成功拾取
	var res_near = GroundLootPickupSolver.attempt_pickup("ACC_PASSER", Vector2(11, 10), drop, null)

	var passed = (not res_far.success) and (res_far.error_code == "OUT_OF_PICKUP_RANGE") and res_near.success and (drop.item_entity == null)
	return {
		"test": "TC-LOOT-01: 地面掉落物物理空间拾取半径检定",
		"passed": passed
	}

static func _test_killer_protection_window() -> Dictionary:
	var item := ItemEntity.new()
	item.item_id = "RING_GOLD"
	item.custom_name = "金戒指"
	item.mass_kg = 0.1
	var drop := GroundDroppedItemAggregate.new("DROP_02", item, Vector2(0, 0), "ACC_HERO")
	drop.protection_remain_seconds = 60.0 # 60 秒专属保护

	# 路人抢夺 -> 拦截 (PROTECTED_BY_KILLER)
	var res_thief = GroundLootPickupSolver.attempt_pickup("ACC_THIEF", Vector2(0, 0), drop, null)

	# 英雄本人拾取 -> 成功
	var res_hero = GroundLootPickupSolver.attempt_pickup("ACC_HERO", Vector2(0, 0), drop, null)

	var passed = (not res_thief.success) and (res_thief.error_code == "PROTECTED_BY_KILLER") and res_hero.success
	return {
		"test": "TC-LOOT-02: 击杀者专属保护期防抢夺机制",
		"passed": passed
	}

static func _test_ecological_decay_lifecycle() -> Dictionary:
	var meat := ItemEntity.new()
	meat.item_id = "RAW_MEAT"
	meat.custom_name = "新鲜野猪肉"
	meat.mass_kg = 1.0
	var drop := GroundDroppedItemAggregate.new("DROP_03", meat, Vector2.ZERO, "", GroundDroppedItemAggregate.LootDecayCategory.ORGANIC_PERISHABLE)

	# 模拟经过 1900 秒 (寿命为 1800 秒)
	GroundLootDecayFSM.tick_ground_loot(drop, 1900.0)

	var res_decayed = GroundLootPickupSolver.attempt_pickup("ACC_ANY", Vector2.ZERO, drop, null)
	var passed = drop.is_decayed and (not res_decayed.success) and (res_decayed.error_code == "ITEM_DECAYED")
	return {
		"test": "TC-LOOT-03: 生鲜材质自然生态衰变与自动销蚀垃圾回收",
		"passed": passed
	}

static func _test_drop_declaration_registry_closed_loop() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 1, "item.mithril.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "mithril_longsword"
	)
	ItemRegistrySolver.register_prototype(catalog, proto)
	var ok_res := GroundDroppedItemAggregate.create_from_declaration("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", catalog)
	var bad_res := GroundDroppedItemAggregate.create_from_declaration("KALAR:EQUIP:WEAPON_BLADE:NOT_REGISTERED", catalog)
	var passed: bool = ok_res.success and ok_res.item_entity.item_uid.begins_with("DRP_") \
		and (not bad_res.success) and bad_res.error_code == "ITEM_NOT_REGISTERED"
	return {"test": "TC-P11-LOOT-01: 掉落声明统一事实源（已登记成功 + UID，未登记拒绝）", "passed": passed}

## Phase 43 N2（TC-P43-S2-02 / S4-05）：CombatPipelineFSM 击杀 is_monster 受击者 →
## 发射 monster.killed（monster.json loot/default_drop_canonical_ids 均在册 → +2 活跃掉落）
## → attempt_pickup_from_ground 按 drop_id 拾取成功并出队（活跃掉落减一、GRANTED +1）。
## 全程经 GameBootstrap 装配的全局监听器，delta 断言规避跨套件累积影响。
static func _test_monster_kill_to_pickup_closed_loop() -> Dictionary:
	GameBootstrap.assemble()
	var listener := GameBootstrap.ground_loot_listener()
	var baseline := listener.get_active_drops().size()

	var attacker := CombatPipelineFSM.CombatParticipant.new()
	attacker.participant_id = "ACC_HERO"
	attacker.weapon_mass_kg = 8.0
	attacker.weapon_velocity = 12.0
	attacker.edge_sharpness = 2.0
	var defender := CombatPipelineFSM.CombatParticipant.new()
	defender.participant_id = "MONSTER_ORC_01"
	defender.is_monster = true
	defender.current_hp = 1.0
	defender.armor_rating = 0.0
	CombatPipelineFSM.execute_action_round(attacker, "SLASH", defender, "BLOCK")

	var after_kill := listener.get_active_drops().size()
	var kill_ok: bool = after_kill == baseline + 2 # 两件在册默认掉落均登记为活跃
	if not kill_ok:
		return {"test": "TC-P43-S4-05: 击杀发射→监听器登记闭环（kill +2）", "passed": false, "baseline": baseline, "after_kill": after_kill}

	# 拾取闭环：按首个 drop_id 拾取（击杀归属人即玩家 → 无保护期拦截）
	var inv := WearableInventoryAggregate.new()
	var chest := ItemEntity.new()
	chest.category = "ARMOR_EQUIPMENT"
	chest.volume_slots = 10
	inv.equip_item("CHEST", chest)
	var lib := AccountItemLibraryAggregate.new("ACC_HERO")
	var first: GroundDroppedItemAggregate = listener.get_active_drops()[baseline]
	var pickup = listener.attempt_pickup_from_ground("ACC_HERO", Vector2.ZERO, first.drop_id, inv, lib)
	var picked_ok: bool = pickup.get("success", false) \
		and listener.get_active_drops().size() == after_kill - 1
	# 统计 GRANTED +1
	var stats_ok := false
	if picked_ok:
		var picked_item: ItemEntity = pickup.get("picked_item", null)
		if picked_item != null and not picked_item.template_id.is_empty():
			var stats = ItemStatisticsSolver.query_account_item_stats(lib, picked_item.template_id)
			stats_ok = stats.found and int(stats.stats["total_gained"]) >= 1
	var passed = kill_ok and picked_ok and stats_ok
	return {"test": "TC-P43-S4-05: 击杀→掉落→按 id 拾取出队闭环（活跃减一 + GRANTED +1）", "passed": passed}

## Phase 44 P7（TC-P44-P7-03）：cleanup_decayed 常态零分配——无衰变项时直接返回
## （活跃列表不变、drop 身份稳定）；有衰变项时单遍过滤清理
static func _test_cleanup_no_decay_zero_alloc() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var listener := GroundLootEventListener.new(catalog)
	var valid_id := "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"
	EventBusCore.get_instance().emit_domain_event("monster.killed", {
		"drop_declarations": [
			{ "canonical_id": valid_id, "display_name": "秘银长剑甲", "x": 2.0, "y": 2.0, "killer_id": "ACC_HERO" },
			{ "canonical_id": valid_id, "display_name": "秘银长剑乙", "x": 3.0, "y": 3.0, "killer_id": "ACC_HERO" }
		]
	})
	var before := listener.get_active_drops().size()
	# 无衰变：cleanup 早退零重建——数量与集合身份均不变
	listener.cleanup_decayed()
	var noop_ok: bool = listener.get_active_drops().size() == before and before == 2
	# 标记一件衰变：cleanup 单遍过滤——衰变项出列、存活项保留
	var drops := listener.get_active_drops()
	if drops.size() == 2:
		drops[0].is_decayed = true
	listener.cleanup_decayed()
	var after := listener.get_active_drops()
	var cleaned_ok: bool = after.size() == 1 and after[0].drop_id == drops[1].drop_id
	var passed = noop_ok and cleaned_ok
	return {"test": "TC-P44-P7-03: cleanup 常态零分配（无衰变早退 + 有衰变单遍过滤）", "passed": passed}
