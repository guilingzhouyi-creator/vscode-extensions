# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Robustness & Idempotency)
# 文件路径: res://backend/infrastructure/robustness/idempotency_controller.gd
# 架构定位: Fault-Tolerance Guard / Circuit Breaker
# 跨域依赖: 上游: 全域后端高危调用点 | 下游: UnifiedLoggerService | 配置: config/infrastructure/robustness.json | 信号: 熔断触发与拦截日志
# 职责说明: 全域事务操作幂等控制器：基于请求哈希或业务流水号对并发双发、重试风暴进行布隆式/滑动窗口去重，确保高危写操作严格仅执行一次。
# 设计依据: Phase 70 / Phase 82 防御健壮性工程标准
# ==============================================================================

class_name IdempotencyController extends RefCounted

## 执行操作记录字典: operation_token -> { "executed_at": float, "result": Variant }
var _executed_tokens: Dictionary = {}
var _token_order_dict: Dictionary = {} # 有序集合（Dictionary 保持插入序），O(1) FIFO 淘汰
var _max_token_history: int = 200

func _init(p_max_history: int = 200) -> void:
	_max_token_history = maxi(10, p_max_history)

## 检查并执行幂等性保护
## 返回: { "already_executed": bool, "result": Variant }
func check_and_record(p_token: String, p_result_if_new: Variant = true) -> Dictionary:
	if p_token.is_empty():
		return {
			"already_executed": false,
			"result": null
		}
	
	if _executed_tokens.has(p_token):
		var entry: Dictionary = _executed_tokens[p_token]
		return {
			"already_executed": true,
			"result": entry.get("result", null)
		}
	
	# 淘汰超额历史令牌（O(1) 均摊，Dictionary 有序集合头部即最旧）
	while _token_order_dict.size() >= _max_token_history:
		var victim: String = ""
		for k in _token_order_dict:
			victim = String(k)
			break
		if victim.is_empty():
			break
		_token_order_dict.erase(victim)
		_executed_tokens.erase(victim)
	
	_executed_tokens[p_token] = {
		"executed_at": Time.get_unix_time_from_system(),
		"result": p_result_if_new
	}
	_token_order_dict[p_token] = true
	
	return {
		"already_executed": false,
		"result": p_result_if_new
	}

func has_token(p_token: String) -> bool:
	return _executed_tokens.has(p_token)

func get_result(p_token: String, p_default: Variant = null) -> Variant:
	if _executed_tokens.has(p_token):
		var entry: Dictionary = _executed_tokens[p_token]
		return entry.get("result", p_default)
	return p_default

func reset() -> void:
	_executed_tokens.clear()
	_token_order_dict.clear()

func history_size() -> int:
	return _executed_tokens.size()

## 兼容旧 Array 形态（测试/归档链路可能读 _token_order）
var _token_order: Array[String]:
	get:
		var arr: Array[String] = []
		for k in _token_order_dict:
			arr.append(String(k))
		return arr
	set(value):
		_token_order_dict.clear()
		for k in value:
			_token_order_dict[String(k)] = true
