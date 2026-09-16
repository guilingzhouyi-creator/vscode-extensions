# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_timeline_replay_audit.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 记录并审计战斗全生命周期中的每一步时间戳、先手判定、发牌时序、出牌校验与 小回合切换动作，输出标准化的确定性重放 Payload，支持服务端无状态回放检验。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatTimelineReplayAudit
extends RefCounted

class StepRecordDTO extends RefCounted:
	var step_index: int = 0
	var timeline_ms: int = 0
	var round_number: int = 1
	var action_type: String = ""             # "INITIATIVE" / "DISPATCH" / "TENSION" / "PLAY_CARD" / "ROUND_TRANSITION"
	var actor_id: String = ""
	var event_data: Dictionary = {}

	## 序列化步骤记录为字典（事件数据深拷贝）
	func to_dto() -> Dictionary:
		return {
			"step_index": step_index,
			"timeline_ms": timeline_ms,
			"round_number": round_number,
			"action_type": action_type,
			"actor_id": actor_id,
			"data": event_data.duplicate(true),
		}

var battle_id: String = ""
var initial_seed: int = 0
var records: Array[StepRecordDTO] = []
var step_counter: int = 0

## 审计器初始化：绑定战斗 ID 与种子并清空记录
func initialize(in_battle_id: String, in_seed: int) -> void:
	battle_id = in_battle_id
	initial_seed = in_seed
	records.clear()
	step_counter = 0

## 记录一步：自增序号 + 时间戳/回合/动作类型/演员/事件数据
func record_step(timeline_ms: int, round_number: int, action_type: String, actor_id: String, event_data: Dictionary) -> void:
	step_counter += 1
	var rec := StepRecordDTO.new()
	rec.step_index = step_counter
	rec.timeline_ms = timeline_ms
	rec.round_number = round_number
	rec.action_type = action_type
	rec.actor_id = actor_id
	rec.event_data = event_data
	records.append(rec)

## 导出确定性重放载荷（战斗 ID/种子/总步数/记录序列）
func export_replay_payload() -> Dictionary:
	var serialized: Array[Dictionary] = []
	for r in records:
		serialized.append(r.to_dto())
	return {
		"battle_id": battle_id,
		"initial_seed": initial_seed,
		"total_steps": records.size(),
		"records": serialized
	}
