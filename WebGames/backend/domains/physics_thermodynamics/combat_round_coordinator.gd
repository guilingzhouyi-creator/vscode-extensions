# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_round_coordinator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 协调玩家操作轴、小回合轴与第三时间轴的三轴联动，判定小回合终点， 支持回合开局预排期离散事件与 0 手牌持续推演保活，防止时间轴中断。 配置由 config/domains/combat.json round_lifecycle 驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatRoundCoordinator
extends RefCounted

class CombatRoundCoordinatorSnapshotDTO extends RefCounted:
	var round_number: int = 1
	var round_start_timeline_ms: int = 0
	var round_duration_ms: int = 0
	var active_mover_id: String = ""
	var is_round_concluded: bool = false
	var conclude_reason: String = ""           # "HAND_EXHAUSTED" / "AP_DEPLETED" / "TIME_LIMIT" / "TENSION_INTERRUPT"
	var timeline_state: Dictionary = {}
	var player_staging_state: Dictionary = {}
	var enemy_staging_state: Dictionary = {}

	## 序列化快照为字典（嵌套状态深拷贝）
	func to_dto() -> Dictionary:
		return {
			"round_number": round_number,
			"round_start_timeline_ms": round_start_timeline_ms,
			"round_duration_ms": round_duration_ms,
			"active_mover_id": active_mover_id,
			"is_round_concluded": is_round_concluded,
			"conclude_reason": conclude_reason,
			"timeline": timeline_state.duplicate(true),
			"player_staging": player_staging_state.duplicate(true),
			"enemy_staging": enemy_staging_state.duplicate(true),
		}

## 引擎事件源必填化：默认内部空转引擎（零调度事件，语义等价旧 null 场景）
var timeline_engine: TertiaryTimelineEngine = TertiaryTimelineEngine.new()
var player_staging: ActionCardStagingBar = null
var enemy_staging: ActionCardStagingBar = null
var current_round: int = 1
var round_elapsed_ms: int = 0
var round_start_timeline_ms: int = 0
var max_round_ms: int = 10000
var rng: DeterministicRNG = null

# Phase 65 扩展：离散预排期计划与脱敏历史
var current_schedule: TimelineEventScheduleDTO = null
var resolved_client_events: Array[Dictionary] = []
## 自动发牌自增序号（与 timeline_engine.event_counter 解耦——该计数器只在引擎排期新事件时递增，
## 不随抽牌递增；P2 修复：同一步 ADD_DRAW 循环/多事件并发/无引擎模式下保证每次发放 ID 唯一。
## B2 修复：序号在战斗实例内单调递增、不随回合复位——跨轮卡牌（end_of_round_policy=KEEP）
## 不再出现 CARD_AUTO_N 重复，引用唯一性跨轮成立）
var _card_id_seq: int = 0
## 回合结算可观察状态（P2 修复：切轮会立即归零计时，结算标志先落盘供表现层快照读取）
var is_round_concluded_state: bool = false
var last_round_end_reason: String = ""

## 三轴编排器初始化：绑定时间轴/双方待发栏/RNG，重置回合计数并读回合时限配置
func initialize(
	in_engine: TertiaryTimelineEngine,
	in_player_staging: ActionCardStagingBar,
	in_enemy_staging: ActionCardStagingBar,
	in_rng: DeterministicRNG
) -> void:
	timeline_engine = in_engine
	player_staging = in_player_staging
	enemy_staging = in_enemy_staging
	rng = in_rng
	current_round = 1
	round_elapsed_ms = 0
	round_start_timeline_ms = in_engine.current_timeline_ms if in_engine else 0
	max_round_ms = GameConfig.get_int("domains.combat", "round_lifecycle/max_round_duration_ms", 10000)
	current_schedule = null
	resolved_client_events.clear()
	_card_id_seq = 0
	is_round_concluded_state = false
	last_round_end_reason = ""

## Phase 65 扩展：装配单回合开局离散事件预排期
func set_round_schedule(schedule: TimelineEventScheduleDTO) -> void:
	current_schedule = schedule
	resolved_client_events.clear()
	# 新回合装配排期：复位结算观察态（发牌序号保持单调递增，B2 修复：跨轮 ID 不重复）
	is_round_concluded_state = false
	last_round_end_reason = ""

## 步进协调：时间推进 -> 派发事件 -> 待发栏入队 -> 回合结束条件判定
func step_coordinator(
	delta_ms: int,
	player_participant: CombatPipelineFSM.CombatParticipant,
	enemy_participant: CombatPipelineFSM.CombatParticipant
) -> Dictionary:
	round_elapsed_ms += delta_ms
	var fired_events: Array = []
	fired_events = timeline_engine.advance_time(delta_ms)

	var processed_events: Array[Dictionary] = []
	var should_end_round := false
	var end_reason := ""

	# 1. 处理 timeline_engine 事件（空转引擎=零调度事件，语义等价旧 null）
	for evt in fired_events:
		if evt.event_type == TertiaryTimelineEngine.TimelineEventType.RANDOM_DISPATCH:
			var drawn_card := _draw_random_card_from_pool()
			var queue_res: Dictionary = player_staging.enqueue_card(drawn_card) if player_staging else {}
			processed_events.append({
				"event_id": evt.event_id,
				"type": "CARD_DISPATCHED",
				"time_ms": evt.trigger_time_ms,
				"queue_res": queue_res
			})
			resolved_client_events.append({
				"kind": "NORMAL_DRAW",
				"drawn": 1,
				"public_message": "战场节拍触发：补充了行动手牌"
			})
		elif evt.event_type == TertiaryTimelineEngine.TimelineEventType.TENSION_PULSE:
			var t_type: String = evt.payload.get("tension_type", "PRESSURE_SURGE")
			processed_events.append({
				"event_id": evt.event_id,
				"type": "TENSION_APPLIED",
				"tension_type": t_type,
				"time_ms": evt.trigger_time_ms
			})
			resolved_client_events.append({
				"kind": "TENSION_PULSE",
				"tension_type": t_type,
				"public_message": "战场紧张度突变"
			})
			if t_type == "FORCE_ROUND_ADVANCE":
				should_end_round = true
				end_reason = "TENSION_FORCE_ADVANCE"

	# 2. 处理 Phase 65 单回合开局预排期离散事件（hand_cap 循环外一次读取，回合内常量）
	var hand_cap := GameConfig.get_int("domains.combat", "round_hand/hand_cap", 5)
	if current_schedule != null:
		for pt in current_schedule.scheduled_points:
			if not pt.is_executed and pt.trigger_time_ms <= round_elapsed_ms:
				pt.is_executed = true
				if pt.event_kind == TimelineEventScheduleDTO.EventKind.NORMAL_DRAW:
					var drawn_card := _draw_random_card_from_pool()
					var queue_res: Dictionary = player_staging.enqueue_card(drawn_card) if player_staging else {}
					processed_events.append({
						"event_id": pt.point_id,
						"type": "CARD_DISPATCHED",
						"event_kind": "NORMAL_DRAW",
						"queue_res": queue_res
					})
					resolved_client_events.append({
						"kind": "NORMAL_DRAW",
						"drawn": 1,
						"public_message": "战场节拍触发：补充了行动手牌"
					})
				elif pt.event_kind == TimelineEventScheduleDTO.EventKind.ADD_DRAW:
					# B3 修复：bonus_cards 无界钳制——payload 来自外部 DTO，防御性封口到 [0, hand_cap]
					var bonus_cards := clampi(int(pt.payload.get("extra_bonus_cards", 1)), 0, hand_cap)
					for b in range(bonus_cards):
						var bonus_card := _draw_random_card_from_pool()
						if player_staging:
							player_staging.enqueue_card(bonus_card)
					processed_events.append({
						"event_id": pt.point_id,
						"type": "CARD_DISPATCHED",
						"event_kind": "ADD_DRAW",
						"bonus_count": bonus_cards
					})
					resolved_client_events.append({
						"kind": "ADD_DRAW",
						"bonus_count": bonus_cards,
						"drawn": bonus_cards,
						"public_message": "战场增益触发：额外补充加发牌"
					})
				elif pt.event_kind == TimelineEventScheduleDTO.EventKind.TENSION_PULSE:
					var t_type: String = pt.payload.get("tension_type", "PRESSURE_SURGE")
					processed_events.append({
						"event_id": pt.point_id,
						"type": "TENSION_APPLIED",
						"tension_type": t_type
					})
					resolved_client_events.append({
						"kind": "TENSION_PULSE",
						"tension_type": t_type,
						"public_message": "战场紧张度突变"
					})
					if t_type == "FORCE_ROUND_ADVANCE":
						should_end_round = true
						end_reason = "TENSION_FORCE_ADVANCE"

	# 小回合结束条件检查：AP耗尽且无手牌 / 超过最大动次时限 / 紧张点强制打断
	var auto_pass_ap := GameConfig.get_bool("domains.combat", "round_lifecycle/auto_pass_on_ap_exhausted", true)
	var auto_pass_hand := GameConfig.get_bool("domains.combat", "round_lifecycle/auto_pass_on_hand_empty", true)

	if not should_end_round:
		# 核心不变量 Inv-TR-3 / Inv-TR2-4：检查是否仍有未决事件
		var has_pending_events := false
		if current_schedule != null:
			for pt in current_schedule.scheduled_points:
				if not pt.is_executed:
					has_pending_events = true
					break

		if auto_pass_ap and auto_pass_hand:
			var player_has_no_ap := (player_participant != null and player_participant.current_ap <= 0)
			var player_has_no_hand := (player_staging != null and player_staging.cards.is_empty())
			if player_has_no_ap and player_has_no_hand:
				# 若预排期中仍有未决时间轴事件，严禁掐断！时钟持续推进保活
				if not has_pending_events:
					should_end_round = true
					end_reason = "AP_AND_HAND_EXHAUSTED"

		if not should_end_round and round_elapsed_ms >= max_round_ms:
			should_end_round = true
			end_reason = "ROUND_TIME_LIMIT_REACHED"

	var active_round_id := current_round
	var curr_timeline_ms := timeline_engine.current_timeline_ms
	if should_end_round:
		# 结算态先落盘（切轮会归零计时，先记录供表现层快照可观察本次结算）
		is_round_concluded_state = true
		last_round_end_reason = end_reason
		_transition_to_next_round(end_reason)

	return {
		"round": active_round_id,
		"timeline_ms": curr_timeline_ms,
		"round_elapsed_ms": round_elapsed_ms,
		"events_fired": processed_events,
		"round_ended": should_end_round,
		"end_reason": end_reason
	}

## 切轮：回合 +1、计时归零并透传继承当前绝对时间轴（timeline_engine 绝不重初始化）
func _transition_to_next_round(reason: String) -> void:
	current_round += 1
	round_elapsed_ms = 0
	round_start_timeline_ms = timeline_engine.current_timeline_ms
	current_schedule = null
	resolved_client_events.clear()

## 从行动卡池动态发放一张卡（RANDOM_DISPATCH 时间轴事件触发时）
func _draw_random_card_from_pool() -> PhysicalVerbRegistry.CombatActionCardEntity:
	var card := PhysicalVerbRegistry.CombatActionCardEntity.new()
	_card_id_seq += 1
	card.card_id = "CARD_AUTO_%d" % _card_id_seq
	card.card_name = "动态发放行动卡"
	card.verb_type = "SLASH"
	card.ap_cost = -2
	card.base_potency = 20.0
	return card

## 回合协调快照（轮次/计时/时间轴/双方待发栏状态）
func get_snapshot() -> CombatRoundCoordinatorSnapshotDTO:
	var snap := CombatRoundCoordinatorSnapshotDTO.new()
	snap.round_number = current_round
	snap.round_start_timeline_ms = round_start_timeline_ms
	snap.round_duration_ms = round_elapsed_ms
	if timeline_engine:
		snap.timeline_state = {
			"current_timeline_ms": timeline_engine.current_timeline_ms,
			"event_counter": timeline_engine.event_counter,
			"scheduled_count": timeline_engine.scheduled_events.size(),
		}
	if player_staging:
		snap.player_staging_state = player_staging.get_snapshot().to_dto()
	if enemy_staging:
		snap.enemy_staging_state = enemy_staging.get_snapshot().to_dto()
	return snap

## Phase 65 表现层只读脱敏快照（技术上封死未决事件倒计时与未来卡牌预测）
func get_client_snapshot() -> CombatTimelineClientDTO.PresenterSnapshotDTO:
	var snap := CombatTimelineClientDTO.PresenterSnapshotDTO.new()
	snap.round_number = current_round
	snap.progress_ratio = clampf(float(round_elapsed_ms) / float(maxi(1, max_round_ms)), 0.0, 1.0)
	# 读取落盘结算态（而非用已复位的计时重算，P2 修复：切轮归零后仍可观察本次结算）
	snap.is_round_concluded = is_round_concluded_state
	snap.conclude_reason = last_round_end_reason
	snap.current_hand_count = player_staging.cards.size() if player_staging else 0
	snap.is_zero_hand_active = (snap.current_hand_count == 0)
	# 浅拷贝即可：元素为一次性 append、从不修改的小字典（避免表现层每帧双重深拷贝）
	snap.resolved_events = resolved_client_events.duplicate()
	return snap
