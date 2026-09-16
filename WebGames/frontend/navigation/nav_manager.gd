# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端导航层: 现代化分层导航器
# 文件路径: res://frontend/navigation/nav_manager.gd
# 职责: 管理全屏 Screen 栈、模态 Modal 队列、全局 Toast 调度与视口生命周期
# ==============================================================================
class_name NavManager
extends Node

static var _instance: NavManager
static func get_instance() -> NavManager:
	if _instance == null:
		_instance = NavManager.new()
		_instance.name = "NavManager"
		_instance._init_default_registry()
	return _instance

var _app_root: AppRoot
var _screen_stack: Array[String] = []
var _current_screen: Control = null
var _screen_registry: Dictionary = {}
var _scene_cache: Dictionary = {}

## 场景缓存最大条目（R-07：防随注册表扩张无界增长；超限按插入序 FIFO 逐出）
const MAX_SCENE_CACHE_ENTRIES: int = 24

## 默认注册 17 个功能视图（R-28：注释计数与实现对齐）
func _init_default_registry() -> void:
	register_screen("account_entry", "res://frontend/views/account_entry/account_entry_view.tscn")
	register_screen("main_hud", "res://frontend/views/main_hud/main_hud_view.tscn")
	register_screen("character_progression", "res://frontend/views/character_progression/character_progression_view.tscn")
	register_screen("combat_view", "res://frontend/views/combat_view/combat_view.tscn")
	register_screen("economy_trade", "res://frontend/views/economy_trade/economy_trade_view.tscn")
	register_screen("gacha_wish", "res://frontend/views/gacha_wish/gacha_wish_view.tscn")
	register_screen("quest_causality", "res://frontend/views/quest_causality/quest_causality_view.tscn")
	register_screen("mail_system", "res://frontend/views/mail_system/mail_system_view.tscn")
	register_screen("guild_social", "res://frontend/views/guild_social/guild_social_view.tscn")
	register_screen("world_map", "res://frontend/views/world_map/world_map_view.tscn")
	register_screen("monster_ecology", "res://frontend/views/monster_ecology/monster_ecology_view.tscn")
	register_screen("crafting_workshop", "res://frontend/views/crafting_workshop/crafting_workshop_view.tscn")
	register_screen("grimoire_authoring", "res://frontend/views/grimoire_authoring/grimoire_authoring_view.tscn")
	register_screen("notification_bulletin", "res://frontend/views/notification_bulletin/notification_bulletin_view.tscn")
	register_screen("settings_center", "res://frontend/views/settings_center/settings_center_view.tscn")
	register_screen("system_save", "res://frontend/views/system_save/system_save_view.tscn")
	register_screen("misc_edge", "res://frontend/views/misc_edge/misc_edge_view.tscn")

## 绑定根视口宿主
func bind_root(root: AppRoot) -> void:
	_app_root = root

## 注册 Screen 路径
func register_screen(screen_id: String, scene_path: String) -> void:
	_screen_registry[screen_id] = scene_path
	# 场景缓存失效：路径更新后重载新场景
	_scene_cache.erase(screen_id)

## 查询 Screen 是否已注册（供 ViewRouter 等外部安全访问注册表）
func has_screen(screen_id: String) -> bool:
	return _screen_registry.has(screen_id)

## 压入新 Screen (保留历史栈)
func push_screen(screen_id: String, params: Dictionary = {}) -> Control:
	return _navigate_to(screen_id, params, true)

## 替换当前 Screen (不追加历史深度)
func replace_screen(screen_id: String, params: Dictionary = {}) -> Control:
	var prev_depth := _screen_stack.size()
	var result := _navigate_to(screen_id, params, true)
	# R-05：仅跳转成功且存在被替换项时才抹去旧栈顶，失败路径栈长度不变
	if result != null and prev_depth > 0:
		_screen_stack.remove_at(prev_depth - 1)
	return result

## 弹出并返回上一 Screen
func pop_screen() -> Control:
	if _screen_stack.size() <= 1:
		printerr("[NavManager] 已经是栈底，无法继续返回")
		return null
	var prev_id: String = _screen_stack[_screen_stack.size() - 2]
	var result := _navigate_to(prev_id, {}, false)
	# R-06：目标解析/跳转成功后才真正出栈，失败不回退栈深
	if result != null:
		_screen_stack.pop_back()
	return result

## 核心跳转与生命周期驱动
## 顺序契约：先加载/实例化成功，再校验可挂载，最后销毁旧屏——失败路径不破坏栈/屏一致性
func _navigate_to(screen_id: String, params: Dictionary, record_history: bool) -> Control:
	if not _screen_registry.has(screen_id):
		printerr("[NavManager] 未注册的 Screen: %s" % screen_id)
		return null

	# 1. 先解析场景（缓存命中优先；失败即返回，旧屏不受影响）
	var scene_path: String = _screen_registry[screen_id]
	var scene: PackedScene = _scene_cache.get(screen_id)
	if scene == null:
		scene = load(scene_path) as PackedScene
		if scene == null:
			printerr("[NavManager] 场景加载失败: %s" % scene_path)
			return null
		_cache_scene(screen_id, scene)

	var inst := scene.instantiate() as Control
	if inst == null:
		printerr("[NavManager] 场景根节点不是 Control: %s" % scene_path)
		return null

	# 2. 挂载前置校验（R-04：宿主无效则不入栈、不销毁旧屏，杜绝孤儿节点 + 栈/场景不一致）
	if _app_root == null or _app_root.screen_container == null:
		printerr("[NavManager] 宿主未绑定, 拒绝跳转以保持栈/场景一致: %s" % screen_id)
		inst.queue_free()
		return null

	# 3. 再销毁旧屏（退出钩子 + 延迟释放）
	if _current_screen != null:
		if _current_screen.has_method("on_screen_exit"):
			_current_screen.call("on_screen_exit")
		_current_screen.queue_free()
		_current_screen = null

	_current_screen = inst
	_app_root.screen_container.add_child(inst)
	inst.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	# 4. 挂载成功后才写栈，保证栈与场景树恒自洽
	if record_history:
		_screen_stack.append(screen_id)

	if inst.has_method("on_screen_enter"):
		inst.call("on_screen_enter", params)

	return inst

## R-07：写入场景缓存并按插入序 FIFO 逐出，保证缓存条目有界（≤ MAX_SCENE_CACHE_ENTRIES）
func _cache_scene(screen_id: String, scene: PackedScene) -> void:
	if not _scene_cache.has(screen_id) and _scene_cache.size() >= MAX_SCENE_CACHE_ENTRIES:
		var oldest_key: String = _scene_cache.keys()[0]
		_scene_cache.erase(oldest_key)
	_scene_cache[screen_id] = scene

## 派发全局 Toast 轻提示
func show_toast(message: String, level: int = NavTypes.ToastLevel.INFO, duration_sec: float = 2.0) -> void:
	if _app_root != null and _app_root.toast_layer != null:
		_app_root.toast_layer.show_toast(message, level, duration_sec)
	else:
		print("[Toast] ", message)

## 显示全屏 Loading 遮罩
func show_loading(hint: String = "载入中...") -> void:
	if _app_root != null and _app_root.loading_overlay != null:
		_app_root.loading_overlay.show_loading(hint)

## 隐藏全屏 Loading 遮罩
func hide_loading() -> void:
	if _app_root != null and _app_root.loading_overlay != null:
		_app_root.loading_overlay.hide_loading()

## 获取当前活跃 Screen 实例
func get_current_screen() -> Control:
	return _current_screen

## 获取当前 Screen 栈深度
func get_stack_depth() -> int:
	return _screen_stack.size()
