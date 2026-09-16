# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第12卷: 制造与工坊系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_12_crafting_workshop.gd
# ==============================================================================
class_name TestFE12CraftingWorkshop
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 12: 制造与工坊系统（锻造强化/符文附魔/分解）"

	results.append(_test_forge_enhancement_preview())
	results.append(_test_salvage_materials_estimate())
	results.append(_test_success_rate_decay())

	var passed_cnt = 0
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

static func _test_forge_enhancement_preview() -> Dictionary:
	var view = CraftingWorkshopView.new()
	view.select_forge_item({ "item_id": "SWORD_01", "name": "双手重剑", "enhancement_level": 3 })

	var passed = (view.enhancement_target_level == 4) and is_equal_approx(view.predicted_success_rate, 0.8)
	view.free()
	return {
		"test": "TC-FE12-01: 装备强化目标阶梯预览与成功率衰减计算",
		"passed": passed
	}

static func _test_salvage_materials_estimate() -> Dictionary:
	var view = CraftingWorkshopView.new()
	view.select_salvage_item({ "item_id": "ARMOR_RUSTY" }, [
		{ "material_id": "IRON_ORE", "count": 3 },
		{ "material_id": "LEATHER_STRAP", "count": 2 }
	])

	var passed = (view.estimated_salvage_materials.size() == 2)
	view.free()
	return {
		"test": "TC-FE12-02: 装备熔铸分解产出残渣材料清单估算",
		"passed": passed
	}

static func _test_success_rate_decay() -> Dictionary:
	var view = CraftingWorkshopView.new()
	view.select_forge_item({ "enhancement_level": 12 })
	var passed = (view.predicted_success_rate <= 0.35)
	view.free()
	return {
		"test": "TC-FE12-03: 高阶强化成功率衰减保底边界防护",
		"passed": passed
	}
