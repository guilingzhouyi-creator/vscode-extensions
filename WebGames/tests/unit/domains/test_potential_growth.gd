# ==============================================================================
# 单元测试：领域 16 后天潜能成长与加点 (Potential Growth Tests)
# 文件路径: res://tests/unit/domains/test_potential_growth.gd
# ==============================================================================
class_name TestPotentialGrowthDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_diminishing_cost_calculation())
	results.append(test_targeted_allocation_flow())
	results.append(test_heart_core_respec_flow())
	results.append(test_dynamic_adjustment_flow())
	results.append(test_respec_preserves_dynamic_adjustments())
	results.append(test_enlightenment_alignment())
	results.append(test_respec_cost_never_negative())
	results.append(test_deserialize_convergence())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 16: 潜能成长与双轨加点（定向/动态）与破阶递减", "all_passed": all_passed, "results": results }

static func test_diminishing_cost_calculation() -> Dictionary:
	# 统一等级破阶成本：C(L) = 1 + floor((L-1)/2) → 1~2 级 1 点 / 3~4 级 2 点 / 5~6 级 3 点
	var cost_l1 = TargetedAttributeSolver.calculate_point_cost_for_next_stat(1)
	var cost_l3 = TargetedAttributeSolver.calculate_point_cost_for_next_stat(3)
	var cost_l5 = TargetedAttributeSolver.calculate_point_cost_for_next_stat(5)
	var passed = (cost_l1 == 1) and (cost_l3 == 2) and (cost_l5 == 3)
	return { "test": "TC-POT-01: 统一等级破阶边际递减购点方程 C(L)", "passed": passed }

static func test_targeted_allocation_flow() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	var engine := PotentialGrowthEngine.new()
	engine.grant_potential_points(5)

	var res = TargetedAttributeSolver.allocate_targeted_point(sheet, engine, "STR")
	# 等级域：1 级 → 2 级（成本 1），底层实际值经换算引擎联动
	var passed = res.success and (sheet.get_level("STR") == 2) \
		and (engine.unassigned_potential_points == 4) and (res.new_actual_value > 0.0)
	return { "test": "TC-POT-02: 手动定向加点（等级域提升）与实时换算联动", "passed": passed }

static func test_heart_core_respec_flow() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	sheet.set_level("STR", 5) # 玩家已加 4 级
	var engine := PotentialGrowthEngine.new()
	engine.lifetime_potential_earned = 10
	engine.unassigned_potential_points = 0

	var wallet := CharacterWalletEntity.new()
	wallet.gold = 500
	wallet.mana_monocrystals = 5

	var res = AttributeRespecPipeline.execute_heart_core_respec(sheet, engine, wallet, 0)
	# L1 等级回退至基础（min_level=1），潜能点全额返还
	var passed = res.success and (sheet.get_level("STR") == AttributeConversionEngine.min_level()) \
		and (engine.unassigned_potential_points == 10)
	return { "test": "TC-POT-03: 心核重构全额返还潜能点与 L1 等级回退", "passed": passed }

static func test_dynamic_adjustment_flow() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	var engine := PotentialGrowthEngine.new()
	engine.grant_potential_points(10)
	var points_before := engine.unassigned_potential_points

	# 事件频道驱动（配置表）：world_boss.boss_defeated → L3 实际值域 SPR +2 / VIT -1
	# 默认等级 1 进度 0（死区实际 0）：SPR 实际 +2 → 2；VIT 直减触底 0
	var res_ch = DynamicAttributeAdjuster.consume_event_channel(sheet, "world_boss.boss_defeated")
	var channel_ok = res_ch.success \
		and is_equal_approx(sheet.get_actual_value("SPR"), 2.0) \
		and is_equal_approx(sheet.get_actual_value("VIT"), 0.0)

	# 未登记频道静默忽略
	var res_miss = DynamicAttributeAdjuster.consume_event_channel(sheet, "unregistered.event")
	var miss_ok = (not res_miss.success) and res_miss.error_code == "NO_DYNAMIC_ADJUST_CONFIG"

	# 直减下限 0：VIT 实际 0 再减 5 → 0（不扣成负数），实际生效 0 并标记触底
	var res_floor = DynamicAttributeAdjuster.apply_dynamic_adjustment(sheet, "VIT", -5.0)
	var floor_ok = res_floor.success and is_equal_approx(sheet.get_actual_value("VIT"), 0.0) \
		and is_equal_approx(res_floor.actual_delta, 0.0) and res_floor.floor_hit

	# 与定向加点完全分离：系统调整不消耗潜能点
	var sep_ok = engine.unassigned_potential_points == points_before

	# 永久记录落账（L3）：SPR +2、VIT 0
	var record_ok = is_equal_approx(float(sheet.dynamic_adjustments.get("SPR", 0)), 2.0) \
		and is_equal_approx(float(sheet.dynamic_adjustments.get("VIT", 0)), 0.0)

	var passed = channel_ok and miss_ok and floor_ok and sep_ok and record_ok
	return { "test": "TC-POT-04: 随机动态加点（事件驱动/实际值域/下限0/不耗潜能点/永久记录）", "passed": passed }

static func test_respec_preserves_dynamic_adjustments() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	var engine := PotentialGrowthEngine.new()
	# L3 系统动态 +5 实际值（永久性）
	DynamicAttributeAdjuster.apply_dynamic_adjustment(sheet, "STR", 5.0)
	# 玩家定向 +3 级（成本 1+1+2=4 点：1→4 级）
	engine.grant_potential_points(4)
	TargetedAttributeSolver.allocate_targeted_point(sheet, engine, "STR")
	TargetedAttributeSolver.allocate_targeted_point(sheet, engine, "STR")
	TargetedAttributeSolver.allocate_targeted_point(sheet, engine, "STR")
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 500
	wallet.mana_monocrystals = 5

	var res = AttributeRespecPipeline.execute_heart_core_respec(sheet, engine, wallet, 0)
	# 洗点洗 L1 等级与 L2 阅历重塑层；L3 动态实际值保留（等级回 1、潜能全额返还、动态 +5 不逆转）
	var passed = res.success \
		and (sheet.get_level("STR") == AttributeConversionEngine.min_level()) \
		and (engine.unassigned_potential_points == 4) \
		and is_equal_approx(float(sheet.dynamic_adjustments.get("STR", 0)), 5.0) \
		and is_equal_approx(sheet.get_actual_value("STR"), 5.0)
	return { "test": "TC-POT-05: 心核洗点洗 L2/L1、L3 动态实际值不逆转（永久性隔离）", "passed": passed }

static func test_enlightenment_alignment() -> Dictionary:
	# 定向加点由阅历突破驱动：默认发点 reason 对齐卡拉尔「阅历」（替代升级 LEVEL_UP）
	var reason := GameConfig.get_string("domains.potential", "growth/default_reason", "")
	var engine := PotentialGrowthEngine.new()
	var balance := engine.grant_potential_points(3)
	var passed = (reason == "ENLIGHTENMENT") and (balance == 3) and (engine.lifetime_potential_earned == 3)
	return { "test": "TC-POT-06: 定向加点由阅历突破驱动（默认 reason=ENLIGHTENMENT）", "passed": passed }

static func test_respec_cost_never_negative() -> Dictionary:
	# M9（Phase 51）：越序 engine（lifetime < unassigned，绕过 deserialize 直接构造）
	# 成本分子钳 0 —— 负成本扣减等价反向增发魔单晶（红证：修复前 crystal_cost < 0）
	var engine := PotentialGrowthEngine.new()
	engine.lifetime_potential_earned = 5
	engine.unassigned_potential_points = 12
	var cost = AttributeRespecPipeline.calculate_respec_cost(engine, 0)

	var sheet := CharacterPhysiologySheet.new()
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 500
	wallet.mana_monocrystals = 100
	var crystal_before := wallet.mana_monocrystals
	var res = AttributeRespecPipeline.execute_heart_core_respec(sheet, engine, wallet, 0)

	var no_mint = wallet.mana_monocrystals == crystal_before and wallet.mana_monocrystals >= 0
	var passed = res.success and int(cost.crystal_cost) == 0 and no_mint
	return { "test": "TC-POT-07: 越序 engine 洗点成本钳 0（M9 负成本增发封堵）", "passed": passed }

static func test_deserialize_convergence() -> Dictionary:
	# M9（Phase 51）：反序列化收敛序关系（Inv-TX-3）——unassigned 夹紧 ∈ [0, lifetime]、负值归 0、合法存档零变化
	var eng = PotentialGrowthEngine.deserialize({"unassigned_potential_points": 12, "lifetime_potential_earned": 5})
	var conv_ok = eng.lifetime_potential_earned == 5 and eng.unassigned_potential_points == 5
	var eng2 = PotentialGrowthEngine.deserialize({"unassigned_potential_points": -3, "lifetime_potential_earned": -7})
	var neg_ok = eng2.lifetime_potential_earned == 0 and eng2.unassigned_potential_points == 0
	var eng3 = PotentialGrowthEngine.deserialize({"unassigned_potential_points": 8, "lifetime_potential_earned": 20})
	var ok_ok = eng3.unassigned_potential_points == 8 and eng3.lifetime_potential_earned == 20
	var passed = conv_ok and neg_ok and ok_ok
	return { "test": "TC-POT-08: 反序列化收敛（M9：unassigned≤lifetime、负值归 0、合法零变化）", "passed": passed }
