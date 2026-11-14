# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_version_service.gd
# 架构定位: Domain Boundary Mock / Simulated Version Handshake Service
# 依赖与触发: 上游: AppBootstrap, MockServiceContainer | 下游: MockBaseService
# 职责说明: 模拟客户端版本兼容性握手与更新检测（对齐版本灰度分群体系），经 MockBaseService 模拟延迟。
# 退出语义与设计依据: 启动阶段版本握手模拟隔离契约
# ==============================================================================

## MockVersionService：客户端版本握手与更新检测模拟服务
class_name MockVersionService
extends IVersionService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

## 模拟异步检测客户端版本号兼容性与热更新需求
func check_version_async(callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"client_version": "0.4.9",
		"latest_version": "0.4.9",
		"compatible": true,
		"update_required": false
	}, simulate_delay_ms)
