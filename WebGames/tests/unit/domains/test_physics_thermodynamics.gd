# ==============================================================================
# 单元测试：领域 2 物理动量侵彻与热力学能损 (Physics & Thermodynamics Tests)
# 文件路径: res://tests/unit/domains/test_physics_thermodynamics.gd
# ==============================================================================
class_name TestPhysicsDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_physical_verb_registry())
	results.append(test_penetration_damage_calculation())
	results.append(test_mana_phase_transition_loss())
	results.append(test_ap_continuum_and_parry_interrupt())
	# Phase 45: 核心战斗逻辑与第三时间轴动态博弈体系
	var p45_res := TestCombatTertiaryTimelinePipeline.run_all_tests()
	results.append_array(p45_res.get("results", []))

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 02: 物理碰撞与热力学能损", "all_passed": all_passed, "results": results }

static func test_physical_verb_registry() -> Dictionary:
	var verbs := ["STAB", "SLASH", "UPPER", "PARRY", "BLOCK", "CRUSH", "INTER", "TWIST"]
	var all_exist := true
	for v in verbs:
		if not PhysicalVerbRegistry.verbs.has(v):
			all_exist = false
			break
	return { "test": "TC-PHYS-01: 八大物理动词常数完整性", "passed": all_exist }

static func test_penetration_damage_calculation() -> Dictionary:
	var dmg_slash = PhysicsAndThermodynamicsSolver.calculate_penetration_damage(3.0, 8.0, "SLASH", 1.5, 5.0)
	var dmg_crush = PhysicsAndThermodynamicsSolver.calculate_penetration_damage(3.0, 8.0, "CRUSH", 0.0, 5.0)
	var passed = (dmg_slash > 0.0) and (dmg_crush > 0.0)
	return { "test": "TC-PHYS-02: 动量守恒与刃口侵彻伤害严格计算", "passed": passed, "dmg_slash": dmg_slash }

static func test_mana_phase_transition_loss() -> Dictionary:
	var loss_primordial = PhysicsAndThermodynamicsSolver.calculate_mana_phase_transition_loss(100.0, true, 1, 10.0)
	var loss_incantation = PhysicsAndThermodynamicsSolver.calculate_mana_phase_transition_loss(100.0, false, 5, 10.0)
	var passed = (loss_primordial.step1_loss_ratio == 0.03) and \
		(loss_incantation.step1_loss_ratio > 0.25) and \
		(loss_primordial.effective_output < 100.0) and \
		(loss_primordial.total_loss_ratio >= 0.001)
	return { "test": "TC-PHYS-03: 始源直驱能损律(3%)对比咒术相变能损(无限逼近100%)", "passed": passed, "pri": loss_primordial, "inc": loss_incantation }

static func test_ap_continuum_and_parry_interrupt() -> Dictionary:
	var attacker := CombatPipelineFSM.CombatParticipant.new()
	attacker.name = "狂战士"
	attacker.current_ap = -3
	var defender := CombatPipelineFSM.CombatParticipant.new()
	defender.name = "剑圣"

	var packet = CombatPipelineFSM.execute_action_round(attacker, "SLASH", defender, "PARRY")
	var passed = packet.is_interrupted and attacker.is_staggered
	return { "test": "TC-PHYS-04: 正负AP势能打断与架招僵直触发", "passed": passed, "interrupted": packet.is_interrupted }
