# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Robustness & Idempotency)
# 文件路径: res://backend/infrastructure/robustness/idempotency_controller.gd
# 架构定位: Fault-Tolerance Guard / Circuit Breaker
# 依赖与触发: 上游: 全域后端高危调用点 | 下游: UnifiedLoggerService | 配置: config/infrastructure/robustness.json | 信号: 熔断触发与拦截日志
# 职责说明: 全域事务操作幂等控制器：基于请求哈希或业务流水号对并发双发、重试风暴进行布隆式/滑动窗口去重，确保高危写操作严格仅执行一次。
# 退出语义与设计依据: 防御健壮性工程标准
# ==============================================================================

## IdempotencyController：Fault-Tolerance Guard / Circuit Breaker
class_name IdempotencyController extends RefCounted

## 执行操作记录字典: operation_token -> { "executed_at": float, "result": Variant }
var _executed_tokens: Dictionary = {}
var _token_order_map: Dictionary = {} # 有序集合（Dictionary 保持插入序），O(1) FIFO 淘汰
var _max_token_history: int = 200

func _init(max_history: int = 200) -> void:
	_max_token_history = maxi(10, max_history)

## 检查并执行幂等性保护
## 返回: { "already_executed": bool, "result": Variant }
func check_and_record(operation_token: String, recorded_outcome: Variant = true) -> Dictionary:
	if operation_token.is_empty():
		return {
			"already_executed": false,
			"result": null
		}

	if _executed_tokens.has(operation_token):
		var entry: Dictionary = _executed_tokens[operation_token]
		return {
			"already_executed": true,
			"result": entry.get("result", null)
		}

	# 淘汰超额历史令牌（O(1) 均摊，Dictionary 有序集合头部即最旧）
	_evict_excess_tokens()

	_executed_tokens[operation_token] = {
		"executed_at": Time.get_unix_time_from_system(),
		"result": recorded_outcome
	}
	_token_order_map[operation_token] = true

	return {
		"already_executed": false,
		"result": recorded_outcome
	}

func _evict_single_oldest_token() -> bool:
	for token_key in _token_order_map:
		var victim: String = String(token_key)
		if victim.is_empty():
			return false
		_token_order_map.erase(victim)
		_executed_tokens.erase(victim)
		return true
	return false

func _evict_excess_tokens() -> void:
	while _token_order_map.size() >= _max_token_history:
		if not _evict_single_oldest_token():
			break

## 检查控制器中是否存在指定请求令牌
func has_token(operation_token: String) -> bool:
	if operation_token.is_empty():
		return false
	return _executed_tokens.has(operation_token)

## 获取指定令牌对应的缓存执行结果
func get_result(operation_token: String, default_value: Variant = null) -> Variant:
	if operation_token.is_empty():
		return default_value
	if _executed_tokens.has(operation_token):
		var entry: Dictionary = _executed_tokens[operation_token]
		return entry.get("result", default_value)
	return default_value

## 重置控制器历史记录与内部哈希表
func reset() -> int:
	var count := _executed_tokens.size()
	_executed_tokens.clear()
	_token_order_map.clear()
	return count

## 获取控制器历史记录队列长度
func history_size() -> int:
	return maxi(0, _executed_tokens.size())
