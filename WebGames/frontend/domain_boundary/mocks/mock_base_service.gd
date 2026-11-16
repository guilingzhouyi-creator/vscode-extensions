# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_base_service.gd
# 架构定位: Domain Boundary Mock / Shared Async Delay & Envelope Helper
# 依赖与触发: 上游: 各 Mock*Service 模拟服务 | 下游: SceneTree Timer
# 职责说明: 提供模拟服务统一的延迟异步回调分发与标准 Result 信封构造；0ms 时同步立即回调。
# 退出语义与设计依据: 无头环境同步安全回退与悬空回调有效性保护契约
# ==============================================================================

## MockBaseService：模拟服务共享延迟分发与标准响应构造基类
class_name MockBaseService
extends RefCounted

## 模拟网络往返延迟基线（毫秒，默认 200ms）
const DEFAULT_SIMULATE_DELAY_MS: int = 200

## 异步回调分发：
## - delay_ms <= 0 或回调无效 → 同步立即回调（测试/离线上下文）
## - 无 SceneTree 环境（纯脚本上下文）→ 同步立即安全回退
## - 否则经 SceneTree.create_timer 延迟触发，模拟真实网络往返
static func delayed_call(result_callback: Callable, operation_result: Dictionary, delay_milliseconds: int = DEFAULT_SIMULATE_DELAY_MS) -> void:
	if delay_milliseconds <= 0 or not result_callback.is_valid():
		result_callback.call(operation_result)
		return
	var scene_tree := Engine.get_main_loop() as SceneTree
	if scene_tree == null:
		result_callback.call(operation_result)
		return
	var callback_wrapper := func() -> void:
		# 超时回调触发时复查有效性，防止定时器等待期间接收方已释放导致悬空调用崩溃
		if not result_callback.is_valid():
			return
		result_callback.call(operation_result)
	scene_tree.create_timer(float(delay_milliseconds) / 1000.0).timeout.connect(callback_wrapper)

## 统一构造成功响应字典（浅拷贝注入附加数据，消除各服务重复样板）
static func reply_success(extra_payload: Dictionary = {}) -> Dictionary:
	var service_response: Dictionary = { "success": true }
	for field_key in extra_payload.keys():
		service_response[field_key] = extra_payload[field_key]
	return service_response

## 统一构造错误响应字典（标准化 error_code 与 message）
static func reply_error(error_code: String, error_message: String, extra_payload: Dictionary = {}) -> Dictionary:
	var service_response: Dictionary = {
		"success": false,
		"error_code": error_code,
		"message": error_message
	}
	for field_key in extra_payload.keys():
		service_response[field_key] = extra_payload[field_key]
	return service_response
