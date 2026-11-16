# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第12卷: 制造与工坊系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_12_crafting_workshop.gd
# ==============================================================================
class_name TestFE12CraftingWorkshop
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 12: 制造与工坊系统（锻造强化/符文附魔/分解）"

	results.append(_test_forge_enhancement_preview())
	results.append(_test_salvage_materials_estimate())
	results.append(_test_success_rate_decay())
	results.append(_test_mounted_real_crafting_workshop())

	var passed_count := 0
	for entry in results:
		if bool(entry.get("passed", false)):
			passed_count += 1

	return {
		"domain": domain_name,
		"passed_count": passed_count,
		"total_count": results.size(),
		"all_passed": (passed_count == results.size()),
		"results": results
	}

static func _test_forge_enhancement_preview() -> Dictionary:
	var prior_mode := ServiceLocator.get_mode()
	ServiceLocator.set_mode("mock")
	var mock_view := CraftingWorkshopView.new()
	mock_view.select_forge_item({ "item_id": "SWORD_01", "name": "双手重剑", "enhancement_level": 3 })
	var mock_ok := (mock_view.enhancement_target_level == 4) and is_equal_approx(mock_view.predicted_success_rate, 0.8)
	mock_view.free()

	ServiceLocator.set_mode("real")
	var real_view := CraftingWorkshopView.new()
	real_view.select_forge_item({ "item_id": "SWORD_01", "name": "双手重剑", "enhancement_level": 3 })
	var real_ok := (real_view.enhancement_target_level == 4) and is_equal_approx(real_view.predicted_success_rate, 0.9)
	real_view.free()
	ServiceLocator.set_mode(prior_mode)

	return {
		"test": "TC-FE12-01: 装备强化目标阶梯预览与双模式成功率对齐计算",
		"passed": mock_ok and real_ok
	}

static func _test_salvage_materials_estimate() -> Dictionary:
	var view := CraftingWorkshopView.new()
	view.select_salvage_item({ "item_id": "ARMOR_RUSTY" }, [
		{ "material_id": "IRON_ORE", "count": 3 },
		{ "material_id": "LEATHER_STRAP", "count": 2 }
	])

	var passed := (view.estimated_salvage_materials.size() == 2)
	view.free()
	return {
		"test": "TC-FE12-02: 装备熔铸分解产出残渣材料清单估算",
		"passed": passed
	}

static func _test_success_rate_decay() -> Dictionary:
	var view := CraftingWorkshopView.new()
	view.select_forge_item({ "enhancement_level": 12 })
	var passed := (view.predicted_success_rate <= 0.35)
	view.free()
	return {
		"test": "TC-FE12-03: 高阶强化成功率衰减保底边界防护",
		"passed": passed
	}

static func _test_mounted_real_crafting_workshop() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/crafting_workshop/crafting_workshop_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: CraftingWorkshopView = mount_handle.get("view", null) as CraftingWorkshopView
	if mounted_view != null:
		mounted_view.select_forge_item({ "item_id": "SWORD_01", "name": "双手重剑", "enhancement_level": 3 })
		mounted_view._on_tab_changed(1)
		mounted_view._on_tab_changed(2)
		mounted_view._on_tab_changed(3)
		mounted_view._on_tab_changed(0)
		mounted_view.select_salvage_item({ "item_id": "ARMOR_RUSTY" }, [{ "material_id": "IRON_ORE", "count": 2 }])
		passed = passed and mounted_view._forge_recipe_list != null and is_equal_approx(mounted_view.predicted_success_rate, 0.9)
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE12-04: 真场景挂载 crafting_workshop_view.tscn（real 模式全页签切换零崩溃/零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}
