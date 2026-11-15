# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_service_container.gd
# 架构定位: Service Container Implementation / Real Backend Adapter
# 依赖与触发: 上游: ServiceLocator | 下游: Real*Service 全域真实适配器集合
# 职责说明: 生产级真实服务依赖注入容器。完整装配 21 项真实后端协议与配置驱动适配器服务，
#           实现全领域零共享模拟容器回退。
# 退出语义与设计依据: 业务领域第一性原理 / 依赖倒置 / 全领域真实服务贯通
# ==============================================================================

## RealServiceContainer：全领域装配真实后端协议与配置适配器的生产级服务容器
class_name RealServiceContainer
extends ServiceContainer

const RealAuthService = preload("res://frontend/domain_boundary/services/real_auth_service.gd")
const RealWorldService = preload("res://frontend/domain_boundary/services/real_world_service.gd")
const RealCharacterService = preload("res://frontend/domain_boundary/services/real_character_service.gd")
const RealEscMenuService = preload("res://frontend/domain_boundary/services/real_esc_menu_service.gd")
const RealPrologueService = preload("res://frontend/domain_boundary/services/real_prologue_service.gd")
const RealHudSyncService = preload("res://frontend/domain_boundary/services/real_hud_sync_service.gd")
const RealLifecycleService = preload("res://frontend/domain_boundary/services/real_lifecycle_service.gd")
const RealGameSettingsService = preload("res://frontend/domain_boundary/services/real_game_settings_service.gd")
const RealVersionService = preload("res://frontend/domain_boundary/services/real_version_service.gd")
const RealCombatService = preload("res://frontend/domain_boundary/services/real_combat_service.gd")
const RealChatCommandService = preload("res://frontend/domain_boundary/services/real_chat_command_service.gd")
const RealCraftingService = preload("res://frontend/domain_boundary/services/real_crafting_service.gd")
const RealEconomyService = preload("res://frontend/domain_boundary/services/real_economy_service.gd")
const RealGachaService = preload("res://frontend/domain_boundary/services/real_gacha_service.gd")
const RealGrimoireService = preload("res://frontend/domain_boundary/services/real_grimoire_service.gd")
const RealGuildService = preload("res://frontend/domain_boundary/services/real_guild_service.gd")
const RealMailService = preload("res://frontend/domain_boundary/services/real_mail_service.gd")
const RealMiscEdgeService = preload("res://frontend/domain_boundary/services/real_misc_edge_service.gd")
const RealQuestService = preload("res://frontend/domain_boundary/services/real_quest_service.gd")
const RealSaveService = preload("res://frontend/domain_boundary/services/real_save_service.gd")
const RealSnapshotDataService = preload("res://frontend/domain_boundary/services/real_snapshot_data_service.gd")

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

## 初始化默认服务套件：全领域 21 项服务均由真实后端或配置适配器提供实现
func _init_default_services() -> void:
    register_service("auth", RealAuthService.new())
    register_service("world", RealWorldService.new())
    register_service("character", RealCharacterService.new())
    register_service("esc_menu", RealEscMenuService.new())
    register_service("prologue", RealPrologueService.new())
    register_service("hud_sync", RealHudSyncService.new())
    register_service("lifecycle", RealLifecycleService.new())
    register_service("game_settings", RealGameSettingsService.new())
    register_service("version", RealVersionService.new())
    register_service("combat", RealCombatService.new())
    register_service("chat_command", RealChatCommandService.new())
    register_service("crafting", RealCraftingService.new())
    register_service("economy", RealEconomyService.new())
    register_service("gacha", RealGachaService.new())
    register_service("grimoire", RealGrimoireService.new())
    register_service("guild", RealGuildService.new())
    register_service("mail", RealMailService.new())
    register_service("misc_edge", RealMiscEdgeService.new())
    register_service("quest", RealQuestService.new())
    register_service("save", RealSaveService.new())
    register_service("snapshot_data", RealSnapshotDataService.new())
