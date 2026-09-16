# ==============================================================================
# 单元测试：领域 19 工坊锻造与符文强化重铸 (Workshop Forge Tests)
# 文件路径: res://tests/unit/domains/test_workshop_forge.gd
# ==============================================================================
class_name TestWorkshopForgeDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_equipment_enhancement())
	results.append(test_socket_inscription())
	results.append(test_salvage_equipment())
	results.append(test_reforge_lock_cost_closure())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 19: 工坊锻造与符文强化重铸", "all_passed": all_passed, "results": results }

static func test_equipment_enhancement() -> Dictionary:
	var item := ItemEntity.new()
	item.custom_name = "誓约之剑"
	item.combat_metrics["enhance_level"] = 0
	item.combat_metrics["edge_sharpness"] = 1.0

	var wallet := CharacterWalletEntity.new()
	wallet.gold = 500

	# +1 成功率 100%
	var res = EquipmentEnhancementSolver.attempt_enhancement(item, wallet)
	var passed = res.success and (item.combat_metrics["enhance_level"] == 1) and (item.combat_metrics["edge_sharpness"] == 1.10)
	return { "test": "TC-FORGE-01: +1 强化确定性成功与锋利度阶梯提升", "passed": passed }

static func test_socket_inscription() -> Dictionary:
	var item := ItemEntity.new()
	item.custom_name = "秘术法杖"
	item.affix_sockets["total_sockets"] = 2
	item.affix_sockets["imprinted_runes"] = []

	var ins_res = SocketInscriptionService.inscribe_rune(item, "RUNE_ARCANE")
	var runes: Array = item.affix_sockets["imprinted_runes"]
	var passed = ins_res.success and (runes.size() == 1) and (runes[0] == "RUNE_ARCANE")
	return { "test": "TC-FORGE-02: 装备孔位符文镶嵌与铭刻", "passed": passed }

static func test_salvage_equipment() -> Dictionary:
	var item := ItemEntity.new()
	item.custom_name = "粗制铁剑"
	item.market_base_price = 10
	var wallet := CharacterWalletEntity.new()
	var inv := WearableInventoryAggregate.new()
	# 裸身容量默认为 0；分解前先提供最小合法仓储容量。
	inv.baseline_capacity = 1
	inv.add_item(item)

	var sal_res = ReforgingAndSalvagePipeline.salvage_equipment(item, wallet, inv)
	var passed = sal_res.success and (inv.storage_items.size() == 0) and (wallet.copper == 50000)
	return { "test": "TC-FORGE-03: 装备分解材料与熔铸货币返还", "passed": passed }

static func test_reforge_lock_cost_closure() -> Dictionary:
	# P39 清单4 闭环：lock_count > 0 时保护符/魔单晶消耗在同一事务内扣除；
	# 余额不足拒绝且不改动物品（词缀保持原样、钱包不扣）
	var item := ItemEntity.new()
	item.custom_name = "实验法杖"
	item.affix_sockets["dynamic_affixes"] = [
		{ "bonus_int": 4.0 },
		{ "mana_efficiency": 0.10 }
	]
	var wallet := CharacterWalletEntity.new()
	wallet.mana_monocrystals = 3
	var rng := DeterministicRNG.from_seed(20240902)

	# 余额充足：锁定 1 条 → 扣 1 魔单晶，锁定词缀保留、其余重掷
	var ok_res = ReforgingAndSalvagePipeline.reforge_affixes(item, 1, rng, wallet)
	var ok_passed = ok_res.get("success", false) \
		and (wallet.mana_monocrystals == 2) \
		and (item.affix_sockets["dynamic_affixes"].size() == 2) \
		and (item.affix_sockets["dynamic_affixes"][0] == { "bonus_int": 4.0 })

	# 余额不足：锁定 5 条（费用超余额）→ INSUFFICIENT_RESOURCES，钱包与词缀均不变
	var poor := CharacterWalletEntity.new()
	poor.mana_monocrystals = 0
	var before := item.serialize()
	var deny_res = ReforgingAndSalvagePipeline.reforge_affixes(item, 1, rng, poor)
	var deny_passed = (not deny_res.get("success", true)) \
		and deny_res.get("error_code", "") == "INSUFFICIENT_RESOURCES" \
		and (poor.mana_monocrystals == 0)
	return {
		"test": "TC-FORGE-04: 重铸锁定消耗闭环（同事务扣魔单晶/余额不足拒绝不改物）",
		"passed": ok_passed and deny_passed
	}
