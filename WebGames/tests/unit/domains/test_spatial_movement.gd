# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 31 双轨空间坐标系统单元测试
# 文件路径: res://tests/unit/domains/test_spatial_movement.gd
# ==============================================================================
class_name TestSpatialMovementDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 31: 双轨空间坐标系与2D位移平滑演化引擎"

	results.append(_test_text_to_vector_translation())
	results.append(_test_speed_load_and_impedance_damping())
	results.append(_test_spatial_trigger_fsm_lifecycle())

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

static func _test_text_to_vector_translation() -> Dictionary:
	var loc := SpatialLocationEntity.new("CONTINENT_CENTRAL", "TOWN_VALAN", "MAIN_STREET", Vector2(0, 0))

	# 向北走 10 米
	var v_north = MovementVectorBridgeSolver.translate_text_step_to_vector("NORTH", 10.0)
	MovementVectorBridgeSolver.apply_displacement(loc, v_north)

	# 向东走 5 米
	var v_east = MovementVectorBridgeSolver.translate_text_step_to_vector("EAST", 5.0)
	MovementVectorBridgeSolver.apply_displacement(loc, v_east)

	var passed = is_equal_approx(loc.local_coordinates.x, 5.0) and is_equal_approx(loc.local_coordinates.y, -10.0)
	return {
		"test": "TC-MOVE-01: 文字方位动词向连续欧氏向量位移精确映射",
		"passed": passed
	}

static func _test_speed_load_and_impedance_damping() -> Dictionary:
	# 基础 4.5m/s, AGI 10 (无修正), 负重 80kg (惩罚 0.5), 地形阻抗 2.0 (沼泽)
	var eff_speed = MovementVectorBridgeSolver.calculate_effective_speed(4.5, 10.0, 80.0, 2.0)
	# (4.5 * 1.0 * 0.5) / 2.0 = 1.125 m/s
	var passed = is_equal_approx(eff_speed, 1.125)
	return {
		"test": "TC-MOVE-02: 敏捷增益、负重惩罚与地质阻抗连续速度衰减",
		"passed": passed
	}

static func _test_spatial_trigger_fsm_lifecycle() -> Dictionary:
	var trigger := SpatialTriggerFSM.SpatialTriggerArea.new("TRIGGER_BOSS_ROOM", Vector2(100, 100), 10.0)

	# 外部 (0, 0)
	var s0 = SpatialTriggerFSM.evaluate_trigger_state(trigger, Vector2(0, 0))
	# 步入边界 (105, 100) -> ENTERED
	var s1 = SpatialTriggerFSM.evaluate_trigger_state(trigger, Vector2(105, 100))
	# 内部停留 (100, 100) -> INSIDE
	var s2 = SpatialTriggerFSM.evaluate_trigger_state(trigger, Vector2(100, 100))
	# 移出外部 (150, 100) -> EXITED
	var s3 = SpatialTriggerFSM.evaluate_trigger_state(trigger, Vector2(150, 100))

	var passed = (s0 == SpatialTriggerFSM.TriggerState.OUTSIDE) and (s1 == SpatialTriggerFSM.TriggerState.ENTERED) and (s2 == SpatialTriggerFSM.TriggerState.INSIDE) and (s3 == SpatialTriggerFSM.TriggerState.EXITED)
	return {
		"test": "TC-MOVE-03: 空间圆形与区域边界进出状态机完整生命周期",
		"passed": passed
	}
