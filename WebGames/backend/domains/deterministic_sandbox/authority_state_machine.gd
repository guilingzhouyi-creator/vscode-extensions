# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/deterministic_sandbox/authority_state_machine.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/deterministic.json | 信号: EventBus 领域广播
# 职责说明: 单机/预测/权威三态解耦流转、时序攻击与 AP 透支作弊防御； 脱同步阈值/透支阈值/状态与原因文案由 config/deterministic.json、 config/narratives/deterministic.json 驱动（代码零硬编码）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name AuthorityTriStateMachine extends RefCounted

# ==============================================================================
# 一、权威模式枚举
# ==============================================================================

## 权威来源三态：决定输入审计与状态回放的裁决方
enum AuthorityMode {
	LOCAL_STANDALONE,   # 单机完全权威（本机裁决，无网络校验）
	CLIENT_PREDICTED,   # 客户端前瞻预测（先本地表现，待服务器裁决）
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
func transition_mode(new_mode: int) -> bool:
	if new_mode < AuthorityMode.LOCAL_STANDALONE or new_mode > AuthorityMode.SERVER_AUTHORITATIVE:
		return false
	var old_mode = current_mode
	current_mode = new_mode
	var keys := AuthorityMode.keys()
	EventBusCore.get_instance().emit_narrative_by_key(
		"deterministic/mode_transition", "network",
		[keys[old_mode], keys[new_mode]]
	)
	return true

## 输入连续性审计：脱同步超阈 / AP 透支（时序作弊）拦截，合法返回 VERIFIED_VALID
## 契约：|client_tick - server_tick| > max_allowed_desync_ticks → DESYNC_DETECTED；
##       current_ap + command_ap_cost < 透支阈值 → CHEAT_DETECTED（valid=false）；
##       状态/原因文案键来自 config/deterministic.json 的 authority.status / reasons。
## 性能：常量级判定，无循环与瞬态分配。
func audit_input_continuity(client_tick: int, server_tick: int, command_ap_cost: int, current_ap: int) -> Dictionary:
	var ap_overflow_threshold := GameConfig.get_int("domains.deterministic", "authority/ap_overflow_threshold", -10)

	var tick_gap = abs(client_tick - server_tick)
	if tick_gap > max_allowed_desync_ticks:
		return {
			"status": GameConfig.get_string("domains.deterministic", "authority/status/desync", "DESYNC_DETECTED"),
			"valid": false,
			"reason": GameConfig.get_string("domains.deterministic", "authority/reasons/desync", "Tick gap exceeds maximum threshold")
		}

	# 时序作弊拦截：AP 透支严重且无合法势能（单帧消耗远大于存量）
	if current_ap + command_ap_cost < ap_overflow_threshold:
		return {
			"status": GameConfig.get_string("domains.deterministic", "authority/status/cheat", "CHEAT_DETECTED"),
			"valid": false,
			"reason": GameConfig.get_string("domains.deterministic", "authority/reasons/cheat", "AP exhaustion overflow")
		}

	return { "status": GameConfig.get_string("domains.deterministic", "authority/status/valid", "VERIFIED_VALID"), "valid": true }
