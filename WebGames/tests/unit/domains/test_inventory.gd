# ==============================================================================
# 单元测试：领域 1 物品系统与多职业兼备 (Inventory Domain Tests)
# 文件路径: res://tests/unit/domains/test_inventory.gd
# ==============================================================================
class_name TestInventoryDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_bare_storage_capacity())
	results.append(test_equipped_armor_storage_expansion())
	results.append(test_experience_rank_logarithmic())
	results.append(test_memory_decay_curve())
	results.append(test_multi_profession_clustering())
	results.append(test_deep_snapshot_rollback())
	# Phase 43 N3 配套新增：unequip_item_ref 聚合辅助（处置销毁已穿戴物品的清槽联动）
	results.append(test_unequip_item_ref_helper())
	# F-1（TC-INV-11）：restore 深载荷唯一入口
	results.append(test_restore_deep_payload_only())
	# Phase 46: 物品属性双 UID 联动与隐藏特殊词缀体系
	var affix_res := TestItemAttributeAffixSystemPipeline.run_all_tests()
	results.append_array(affix_res.get("results", []))

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 01: 物品系统与多职业兼备", "all_passed": all_passed, "results": results }

static func test_bare_storage_capacity() -> Dictionary:
	var inv := WearableInventoryAggregate.new()
	var cap = inv.calculate_total_capacity()
	var passed = (cap == 0)
	return { "test": "TC-INV-01: 裸身容量严格为0", "passed": passed, "expected": 0, "actual": cap }

static func test_equipped_armor_storage_expansion() -> Dictionary:
	var inv := WearableInventoryAggregate.new()
	var chest_armor := ItemEntity.new()
	chest_armor.category = "ARMOR_EQUIPMENT"
	chest_armor.volume_slots = 6
	inv.equip_item("CHEST", chest_armor)
	var cap = inv.calculate_total_capacity()
	var passed = (cap == 6)
	return { "test": "TC-INV-02: 穿戴胸甲扩充储物格", "passed": passed, "expected": 6, "actual": cap }

static func test_experience_rank_logarithmic() -> Dictionary:
	var r1 = ExperienceCalculator.evaluate_experience_rank(100.0, 20.0, 10.0, 50.0)
	var r2 = ExperienceCalculator.evaluate_experience_rank(10000.0, 20.0, 10.0, 50.0)
	var passed = (r1 > 0) and (r2 > r1)
	return { "test": "TC-INV-03: 经历综合阶位对数收敛与单调性", "passed": passed, "r1": r1, "r2": r2 }

static func test_memory_decay_curve() -> Dictionary:
	var m0 := 100.0
	var m30 = ExperienceCalculator.calculate_memory_decay(m0, 30.0, 10.0)
	var m60 = ExperienceCalculator.calculate_memory_decay(m0, 60.0, 10.0)
	var passed = (m30 < m0) and (m60 < m30) and (m60 > 0.0)
	return { "test": "TC-INV-04: 遗忘曲线半衰期衰减与渐近性", "passed": passed, "m30": m30, "m60": m60 }

static func test_multi_profession_clustering() -> Dictionary:
	var ast1 := SkillSubgraphAST.new()
	for i in range(12):
		ast1.nodes["node_phys_" + str(i)] = { "symbol": "SLASH", "node_type": "PHYSICAL_VERB" }
	for i in range(12):
		ast1.nodes["node_magic_" + str(i)] = { "symbol": "FLAME", "node_type": "MAGIC_RUNE" }

	var professions = MultiProfessionEngine.evaluate_active_professions([ast1])
	var has_sword_master := false
	var has_archmage := false
	var has_spellblade := false
	for p in professions:
		if p.profession_id == "SWORD_MASTER": has_sword_master = true
		if p.profession_id == "ARCHMAGE": has_archmage = true
		if p.profession_id == "SPELLBLADE": has_spellblade = true

	var passed = has_sword_master and has_archmage and has_spellblade
	return { "test": "TC-INV-05: 魔武双修动态聚类极效魔剑士", "passed": passed, "count": professions.size() }

static func test_deep_snapshot_rollback() -> Dictionary:
	# P39 清单2：snapshot/restore 为 item 级深拷贝（serialize/deserialize 重建）。
	# 深快照后对运行实例的深层字段就地变更（词缀/耐久/锁定），restore 须完整恢复。
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 1
	inv.owner_account_id = "ACCT_SNAP_01"
	var blade := ItemEntity.new()
	blade.item_id = "BLADE_SNAPSHOT"
	blade.custom_name = "快照之刃"
	blade.affix_sockets["dynamic_affixes"] = [{ "bonus_str": 5.0 }]
	blade.durability_current = 80.0
	blade.combat_metrics["enhance_level"] = 3
	inv.add_item(blade)

	var snap := inv.snapshot()
	# 对运行实例就地深层变更（模拟提交中途失败前的污染）
	blade.affix_sockets["dynamic_affixes"].clear()
	blade.affix_sockets["dynamic_affixes"].append({ "bonus_str": 999.0 })
	blade.durability_current = 1.0
	blade.combat_metrics["enhance_level"] = 0
	inv.restore(snap)

	var restored: ItemEntity = inv.storage_items[0] if inv.storage_items.size() > 0 else null
	var passed = restored != null \
		and restored is ItemEntity \
		and restored.affix_sockets["dynamic_affixes"].size() == 1 \
		and int(restored.affix_sockets["dynamic_affixes"][0].get("bonus_str", -1)) == 5 \
		and restored.durability_current == 80.0 \
		and int(restored.combat_metrics.get("enhance_level", -1)) == 3 \
		and inv.storage_items.size() == 1
	return {
		"test": "TC-INV-06: 深快照 item 级序列化往返回滚（词缀/耐久/强化全恢复）",
		"passed": passed
	}

## Phase 43 N3 配套（TC-P43-S4-xx）：EquipmentLoadoutAggregate.unequip_item_ref ——
## 按实例引用反查槽位并卸下（处置销毁已穿戴物品时双侧清槽联动），返回槽位名；
## 未持有该实例返回空串；container_state 复位 UNOWNED。
static func test_unequip_item_ref_helper() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var helm := ItemEntity.new()
	helm.item_id = "HELM_REF"
	helm.custom_name = "反查头盔"
	var blade := ItemEntity.new()
	blade.item_id = "BLADE_REF"
	blade.custom_name = "反查佩剑"
	loadout.equip("HEAD", helm)
	loadout.equip("MAIN_HAND", blade)

	var slot_hit := loadout.unequip_item_ref(helm)
	var miss := loadout.unequip_item_ref(ItemEntity.new())
	var second := loadout.unequip_item_ref(blade)

	var passed = slot_hit == "HEAD" \
		and loadout.get_equipped_item("HEAD") == null \
		and helm.container_state == "UNOWNED" \
		and miss == "" \
		and second == "MAIN_HAND" \
		and loadout.get_equipped_item("MAIN_HAND") == null
	return {
		"test": "TC-P43-N3A: unequip_item_ref 反查卸下（命中槽位/清槽/未命中空串）",
		"passed": passed
	}

## Phase 85 F-1（TC-P85-S4-01）：restore 深载荷唯一入口——仅接受 snapshot() 深载荷；
## 无 storage_payloads 输入 → 空容器恢复（旧引用路径已退役，畸形快照不静默吞掉）。
static func test_restore_deep_payload_only() -> Dictionary:
	var inv := WearableInventoryAggregate.new()
	var helm := ItemEntity.new()
	helm.item_id = "DEEP_SNAP_HELM"
	helm.custom_name = "深快照头盔"
	inv.equip_item("HEAD", helm)
	var snap := inv.snapshot()

	var inv2 := WearableInventoryAggregate.new()
	inv2.restore(snap)
	var restored = inv2.equipped_slots.get("HEAD")
	var deep_ok: bool = restored != null 		and restored is ItemEntity 		and restored != helm 		and restored.item_id == "DEEP_SNAP_HELM" 		and restored.item_uid == helm.item_uid

	var inv3 := WearableInventoryAggregate.new()
	inv3.equip_item("HEAD", ItemEntity.new())
	inv3.restore({"owner_account_id": "X"})
	var missing_ok: bool = inv3.storage_items.is_empty() and inv3.equipped_slots.get("HEAD") == null

	var passed := deep_ok and missing_ok
	return {
		"test": "TC-INV-11: restore 深载荷唯一入口（重建一致/缺载荷空容器）",
		"passed": passed
	}
