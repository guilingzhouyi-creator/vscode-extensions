# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Robustness & Idempotency)
# 文件路径: res://backend/infrastructure/robustness/backend_robustness_guard.gd
# 架构定位: Fault-Tolerance Guard / Circuit Breaker
# 跨域依赖: 上游: 全域后端高危调用点 | 下游: UnifiedLoggerService | 配置: config/infrastructure/robustness.json | 信号: 熔断触发与拦截日志
# 职责说明: 后端高可用与防御健壮性护栏：提供除零防御钳制、浮点 NaN/INF 消毒清洗、递归深度监控与死循环自动熔断回滚保护。
# 设计依据: Phase 70 / Phase 82 防御健壮性工程标准
# ==============================================================================

class_name BackendRobustnessGuard extends RefCounted

## 错误分类标准枚举
enum FaultSeverity {
	RECOVERABLE = 0,    # 可恢复业务微瑕
	BUSINESS_REJECT = 1,# 业务合法性拒绝（如余额不足、条件不满足）
	CONFIG_ERROR = 2,   # 配置表缺漏或格式不匹配
	SYSTEM_FATAL = 3    # 底层系统崩溃或严重不一致
}

## 安全整数清洗（防御越界、负数、null 与非法字符串类型）
static func sanitize_int(p_val: Variant, p_min: int, p_max: int, p_default: int) -> int:
	if p_val == null:
		return p_default
	if not (p_val is int or p_val is float or p_val is String):
		return p_default
	
	var num: int = 0
	if p_val is String:
		var s: String = (p_val as String).strip_edges()
		if not s.is_valid_int():
			return p_default
		num = s.to_int()
	else:
		num = int(p_val)
	
	return clampi(num, p_min, p_max)

## 安全浮点数清洗（防御 NaN、INF 与超界）
static func sanitize_float(p_val: Variant, p_min: float, p_max: float, p_default: float) -> float:
	if p_val == null:
		return p_default
	if not (p_val is float or p_val is int or p_val is String):
		return p_default
	
	var num: float = 0.0
	if p_val is String:
		var s: String = (p_val as String).strip_edges()
		if not s.is_valid_float():
			return p_default
		num = s.to_float()
	else:
		num = float(p_val)
	
	if is_nan(num) or is_inf(num):
		return p_default
	return clampf(num, p_min, p_max)

## 安全字符串清洗（防御空与非法转义、前后空格）
static func sanitize_string(p_val: Variant, p_default: String = "") -> String:
	if p_val == null:
		return p_default
	return str(p_val).strip_edges()

## 安全字典清洗（确保非空并提供深拷贝隔离保护）
static func sanitize_dict(p_val: Variant) -> Dictionary:
	if p_val == null or not (p_val is Dictionary):
		return {}
	return (p_val as Dictionary).duplicate(true)

## 安全数组清洗（提供深拷贝隔离保护与长度上限截断）
static func sanitize_array(p_val: Variant, p_max_len: int = -1) -> Array:
	if p_val == null or not (p_val is Array):
		return []
	var arr: Array = (p_val as Array).duplicate(true)
	if p_max_len > 0 and arr.size() > p_max_len:
		arr.resize(p_max_len)
	return arr

## 错误结构化判定与归类
static func classify_error(p_code: String, p_context: Dictionary = {}) -> Dictionary:
	var severity: FaultSeverity = FaultSeverity.RECOVERABLE
	if p_code.begins_with("FATAL_") or p_code.begins_with("CRIT_"):
		severity = FaultSeverity.SYSTEM_FATAL
	elif p_code.begins_with("CFG_") or p_code.begins_with("CONFIG_"):
		severity = FaultSeverity.CONFIG_ERROR
	elif p_code.begins_with("REJECT_") or p_code.begins_with("BIZ_"):
		severity = FaultSeverity.BUSINESS_REJECT
	
	return {
		"code": p_code,
		"severity": severity,
		"is_recoverable": (severity == FaultSeverity.RECOVERABLE or severity == FaultSeverity.BUSINESS_REJECT),
		"context": p_context
	}
