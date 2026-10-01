# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 服务定位器
# 文件路径: res://frontend/domain_boundary/service_locator.gd
# 职责: 静态服务定位器。读取 frontend.ui.service_mode 配置，
#       在 Mock 容器与未来 Real 容器之间切换，为上层提供统一的服务容器获取入口。
#       上层通过 ServiceLocator.get_instance() 获取容器，无需关心当前是 Mock 还是后端实现。
# 设计依据: WebGames 零逻辑纪律与领域边界穿透架构
# ==============================================================================
class_name ServiceLocator
extends RefCounted

const ServiceContainer = preload("res://frontend/domain_boundary/service_container.gd")
const MockServiceContainer = preload("res://frontend/domain_boundary/mocks/mock_service_container.gd")

## 已解析的服务容器单例（按 service_mode 惰性初始化）
static var _instance: ServiceContainer

## 获取当前服务容器单例（按配置惰性初始化）
static func get_instance() -> ServiceContainer:
	if _instance == null:
		var mode := get_mode()
		match mode:
			"mock":
				_instance = MockServiceContainer.get_instance()
			# 当 mode == "backend" 时未来返回 RealServiceContainer.get_instance()（当前不实现）
			# "backend":
			#	 _instance = RealServiceContainer.get_instance()
			_:
				printerr("[ServiceLocator] 未知的 service_mode: %s，回落到 mock" % mode)
				_instance = MockServiceContainer.get_instance()
	return _instance

## 获取当前服务模式（从 frontend.ui.service_mode 配置读取，默认 mock）
static func get_mode() -> String:
	return GameConfig.get_string("frontend.ui", "service_mode", "mock")

## 重置定位器单例（测试隔离 / teardown 用）——清空已解析的容器引用
static func reset() -> void:
	_instance = null
