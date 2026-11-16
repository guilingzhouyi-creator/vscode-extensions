# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/deterministic_sandbox/authority_tri_state_machine.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/deterministic.json | 信号: EventBus 领域广播
# 职责说明: 单机/预测/权威三态解耦流转、时序攻击与 AP 透支作弊防御； 脱同步阈值/透支阈值/状态与原因文案由 config/deterministic.json、 config/narratives/deterministic.json 驱动（代码零硬编码）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AuthorityTriStateMachine：Domain FSM / Lifecycle Session Engine
class_name AuthorityTriStateMachine extends RefCounted

# ==============================================================================
# 一、权威模式枚举
# ==============================================================================

## 权威来源三态：决定输入审计与状态回放的裁决方
enum AuthorityMode {
	LOCAL_STANDALONE, # 单机完全权威（本机裁决，无网络校验）
	CLIENT_PREDICTED, # 客户端前瞻预测（先本地表现，待服务器裁决）
	SERVER_AUTHORITATIVE # 服务器最终裁决（联机权威，防作弊）
}

# ==============================================================================
# 二、状态与脱同步阈值（config/deterministic.json 驱动）
# ==============================================================================

## 当前权威模式（初始为单机完全权威）
var current_mode: int = AuthorityMode.LOCAL_STANDALONE
## 最近一次服务器校验通过的服务端 tick（联机对账锚点）
var last_verified_server_tick: int = GameConfig.get_int("domains.deterministic", "authority/last_verified_server_tick", 0)
## 允许的最大脱同步 tick 数（超过即判 DESYNC，防时序作弊）
var max_allowed_desync_ticks: int = GameConfig.get_int("domains.deterministic", "authority/max_allowed_desync_ticks", 5)

# ==============================================================================
# 三、权威模式跃迁与输入审计
# ==============================================================================

## 权威模式跃迁：越界拦截 + 广播模式切换叙事（枚举键名）
## 契约：new_mode 越界返回 false 且不产生副作用；成功则广播确定性/网络叙事。
const AUTHORITY_MODE_NAMES: Array[String] = ["LOCAL_STANDALONE", "CLIENT_PREDICTED", "SERVER_AUTHORITATIVE"]

static var _authority_cache_version: int = -1
static var _cached_ap_overflow_threshold: int = -10
static var _cached_max_desync_ticks: int = 5
static var _cached_status_desync: String = "DESYNC_DETECTED"
static var _cached_reason_desync: String = "Client/server ticks diverged beyond threshold"
static var _cached_status_cheat: String = "CHEAT_DETECTED"
static var _cached_reason_cheat: String = "Action point budget overdraft detected"
static var _cached_status_valid: String = "VERIFIED_VALID"

static func _ensure_authority_cache() -> void:
	var config_version: int = GameConfig.config_reload_version()
	if _authority_cache_version == config_version:
		return
	_authority_cache_version = config_version
	_cached_ap_overflow_threshold = GameConfig.get_int("domains.deterministic", "authority/ap_overflow_threshold", -10)
	_cached_max_desync_ticks = GameConfig.get_int("domains.deterministic", "authority/max_allowed_desync_ticks", 5)
	_cached_status_desync = GameConfig.get_string("domains.deterministic", "authority/status/desync", "DESYNC_DETECTED")
	_cached_reason_desync = GameConfig.get_string("domains.deterministic", "authority/reasons/desync", "Client/server ticks diverged beyond threshold")
	_cached_status_cheat = GameConfig.get_string("domains.deterministic", "authority/status/cheat", "CHEAT_DETECTED")
	_cached_reason_cheat = GameConfig.get_string("domains.deterministic", "authority/reasons/cheat", "Action point budget overdraft detected")
	_cached_status_valid = GameConfig.get_string("domains.deterministic", "authority/status/valid", "VERIFIED_VALID")

## 切换权威模式并在有监听者时广播模式切换叙事
func transition_mode(new_mode: int) -> bool:
	if new_mode < AuthorityMode.LOCAL_STANDALONE or new_mode > AuthorityMode.SERVER_AUTHORITATIVE:
		return false
	var old_mode := current_mode
	current_mode = new_mode
	var event_bus := EventBusCore.get_instance()
	if event_bus.has_channel_listeners(EventChannelDefinition.NARRATIVE_EVENT_TEXT):
		event_bus.emit_narrative_by_key(
			"deterministic/mode_transition", "network",
			[AUTHORITY_MODE_NAMES[old_mode], AUTHORITY_MODE_NAMES[new_mode]]
		)
	return true

## 输入连续性审计：脱同步超阈 / AP 透支（时序作弊）拦截，合法返回 VERIFIED_VALID
## 契约：|client_tick - server_tick| > max_allowed_desync_ticks → DESYNC_DETECTED；
##       current_action_points + command_action_points_cost < 透支阈值 → CHEAT_DETECTED（valid=false）；
##       状态/原因文案键来自 config/deterministic.json 的 authority.status / reasons。
## 性能：常量级判定，无循环与瞬态分配。
func audit_input_continuity(client_tick: int, server_tick: int, command_action_points_cost: int, current_action_points: int) -> Dictionary:
	_ensure_authority_cache()

	var tick_gap: int = absi(client_tick - server_tick)
	if tick_gap > max_allowed_desync_ticks:
		return {
			"status": _cached_status_desync,
			"valid": false,
			"reason": _cached_reason_desync
		}

	# 时序作弊拦截：AP 透支严重且无合法势能（单帧消耗远大于存量）
	if current_action_points + command_action_points_cost < _cached_ap_overflow_threshold:
		return {
			"status": _cached_status_cheat,
			"valid": false,
			"reason": _cached_reason_cheat
		}

	return {"status": _cached_status_valid, "valid": true}
