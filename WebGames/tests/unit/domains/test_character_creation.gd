# ==============================================================================
# 单元测试：领域 15 角色创生与种族资质分配 (Character Creation Tests)
# 文件路径: res://tests/unit/domains/test_character_creation.gd
# ==============================================================================
class_name TestCharacterCreationDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_dice_and_point_buy())
	results.append(test_trait_karma_balance())
	results.append(test_character_creation_output())
	results.append(test_attribute_conversion_engine())
	# Phase 48: 配置驱动角色创建系统升级与开局事件流接入（专属套件并入本域）
	var p48_res := TestCharacterCreationAndOpeningPipeline.run_all_tests()
	results.append_array(p48_res.get("results", []))
	# Phase 49: 文字版角色序章执行内核与占位符引擎（专属套件并入本域）
	var p49_res := TestPrologueCoreAndPlaceholderPipeline.run_all_tests()
	results.append_array(p49_res.get("results", []))

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 15: 角色创生与种族资质分配", "all_passed": all_passed, "results": results }

static func test_dice_and_point_buy() -> Dictionary:
	var roll_val = AttributeInitializationSolver.roll_4d6_drop_lowest()
	var in_range = (roll_val >= 3 and roll_val <= 18)
	# 掷骰映射统一等级（1~6）
	var mapped = AttributeInitializationSolver.map_roll_to_level(roll_val)
	var mapped_ok = mapped >= AttributeConversionEngine.min_level() and mapped <= AttributeConversionEngine.max_level()

	# 天平购点（统一等级 1~6，每级消耗 = 等级数，池 21）
	var valid_alloc := { "STR": 5, "CON": 4, "INT": 4, "AGI": 3, "SPR": 2, "VIT": 2 } # 20 点
	var res_valid = AttributeInitializationSolver.validate_point_buy_allocation(valid_alloc, 21)

	var invalid_alloc := { "STR": 7, "CON": 4, "INT": 4, "AGI": 3, "SPR": 2, "VIT": 2 } # 7 超出 [1, 6]
	var res_invalid = AttributeInitializationSolver.validate_point_buy_allocation(invalid_alloc, 21)

	var passed = in_range and mapped_ok and res_valid.valid and (not res_invalid.valid)
	return { "test": "TC-CREATE-01: 4d6 掷骰映射统一等级与 21 购点等级约束", "passed": passed }

static func test_trait_karma_balance() -> Dictionary:
	var selected := ["PRIMORDIAL_RESONANCE", "HEART_CORE_FISSURE"] # +3 -3 = 0
	var check = InnateTraitRegistry.validate_traits_selection(selected, 0)
	var passed = check.valid and (check.balance == 0)
	return { "test": "TC-CREATE-02: 先天天赋正面特质与负面缺陷因果守恒", "passed": passed }

static func test_character_creation_output() -> Dictionary:
	var res = CharacterCreationService.create_new_character(
		"艾尔登",
		"IMPERIAL_NOBLE",
		"CENTRAL_CONTINENT",
		{ "STR": 4, "CON": 3, "INT": 4, "AGI": 2, "SPR": 2, "VIT": 2 },
		["PRIMORDIAL_RESONANCE"]
	)
	var sheet: CharacterPhysiologySheet = res.physiology_sheet
	# 等级域：创角分配原样落位；INT 4 级（人类）→ 实际 = 1000 × 成长(3) × 天赋系数 1.2
	var level_ok = (sheet.get_level("INT") == 4) and (sheet.race_id == "HUMAN")
	var coef_ok = is_equal_approx(float(sheet.base_coefficients.get("INT", 0.0)), 1.2) # 始源共鸣 INT 系数修正
	var actual_ok = sheet.get_actual_value("INT") > 0.0 and sheet.get_actual_value("STR") > 0.0
	var passed = level_ok and coef_ok and actual_ok and (sheet.somatic_function > 0.0) and (res.wallet.gold == 500)
	return { "test": "TC-CREATE-03: 创角聚合生成统一六维底座与种族/天赋系数修正", "passed": passed }

static func test_attribute_conversion_engine() -> Dictionary:
	# 人类基准十进制与满级原值（6 级 × 每级基准 = 600/60/6000/600/60/6000）
	var base_ok = is_equal_approx(AttributeConversionEngine.human_base("STR"), 100.0) \
		and is_equal_approx(AttributeConversionEngine.human_base("AGI"), 10.0) \
		and is_equal_approx(AttributeConversionEngine.human_base("INT"), 1000.0) \
		and is_equal_approx(AttributeConversionEngine.human_base("SPR"), 100.0) \
		and is_equal_approx(AttributeConversionEngine.human_base("CON"), 10.0) \
		and is_equal_approx(AttributeConversionEngine.human_base("VIT"), 1000.0) \
		and (AttributeConversionEngine.max_level() == 6)

	var full := CharacterPhysiologySheet.new()
	for k in AttributeConversionEngine.DEFAULT_STAT_LIST:
		full.set_level(k, 6)
		full.set_progress(k, 1.0)
	var full_ok = is_equal_approx(full.get_actual_value("STR"), 600.0) \
		and is_equal_approx(full.get_actual_value("AGI"), 60.0) \
		and is_equal_approx(full.get_actual_value("INT"), 6000.0) \
		and is_equal_approx(full.get_actual_value("SPR"), 600.0) \
		and is_equal_approx(full.get_actual_value("CON"), 60.0) \
		and is_equal_approx(full.get_actual_value("VIT"), 6000.0)

	# 死区：等级 1 进度 0 → 连续等级量 0 → 实际值 0（STR 参考 0~50 全零）
	var fresh := CharacterPhysiologySheet.new()
	var dead_ok = is_equal_approx(fresh.get_actual_value("STR"), 0.0)

	# 种族系数数组：HIGH_ELF INT ×1.2（等级相同、底层实际值联动）
	var elf := CharacterPhysiologySheet.new()
	elf.race_id = "HIGH_ELF"
	elf.set_level("INT", 6)
	elf.set_progress("INT", 1.0)
	var race_ok = is_equal_approx(elf.get_actual_value("INT"), 6000.0 * 1.2)

	# 6 级上限：越级拒绝
	var cap := CharacterPhysiologySheet.new()
	cap.set_level("STR", 6)
	var cap_ok = (not cap.set_level("STR", 7)) and (cap.get_level("STR") == 6) and (not AttributeConversionEngine.validate_level(7))

	# 配置联动：底层系数变化 → 等级不变、实际值随之变化
	var linked := CharacterPhysiologySheet.new()
	linked.set_level("STR", 6)
	linked.set_progress("STR", 1.0)
	var before := linked.get_actual_value("STR")
	linked.base_coefficients["STR"] = 2.0
	var linked_ok = (linked.get_level("STR") == 6) and is_equal_approx(linked.get_actual_value("STR"), before * 2.0)

	var passed = base_ok and full_ok and dead_ok and race_ok and cap_ok and linked_ok
	return { "test": "TC-CREATE-04: 统一换算底座（人类基准/满级原值/死区/种族系数/6级上限/配置联动）", "passed": passed }
