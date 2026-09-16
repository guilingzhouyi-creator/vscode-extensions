# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 统一测试基类 (TestCase)
# 文件路径: res://tests/support/test_case.gd
# 职责: 为全域测试套件提供标准化生命周期管理、强类型断言器与自动化测试结果打包
# ==============================================================================
class_name TestCase
extends RefCounted

## -----------------------------------------------------------------------------
## 生命周期钩子（派生类按需重写）
## -----------------------------------------------------------------------------
static func setup() -> void:
	pass

static func teardown() -> void:
	pass

## -----------------------------------------------------------------------------
## 核心强类型断言助手
## -----------------------------------------------------------------------------
static func assert_eq(actual, expected, _msg: String = "") -> bool:
	return actual == expected

static func assert_ne(actual, expected, _msg: String = "") -> bool:
	return actual != expected

static func assert_true(condition: bool, _msg: String = "") -> bool:
	return condition == true

static func assert_false(condition: bool, _msg: String = "") -> bool:
	return condition == false

static func assert_null(val, _msg: String = "") -> bool:
	return val == null

static func assert_not_null(val, _msg: String = "") -> bool:
	return val != null

static func assert_gt(val, threshold, _msg: String = "") -> bool:
	return val > threshold

static func assert_gte(val, threshold, _msg: String = "") -> bool:
	return val >= threshold

static func assert_lt(val, threshold, _msg: String = "") -> bool:
	return val < threshold

static func assert_lte(val, threshold, _msg: String = "") -> bool:
	return val <= threshold

static func assert_almost_eq(a: float, b: float, epsilon: float = 0.0001, _msg: String = "") -> bool:
	return abs(a - b) <= epsilon

static func assert_has_key(d: Dictionary, key, _msg: String = "") -> bool:
	return d.has(key)

## -----------------------------------------------------------------------------
## 标准用例包装器（消除 105 处重复的 Dictionary 组装样板）
## -----------------------------------------------------------------------------
static func make_result(test_name: String, passed: bool, extra: Dictionary = {}) -> Dictionary:
	var d := { "test": test_name, "passed": passed }
	for k in extra:
		d[k] = extra[k]
	return d

static func pack_results(domain_name: String, results: Array[Dictionary]) -> Dictionary:
	var all_ok := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_ok = false

	return {
		"domain": domain_name,
		"total": results.size(),
		"total_count": results.size(),
		"passed": passed_cnt,
		"passed_count": passed_cnt,
		"all_passed": all_ok,
		"results": results
	}
