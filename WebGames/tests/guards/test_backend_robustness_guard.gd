# ==============================================================================
# 单元测试：Phase 69 后端鲁棒性与异常隔离 (Backend Robustness Guard)
# 文件路径: res://tests/guards/test_backend_robustness_guard.gd
# 职责: 验证脏数据清洗、极值截断、异常分类与深拷贝防污染（TC-RM-21 ~ TC-RM-28）
# ==============================================================================
class_name TestBackendRobustnessGuard extends RefCounted

const BackendRobustnessGuard = preload("res://backend/infrastructure/robustness/backend_robustness_guard.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_sanitize_int_negative())
	results.append(test_sanitize_int_overflow())
	results.append(test_sanitize_int_invalid_types())
	results.append(test_sanitize_string_edges())
	results.append(test_sanitize_dict_deep_copy())
	results.append(test_sanitize_array_deep_copy())
	results.append(test_sanitize_array_large_collection())
	results.append(test_error_classification())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "Phase 69: 后端鲁棒性与异常隔离",
		"all_passed": all_passed,
		"results": results
	}

## TC-RM-21: 整型极值与负数截断清洗
static func test_sanitize_int_negative() -> Dictionary:
	var cleaned: int = BackendRobustnessGuard.sanitize_int(-999, 0, 100, 0)
	var passed: bool = (cleaned == 0)
	return {
		"test": "TC-RM-21: 负数越界输入安全截断至合法下限",
		"passed": passed,
		"detail": "cleaned=%d" % cleaned
	}

## TC-RM-22: 整型极大值溢出防护
static func test_sanitize_int_overflow() -> Dictionary:
	var cleaned: int = BackendRobustnessGuard.sanitize_int(9999999, 0, 1000, 1000)
	var passed: bool = (cleaned == 1000)
	return {
		"test": "TC-RM-22: 极大值溢出输入安全截断至合法上限",
		"passed": passed,
		"detail": "cleaned=%d" % cleaned
	}

## TC-RM-23: null 与非法类型整数清洗
static func test_sanitize_int_invalid_types() -> Dictionary:
	var c_null: int = BackendRobustnessGuard.sanitize_int(null, 0, 100, 42)
	var c_bad_str: int = BackendRobustnessGuard.sanitize_int("not_a_number", 0, 100, 42)
	var c_array: int = BackendRobustnessGuard.sanitize_int([1, 2], 0, 100, 42)
	var c_valid_str: int = BackendRobustnessGuard.sanitize_int("55", 0, 100, 42)
	
	var passed: bool = (c_null == 42) and (c_bad_str == 42) and (c_array == 42) and (c_valid_str == 55)
	return {
		"test": "TC-RM-23: null 与非数值畸形输入安全回退默认值",
		"passed": passed,
		"detail": "null=%d, bad_str=%d, arr=%d, valid_str=%d" % [c_null, c_bad_str, c_array, c_valid_str]
	}

## TC-RM-24: 字符串空值与前后空格清洗
static func test_sanitize_string_edges() -> Dictionary:
	var s_raw: String = "   valid_name_with_spaces   "
	var s_clean: String = BackendRobustnessGuard.sanitize_string(s_raw, "default")
	var s_null: String = BackendRobustnessGuard.sanitize_string(null, "fallback")
	
	var passed: bool = (s_clean == "valid_name_with_spaces") and (s_null == "fallback")
	return {
		"test": "TC-RM-24: 字符串前后无效空白剥离与 null 安全替换",
		"passed": passed,
		"detail": "clean='%s', null='%s'" % [s_clean, s_null]
	}

## TC-RM-25: 字典深拷贝与防污染隔离
static func test_sanitize_dict_deep_copy() -> Dictionary:
	var original: Dictionary = {
		"config": {"nested_key": 100},
		"items": [1, 2, 3]
	}
	var sanitized: Dictionary = BackendRobustnessGuard.sanitize_dict(original)
	
	# 修改清洗副本，验证原字典未受任何污染
	var sub_cfg: Dictionary = sanitized["config"]
	sub_cfg["nested_key"] = 999
	
	var orig_sub: Dictionary = original["config"]
	var passed: bool = (int(orig_sub["nested_key"]) == 100) and (int(sub_cfg["nested_key"]) == 999)
	return {
		"test": "TC-RM-25: 字典入参深拷贝防并发修改污染",
		"passed": passed,
		"detail": "original=%d, sanitized=%d" % [int(orig_sub["nested_key"]), int(sub_cfg["nested_key"])]
	}

## TC-RM-26: 数组深拷贝与防污染隔离
static func test_sanitize_array_deep_copy() -> Dictionary:
	var original: Array = ["item_a", "item_b"]
	var sanitized: Array = BackendRobustnessGuard.sanitize_array(original)
	sanitized.append("item_c")
	
	var passed: bool = (original.size() == 2) and (sanitized.size() == 3)
	return {
		"test": "TC-RM-26: 数组入参深拷贝防并发修改污染",
		"passed": passed,
		"detail": "orig_size=%d, sanitized_size=%d" % [original.size(), sanitized.size()]
	}

## TC-RM-27: 超大集合压力截断测试
static func test_sanitize_array_large_collection() -> Dictionary:
	var large_arr: Array = []
	for i in range(1000):
		large_arr.append(i)
	
	var truncated: Array = BackendRobustnessGuard.sanitize_array(large_arr, 100)
	var passed: bool = (truncated.size() == 100) and (int(truncated[0]) == 0) and (int(truncated[99]) == 99)
	return {
		"test": "TC-RM-27: 超大集合入参压力防护与安全最大长度截断",
		"passed": passed,
		"detail": "orig=%d, truncated=%d" % [large_arr.size(), truncated.size()]
	}

## TC-RM-28: 异常分级分类确定性测试
static func test_error_classification() -> Dictionary:
	var e_fatal: Dictionary = BackendRobustnessGuard.classify_error("FATAL_MEMORY_CORRUPT")
	var e_biz: Dictionary = BackendRobustnessGuard.classify_error("BIZ_INSUFFICIENT_FUNDS")
	var e_cfg: Dictionary = BackendRobustnessGuard.classify_error("CFG_TABLE_MISSING")
	var e_rec: Dictionary = BackendRobustnessGuard.classify_error("RETRY_TIMEOUT")
	
	var p1: bool = (int(e_fatal.get("severity", -1)) == BackendRobustnessGuard.FaultSeverity.SYSTEM_FATAL) and (not bool(e_fatal.get("is_recoverable", true)))
	var p2: bool = (int(e_biz.get("severity", -1)) == BackendRobustnessGuard.FaultSeverity.BUSINESS_REJECT) and bool(e_biz.get("is_recoverable", false))
	var p3: bool = (int(e_cfg.get("severity", -1)) == BackendRobustnessGuard.FaultSeverity.CONFIG_ERROR)
	var p4: bool = (int(e_rec.get("severity", -1)) == BackendRobustnessGuard.FaultSeverity.RECOVERABLE) and bool(e_rec.get("is_recoverable", false))
	
	var passed: bool = p1 and p2 and p3 and p4
	return {
		"test": "TC-RM-28: 错误事件确定性分级与可恢复性判定",
		"passed": passed,
		"detail": "fatal_ok=%s, biz_ok=%s, cfg_ok=%s, rec_ok=%s" % [p1, p2, p3, p4]
	}
