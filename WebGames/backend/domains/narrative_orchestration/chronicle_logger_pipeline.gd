# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/chronicle_logger_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 记录重大因果大事件、生成确定性事件指纹哈希并构建不可逆世界编年史
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name ChronicleLoggerPipeline
extends RefCounted

class ChronicleEntryDTO extends RefCounted:
	var entry_hash: String
	var event_id: String
	var event_title: String
	var timestamp_utc: int
	var causal_summary: String

	## 编年史条目构造（哈希/事件/时间/因果摘要）
	func _init(p_hash: String, p_id: String, p_title: String, p_time: int, p_summary: String) -> void:
		entry_hash = p_hash
		event_id = p_id
		event_title = p_title
		timestamp_utc = p_time
		causal_summary = p_summary

## 记录重大因果事件：确定性指纹哈希（SHA-256 前 16 位大写）入不可逆编年史
static func log_chronicle_event(
	chronicle_history: Array[ChronicleEntryDTO],
	event: NarrativeEventAggregate,
	timestamp_utc: int,
	summary: String
) -> ChronicleEntryDTO:
	var raw_fingerprint := "%s:%s:%d:%s" % [event.event_id, event.event_title, timestamp_utc, summary]
	var event_hash = raw_fingerprint.sha256_text().substr(0, 16).to_upper()

	var entry := ChronicleEntryDTO.new(event_hash, event.event_id, event.event_title, timestamp_utc, summary)
	chronicle_history.append(entry)
	return entry
