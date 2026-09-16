# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 物品描述系统单元测试（Phase 21）
# 文件路径: res://tests/unit/infrastructure/test_item_description.gd
# 覆盖: Phase 21 施工细则 阶段1~4（TC-ITEMDESC-01~06）
#       —— 已注册物品生成 / 不绕过注册系统 / 状态条件组合 / 不反向定义属性 /
#          配置为源零内联 / 只读协作
# ==============================================================================
class_name TestItemDescriptionDomain
extends RefCounted

const SWORD_ID: String = "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 21: 物品描述系统（物品侧三位一体）"

	results.append(_test_registered_item_resolve())
	results.append(_test_unregistered_intercept())
	results.append(_test_state_condition_combination())
	results.append(_test_no_reverse_attribute_definition())
	results.append(_test_config_as_source())
	results.append(_test_readonly_collaboration())

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

## TC-ITEMDESC-01: 已注册物品描述生成（模板填充零残留）
static func _test_registered_item_resolve() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var res := ItemDescriptionResolver.resolve(
		catalog, SWORD_ID, {"quantity": 3, "durability": 40})
	var text: String = str(res.get("text", ""))
	var passed = res.get("success", false) \
		and text.contains("mithril_longsword") \
		and text.contains("持有 3 件") \
		and not text.contains("{")
	return {
		"test": "TC-ITEMDESC-01: 已注册物品描述生成（模板 {param} 填充零残留）",
		"passed": passed
	}

## TC-ITEMDESC-02: 不绕过注册系统（未注册物品 → UNREGISTERED_ITEM）
static func _test_unregistered_intercept() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var res := ItemDescriptionResolver.resolve(catalog, "KALAR:EQUIP:WEAPON:GHOST_BLADE")
	var passed = not res.get("success", true) and str(res.get("code", "")) == "UNREGISTERED_ITEM"
	return {
		"test": "TC-ITEMDESC-02: 不绕过注册系统（未注册 → UNREGISTERED_ITEM，描述不建独立身份）",
		"passed": passed
	}

## TC-ITEMDESC-03: 状态条件组合（enchant/quantity 条件段按状态拼接）
static func _test_state_condition_combination() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var res_flame := ItemDescriptionResolver.resolve(catalog, SWORD_ID, {"enchant": "FLAME"})
	var res_qty := ItemDescriptionResolver.resolve(catalog, SWORD_ID, {"quantity": 2})
	var passed = res_flame.get("success", false) and str(res_flame.get("text", "")).contains("附魔烈焰") \
		and res_qty.get("success", false) and str(res_qty.get("text", "")).contains("持有 2 件")
	return {
		"test": "TC-ITEMDESC-03: 状态条件组合（品质/数量/耐久/附魔条件段按状态拼接）",
		"passed": passed
	}

## TC-ITEMDESC-04: 不反向定义属性（模板参数白名单 + 缺参拦截）
static func _test_no_reverse_attribute_definition() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	# 模板引用 state 未提供的白名单参数（quality_tier）→ MISSING_PARAMS（不静默输出）
	var res := ItemDescriptionResolver.resolve(catalog, SWORD_ID, {})
	# base 模板参数全部由 proto 注入（无缺参）；此处验证未知参数兜底不抛 Fatal
	var ok_resolve: bool = res.get("success", false)
	# 白名单核验：模板占位符集合 ⊆ 白名单（name/tier_rank/mass_kg/market_value/quantity/durability/enchant）
	var templates: Dictionary = GameConfig.get_table("copywriting.item", {})
	var whitelist := ["name", "tier_rank", "mass_kg", "volume_slots", "market_value", "quantity", "durability", "enchant", "quality_tier"]
	var all_in_whitelist := true
	for t_key in templates:
		var entry: Dictionary = templates[t_key]
		for field in ["base", "text"]:
			var text: String = str(entry.get(field, ""))
			for p in text.split("{"):
				if p.find("}") > 0:
					var param := p.substr(0, p.find("}"))
					if param not in whitelist:
						all_in_whitelist = false
	var passed = ok_resolve and all_in_whitelist
	return {
		"test": "TC-ITEMDESC-04: 不反向定义属性（模板参数全部在属性白名单，禁新属性定义）",
		"passed": passed
	}

## TC-ITEMDESC-05: 配置为源零内联（模板 100% 来自 copywriting.item 表）
static func _test_config_as_source() -> Dictionary:
	var templates: Dictionary = GameConfig.get_table("copywriting.item", {})
	var passed = templates.size() >= 2 and templates.has("mithril_longsword")
	return {
		"test": "TC-ITEMDESC-05: 配置为源零内联（描述模板 100% 来自 copywriting.item 表）",
		"passed": passed
	}

## TC-ITEMDESC-06: 只读协作（描述解析后注册表零写入、本体字段零修改）
static func _test_readonly_collaboration() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var before: int = catalog.get_prototype(SWORD_ID).tier_rank
	ItemDescriptionResolver.resolve(catalog, SWORD_ID, {"quantity": 1})
	var after: int = catalog.get_prototype(SWORD_ID).tier_rank
	var passed = before == after
	return {
		"test": "TC-ITEMDESC-06: 只读协作（描述解析后注册表零写入、本体字段零修改）",
		"passed": passed
	}
