# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 服务依赖注入容器
# 文件路径: res://frontend/domain_boundary/mocks/mock_service_container.gd
# 职责: 注册与解析前端服务实例，屏蔽底层服务实现是 Mock 还是未来真实后端
# ==============================================================================
class_name MockServiceContainer
extends RefCounted

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

var _services: Dictionary = {}

## 初始化默认 Mock 服务套件
func _init_default_services() -> void:
	register_service("auth", MockAuthService.new())
	register_service("world", MockWorldService.new())
	register_service("combat", MockCombatService.new())
	register_service("version", MockVersionService.new())
	register_service("gacha", MockGachaService.new())
	register_service("chat_command", MockChatCommandService.new())
	register_service("crafting", MockCraftingService.new())
	register_service("grimoire", MockGrimoireService.new())
	register_service("economy", MockEconomyService.new())
	register_service("character", MockCharacterService.new())
	register_service("quest", MockQuestService.new())
	register_service("guild", MockGuildService.new())
	register_service("save", MockSaveService.new())
	register_service("misc_edge", MockMiscEdgeService.new())
	register_service("mail", MockMailService.new())
	register_service("snapshot_data", MockSnapshotDataService.new())

## 注册服务
func register_service(service_name: String, instance: RefCounted) -> void:
	_services[service_name] = instance

## 获取服务
func get_service(service_name: String) -> RefCounted:
	if not _services.has(service_name):
		printerr("[MockServiceContainer] 未注册的服务: %s" % service_name)
		return null
	return _services[service_name]

## 泛化便捷访问
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
