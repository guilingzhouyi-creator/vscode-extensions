# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Core)
# 文件路径: res://frontend/domain_boundary/service_locator.gd
# 架构定位: Static Service Locator & Mode Switcher
# 依赖与触发: 上游: AppBootstrap, 视图与测试套件 | 下游: MockServiceContainer, RealServiceContainer, WorldSessionRuntimeService
# 职责说明: 静态服务定位器；读取 frontend.ui.service_mode 配置，在模拟容器与真实后端容器之间统一切换并管理世界网关会话。
# 退出语义与设计依据: WebGames 零逻辑纪律、配置驱动模式切换与领域边界穿透架构
# ==============================================================================

## ServiceLocator：前端领域边界服务定位器与模式切换入口
class_name ServiceLocator
extends RefCounted

const ServiceContainer = preload("res://frontend/domain_boundary/service_container.gd")
const MockServiceContainer = preload("res://frontend/domain_boundary/mocks/mock_service_container.gd")
const RealServiceContainer = preload("res://frontend/domain_boundary/services/real_service_container.gd")
const WorldGatewayFSMClass = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")

## 已解析的服务容器单例（按 service_mode 惰性初始化）
static var _instance: ServiceContainer

## 全局当前激活的网关状态机引用 (WorldGatewayFSM)
static var _active_gateway: RefCounted = null

## 自定义服务模式覆盖（供测试用例或动态环境切换）
static var _custom_mode: String = ""

## 显式指定服务模式（测试隔离或动态切换）
static func set_mode(mode: String) -> void:
	_custom_mode = mode
	_instance = null

## 注册当前活跃的世界网关实例（同步后端会话真源）
static func set_active_gateway(gateway: RefCounted) -> void:
	_active_gateway = gateway
	WorldSessionRuntimeService.bind_gateway(gateway)
	if _instance != null:
		_instance.set_active_gateway(gateway)

## 创建并激活指定账号的世界网关实例（解耦前端视图与后端网关实现）
static func create_and_activate_gateway(account_id: String) -> RefCounted:
	var gateway: RefCounted = WorldGatewayFSMClass.new(account_id)
	if gateway != null and gateway.has_method("enter_gateway"):
		gateway.call("enter_gateway")
	set_active_gateway(gateway)
	WorldSessionRuntimeService.activate_authenticated_session(account_id, "", gateway)
	return gateway

## 获取当前活跃的世界网关实例（单源优先委托至后端会话真源）
static func get_active_gateway() -> RefCounted:
	var runtime_gateway: Variant = WorldSessionRuntimeService.get_gateway()
	if runtime_gateway != null and runtime_gateway is RefCounted:
		return runtime_gateway as RefCounted
	if _active_gateway != null:
		return _active_gateway
	if _instance != null:
		return _instance.get_active_gateway()
	return null

## 清空当前活跃的世界网关实例（同步释放后端会话绑定）
static func clear_active_gateway() -> void:
	_active_gateway = null
	WorldSessionRuntimeService.bind_gateway(null)
	if _instance != null:
		_instance.clear_active_gateway()

## 获取当前服务容器单例（按配置惰性初始化）
static func get_instance() -> ServiceContainer:
	if _instance == null:
		var mode := get_mode()
		match mode:
			"backend", "real":
				_instance = RealServiceContainer.get_instance()
			"mock":
				_instance = MockServiceContainer.get_instance()
			_:
				EventBusCore.get_instance().emit_log(
					"warn",
					TemplateFormatter.format("ServiceLocator: unknown service_mode '{mode}', falling back to mock", {"mode": mode})
				)
				_instance = MockServiceContainer.get_instance()
	return _instance

## 获取当前服务模式（从 custom_mode 覆盖或 frontend.ui.service_mode 配置读取，默认 real）
static func get_mode() -> String:
	if not _custom_mode.is_empty():
		return _custom_mode
	return GameConfig.get_string("frontend.ui", "service_mode", "real")

## 构建并可选回调通知服务不可用失败回执（统一跨视图门面边界守卫）
static func reply_service_unavailable(on_completed: Callable = Callable()) -> Dictionary:
	var unavailable_reply := {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}
	if on_completed.is_valid():
		on_completed.call(unavailable_reply)
	return unavailable_reply

## 重置定位器单例（测试隔离 / teardown 用）——清空已解析的容器引用与激活网关
static func reset() -> void:
	_instance = null
	_active_gateway = null
	_custom_mode = ""
	WorldSessionRuntimeService.bind_gateway(null)
	RealServiceContainer.reset_instance()
	MockServiceContainer.reset_instance()
