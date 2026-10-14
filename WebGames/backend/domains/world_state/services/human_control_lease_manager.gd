# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 人类控制租约管理器)
# 文件路径: res://backend/domains/world_state/services/human_control_lease_manager.gd
# 架构定位: Domain Guard / Concurrency Lease Arbitrator
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: AgentActionExecutionSolver
# 职责说明: 维护人类前台交互租约，提供毫秒级抢占窗口续订、失效判定与防冲突断言
# 退出语义与设计依据: 状态仲裁类；设计依据: 卡拉尔人类前台控制租约抢占防线 (Inv-LEASE-PREEMPTION-1)
# ==============================================================================

## 人类控制租约管理器：维护前台人类操作独占租约，防范 Agent 异步动作竞态
class_name HumanControlLeaseManager
extends RefCounted

const DEFAULT_LEASE_WINDOW_MS: int = 3000

static var _last_human_activity_ms: int = -100000
static var _current_lease_holder: String = ""
static var _active_lease_nonce: int = 0
static var _mock_time_offset_ms: int = 0

## 续订人类前台控制租约
static func renew_human_lease(account_id: String, lease_nonce: int, window_ms: int = DEFAULT_LEASE_WINDOW_MS) -> void:
	_last_human_activity_ms = _get_current_time_ms()
	_current_lease_holder = account_id
	_active_lease_nonce = lease_nonce

## 判定当前是否处于人类控制租约保护期
static func is_lease_active(account_id: String = "") -> bool:
	var now := _get_current_time_ms()
	if now - _last_human_activity_ms > DEFAULT_LEASE_WINDOW_MS:
		return false
	if not account_id.is_empty() and not _current_lease_holder.is_empty():
		return account_id == _current_lease_holder
	return true

## 显式主动释放人类控制租约（例如用户主动闲置或退出世界）
static func release_lease() -> void:
	_last_human_activity_ms = -100000
	_current_lease_holder = ""
	_active_lease_nonce = 0
	_mock_time_offset_ms = 0

## 获取当前控制权租约的动态随机防重放随机数
static func get_active_lease_nonce() -> int:
	return _active_lease_nonce

## 获取当前持有控制权租约的主体标识
static func get_lease_holder() -> String:
	return _current_lease_holder

## 在测试环境下模拟推进租约时钟毫秒数
static func simulate_time_advance_ms(ms: int) -> void:
	_mock_time_offset_ms += ms

static func _get_current_time_ms() -> int:
	return Time.get_ticks_msec() + _mock_time_offset_ms

## 重置测试单例与租约状态机为初始值
static func reset_for_tests() -> void:
	release_lease()

