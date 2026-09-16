# ==============================================================================
# 单元测试：领域 7 生命体质与生命周期 (Lifecycle & Physiology Tests)
# 文件路径: res://tests/unit/domains/test_lifecycle_physiology.gd
# ==============================================================================
class_name TestLifecycleDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_physiology_sheet_initialization())
	results.append(test_lifespan_iso_equivalence())
	results.append(test_mana_backfire_risk())
	results.append(test_lifecycle_rejuvenation_fsm())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 07: 生命体质与生命周期", "all_passed": all_passed, "results": results }

static func test_physiology_sheet_initialization() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	var sf = LifeCycleAndPhysiologySolver.calculate_somatic_function(sheet)
	var passed = (sf > 0.0) and (sheet.heart_core_integrity == 1.0)
	return { "test": "TC-LIFE-01: 生理面板与三大生理指标初始化", "passed": passed, "sf": sf }

static func test_lifespan_iso_equivalence() -> Dictionary:
	var human := CharacterPhysiologySheet.new()
	human.raw_chronological_age = 50.0
	human.lifespan_scale = 1.0 # 50%

	var elf := CharacterPhysiologySheet.new()
	elf.raw_chronological_age = 250.0
	elf.lifespan_scale = 5.0 # 50%

	var sf_h = LifeCycleAndPhysiologySolver.calculate_somatic_function(human)
	var sf_e = LifeCycleAndPhysiologySolver.calculate_somatic_function(elf)
	var passed = abs(sf_h - sf_e) < 0.01
	return { "test": "TC-LIFE-02: 跨种族0-100岁ISO标准原器等效函数", "passed": passed, "sf_h": sf_h, "sf_e": sf_e }

static func test_mana_backfire_risk() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	sheet.mana_aptitude = CharacterPhysiologySheet.ManaAptitude.MANA_ADAPTOR # threshold = 1
	var safe_risk = LifeCycleAndPhysiologySolver.evaluate_mana_backfire_risk(sheet, 1)
	var high_risk = LifeCycleAndPhysiologySolver.evaluate_mana_backfire_risk(sheet, 5)
	var passed = (safe_risk == 0.0) and (high_risk > 0.5)
	return { "test": "TC-LIFE-03: 越阶施法与魔适者反噬概率断言", "passed": passed, "high_risk": high_risk }

static func test_lifecycle_rejuvenation_fsm() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	sheet.raw_chronological_age = 70.0
	var age_step = LifeCycleEvolutionFSM.age_character_years(sheet, 20.0) # age = 90
	var rejuv_sf = LifeCycleEvolutionFSM.apply_rejuvenation(sheet, 30.0) # age = 60
	var passed = age_step.near_eol and (rejuv_sf > age_step.new_sf)
	return { "test": "TC-LIFE-04: 岁月衰老演化与生机逆龄调和状态机", "passed": passed, "rejuv_sf": rejuv_sf }
