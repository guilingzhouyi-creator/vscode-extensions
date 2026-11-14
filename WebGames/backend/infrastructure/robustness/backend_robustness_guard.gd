# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Robustness & Idempotency)
# 文件路径: res://backend/infrastructure/robustness/backend_robustness_guard.gd
# 架构定位: Fault-Tolerance Guard / Circuit Breaker
# 依赖与触发: 上游: 全域后端高危调用点 | 下游: UnifiedLoggerService | 配置: config/infrastructure/robustness.json | 信号: 熔断触发与拦截日志
# 职责说明: 后端高可用与防御健壮性护栏：提供除零防御钳制、浮点 NaN/INF 消毒清洗、递归深度监控与死循环自动熔断回滚保护。
# 退出语义与设计依据: 业务领域第一性原理与防御健壮性工程契约
# ==============================================================================

## BackendRobustnessGuard：Fault-Tolerance Guard / Circuit Breaker
class_name BackendRobustnessGuard extends RefCounted

## 错误分类标准枚举
enum FaultSeverity {
	RECOVERABLE = 0,    # 可恢复业务微瑕
	BUSINESS_REJECT = 1,# 业务合法性拒绝（如余额不足、条件不满足）
	CONFIG_ERROR = 2,   # 配置表缺漏或格式不匹配
	SYSTEM_FATAL = 3    # 底层系统崩溃或严重不一致
}

## 安全整数清洗（防御越界、负数、null 与非法字符串类型）
static func sanitize_int(raw_value: Variant, min_value: int, max_value: int, default_value: int) -> int:
	if raw_value == null:
		return default_value
	if not (raw_value is int or raw_value is float or raw_value is String):
		return default_value

	var sanitized_number: int = 0
	if raw_value is String:
		var trimmed_text: String = (raw_value as String).strip_edges()
		if not trimmed_text.is_valid_int():
			return default_value
		sanitized_number = trimmed_text.to_int()
	else:
		sanitized_number = int(raw_value)

	return clampi(sanitized_number, min_value, max_value)

## 安全浮点数清洗（防御 NaN、INF 与超界）
static func sanitize_float(raw_value: Variant, min_value: float, max_value: float, default_value: float) -> float:
	if raw_value == null:
		return default_value
	if not (raw_value is float or raw_value is int or raw_value is String):
		return default_value

	var sanitized_number: float = 0.0
	if raw_value is String:
		var trimmed_text: String = (raw_value as String).strip_edges()
		if not trimmed_text.is_valid_float():
			return default_value
		sanitized_number = trimmed_text.to_float()
	else:
		sanitized_number = float(raw_value)

	# 显式拦截 NaN 与无穷大，避免 clampf 透传异常浮点状态
	if is_nan(sanitized_number) or is_inf(sanitized_number):
		return default_value
	return clampf(sanitized_number, min_value, max_value)

## 安全字符串清洗（防御空与非法转义、前后空格）
static func sanitize_string(raw_value: Variant, default_value: String = "") -> String:
	if raw_value == null:
		return default_value
	return str(raw_value).strip_edges()

## 安全字典清洗（确保非空并提供深拷贝隔离保护）
static func sanitize_dict(raw_value: Variant) -> Dictionary:
	if raw_value == null or not (raw_value is Dictionary):
		return {}
	return (raw_value as Dictionary).duplicate(true)

## 安全数组清洗（提供深拷贝隔离保护与长度上限截断）
static func sanitize_array(raw_value: Variant, max_length: int = -1) -> Array:
	if raw_value == null or not (raw_value is Array):
		return []
	var sanitized_array: Array = (raw_value as Array).duplicate(true)
	if max_length > 0 and sanitized_array.size() > max_length:
		sanitized_array.resize(max_length)
	return sanitized_array

## 错误结构化判定与归类
static func classify_error(error_code: String, context: Dictionary = {}) -> Dictionary:
	var severity: FaultSeverity = FaultSeverity.RECOVERABLE
	if error_code.begins_with("FATAL_") or error_code.begins_with("CRIT_"):
		severity = FaultSeverity.SYSTEM_FATAL
	elif error_code.begins_with("CFG_") or error_code.begins_with("CONFIG_"):
		severity = FaultSeverity.CONFIG_ERROR
	elif error_code.begins_with("REJECT_") or error_code.begins_with("BIZ_"):
		severity = FaultSeverity.BUSINESS_REJECT

	return {
		"code": error_code,
		"severity": severity,
		"is_recoverable": (severity == FaultSeverity.RECOVERABLE or severity == FaultSeverity.BUSINESS_REJECT),
		"context": context
	}
