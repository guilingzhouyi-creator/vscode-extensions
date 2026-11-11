# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 服务依赖注入容器
# 文件路径: res://frontend/domain_boundary/mocks/mock_service_container.gd
# 职责: 注册与解析前端服务实例，屏蔽底层服务实现是 Mock 还是未来真实后端
# ==============================================================================
class_name MockServiceContainer
extends ServiceContainer

const MockEscMenuService = preload("res://frontend/domain_boundary/mocks/mock_esc_menu_service.gd")

static var _instance: MockServiceContainer
static func get_instance() -> MockServiceContainer:
	if _instance == null:
		_instance = MockServiceContainer.new()
		_instance._init_default_services()
	return _instance

## R-26：重置单例（测试 teardown / 用例隔离用）——清空已注册服务后置空单例引用
static func reset_instance() -> void:
	if _instance != null:
		_instance._services.clear()
	_instance = null


## 初始化默认 Mock 服务套件
func _init_default_services() -> void:
	register_service("auth", MockAuthService.new())
	register_service("world", MockWorldService.new())
	register_service("character", MockCharacterService.new())
	register_service("esc_menu", MockEscMenuService.new())
	_register_shared_mock_services()
