# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 34 物质守恒与销毁系统单元测试
# 文件路径: res://tests/unit/domains/test_matter_disposal.gd
# ==============================================================================
class_name TestMatterDisposalDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 34: 物质守恒与熔炉焚化处置系统"

	results.append(_test_no_facility_deletion_prohibition())
	results.append(_test_furnace_disposal_and_residue_generation())
	results.append(_test_valuable_item_security_lock())
	results.append(_test_locked_container_state_rejection())
	# Phase 43 N3 新增：多产量逐件守恒（TC-P43-S1-03 / S4-04）
	results.append(_test_multi_yield_mass_conservation())
	# Phase 51 M5 新增：穿戴销毁失败对称回滚
	results.append(_test_equipped_destroy_rollback_symmetry())
	# Phase 64 P1 修复回归：装备销毁后增量负重缓存必须与地面真值一致（防旁路直写失配）
	results.append(_test_equipped_destroy_weight_cache_consistency())

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

static func _test_no_facility_deletion_prohibition() -> Dictionary:
	var item := ItemEntity.new()
	item.item_id = "OLD_RAGS"
	item.custom_name = "破损布衣"

	# 无设施直接在背包中删除 -> 拦截 (NO_DISPOSAL_FACILITY)
	var res = MatterDisposalSolver.execute_disposal(Vector2.ZERO, null, item)
	var passed = (not res.success) and (res.error_code == "NO_DISPOSAL_FACILITY")
	return {
		"test": "TC-DISPOSAL-01: 严格物质守恒，严禁背包凭空原地删除物品",
		"passed": passed
	}

static func _test_furnace_disposal_and_residue_generation() -> Dictionary:
	var chest := ItemEntity.new()
	chest.category = "ARMOR_EQUIPMENT"
	chest.volume_slots = 10
	var inv := WearableInventoryAggregate.new()
	inv.equip_item("CHEST", chest)

	var sword := ItemEntity.new()
	sword.item_id = "RUSTY_SWORD"
	sword.custom_name = "生锈铁剑"
	sword.mass_kg = 3.0
	inv.add_item(sword)

	var furnace := ItemDisposalFacilityDTO.new(ItemDisposalFacilityDTO.DisposalMethod.TOWN_HIGH_HEAT_FURNACE, Vector2(2, 2), 3.0)

	var res = DisposalPipeline.process_item_disposal(Vector2(2, 2), furnace, inv, "RUSTY_SWORD")

	# 原物品被移除，生成了炉渣与魔素尘埃
	var has_slag := false
	var has_dust := false
	for it in inv.storage_items:
		if it is ItemEntity:
			if it.item_id == "MATERIAL_SLAG_ASH": has_slag = true
			if it.item_id == "MATERIAL_MANA_DUST": has_dust = true

	var passed = res.success and has_slag and has_dust
	return {
		"test": "TC-DISPOSAL-02: 城镇熔炉物理焚化与炉渣尘埃残渣质量守恒产出",
		"passed": passed
	}

static func _test_locked_container_state_rejection() -> Dictionary:
	# P39 清单4：container_state == LOCKED 的锁定物品严禁销毁（与分解/追缴同语义）
	var locked_item := ItemEntity.new()
	locked_item.item_id = "LOCKED_RELIC"
	locked_item.custom_name = "已锁定圣遗物"
	locked_item.container_state = "LOCKED"
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 2
	inv.add_item(locked_item)
	# add_item 会把 container_state 归一为 INVENTORY；锁定语义须在入仓后显式置回
	locked_item.container_state = "LOCKED"
	var furnace := ItemDisposalFacilityDTO.new(ItemDisposalFacilityDTO.DisposalMethod.TOWN_HIGH_HEAT_FURNACE, Vector2.ZERO, 3.0)

	var res = DisposalPipeline.process_item_disposal(Vector2.ZERO, furnace, inv, "LOCKED_RELIC")

	var passed = (not res.success) and (res.error_code == "ITEM_LOCKED") \
		and (inv.storage_items.size() == 1) \
		and (inv.storage_items[0].item_id == "LOCKED_RELIC")
	return {
		"test": "TC-DISPOSAL-04: LOCKED 容器状态物品销毁拦截（清单4 锁定校验闭环）",
		"passed": passed
	}

static func _test_valuable_item_security_lock() -> Dictionary:
	var god_sword := ItemEntity.new()
	god_sword.item_id = "SWORD_PLUS_7"
	god_sword.custom_name = "誓约胜利之剑+7"
	god_sword.combat_metrics["enhance_level"] = 7 # +7 高阶强化

	var furnace := ItemDisposalFacilityDTO.new(ItemDisposalFacilityDTO.DisposalMethod.TOWN_HIGH_HEAT_FURNACE, Vector2.ZERO, 3.0)

	# 未输入密码 -> 拦截 (VALUABLE_LOCK_ACTIVE)
	var res_locked = MatterDisposalSolver.execute_disposal(Vector2.ZERO, furnace, god_sword, "")
	# 输入正确确认口令 -> 允许熔毁
	var res_unlocked = MatterDisposalSolver.execute_disposal(Vector2.ZERO, furnace, god_sword, "CONFIRM_DESTROY")

	var passed = (not res_locked.success) and (res_locked.error_code == "VALUABLE_LOCK_ACTIVE") and res_unlocked.success
	return {
		"test": "TC-DISPOSAL-03: +7 高阶贵重物品二次安全口令防误销毁锁",
		"passed": passed
	}

## Phase 43 N3（TC-P43-S1-03 / S4-04）：多产量逐件守恒——
## 产物实例数 == yield_*_count == FORGED 台账记账数（大质量输入保证 slag_count ≥ 2）。
static func _test_multi_yield_mass_conservation() -> Dictionary:
	var inv := WearableInventoryAggregate.new()
	# 穿戴护甲扩容，为多件产物提供储物空间（10kg 剑 → 16 slag + 10 dust = 26 件需 ≥26 格）
	var chest := ItemEntity.new()
	chest.category = "ARMOR_EQUIPMENT"
	chest.volume_slots = 40
	inv.equip_item("CHEST", chest)

	var sword := ItemEntity.new()
	sword.item_id = "HEAVY_GREATSWORD"
	sword.custom_name = "重型巨剑"
	sword.mass_kg = 10.0
	sword.template_id = "KALAR:EQUIP:WEAPON_BLADE:HEAVY_GREATSWORD"
	inv.add_item(sword)

	var furnace := ItemDisposalFacilityDTO.new(ItemDisposalFacilityDTO.DisposalMethod.TOWN_HIGH_HEAT_FURNACE, Vector2(2, 2), 3.0)
	var lib := AccountItemLibraryAggregate.new("ACC_CONSERVE")
	# 签名：(pos, facility, inventory, item_id, passcode="", library=null, loadout=null)
	var res = DisposalPipeline.process_item_disposal(Vector2(2, 2), furnace, inv, "HEAVY_GREATSWORD", "", lib)

	var slag_count := 0
	var dust_count := 0
	if res.get("success", false):
		for it in inv.storage_items:
			if it is ItemEntity:
				if it.item_id == "MATERIAL_SLAG_ASH":
					slag_count += 1
				elif it.item_id == "MATERIAL_MANA_DUST":
					dust_count += 1

	var forge_ok := false
	if res.get("success", false):
		var stats = ItemStatisticsSolver.query_account_item_stats(lib, "KALAR:MATERIAL:DISPOSAL:SLAG_ASH")
		forge_ok = stats.found and int(stats.stats["current_quantity"]) == slag_count

	var passed = res.get("success", false) \
		and int(res.get("yield_slag_ash_count", 0)) >= 2 \
		and slag_count == int(res.get("yield_slag_ash_count", 0)) \
		and dust_count == int(res.get("yield_mana_dust_count", 0)) \
		and forge_ok
	return {
		"test": "TC-P43-S4-04: 多件产物逐件守恒（实例数==yield 数==FORGED 记账数）",
		"passed": passed
	}

## M5（Phase 51）：穿戴物品销毁产物回流失败——回滚必须对称：
## inventory 重建式恢复后 loadout 槽按 item_uid 回挂同一实例（双簿记同源、无 DESTROYED 残留）
## 红证：修复前仅 inventory.restore()，loadout 槽位空置且与 equipped_slots 引用脱节
static func _test_equipped_destroy_rollback_symmetry() -> Dictionary:
	var inv := WearableInventoryAggregate.new() # 裸身零容量：产物必然无法回流 → 触发整体回滚
	var loadout := EquipmentLoadoutAggregate.new()
	var sword := ItemEntity.new()
	sword.item_id = "RUSTY_SWORD"
	sword.custom_name = "生锈铁剑"
	sword.mass_kg = 3.0
	sword.item_uid = "M5_EQUIPPED_SWORD_UID_001" # 直挂槽位不经 add_item：显式 uid 供快照/反查可追溯
	# 同一实例双侧挂载（inventory.equipped_slots + loadout.slots），模拟真实穿戴双簿记；
	# 域内不变量：装备态物品不驻留 storage（避免恢复重建出同 uid 双实例）
	inv.equip_item("MAIN_HAND", sword)
	loadout.equip("MAIN_HAND", sword)
	var uid_before := sword.item_uid
	var furnace := ItemDisposalFacilityDTO.new(ItemDisposalFacilityDTO.DisposalMethod.TOWN_HIGH_HEAT_FURNACE, Vector2.ZERO, 3.0)

	var res = DisposalPipeline.process_item_disposal(Vector2.ZERO, furnace, inv, "RUSTY_SWORD", "", null, loadout)

	var inv_item := inv.find_item_by_item_uid(uid_before)
	var slot_item = loadout.slots.get("MAIN_HAND", null)
	var rollback_ok = (not res.success) \
		and res.error_code == "INVENTORY_CAPACITY_INSUFFICIENT" \
		and inv_item != null \
		and slot_item != null and slot_item.item_uid == uid_before \
		and slot_item == inv_item \
		and inv.equipped_slots.get("MAIN_HAND", null) == inv_item \
		and inv_item.container_state == "EQUIPPED"
	var no_product := true
	for it in inv.storage_items:
		if it is ItemEntity and (it.item_id == "MATERIAL_SLAG_ASH" or it.item_id == "MATERIAL_MANA_DUST"):
			no_product = false
			break
	var passed = rollback_ok and no_product
	return {
		"test": "TC-DISPOSAL-05: 穿戴销毁失败对称回滚（M5：loadout 槽 uid 回挂、双簿记同源）",
		"passed": passed
	}

## Phase 64 P1 回归（红证：修复前销毁装备直写 equipped_slots[slot]=null 绕过
## unequip_item，增量负重缓存永久虚高 → 与地面真值偏离）：
## 装备销毁成功后，calculate_total_weight() 必须与 refresh_cached_metrics() 一致。
static func _test_equipped_destroy_weight_cache_consistency() -> Dictionary:
	var inv := WearableInventoryAggregate.new()
	var chest := ItemEntity.new()
	chest.category = "ARMOR_EQUIPMENT"
	chest.volume_slots = 40 # 为产物回流留足容量
	chest.mass_kg = 2.0
	inv.equip_item("CHEST", chest)

	var sword := ItemEntity.new()
	sword.item_id = "HEAVY_GREATSWORD"
	sword.mass_kg = 10.0
	sword.template_id = "KALAR:EQUIP:WEAPON_BLADE:HEAVY_GREATSWORD"
	inv.equip_item("MAIN_HAND", sword)

	var weight_with_sword := inv.calculate_total_weight() # 触发首次缓存刷新 = 12.0
	var furnace := ItemDisposalFacilityDTO.new(ItemDisposalFacilityDTO.DisposalMethod.TOWN_HIGH_HEAT_FURNACE, Vector2(2, 2), 3.0)
	var res = DisposalPipeline.process_item_disposal(Vector2(2, 2), furnace, inv, "HEAVY_GREATSWORD")

	var slot_cleared = inv.equipped_slots.get("MAIN_HAND", null) == null
	var weight_after := inv.calculate_total_weight() # 未主动刷新，验证增量扣减正确性
	inv.refresh_cached_metrics() # 地面真值：全量重算
	var ground_truth := inv.calculate_total_weight()

	var passed = res.get("success", false) \
		and slot_cleared \
		and is_equal_approx(weight_with_sword, 12.0) \
		and is_equal_approx(weight_after, ground_truth)
	return {
		"test": "TC-DISPOSAL-06: 装备销毁后增量负重缓存与地面真值一致（P1 旁路直写回归）",
		"passed": passed
	}
