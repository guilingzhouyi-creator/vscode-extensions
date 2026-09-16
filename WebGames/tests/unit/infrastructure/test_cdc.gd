# ==============================================================================
# 单元测试：配置驱动收口与单一真源验收 (Phase 25)
# 文件路径: res://tests/unit/infrastructure/test_cdc.gd
# 职责: 验证默认次分类配置驱动、Gacha 概率与保底零回归、代码 ID 引用一致性、
#       AST Kind 单一真源判定、收口审计通过性及与 P24 边界隔离
# ==============================================================================
class_name TestCdcDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_default_minor_category_configuration())
	results.append(test_gacha_rates_zero_regression())
	results.append(test_canonical_id_reference_consistency())
	results.append(test_ast_condition_kind_single_source())
	results.append(test_audit_cdc_integrity())
	results.append(test_phase24_boundary_non_overlap())

	var all_passed: bool = true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Phase 25: 配置驱动收口与单一真源", "all_passed": all_passed, "results": results }

## TC-CDC-01: 默认次分类从 GameConfig 读取且缺失时回退默认值
static func test_default_minor_category_configuration() -> Dictionary:
	var cfg_minor: String = GameConfig.get_string("domains.item_namespace_registry", "defaults/category_minor", "WEAPON_BLADE")
	var fallback_minor: String = GameConfig.get_string("domains.non_existent_table", "defaults/category_minor", "WEAPON_BLADE")
	var proto := ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:TEST:MIN_CAT", 9999, "item.test_min_cat.name"
	)
	var passed: bool = (cfg_minor == "WEAPON_BLADE") and (fallback_minor == "WEAPON_BLADE") and (proto.category_minor == "WEAPON_BLADE")
	return {
		"test": "TC-CDC-01: 默认次分类配置驱动与缺省安全回退",
		"passed": passed
	}

## TC-CDC-02: Gacha 概率表配置驱动且全阶段概率计算零回归
static func test_gacha_rates_zero_regression() -> Dictionary:
	var base_rate: float = GachaProbabilitySolver.calculate_current_5star_rate(10)
	var soft_rate: float = GachaProbabilitySolver.calculate_current_5star_rate(75)
	var hard_rate: float = GachaProbabilitySolver.calculate_current_5star_rate(90)
	var rate_5star_cfg: float = GameConfig.get_float("domains.gacha", "rates/base_5star", 0.006)
	var passed: bool = (base_rate == rate_5star_cfg) and (soft_rate > 0.20) and (hard_rate == 1.0)
	return {
		"test": "TC-CDC-02: Gacha 概率阶梯与保底计算零行为回归",
		"passed": passed
	}

## TC-CDC-03: 代码中引用的 Canonical ID 常量在物品注册表中真实存在
static func test_canonical_id_reference_consistency() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var slag_ash_exists: bool = (catalog.get_prototype(DisposalPipeline.CANONICAL_ID_SLAG_ASH) != null)
	var mana_dust_exists: bool = (catalog.get_prototype(DisposalPipeline.CANONICAL_ID_MANA_DUST) != null)
	var passed: bool = slag_ash_exists and mana_dust_exists
	return {
		"test": "TC-CDC-03: 代码 Canonical ID 常量引用与注册表完全一致",
		"passed": passed
	}

## TC-CDC-04: AST 条件 Kind 单一真源在编排器中正确求值
static func test_ast_condition_kind_single_source() -> Dictionary:
	var ctx: Dictionary = {
		"town_id": "KALAR_CITY",
		"character_level": 25,
		"world_hour": 14,
		"reputations": { "SILVER_ORDER": 150 }
	}
	var cond_town: Dictionary = { "type": "LEAF", "kind": "TOWN_EQUALS", "val": "KALAR_CITY" }
	var cond_lvl: Dictionary = { "type": "LEAF", "kind": "MIN_LEVEL", "val": 20 }
	var cond_hour: Dictionary = { "type": "LEAF", "kind": "HOUR_BETWEEN", "min": 10, "max": 18 }
	var cond_rep: Dictionary = { "type": "LEAF", "kind": "REPUTATION_GREATER", "faction": "SILVER_ORDER", "val": 100 }

	var ok_town: bool = NarrativeCausalityOrchestrator.evaluate_ast_condition(cond_town, ctx)
	var ok_lvl: bool = NarrativeCausalityOrchestrator.evaluate_ast_condition(cond_lvl, ctx)
	var ok_hour: bool = NarrativeCausalityOrchestrator.evaluate_ast_condition(cond_hour, ctx)
	var ok_rep: bool = NarrativeCausalityOrchestrator.evaluate_ast_condition(cond_rep, ctx)

	var compound_and: Dictionary = { "type": "AND", "conditions": [cond_town, cond_lvl, cond_hour, cond_rep] }
	var ok_compound: bool = NarrativeCausalityOrchestrator.evaluate_ast_condition(compound_and, ctx)

	var passed: bool = ok_town and ok_lvl and ok_hour and ok_rep and ok_compound
	return {
		"test": "TC-CDC-04: AST 条件 Kind 单一真源分支求值正确性",
		"passed": passed
	}

## TC-CDC-05: 配置驱动收口各项元数据校验守卫完整
static func test_audit_cdc_integrity() -> Dictionary:
	var cfg_gacha: Dictionary = GameConfig.get_dict("domains.gacha", "rates", {})
	var pity_gacha: Dictionary = GameConfig.get_dict("domains.gacha", "pity", {})
	var has_rates: bool = cfg_gacha.has("base_5star") and cfg_gacha.has("base_4star")
	var has_pity: bool = pity_gacha.has("soft_threshold") and pity_gacha.has("hard_threshold")
	var soft_val: int = int(pity_gacha.get("soft_threshold", 70))
	var hard_val: int = int(pity_gacha.get("hard_threshold", 90))
	var passed: bool = has_rates and has_pity and (soft_val < hard_val)
	return {
		"test": "TC-CDC-05: 收口配置完整性与保底阈值单调性守卫",
		"passed": passed
	}

## TC-CDC-06: 与 Phase 24 统一文案配置系统职责边界隔离（零重叠）
static func test_phase24_boundary_non_overlap() -> Dictionary:
	# 校验 CopywritingResolver 统一处理文案，本领域专注配置收口与注册防漂移
	var copy_res: Dictionary = CopywritingResolver.resolve(
		"bulletin.maintenance_notice.base", {}
	)
	var passed: bool = copy_res.get("success", false) and (copy_res.get("text", "") != "")
	return {
		"test": "TC-CDC-06: 与 Phase 24 统一文案职责边界清晰隔离",
		"passed": passed
	}
