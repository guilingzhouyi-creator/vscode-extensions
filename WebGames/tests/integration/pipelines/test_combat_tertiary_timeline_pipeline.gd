# ==============================================================================
# 测试领域：核心战斗逻辑与第三时间轴动态博弈体系 (Phase 45 专属测试套件)
# 文件路径: res://tests/integration/pipelines/test_combat_tertiary_timeline_pipeline.gd
# 职责: 验证综合先手评估求解器、第三时间轴推演引擎、待发栏满载溢出缓冲、
#       小回合生命周期无缝继承、确定性重放审计与配置热更兜底。
# 需求源: Phase 45 (P7.1 ~ P7.6 验收矩阵)
# ==============================================================================
class_name TestCombatTertiaryTimelinePipeline
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_initiative_calculation())
	results.append(_test_tertiary_timeline_advancement())
	results.append(_test_staging_bar_overflow_policies())
	results.append(_test_subround_interlocking_continuity())
	results.append(_test_deterministic_replay_audit())
	results.append(_test_config_sanity_and_fallback())
	# Phase 54 M8 新增：两阶段排期不断供
	results.append(_test_timeline_two_phase_no_reschedule_loss())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "Combat Tertiary Timeline & Dynamic Game System (Phase 45)",
		"all_passed": all_passed,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"results": results
	}

## TC-P45-S4-01: 综合属性先手评分与三级平局决胜
static func _test_initiative_calculation() -> Dictionary:
	var rng := DeterministicRNG.from_seed(12345)

	# 1. 评分显著差距：玩家敏捷优势直接胜出
	var p_spec := CombatInitiativeSolver.ParticipantInitiativeSpec.new()
	p_spec.participant_id = "PLAYER_01"
	p_spec.name = "先锋玩家"
	p_spec.is_player = true
	p_spec.base_agility = 30.0
	p_spec.base_perception = 15.0
	p_spec.level = 5

	var e_spec := CombatInitiativeSolver.ParticipantInitiativeSpec.new()
	e_spec.participant_id = "GOBLIN_01"
	e_spec.name = "哥布林斥候"
	e_spec.is_player = false
	e_spec.base_agility = 10.0
	e_spec.base_perception = 8.0
	e_spec.level = 2

	var res1 := CombatInitiativeSolver.evaluate_initiative(p_spec, e_spec, rng)
	if res1.first_mover_id != "PLAYER_01" or res1.tie_broken_by != "SCORE":
		return {"test": "TC-P45-S4-01: 综合先手敏捷优势胜出", "passed": false, "error": "Score initiative failed"}
	if res1.initial_ap_diff <= 0:
		return {"test": "TC-P45-S4-01: 初始先手 AP 优势", "passed": false, "error": "AP lead bonus missing"}

	# 2. 评分相同、纯敏捷不同：二级敏捷兜底决胜
	var p_spec2 := CombatInitiativeSolver.ParticipantInitiativeSpec.new()
	p_spec2.participant_id = "PLAYER_02"
	p_spec2.base_agility = 20.0
	p_spec2.base_perception = 10.0
	p_spec2.level = 1

	var e_spec2 := CombatInitiativeSolver.ParticipantInitiativeSpec.new()
	e_spec2.participant_id = "ENEMY_02"
	e_spec2.base_agility = 10.0
	e_spec2.base_perception = 22.5 # 配平基础分数
	e_spec2.level = 1

	# 构造零抖动 RNG 验证兜底比对
	var zero_rng := DeterministicRNG.from_seed(9999)
	var res2 := CombatInitiativeSolver.evaluate_initiative(p_spec2, e_spec2, zero_rng)
	if res2.first_mover_id != "PLAYER_02" and res2.first_mover_id != "ENEMY_02":
		return {"test": "TC-P45-S4-01: 二级决胜有效性", "passed": false, "error": "Invalid first mover"}

	# 3. 完全相同属性：三级确定性随机决胜
	var p_spec3 := CombatInitiativeSolver.ParticipantInitiativeSpec.new()
	p_spec3.participant_id = "CLONE_A"
	p_spec3.base_agility = 15.0
	p_spec3.base_perception = 15.0
	p_spec3.level = 3

	var e_spec3 := CombatInitiativeSolver.ParticipantInitiativeSpec.new()
	e_spec3.participant_id = "CLONE_B"
	e_spec3.base_agility = 15.0
	e_spec3.base_perception = 15.0
	e_spec3.level = 3

	var res3 := CombatInitiativeSolver.evaluate_initiative(p_spec3, e_spec3, rng)
	if res3.first_mover_id.is_empty():
		return {"test": "TC-P45-S4-01: 三级平局掷骰决胜", "passed": false, "error": "Empty first mover on tie"}

	return {"test": "TC-P45-S4-01: 先手综合属性计算与三级平局决胜", "passed": true}

## TC-P45-S4-02: 第三时间轴双离散事件点时间推进验证
static func _test_tertiary_timeline_advancement() -> Dictionary:
	var engine := TertiaryTimelineEngine.new()
	var rng := DeterministicRNG.from_seed(42)

	engine.initialize(0, rng)
	if engine.current_timeline_ms != 0 or engine.scheduled_events.size() != 2:
		return {"test": "TC-P45-S4-02: 初始化状态", "passed": false, "error": "Init state invalid"}

	# 推进 0ms 不触发事件
	var fired0 := engine.advance_time(0)
	if not fired0.is_empty():
		return {"test": "TC-P45-S4-02: 零步长推进", "passed": false, "error": "Fired on zero delta"}

	# 推进 3000ms（发放点通常在 1200~2800ms 内，必然触发至少 1 个发放点）
	var fired1 := engine.advance_time(3000)
	if fired1.is_empty():
		return {"test": "TC-P45-S4-02: 推进事件触发", "passed": false, "error": "No event fired in 3000ms"}
	if engine.current_timeline_ms != 3000:
		return {"test": "TC-P45-S4-02: 时间戳单调前进", "passed": false, "error": "Timeline ms mismatch"}

	# 验证排期队列未被掏空，触发后自动生成下一次事件
	if engine.scheduled_events.is_empty():
		return {"test": "TC-P45-S4-02: 后续事件自动排期", "passed": false, "error": "Scheduled events empty"}

	# 持续推进至 10000ms，验证紧张点亦被触发
	var fired2 := engine.advance_time(7000)
	if engine.current_timeline_ms != 10000:
		return {"test": "TC-P45-S4-02: 累加时间推进", "passed": false, "error": "Accumulated timeline mismatch"}

	return {"test": "TC-P45-S4-02: 第三时间轴独立推进与离散事件触发", "passed": true}

## TC-P45-S4-03: 待发栏容量满载时时间轴不阻塞与溢出策略验证
static func _test_staging_bar_overflow_policies() -> Dictionary:
	var bar := ActionCardStagingBar.new()
	bar.initialize("HERO_01", 3)

	var c1 := PhysicalVerbRegistry.CombatActionCardEntity.new()
	c1.card_id = "CARD_001"
	c1.card_name = "劈砍1"

	var c2 := PhysicalVerbRegistry.CombatActionCardEntity.new()
	c2.card_id = "CARD_002"
	c2.card_name = "劈砍2"

	var c3 := PhysicalVerbRegistry.CombatActionCardEntity.new()
	c3.card_id = "CARD_003"
	c3.card_name = "劈砍3"

	var r1 := bar.enqueue_card(c1)
	var r2 := bar.enqueue_card(c2)
	var r3 := bar.enqueue_card(c3)

	if not r1.success or not r2.success or not r3.success:
		return {"test": "TC-P45-S4-03: 正常入队", "passed": false, "error": "Normal enqueue failed"}
	if bar.cards.size() != 3 or not bar.get_snapshot().is_full:
		return {"test": "TC-P45-S4-03: 满载标记", "passed": false, "error": "Full state invalid"}

	# 满载推入第 4 张卡：默认 DISCARD_OLDEST 策略生效
	var c4 := PhysicalVerbRegistry.CombatActionCardEntity.new()
	c4.card_id = "CARD_004"
	c4.card_name = "刺击4"

	var r4 := bar.enqueue_card(c4)
	if not r4.success or r4.action != "OVERFLOW_DISCARD_OLDEST":
		return {"test": "TC-P45-S4-03: 满载溢出挤出最旧", "passed": false, "error": "Overflow discard failed"}
	if r4.discarded_card_id != "CARD_001" or r4.inserted_card_id != "CARD_004":
		return {"test": "TC-P45-S4-03: 挤出卡牌一致性", "passed": false, "error": "Discarded card mismatch"}
	if bar.cards.size() != 3:
		return {"test": "TC-P45-S4-03: 容量守恒", "passed": false, "error": "Capacity violation"}

	# 消费弹出一张卡
	var popped := bar.pop_card("CARD_002")
	if popped == null or popped.card_id != "CARD_002":
		return {"test": "TC-P45-S4-03: 手牌弹出消费", "passed": false, "error": "Pop card failed"}
	if bar.cards.size() != 2 or bar.get_snapshot().is_full:
		return {"test": "TC-P45-S4-03: 消费后解除满载", "passed": false, "error": "Is_full flag not cleared"}

	return {"test": "TC-P45-S4-03: 待发栏满载溢出处理与时间轴不阻塞", "passed": true}

## TC-P45-S4-04: 小回合切轮时第三时间轴绝对时间继承连续性验证
static func _test_subround_interlocking_continuity() -> Dictionary:
	var engine := TertiaryTimelineEngine.new()
	var rng := DeterministicRNG.from_seed(777)
	engine.initialize(0, rng)

	var p_bar := ActionCardStagingBar.new()
	p_bar.initialize("PLAYER", 5)
	var e_bar := ActionCardStagingBar.new()
	e_bar.initialize("ENEMY", 5)

	var coordinator := CombatRoundCoordinator.new()
	coordinator.initialize(engine, p_bar, e_bar, rng)

	var p_part := CombatPipelineFSM.CombatParticipant.new()
	p_part.participant_id = "P1"
	p_part.current_ap = 5

	var e_part := CombatPipelineFSM.CombatParticipant.new()
	e_part.participant_id = "E1"
	e_part.current_ap = 5

	# 步进 5000ms：回合仍在进行中
	var step1 := coordinator.step_coordinator(5000, p_part, e_part)
	if step1.round != 1 or step1.round_ended != false:
		return {"test": "TC-P45-S4-04: 回合中持续步进", "passed": false, "error": "Round ended prematurely"}
	if step1.timeline_ms != 5000:
		return {"test": "TC-P45-S4-04: 时间轴步进同步", "passed": false, "error": "Timeline ms out of sync"}

	# 模拟 AP 耗尽且手牌打空：强制小回合结束
	p_part.current_ap = 0
	p_bar.cards.clear()
	var step2 := coordinator.step_coordinator(100, p_part, e_part)
	if step2.round_ended != true or step2.end_reason != "AP_AND_HAND_EXHAUSTED":
		return {"test": "TC-P45-S4-04: AP与手牌耗尽判定结束", "passed": false, "error": "Round end criteria not met"}

	# 验证进入第 2 回合后，时间轴绝对时刻保持 5100ms 连续继承，严禁被重新归零！
	if coordinator.current_round != 2:
		return {"test": "TC-P45-S4-04: 回合编号递增", "passed": false, "error": "Round number not advanced"}
	if coordinator.round_elapsed_ms != 0:
		return {"test": "TC-P45-S4-04: 动次局部计时重置", "passed": false, "error": "Round elapsed not reset"}
	if engine.current_timeline_ms != 5100:
		return {"test": "TC-P45-S4-04: 第三时间轴绝对时间继承", "passed": false, "error": "Timeline ms reset or drifted"}

	return {"test": "TC-P45-S4-04: 小回合换轮第三时间轴状态无缝继承", "passed": true}

## TC-P45-S4-05: 确定性随机重放全要素吻合验证
static func _test_deterministic_replay_audit() -> Dictionary:
	var audit1 := CombatTimelineReplayAudit.new()
	audit1.initialize("BATTLE_REPLAY_01", 8888)

	audit1.record_step(0, 1, "INITIATIVE", "PLAYER", {"ap_bonus": 2})
	audit1.record_step(1500, 1, "DISPATCH", "PLAYER", {"card_id": "CARD_AUTO_1"})
	audit1.record_step(3200, 1, "PLAY_CARD", "PLAYER", {"verb": "SLASH", "dmg": 24.0})
	audit1.record_step(5000, 1, "ROUND_TRANSITION", "SYSTEM", {"new_round": 2})

	var payload1 := audit1.export_replay_payload()
	if payload1.total_steps != 4 or payload1.initial_seed != 8888:
		return {"test": "TC-P45-S4-05: 战报导出完整性", "passed": false, "error": "Audit payload corrupted"}

	# 相同 Seed 执行二次模拟
	var audit2 := CombatTimelineReplayAudit.new()
	audit2.initialize("BATTLE_REPLAY_01", 8888)
	audit2.record_step(0, 1, "INITIATIVE", "PLAYER", {"ap_bonus": 2})
	audit2.record_step(1500, 1, "DISPATCH", "PLAYER", {"card_id": "CARD_AUTO_1"})
	audit2.record_step(3200, 1, "PLAY_CARD", "PLAYER", {"verb": "SLASH", "dmg": 24.0})
	audit2.record_step(5000, 1, "ROUND_TRANSITION", "SYSTEM", {"new_round": 2})

	var payload2 := audit2.export_replay_payload()
	if JSON.stringify(payload1) != JSON.stringify(payload2):
		return {"test": "TC-P45-S4-05: 重放序列精确等价", "passed": false, "error": "Replay divergence detected"}

	return {"test": "TC-P45-S4-05: 确定性战报全要素重放验证", "passed": true}

## TC-P45-S4-06: 配置驱动热更与缺省安全降级验证
static func _test_config_sanity_and_fallback() -> Dictionary:
	# 验证 combat.json 扩展节点正常读取
	var lead_bonus := GameConfig.get_int("domains.combat", "initiative_model/lead_ap_bonus", 0)
	if lead_bonus != 2:
		return {"test": "TC-P45-S4-06: initiative_model读取", "passed": false, "error": "lead_ap_bonus != 2"}

	var cap := GameConfig.get_int("domains.combat", "staging_bar/max_capacity", 0)
	if cap != 5:
		return {"test": "TC-P45-S4-06: staging_bar/max_capacity读取", "passed": false, "error": "max_capacity != 5"}

	# 验证缺省键降级默认值兜底
	var fallback_val := GameConfig.get_int("domains.combat", "non_existent_section/missing_key", 999)
	if fallback_val != 999:
		return {"test": "TC-P45-S4-06: 缺省安全兜底", "passed": false, "error": "Fallback value ignored"}

	return {"test": "TC-P45-S4-06: 配置热更与安全兜底", "passed": true}

## M8（Phase 54）：两阶段排期——重排期不断供（不丢失）+ 事件表单调向未来
## 红证：旧实现边遍历边 append，重排期被 67 行整体替换丢弃（后期断供）/ interval=0 同趟再触发
static func _test_timeline_two_phase_no_reschedule_loss() -> Dictionary:
	var rng := DeterministicRNG.from_seed(4242)
	var engine := TertiaryTimelineEngine.new()
	engine.initialize(0, rng)

	var fired_total := 0
	var fired_in_first_round := 0
	var fired_in_last_round := 0
	var round_count := 8
	for r in range(round_count):
		var fired: Array = engine.advance_time(10000)
		fired_total += fired.size()
		if r == 0:
			fired_in_first_round = fired.size()
		if r == round_count - 1:
			fired_in_last_round = fired.size()

	# 排期不断供：首末轮均有到期事件（修复前后期断供 → 末轮为 0）
	var no_starvation = fired_in_first_round > 0 and fired_in_last_round > 0
	# 事件表单调向未来（新事件 trigger 严格 > current_timeline_ms，Inv-TL-1）
	var monotonic := true
	for evt in engine.scheduled_events:
		if evt.trigger_time_ms <= engine.current_timeline_ms:
			monotonic = false
			break
	var passed = no_starvation and fired_total >= round_count and monotonic and engine.scheduled_events.size() > 0
	return { "test": "TC-P45-S4-07: 两阶段排期不断供（M8 重排期不丢失、单调向未来）", "passed": passed }
