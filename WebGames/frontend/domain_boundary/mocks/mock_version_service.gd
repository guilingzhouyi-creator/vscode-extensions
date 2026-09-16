# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟版本服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_version_service.gd
# 职责: 模拟客户端版本健康度与更新检测（对齐 P74 灰度体系），经 MockBaseService 模拟网络延迟
# ==============================================================================
class_name MockVersionService
extends IVersionService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

func check_version_async(callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"client_version": "0.4.9",
		"latest_version": "0.4.9",
		"compatible": true,
		"update_required": false
	}, simulate_delay_ms)