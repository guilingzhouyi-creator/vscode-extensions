# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_schema_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: .kalar_save 数据架构、前后端命令与事件包契约。 版本号/命令类型/事件类型默认值由 config/persistence.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name KalarSaveSchema extends RefCounted

var save_format_version: String = GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
var signature_hash_sha256: String = ""
var player_profile: Dictionary = {}
var inventory_data: Dictionary = {}
var world_clock_data: Dictionary = {}
var towns_data: Dictionary = {}
var authored_books: Array = []

## 序列化存档架构为字典（版本/签名/全分区载荷）
func serialize() -> Dictionary:
	return {
		"save_format_version": save_format_version,
		"signature_hash_sha256": signature_hash_sha256,
		"player_profile": player_profile,
		"inventory_data": inventory_data,
		"world_clock_data": world_clock_data,
		"towns_data": towns_data,
		"authored_books": authored_books
	}

class ClientCommandPacket extends RefCounted:
	var command_id: String = ""
	var sequence_number: int = 0
	var command_type: String = GameConfig.get_string("infrastructure.persistence", "command_defaults/command_type", "EXECUTE_COMBAT_ACTION")
	var payload: Dictionary = {}
	var client_timestamp: int = 0

class ServerEventPacket extends RefCounted:
	var server_frame_tick: int = 0
	var acknowledged_sequence_number: int = 0
	var event_type: String = GameConfig.get_string("infrastructure.persistence", "event_defaults/event_type", "STATE_UPDATE")
	var authoritative_state: Dictionary = {}
