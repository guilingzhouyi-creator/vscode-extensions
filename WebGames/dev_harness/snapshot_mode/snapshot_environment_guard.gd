# ==============================================================================
# 模块归属: 测试与工程化工具层 (Dev Harness · 快照测试工程模式)
# 文件路径: res://dev_harness/snapshot_mode/snapshot_environment_guard.gd
# 架构定位: Safety Gate / Environment Sentinel
# 跨域依赖: 上游: SnapshotInjectionSolver | 下游: EventBusCore, OS, Engine
# 职责说明: 提供运行环境安全性硬核守卫，严格判定 Debug 与 Test 模式，生产环境强行熔断
# 设计依据: 业务域第一性原理 / 快照测试工程化规范
# ==============================================================================
class_name SnapshotEnvironmentGuard
extends RefCounted

const ERROR_TEST_MODE_DISABLED: String = "ERR_TEST_MODE_DISABLED"
const ERROR_PRODUCTION_BLOCKED: String = "ERR_PRODUCTION_BLOCKED"

static var _test_override_enabled: bool = false
static var _test_override_value: bool = true

## 是否允许执行快照注入（仅限 Debug 构建、编辑器或自动化测试模式）
static func is_injection_permitted() -> bool:
	if _test_override_enabled:
		return _test_override_value

	# 1. 引擎调试构建标志判定
	if OS.is_debug_build():
		return true

	# 2. 编辑器运行态判定
	if Engine.is_editor_hint():
		return true

	# 3. 自定义特性标签判定
	if OS.has_feature("test") or OS.has_feature("editor"):
		return true

	return false

## 验证并执行安全拦截
static func validate_injection_environment() -> Dictionary:
	if is_injection_permitted():
		return {
			"permitted": true,
			"error_code": "OK",
			"message": "Debug test environment confirmed."
		}

	var err_msg := "快照测试工程模式仅允许在 Debug/Test 模式下运行，生产环境已绝对熔断阻断！"
	EventBusCore.get_instance().emit_log("error", err_msg)
	return {
		"permitted": false,
		"error_code": ERROR_TEST_MODE_DISABLED,
		"message": err_msg
	}

## 仅用于单元测试守卫自身的模拟切换
static func set_test_override(enabled: bool, permitted_value: bool) -> void:
	_test_override_enabled = enabled
	_test_override_value = permitted_value

## 重置测试模拟
static func reset_for_test() -> void:
	_test_override_enabled = false
	_test_override_value = true

