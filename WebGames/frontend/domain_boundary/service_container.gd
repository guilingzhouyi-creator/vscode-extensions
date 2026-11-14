# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Core)
# 文件路径: res://frontend/domain_boundary/service_container.gd
# 架构定位: Domain Boundary Service Container Abstract Base
# 依赖与触发: 上游: ServiceLocator, MockServiceContainer, RealServiceContainer | 下游: 全部 I*Service 接口
# 职责说明: 服务依赖注入容器的抽象基类，提供通用服务注册表与全领域强类型便捷访问契约，屏蔽底层模拟或真实后端实现。
# 退出语义与设计依据: WebGames 零逻辑纪律、接口倒置与领域边界穿透架构
## ServiceContainer：前端领域边界服务依赖注入容器抽象基类
class_name ServiceContainer
extends RefCounted

const IPrologueService = preload("res://frontend/domain_boundary/interfaces/i_prologue_service.gd")
const IHudSyncService = preload("res://frontend/domain_boundary/interfaces/i_hud_sync_service.gd")
const ILifecycleService = preload("res://frontend/domain_boundary/interfaces/i_lifecycle_service.gd")
const IGameSettingsService = preload("res://frontend/domain_boundary/interfaces/i_game_settings_service.gd")

# 一、通用服务注册表
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

## 为全部渐进式演进业务域注册共享默认模拟服务（消除 Mock/Real 容器重复装配）
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

# 二、领域强类型便捷访问契约（单源汇聚，Mock/Real 容器直接复用）

## 获取账号认证与角色槽位服务实例
func auth() -> IAuthService:
	return get_service("auth") as IAuthService
## 获取世界网关与主页状态服务实例
func world() -> IWorldService:
	return get_service("world") as IWorldService
## 获取战斗快照与技能施放服务实例
func combat() -> ICombatService:
	return get_service("combat") as ICombatService
## 获取客户端版本与灰度检测服务实例
func version() -> IVersionService:
	return get_service("version") as IVersionService
## 获取抽卡祈愿与保底结算服务实例
func gacha() -> IGachaService:
	return get_service("gacha") as IGachaService
## 获取聊天指令补全服务实例
func chat_command() -> IChatCommandService:
	return get_service("chat_command") as IChatCommandService
## 获取制造工坊强化与分解服务实例
func crafting() -> ICraftingService:
	return get_service("crafting") as ICraftingService
## 获取魔典著书与版税服务实例
func grimoire() -> IGrimoireService:
	return get_service("grimoire") as IGrimoireService
## 获取货币换算与商店交易服务实例
func economy() -> IEconomyService:
	return get_service("economy") as IEconomyService
## 获取角色养成与权威创角服务实例
func character() -> ICharacterService:
	return get_service("character") as ICharacterService
## 获取任务因果状态流转服务实例
func quest() -> IQuestService:
	return get_service("quest") as IQuestService
## 获取公会社交与交易服务实例
func guild() -> IGuildService:
	return get_service("guild") as IGuildService
## 获取系统存档与回放控制服务实例
func save() -> ISaveService:
	return get_service("save") as ISaveService
## 获取突变、拾取与命名费用等边缘服务实例
func misc_edge() -> IMiscEdgeService:
	return get_service("misc_edge") as IMiscEdgeService
## 获取玩家邮箱与附件领取服务实例
func mail() -> IMailService:
	return get_service("mail") as IMailService
## 获取只读域级演示快照数据服务实例
func snapshot_data() -> ISnapshotDataService:
	return get_service("snapshot_data") as ISnapshotDataService
## 获取 ESC 系统菜单状态与存盘退出服务实例
func esc_menu() -> IEscMenuService:
	return get_service("esc_menu") as IEscMenuService
## 获取创角序章剧情演进服务实例
func prologue() -> IPrologueService:
	return get_service("prologue") as IPrologueService
## 获取常驻主页 HUD 权威同步服务实例
func hud_sync() -> IHudSyncService:
	return get_service("hud_sync") as IHudSyncService
## 获取客户端暂停与停机生命周期服务实例
func lifecycle() -> ILifecycleService:
	return get_service("lifecycle") as ILifecycleService
## 获取游戏音画与显示设置服务实例
func game_settings() -> IGameSettingsService:
	return get_service("game_settings") as IGameSettingsService
