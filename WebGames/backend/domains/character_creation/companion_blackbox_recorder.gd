# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/companion_blackbox_recorder.gd
# 架构定位: Domain Diagnostics / Blackbox Dump Provider
# 依赖与触发: 上游: AgentPlaythroughSession, WorldGateway | 下游: CompanionObserverBus | 配置: 无 | 信号: 无
# 职责说明: 伴侣推演黑匣子现场转储器；在推演发生异常、死路挂起或规则冲突时，即时抽取伴侣观察总线事件尾部轨迹与当前角色快照，组装标准诊断转储字典 (Diagnostic Dump)，供现场复盘与自动化审计。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CompanionBlackboxRecorder：Domain Diagnostics / Blackbox Dump Provider
class_name CompanionBlackboxRecorder
extends RefCounted

const DEFAULT_TAIL_LIMIT: int = 16

# ==============================================================================
# 一、现场诊断转储核心入口
# ==============================================================================

## 创建结构化现场诊断转储字典
static func create_diagnostic_dump(
	error_code: String,
	failing_pack_id: String,
	failing_node_id: String,
	context_payload: Dictionary = {}
) -> Dictionary:
	var now_timestamp_utc: int = int(Time.get_unix_time_from_system())
	var bus := CompanionObserverBus.get_instance()
	var event_tail: Array[Dictionary] = []
	if bus != null:
		event_tail = bus.get_recent_events(DEFAULT_TAIL_LIMIT)

	var character_snapshot: Dictionary = _extract_character_snapshot(context_payload)
	var sanitized_code: String = error_code if not error_code.is_empty() else "UNKNOWN"
	var dump_id: String = "dump_%d_%s" % [now_timestamp_utc, sanitized_code]

	return {
		"dump_id": dump_id,
		"timestamp": now_timestamp_utc,
		"error_code": error_code,
		"failing_pack_id": failing_pack_id,
		"failing_node_id": failing_node_id,
		"recent_event_tail": event_tail,
		"character_snapshot": character_snapshot,
		"context_data": context_payload.duplicate(true)
	}

# ==============================================================================
# 二、数据提取辅助方法 (CC <= 5, Depth <= 2)
# ==============================================================================

static func _extract_character_snapshot(context_payload: Dictionary) -> Dictionary:
	if context_payload.is_empty():
		return {}

	if context_payload.has("character_snapshot"):
		var snapshot_value: Variant = context_payload.get("character_snapshot")
		if snapshot_value is Dictionary:
			return (snapshot_value as Dictionary).duplicate(true)

	if context_payload.has("profile"):
		var profile_value: Variant = context_payload.get("profile")
		if profile_value is CharacterProfile:
			return (profile_value as CharacterProfile).serialize()
		if profile_value is Dictionary:
			return (profile_value as Dictionary).duplicate(true)

	return {}
