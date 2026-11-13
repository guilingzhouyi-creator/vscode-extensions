# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 服务容器抽象基类
# 文件路径: res://frontend/domain_boundary/service_container.gd
# 职责: 服务依赖注入容器的抽象基类。提供通用服务注册表与 17 个领域便捷访问虚方法。
#       Mock 容器（当前）与未来 Real 容器（后端接线）都应继承此类，
#       确保上层调用方面向统一契约，屏蔽底层服务实现来源。
# 设计依据: WebGames 零逻辑纪律与领域边界穿透架构
# ==============================================================================
class_name ServiceContainer
extends RefCounted

# ==============================================================================
# 一、通用服务注册表
# ==============================================================================

## 服务实例注册表: service_name -> RefCounted
var _services: Dictionary = {}

## 当前会话激活的世界网关实例引用
var _active_gateway: RefCounted = null

## 注册当前活跃的世界网关实例
func set_active_gateway(gateway: RefCounted) -> void:
	_active_gateway = gateway

## 获取当前活跃的世界网关实例
func get_active_gateway() -> RefCounted:
	return _active_gateway

## 清空当前活跃的世界网关实例
func clear_active_gateway() -> void:
	_active_gateway = null

## 注册服务实例到通用注册表
func register_service(service_name: String, instance: RefCounted) -> void:
	_services[service_name] = instance

## 按名解析服务实例；未注册时记录告警日志并返回 null
func get_service(service_name: String) -> RefCounted:
	if not _services.has(service_name):
		EventBusCore.get_instance().emit_log(
			"warn",
			TemplateFormatter.format("ServiceContainer: unregistered service {service_name}", {"service_name": service_name})
		)
		return null
	return _services[service_name]

## 为全部渐进式演进业务域注册共享默认数据桩（消除 Mock/Real 容器重复装配）
func _register_shared_mock_services() -> void:
	register_service("combat", MockCombatService.new())
	register_service("version", MockVersionService.new())
	register_service("gacha", MockGachaService.new())
	register_service("chat_command", MockChatCommandService.new())
	register_service("crafting", MockCraftingService.new())
	register_service("grimoire", MockGrimoireService.new())
	register_service("economy", MockEconomyService.new())
	register_service("quest", MockQuestService.new())
	register_service("guild", MockGuildService.new())
	register_service("save", MockSaveService.new())
	register_service("misc_edge", MockMiscEdgeService.new())
	register_service("mail", MockMailService.new())
	register_service("snapshot_data", MockSnapshotDataService.new())

# ==============================================================================
# 二、领域强类型便捷访问契约（单源汇聚，Mock/Real 容器直接复用）
# ==============================================================================

func auth() -> IAuthService: return get_service("auth") as IAuthService
func world() -> IWorldService: return get_service("world") as IWorldService
func combat() -> ICombatService: return get_service("combat") as ICombatService
func version() -> IVersionService: return get_service("version") as IVersionService
func gacha() -> IGachaService: return get_service("gacha") as IGachaService
func chat_command() -> IChatCommandService: return get_service("chat_command") as IChatCommandService
func crafting() -> ICraftingService: return get_service("crafting") as ICraftingService
func grimoire() -> IGrimoireService: return get_service("grimoire") as IGrimoireService
func economy() -> IEconomyService: return get_service("economy") as IEconomyService
func character() -> ICharacterService: return get_service("character") as ICharacterService
func quest() -> IQuestService: return get_service("quest") as IQuestService
func guild() -> IGuildService: return get_service("guild") as IGuildService
func save() -> ISaveService: return get_service("save") as ISaveService
func misc_edge() -> IMiscEdgeService: return get_service("misc_edge") as IMiscEdgeService
func mail() -> IMailService: return get_service("mail") as IMailService
func snapshot_data() -> ISnapshotDataService: return get_service("snapshot_data") as ISnapshotDataService
func esc_menu() -> IEscMenuService: return get_service("esc_menu") as IEscMenuService
