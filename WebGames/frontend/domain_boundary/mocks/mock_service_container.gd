# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_service_container.gd
# 架构定位: Domain Boundary Service Container (Mock Implementation)
# 依赖与触发: 上游: ServiceLocator, 单元测试套件 | 下游: 全套 Mock*Service 实现
# 职责说明: 注册与解析全套前端模拟服务实例，屏蔽底层实现差异以支持无后端离线运转与单测隔离。
# 退出语义与设计依据: 依赖注入容器单源装配与测试单例重置清理契约
## MockServiceContainer：前端全套模拟服务的依赖注入容器单例
class_name MockServiceContainer
extends ServiceContainer

const MockEscMenuService = preload("res://frontend/domain_boundary/mocks/mock_esc_menu_service.gd")
const MockPrologueService = preload("res://frontend/domain_boundary/mocks/mock_prologue_service.gd")
const MockHudSyncService = preload("res://frontend/domain_boundary/mocks/mock_hud_sync_service.gd")
const MockLifecycleService = preload("res://frontend/domain_boundary/mocks/mock_lifecycle_service.gd")
const MockGameSettingsService = preload("res://frontend/domain_boundary/mocks/mock_game_settings_service.gd")

static var _instance: MockServiceContainer

## 获取并惰性装配模拟服务容器全局单例
static func get_instance() -> MockServiceContainer:
	if _instance == null:
		_instance = MockServiceContainer.new()
		_instance._init_default_services()
	return _instance

## 重置容器单例：清空已注册服务并置空单例引用，保障测试 teardown 与用例状态隔离
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
	register_service("prologue", MockPrologueService.new())
	register_service("hud_sync", MockHudSyncService.new())
	register_service("lifecycle", MockLifecycleService.new())
	register_service("game_settings", MockGameSettingsService.new())
	_register_shared_mock_services()
