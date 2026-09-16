# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Phase 65 战斗双随机与第三时间轴测试套件
# 文件路径: res://tests/integration/pipelines/test_combat_dual_random_and_timeline_pipeline.gd
# 职责: 验收手牌数量随机与牌型抽取解耦、合法0手牌与保活推演、时间轴开局预排期及前端脱敏
# ==============================================================================
class_name TestCombatDualRandomAndTimelinePipeline
extends RefCounted

const CombatHandDrawDTOClass = preload("res://backend/domains/physics_thermodynamics/combat_hand_draw_dto.gd")
const TimelineEventScheduleDTOClass = preload("res://backend/domains/physics_thermodynamics/timeline_event_schedule_dto.gd")
const CombatTimelineClientDTOClass = preload("res://backend/domains/physics_thermodynamics/combat_timeline_client_dto.gd")
const CombatHandGeneratorClass = preload("res://backend/domains/physics_thermodynamics/combat_hand_generator.gd")
const TimelineScheduleGeneratorClass = preload("res://backend/domains/physics_thermodynamics/timeline_schedule_generator.gd")
const CombatRoundCoordinatorClass = preload("res://backend/domains/physics_thermodynamics/combat_round_coordinator.gd")
const TertiaryTimelineEngineClass = preload("res://backend/domains/physics_thermodynamics/tertiary_timeline_engine.gd")
const DeterministicRNGClass = preload("res://backend/infrastructure/deterministic_rng.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name := "Phase 65: 战斗抽牌数量随机与第三时间轴事件调度重构验收流水线"

	results.append(_test_tr_01_first_encounter_and_normal_quantity_random())
	results.append(_test_tr_02_special_modifier_zero_hand_state())
	results.append(_test_tr_03_zero_hand_keepalive_timeline_progression())
	results.append(_test_tr_04_opening_schedule_and_min_spacing_constraint())
	results.append(_test_tr_05_add_draw_bonus_cards_trigger())
	results.append(_test_tr_06_cross_round_pending_modifier_consumption())
	results.append(_test_tr_07_client_view_desensitization())
	results.append(_test_tr_08_deterministic_rng_repeatability())
	# R-03（TC-CT-09）：空转引擎等价旧 null 场景
	results.append(_test_idle_engine_null_equivalence())

	var passed_cnt := 0
	for r in results:
		if bool(r.get("passed", false)):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

## TC-TR-01: 首次遇敌与后续普通回合发牌数量随机性与边界断言
static func _test_tr_01_first_encounter_and_normal_quantity_random() -> Dictionary:
	var rng := DeterministicRNG.from_seed(12345)

	# 1. 首次遇敌发牌测试 (区间 [3, 4])
	var first_counts := []
	for i in range(50):
		var count := CombatHandGenerator.evaluate_base_hand_count(true, rng)
		first_counts.append(count)
		if count < 3 or count > 4:
			return {"test": "TC-TR-01: 首次遇敌发牌数量越界", "passed": false, "error": "First encounter count %d not in [3, 4]" % count}

	# 2. 普通回合发牌测试 (离散分布 1~4)
	var normal_counts := {}
	for i in range(100):
		var c := CombatHandGenerator.evaluate_base_hand_count(false, rng)
		normal_counts[c] = normal_counts.get(c, 0) + 1
		if c < 1 or c > 4:
			return {"test": "TC-TR-01: 普通回合发牌数量非法", "passed": false, "error": "Normal round count %d not in [1, 4]" % c}

	var has_1: bool = normal_counts.get(1, 0) > 0
	var has_2: bool = normal_counts.get(2, 0) > 0

	var passed: bool = (first_counts.size() == 50) and has_1 and has_2
	return {
		"test": "TC-TR-01: 首次遇敌[3,4]区间与普通回合离散发牌数量双随机解耦验证",
		"passed": passed
	}

## TC-TR-02: 特殊效果流水线修正数量与合法 0 手牌状态断言
static func _test_tr_02_special_modifier_zero_hand_state() -> Dictionary:
	var rng := DeterministicRNG.from_seed(54321)
	var spec := CombatHandDrawDTO.HandDrawSpecDTO.new()
	spec.current_round = 2
	spec.is_first_encounter = false
	spec.special_modifiers = [
		{"modifier_id": "DEBUFF_SILENCE_HAND", "force_zero_hand": true}
	]

	var res := CombatHandGenerator.draw_cards_for_turn(spec, rng)
	var zero_ok: bool = (res.final_draw_count == 0) and res.is_zero_hand_state and res.actual_cards.is_empty()

	# 增量削减至 0 场景
	var spec2 := CombatHandDrawDTO.HandDrawSpecDTO.new()
	spec2.current_round = 3
	spec2.special_modifiers = [
		{"modifier_id": "DEBUFF_SLOWNESS", "hand_count_delta": -10}
	]
	var res2 := CombatHandGenerator.draw_cards_for_turn(spec2, rng)
	var clamp_zero_ok: bool = (res2.final_draw_count == 0) and res2.is_zero_hand_state

	var passed: bool = zero_ok and clamp_zero_ok and (res.applied_modifiers.size() == 1)
	return {
		"test": "TC-TR-02: 特殊效果流水线合法将手牌削减至0且标记状态机",
		"passed": passed
	}

## TC-TR-03: 玩家 0 手牌且 0 AP 姿态下时间轴保活持续推演断言
static func _test_tr_03_zero_hand_keepalive_timeline_progression() -> Dictionary:
	var engine := TertiaryTimelineEngine.new()
	var rng := DeterministicRNG.from_seed(777)
	engine.initialize(0, rng)

	var p_bar := ActionCardStagingBar.new()
	p_bar.initialize("PLAYER", 5)
	var e_bar := ActionCardStagingBar.new()
	e_bar.initialize("ENEMY", 5)

	var coordinator := CombatRoundCoordinator.new()
	coordinator.initialize(engine, p_bar, e_bar, rng)

	# 构建含未来未决事件的预排期计划 (在 4000ms 处有事件)
	var schedule := TimelineEventScheduleDTO.new()
	schedule.round_number = 1
	schedule.max_round_duration_ms = 10000
	var pt := TimelineEventScheduleDTO.ScheduledPoint.new()
	pt.point_id = "EVT_FUTURE_DRAW"
	pt.event_kind = TimelineEventScheduleDTO.EventKind.NORMAL_DRAW
	pt.trigger_time_ms = 4000
	schedule.scheduled_points = [pt]
	coordinator.set_round_schedule(schedule)

	var p_part := CombatPipelineFSM.CombatParticipant.new()
	p_part.participant_id = "HERO"
	p_part.current_ap = 0 # AP 为 0
	p_bar.cards.clear()   # 手牌为 0

	var e_part := CombatPipelineFSM.CombatParticipant.new()
	e_part.participant_id = "BOSS"
	e_part.current_ap = 5

	# 步进 2000ms：虽然 0 AP 且 0 手牌，但因预排期有未决事件且未超时，绝对不结束回合！
	var step1 := coordinator.step_coordinator(2000, p_part, e_part)
	var keepalive_ok: bool = (step1.round == 1) and (step1.round_ended == false) and (step1.round_elapsed_ms == 2000)

	# 步进 2500ms（累计 4500ms，触发 4000ms 的事件）
	var step2 := coordinator.step_coordinator(2500, p_part, e_part)
	var evt_triggered: bool = pt.is_executed and (step2.events_fired.size() > 0)

	var passed: bool = keepalive_ok and evt_triggered
	return {
		"test": "TC-TR-03: 0手牌且0AP姿态下第三时间轴保活持续推进与未决事件触发",
		"passed": passed
	}

## TC-TR-04: 回合开局一次性预排期与最小事件间距防碰撞断言
static func _test_tr_04_opening_schedule_and_min_spacing_constraint() -> Dictionary:
	var rng := DeterministicRNGClass.from_seed(9876)
	var schedule := TimelineScheduleGeneratorClass.generate_round_schedule(1, 10000, rng)

	var pts = schedule.scheduled_points
	var count_ok: bool = (pts.size() >= 2 and pts.size() <= 4)

	var spacing_ok: bool = true
	var monotonic_ok: bool = true
	for i in range(1, pts.size()):
		var diff: int = pts[i].trigger_time_ms - pts[i - 1].trigger_time_ms
		if diff < 1500:
			spacing_ok = false
		if pts[i].trigger_time_ms <= pts[i - 1].trigger_time_ms:
			monotonic_ok = false

	var passed: bool = count_ok and spacing_ok and monotonic_ok
	return {
		"test": "TC-TR-04: 回合开局一次性预排期单调递增且满足>=1500ms最小防碰撞间距",
		"passed": passed
	}

## TC-TR-05: 加发牌点 ADD_DRAW 到点触发与额外卡牌补发断言
static func _test_tr_05_add_draw_bonus_cards_trigger() -> Dictionary:
	var rng := DeterministicRNGClass.from_seed(444)
	var p_bar := ActionCardStagingBar.new()
	p_bar.initialize("PLAYER", 5)
	var e_bar := ActionCardStagingBar.new()
	e_bar.initialize("ENEMY", 5)

	var coordinator := CombatRoundCoordinator.new()
	coordinator.initialize(TertiaryTimelineEngineClass.new(), p_bar, e_bar, rng)

	var schedule := TimelineEventScheduleDTO.new()
	schedule.round_number = 1
	schedule.max_round_duration_ms = 8000
	var pt := TimelineEventScheduleDTO.ScheduledPoint.new()
	pt.point_id = "EVT_ADD_DRAW_TEST"
	pt.event_kind = TimelineEventScheduleDTO.EventKind.ADD_DRAW
	pt.trigger_time_ms = 2000
	pt.payload = {"extra_bonus_cards": 2}
	schedule.scheduled_points = [pt]
	coordinator.set_round_schedule(schedule)

	var p_part := CombatPipelineFSM.CombatParticipant.new()
	p_part.participant_id = "HERO"
	p_part.current_ap = 5
	var e_part := CombatPipelineFSM.CombatParticipant.new()
	e_part.participant_id = "BOSS"
	e_part.current_ap = 5

	# 步进 2500ms 跨越触发点
	var step := coordinator.step_coordinator(2500, p_part, e_part)
	var bonus_dispatched: bool = (p_bar.cards.size() == 2)
	var pt_done: bool = pt.is_executed

	# P2 修复回归：跨过回合时限后，结算态必须可被表现层快照观察
	# （红证：修复前 get_client_snapshot 用已归零的 round_elapsed_ms 重算，is_round_concluded 恒 false）
	# 注意：协调器时限取自配置 round_lifecycle/max_round_duration_ms（默认 10000），非 schedule DTO 的 8000；
	# step1 已累计 2500ms，step2 需 ≥7500ms 才能越过 10000ms 时限触发 ROUND_TIME_LIMIT_REACHED
	var step2 := coordinator.step_coordinator(8000, p_part, e_part)
	var snap := coordinator.get_client_snapshot()
	var concluded_ok: bool = step2.round_ended \
		and snap.is_round_concluded \
		and snap.conclude_reason == "ROUND_TIME_LIMIT_REACHED"

	var passed: bool = bonus_dispatched and pt_done and concluded_ok
	return {
		"test": "TC-TR-05: 加发牌点(ADD_DRAW)到点触发额外发放2张卡牌入待发栏",
		"passed": passed
	}

## TC-TR-06: 跨回合修饰符显式消费（Inv-TR-5）——未消费修饰介入下一回合排期，
## 应用后按生命周期递减并置单次消费标记（is_consumed），禁止重复生效
static func _test_tr_06_cross_round_pending_modifier_consumption() -> Dictionary:
	var rng := DeterministicRNGClass.from_seed(888)
	var mod := PendingTimelineModifierDTO.new()
	mod.source_id = "ROUND_1_PENDING"
	mod.lifetime_rounds = 1
	mod.event_count_delta = 1
	mod.min_spacing_delta = -200
	var modifiers: Array[PendingTimelineModifierDTO] = [mod]

	var schedule := TimelineScheduleGeneratorClass.generate_round_schedule(2, 10000, rng, modifiers)
	var pts := schedule.scheduled_points
	var mod_applied: bool = (schedule.active_modifiers.size() == 1)
	var count_expanded: bool = (pts.size() >= 2)
	# 单次消费契约：lifetime_rounds 递减至 0 → is_consumed 置 true（消费后标记已清空）
	var consumed_ok: bool = mod.is_consumed and mod.lifetime_rounds == 0 \
		and schedule.active_modifiers[0].get("source_id", "") == "ROUND_1_PENDING"

	# 二次排期不得重复生效（已消费修饰被跳过）
	var schedule2 := TimelineScheduleGeneratorClass.generate_round_schedule(3, 10000, rng, modifiers)
	var not_reapplied: bool = schedule2.active_modifiers.is_empty()

	var passed: bool = mod_applied and count_expanded and consumed_ok and not_reapplied
	return {
		"test": "TC-TR-06: 跨回合修饰符显式介入下一回合事件密度与排期生成（单次消费标记闭环）",
		"passed": passed
	}

## TC-TR-07: 前端 Presenter 视图快照脱敏与绝对时间戳零泄漏断言
static func _test_tr_07_client_view_desensitization() -> Dictionary:
	var rng := DeterministicRNG.from_seed(333)
	var p_bar := ActionCardStagingBar.new()
	p_bar.initialize("PLAYER", 5)
	var e_bar := ActionCardStagingBar.new()
	e_bar.initialize("ENEMY", 5)

	var coordinator := CombatRoundCoordinator.new()
	coordinator.initialize(TertiaryTimelineEngineClass.new(), p_bar, e_bar, rng)

	var schedule := TimelineEventScheduleDTO.new()
	schedule.round_number = 1
	schedule.max_round_duration_ms = 10000
	var pt := TimelineEventScheduleDTO.ScheduledPoint.new()
	pt.point_id = "INTERNAL_PT"
	pt.event_kind = TimelineEventScheduleDTO.EventKind.NORMAL_DRAW
	pt.trigger_time_ms = 3000
	schedule.scheduled_points = [pt]
	coordinator.set_round_schedule(schedule)

	var p_part := CombatPipelineFSM.CombatParticipant.new()
	var e_part := CombatPipelineFSM.CombatParticipant.new()

	coordinator.step_coordinator(4000, p_part, e_part)

	var client_snapshot := coordinator.get_client_snapshot()
	var client_dict := client_snapshot.to_client_view()

	# 严格断言：绝对不能含有 trigger_time_ms, next_event_in, internal 等敏感字段
	var no_trigger_time: bool = not client_dict.has("trigger_time_ms")
	var no_next_time: bool = not client_dict.has("next_event_time")
	var has_ratio: bool = client_dict.has("progress_ratio") and is_equal_approx(float(client_dict["progress_ratio"]), 0.4)
	var has_events: bool = client_dict.has("resolved_events") and (client_dict["resolved_events"].size() == 1)

	var passed: bool = no_trigger_time and no_next_time and has_ratio and has_events
	return {
		"test": "TC-TR-07: 前端客户端视图快照安全脱敏与未来倒计时零泄漏",
		"passed": passed
	}

## TC-TR-08: DeterministicRNG 相同种子 100% 幂等确定性重演断言
static func _test_tr_08_deterministic_rng_repeatability() -> Dictionary:
	var seed_val := 9999
	var rng1 := DeterministicRNGClass.from_seed(seed_val)
	var sched1 := TimelineScheduleGeneratorClass.generate_round_schedule(1, 10000, rng1)

	var rng2 := DeterministicRNGClass.from_seed(seed_val)
	var sched2 := TimelineScheduleGeneratorClass.generate_round_schedule(1, 10000, rng2)

	var pts1 := sched1.scheduled_points
	var pts2 := sched2.scheduled_points

	var same_count: bool = (pts1.size() == pts2.size())
	var all_match: bool = same_count
	var mismatch_reason := ""
	if same_count:
		for i in range(pts1.size()):
			if pts1[i].trigger_time_ms != pts2[i].trigger_time_ms:
				all_match = false
				mismatch_reason = "Time mismatch at %d: %d vs %d" % [i, pts1[i].trigger_time_ms, pts2[i].trigger_time_ms]
				break
			if pts1[i].event_kind != pts2[i].event_kind:
				all_match = false
				mismatch_reason = "Kind mismatch at %d: %d vs %d" % [i, pts1[i].event_kind, pts2[i].event_kind]
				break
	else:
		mismatch_reason = "Size mismatch: %d vs %d" % [pts1.size(), pts2.size()]

	var passed: bool = same_count and all_match
	if not passed:
		print("DEBUG TC-TR-08 FAILED: ", mismatch_reason)
	return {
		"test": "TC-TR-08: 相同种子下生成排期时间戳与事件类型 100% 确定性幂等重演",
		"passed": passed,
		"error": mismatch_reason
	}


## R-03（TC-CT-09）：引擎必填化等价性——空转引擎零调度事件/快照态完整。
static func _test_idle_engine_null_equivalence() -> Dictionary:
	var rng := DeterministicRNGClass.from_seed(20260912)
	var p_bar := ActionCardStagingBar.new()
	p_bar.initialize("PLAYER", 5)
	var e_bar := ActionCardStagingBar.new()
	e_bar.initialize("ENEMY", 5)
	var coordinator := CombatRoundCoordinatorClass.new()
	coordinator.initialize(TertiaryTimelineEngineClass.new(), p_bar, e_bar, rng)
	var fired: Array = coordinator.timeline_engine.advance_time(5000)
	var idle_events_ok: bool = fired.is_empty()
	var snap := coordinator.get_snapshot()
	var advance_ok: bool = snap != null \
		and snap.timeline_state != null \
		and snap.timeline_state.has("current_timeline_ms") \
		and int(snap.timeline_state.get("scheduled_count", -1)) == 0
	var passed: bool = idle_events_ok and advance_ok
	return {
		"test": "TC-CT-09: 空转引擎等价旧 null 场景（零调度事件/快照态完整）",
		"passed": passed,
		"fired_events": fired.size()
	}
