# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_service_container.gd
# 架构定位: Service Container Implementation / Real Backend Adapter
# 依赖与触发: 上游: ServiceLocator | 下游: RealAuthService, Mock Services
# 职责说明: 生产级真实服务依赖注入容器。装配真实后端服务（如 RealAuthService），
#           对于未完成真实后端接入的业务域安全装配对应数据桩，保障系统平稳演进。
# 设计依据: 业务领域第一性原理 / 依赖倒置 / 渐进式贯通
# ==============================================================================

class_name RealServiceContainer
extends ServiceContainer

const RealAuthService = preload("res://frontend/domain_boundary/services/real_auth_service.gd")
const RealWorldService = preload("res://frontend/domain_boundary/services/real_world_service.gd")
const RealCharacterService = preload("res://frontend/domain_boundary/services/real_character_service.gd")
const RealEscMenuService = preload("res://frontend/domain_boundary/services/real_esc_menu_service.gd")
const IEscMenuService = preload("res://frontend/domain_boundary/interfaces/i_esc_menu_service.gd")

static var _instance: ServiceContainer = null

## 获取真实服务容器全局单例
static func get_instance() -> ServiceContainer:
    if _instance == null:
        _instance = new()
        _instance.call("_init_default_services")
    return _instance

## 重置单例（供测试隔离使用）
static func reset_instance() -> void:
    if _instance != null:
        _instance._services.clear()
    _instance = null

## 初始化默认服务套件：auth/world/character/esc_menu 装配真实协议适配器，其余渐进式回退
func _init_default_services() -> void:
    register_service("auth", RealAuthService.new())
    register_service("world", RealWorldService.new())
    register_service("combat", MockCombatService.new())
    register_service("version", MockVersionService.new())
    register_service("gacha", MockGachaService.new())
    register_service("chat_command", MockChatCommandService.new())
    register_service("crafting", MockCraftingService.new())
    register_service("grimoire", MockGrimoireService.new())
    register_service("economy", MockEconomyService.new())
    register_service("character", RealCharacterService.new())
    register_service("quest", MockQuestService.new())
    register_service("guild", MockGuildService.new())
    register_service("save", MockSaveService.new())
    register_service("misc_edge", MockMiscEdgeService.new())
    register_service("mail", MockMailService.new())
    register_service("snapshot_data", MockSnapshotDataService.new())
    register_service("esc_menu", RealEscMenuService.new())

## 强类型便捷访问方法
func auth() -> IAuthService:
    return get_service("auth") as IAuthService

func world() -> IWorldService:
    return get_service("world") as IWorldService

func combat() -> ICombatService:
    return get_service("combat") as ICombatService

func version() -> IVersionService:
    return get_service("version") as IVersionService

func gacha() -> IGachaService:
    return get_service("gacha") as IGachaService

func chat_command() -> IChatCommandService:
    return get_service("chat_command") as IChatCommandService

func crafting() -> ICraftingService:
    return get_service("crafting") as ICraftingService

func grimoire() -> IGrimoireService:
    return get_service("grimoire") as IGrimoireService

func economy() -> IEconomyService:
    return get_service("economy") as IEconomyService

func character() -> ICharacterService:
    return get_service("character") as ICharacterService

func quest() -> IQuestService:
    return get_service("quest") as IQuestService

func guild() -> IGuildService:
    return get_service("guild") as IGuildService

func save() -> ISaveService:
    return get_service("save") as ISaveService

func misc_edge() -> IMiscEdgeService:
    return get_service("misc_edge") as IMiscEdgeService

func mail() -> IMailService:
    return get_service("mail") as IMailService

func snapshot_data() -> ISnapshotDataService:
    return get_service("snapshot_data") as ISnapshotDataService

func esc_menu() -> IEscMenuService:
    return get_service("esc_menu") as IEscMenuService
