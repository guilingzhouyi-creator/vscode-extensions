# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/solvers/agent_hud_slice_solver.gd
# 架构定位: Domain Solver / Context Slicing & Telemetry Pipeline
# 依赖与触发: 上游: AuthoritativeHudSnapshotDTO | 下游: AgentHudTelemetryPacketDTO, AgentTelemetryPoolRegistry | 配置: config/domains/world_state/core.json
# 职责说明: 主页 HUD 面向 Agent 的上下文切片求解器与标准遥测数据包原子装箱流水线。
#           执行字段无损映射、归一化比率防零安全钳制、因果差分贯穿计算与原位行动空间填充，彻底阻断循环内堆分配。
# 退出语义与设计依据: 标准数据包原子装箱与深度对象池守恒规范 (Inv-ATOMIC-PACK-PIPELINE-1, Inv-INPLACE-INJECTION-1, ADV-PRF-002)
# ==============================================================================

## AgentHudSliceSolver：Domain Solver / Context Slicing & Telemetry Pipeline
class_name AgentHudSliceSolver
extends RefCounted

const AgentTelemetryPoolRegistry = preload("res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd")
const AgentHudTelemetryPacketDTO = preload("res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd")
const AgentHudContextSliceDTO = preload("res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd")
const AuthoritativeHudSnapshotDTO = preload("res://backend/domains/world_state/dto/authoritative_hud_snapshot_dto.gd")
const HudUiNoticeDTO = preload("res://backend/domains/world_state/dto/hud_ui_notice_dto.gd")
const HomeActionSpaceSolver = preload("res://backend/domains/world_state/solvers/home_action_space_solver.gd")
const HudCausalDeltaSolver = preload("res://backend/domains/world_state/solvers/hud_causal_delta_solver.gd")

## 一站式原子装箱流水线：生成直接交付 LLM 的标准数据包（支持原位复用）
static func assemble_telemetry_packet(
	snapshot: AuthoritativeHudSnapshotDTO,
	prev_slice: AgentHudContextSliceDTO = null,
	sequence_index: int = 1,
	cause: String = "",
	human_interacting: bool = false,
	initiator: String = "SYSTEM_TICK_SIMULATION",
	out_packet: AgentHudTelemetryPacketDTO = null
) -> AgentHudTelemetryPacketDTO:
	var packet: AgentHudTelemetryPacketDTO = out_packet if out_packet != null else AgentTelemetryPoolRegistry.borrow_packet()
	packet.reset_state()

	# 1. 组装信封 (Envelope) 及控制租约 (Control Lease)
	packet.protocol_version = "1.0.0"
	packet.sequence_index = sequence_index
	packet.timestamp_ms = int(Time.get_unix_time_from_system() * 1000.0)
	packet.packet_id = "pkt_home_%d_%04d" % [int(packet.timestamp_ms / 1000), sequence_index]
	packet.domain = "HOME_HUD"
	packet.is_terminal = false
	packet.human_interaction_state = "ACTIVE" if human_interacting else "IDLE"
	packet.agent_control_mode = "READ_ONLY_OBSERVER" if human_interacting else "READ_WRITE"
	packet.active_operator = "HUMAN_PLAYER" if human_interacting else "AGENT"
	packet.is_writable = not human_interacting
	packet.preempted_by_human = human_interacting

	# 2. 组装纯净观测切片 (Observation)
	if packet.observation == null:
		packet.observation = AgentTelemetryPoolRegistry.borrow_slice()
	solve_slice(snapshot, packet.observation)

	# 3. 组装因果差分 (Causal Deltas with Initiator Provenance - 原位注入)
	if prev_slice != null:
		HudCausalDeltaSolver.compute_deltas_into(prev_slice, packet.observation, packet.causal_deltas, cause, initiator)
	else:
		packet.causal_deltas.clear()

	# 4. 组装动态行动空间 (Action Space Directives with Human Preemption Pruning - 原位注入)
	HomeActionSpaceSolver.resolve_action_space_into(snapshot, packet.action_space, human_interacting)

	return packet

## 纯切片求解方法（避免字典 duplicate 瞬态堆分配）
static func solve_slice(
	snapshot: AuthoritativeHudSnapshotDTO,
	out_slice: AgentHudContextSliceDTO = null,
	injected_notices: Array[HudUiNoticeDTO] = []
) -> AgentHudContextSliceDTO:
	var slice: AgentHudContextSliceDTO = out_slice if out_slice != null else AgentTelemetryPoolRegistry.borrow_slice()
	slice.reset_state()

	if snapshot == null:
		return slice

	# 身份标量映射
	slice.account_id = snapshot.account_id
	slice.character_id = snapshot.character_id
	slice.character_name = snapshot.character_name
	slice.race_id = snapshot.race_id
	slice.level = snapshot.level

	# 生理比率安全计算 (下限防零 maxf(1.0, ...) 与 clampf(..., 0.0, 1.0) 闭环)
	slice.hp_current = snapshot.hp_current
	slice.hp_max = snapshot.hp_max
	slice.hp_ratio = clampf(snapshot.hp_current / maxf(1.0, snapshot.hp_max), 0.0, 1.0)

	slice.mp_current = snapshot.mp_current
	slice.mp_max = snapshot.mp_max
	slice.mp_ratio = clampf(snapshot.mp_current / maxf(1.0, snapshot.mp_max), 0.0, 1.0)

	slice.ap_current = snapshot.ap_current
	slice.ap_max = snapshot.ap_max
	slice.ap_ratio = clampf(snapshot.ap_current / maxf(1.0, snapshot.ap_max), 0.0, 1.0)

	# 资产与潜能成长
	slice.wallet_gold = snapshot.wallet_gold
	slice.wallet_mana_monocrystals = snapshot.wallet_mana_monocrystals
	slice.ledger_nonce = snapshot.ledger_nonce
	slice.unallocated_potential_points = snapshot.unallocated_potential_points

	# 原位复制基础属性，杜绝 duplicate(true) 产生新字典
	slice.attribute_values.clear()
	for k in snapshot.attribute_values.keys():
		slice.attribute_values[k] = snapshot.attribute_values[k]
	slice.title_rank_key = snapshot.title_rank_key

	# 环境历法
	if snapshot.calendar_env != null:
		slice.calendar_year = snapshot.calendar_env.calendar_years
		slice.calendar_month = snapshot.calendar_env.calendar_months
		slice.calendar_day = snapshot.calendar_env.calendar_days
		slice.day_phase_key = snapshot.calendar_env.day_phase_key

	# 任务追踪
	if snapshot.quest_tracker != null and not snapshot.quest_tracker.tracked_quest_id.is_empty():
		slice.active_quest_id = snapshot.quest_tracker.tracked_quest_id
		slice.active_quest_target_count = snapshot.quest_tracker.target_count
		slice.active_quest_current_count = snapshot.quest_tracker.current_count
		slice.is_quest_completable = snapshot.quest_tracker.is_completable

	# 运行模式与社交
	if snapshot.mode_features != null:
		slice.game_mode = "MULTIPLAYER" if snapshot.mode_features.game_mode == 1 else "SINGLE_PLAYER"
		slice.is_multiplayer_ready = snapshot.mode_features.party_matchmaking_enabled
	slice.unread_mail_count = snapshot.unread_mail_count

	# UI 公告与活动引导去表现化提取 (Inv-UI-FEED-STRUCTURAL-PURITY-9)
	if snapshot.ops_bulletin_brief != null and not snapshot.ops_bulletin_brief.is_empty():
		var notice := HudUiNoticeDTO.new()
		notice.notice_id = str(snapshot.ops_bulletin_brief.get("notice_id", "bulletin_announcement"))
		notice.category = "ANNOUNCEMENT"
		notice.priority = 1
		notice.message_text = str(snapshot.ops_bulletin_brief.get("title", ""))
		notice.actions = ["DISMISS_UI_NOTICE"]
		slice.ui_notices.append(notice)

	# 合并外部注入的结构化通知
	for extra_notice in injected_notices:
		if extra_notice != null:
			slice.ui_notices.append(extra_notice)

	return slice
