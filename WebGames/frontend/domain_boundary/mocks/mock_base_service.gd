# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: Mock 服务共享底座
# 文件路径: res://frontend/domain_boundary/mocks/mock_base_service.gd
# 职责: 提供 Mock 服务统一的"模拟网络延迟"异步回调分发；0ms = 同步立即回调（测试注入）
# ==============================================================================
class_name MockBaseService
extends RefCounted

## 模拟网络延迟（毫秒，默认 200ms——与 Phase 77 阶段3 契约一致）
const DEFAULT_SIMULATE_DELAY_MS: int = 200

## 异步回调分发：
## - delay_ms <= 0 或回调无效 → 同步立即回调（测试/离线上下文）
## - 无 SceneTree 环境（纯脚本上下文）→ 同步立即回调兜底
## - 否则经 SceneTree.create_timer 延迟触发，模拟真实网络往返
static func delayed_call(callback: Callable, result: Dictionary, delay_ms: int = DEFAULT_SIMULATE_DELAY_MS) -> void:
	if delay_ms <= 0 or not callback.is_valid():
		callback.call(result)
		return
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		callback.call(result)
		return
	var cb := func() -> void:
		# R-10：超时回调触发时复查有效性，杜绝定时器期间回调已失效（悬空回调）而崩溃
		if not callback.is_valid():
			return
		callback.call(result)
	tree.create_timer(float(delay_ms) / 1000.0).timeout.connect(cb)