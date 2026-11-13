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

## 释放静态单例与缓存场景资源，避免测试运行器退出时残留 ObjectDB / PackedScene 引用
static func reset_instance() -> void:
	if _instance != null and is_instance_valid(_instance):
		if _instance._active_transition != null and _instance._active_transition.is_valid():
			_instance._active_transition.kill()
		_instance._active_transition = null
		if _instance._transitioning_old_screen != null and is_instance_valid(_instance._transitioning_old_screen):
			_instance._transitioning_old_screen.free()
		_instance._transitioning_old_screen = null
		if _instance._current_screen != null and is_instance_valid(_instance._current_screen):
			_instance._current_screen.free()
		_instance._current_screen = null
		_instance._scene_cache.clear()
		_instance._screen_stack.clear()
		_instance._screen_registry.clear()
		_instance._app_root = null
		_instance.free()
	_instance = null

var _app_root: AppRoot
var _screen_stack: Array[String] = []
var _current_screen: Control = null
var _screen_registry: Dictionary = {}
var _scene_cache: Dictionary = {}

## 当前活跃的转场 Tween（同一时刻仅允许一个转场；新转场启动前先 kill 旧 Tween）
var _active_transition: Tween = null
var _transitioning_old_screen: Control = null

## 场景缓存最大条目（R-07：防随注册表扩张无界增长；超限按插入序 FIFO 逐出）
const MAX_SCENE_CACHE_ENTRIES: int = 24

## 转场动效持续时长（秒）
const TRANSITION_DURATION: float = 0.25

const LOG_LEVEL_WARN: String = "warn"
const METHOD_ON_SCREEN_EXIT: String = "on_screen_exit"

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

## 查询 Screen 是否已注册（供外部安全访问注册表）
func has_screen(screen_id: String) -> bool:
	return _screen_registry.has(screen_id)

## 压入新 Screen (保留历史栈)
func push_screen(screen_id: String, params: Dictionary = {}, transition_type: int = NavTypes.TransitionType.NONE) -> Control:
	return _navigate_to(screen_id, params, true, transition_type)

## 替换当前 Screen (不追加历史深度)
func replace_screen(screen_id: String, params: Dictionary = {}, transition_type: int = NavTypes.TransitionType.NONE) -> Control:
	var prev_depth := _screen_stack.size()
	var result := _navigate_to(screen_id, params, true, transition_type)
	# R-05：仅跳转成功且存在被替换项时才抹去旧栈顶，失败路径栈长度不变
	if result != null and prev_depth > 0:
		_screen_stack.remove_at(prev_depth - 1)
	return result

## 弹出并返回上一 Screen（默认 SLIDE_RIGHT 回退动效）
func pop_screen(transition_type: int = NavTypes.TransitionType.SLIDE_RIGHT) -> Control:
	if _screen_stack.size() <= 1:
		EventBusCore.get_instance().emit_log(LOG_LEVEL_WARN, "NavManager: already at stack bottom, cannot pop")
		return null
	var prev_id: String = _screen_stack[_screen_stack.size() - 2]
	var result := _navigate_to(prev_id, {}, false, transition_type)
	# R-06：目标解析/跳转成功后才真正出栈，失败不回退栈深
	if result != null:
		_screen_stack.pop_back()
	return result

## 核心跳转与生命周期驱动
## 顺序契约：先加载/实例化成功，再校验可挂载，最后销毁旧屏——失败路径不破坏栈/屏一致性
## 转场动效：transition_type != NONE 时旧屏在动效结束后才 queue_free，保证视觉连续性
func _navigate_to(screen_id: String, params: Dictionary, record_history: bool, transition_type: int = NavTypes.TransitionType.NONE) -> Control:
	if not _screen_registry.has(screen_id):
		EventBusCore.get_instance().emit_log(
			LOG_LEVEL_WARN,
			TemplateFormatter.format("NavManager: unregistered screen {screen_id}", {"screen_id": screen_id})
		)
		return null

	# 1. 先解析场景（缓存命中优先；失败即返回，旧屏不受影响）
	var scene_path: String = _screen_registry[screen_id]
	var scene: PackedScene = _scene_cache.get(screen_id)
	if scene == null:
		scene = load(scene_path) as PackedScene
		if scene == null:
			EventBusCore.get_instance().emit_log(
				LOG_LEVEL_WARN,
				TemplateFormatter.format("NavManager: failed to load scene {scene_path}", {"scene_path": scene_path})
			)
			return null
		_cache_scene(screen_id, scene)

	var inst := scene.instantiate() as Control
	if inst == null:
		EventBusCore.get_instance().emit_log(
			LOG_LEVEL_WARN,
			TemplateFormatter.format("NavManager: scene root is not Control {scene_path}", {"scene_path": scene_path})
		)
		return null

	# 2. 挂载前置校验（R-04：宿主无效则不入栈、不销毁旧屏，杜绝孤儿节点 + 栈/场景不一致）
	if _app_root == null or _app_root.screen_container == null:
		EventBusCore.get_instance().emit_log(
			LOG_LEVEL_WARN,
			TemplateFormatter.format("NavManager: host unbound, navigation rejected for {screen_id}", {"screen_id": screen_id})
		)
		inst.queue_free()
		return null

	var old_screen := _current_screen

	# 3. 挂载新屏（旧屏暂保留，转场结束后释放）
	_current_screen = inst
	_app_root.screen_container.add_child(inst)
	inst.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	if transition_type == NavTypes.TransitionType.NONE or old_screen == null:
		_exit_and_free_screen(old_screen)
	else:
		_play_transition(old_screen, inst, transition_type)

	# 4. 挂载成功后才写栈，保证栈与场景树恒自洽
	if record_history:
		_screen_stack.append(screen_id)

	if inst.has_method("on_screen_enter"):
		inst.call("on_screen_enter", params)

	return inst

## 统一触发屏幕退出钩子并安全释放
func _exit_and_free_screen(screen: Control) -> void:
	if screen == null:
		return
	if screen.has_method(METHOD_ON_SCREEN_EXIT):
		screen.call(METHOD_ON_SCREEN_EXIT)
	screen.queue_free()

## 转场动效调度：根据类型派发到具体动效实现，转场结束后自动清理旧屏
func _play_transition(old_screen: Control, new_screen: Control, transition_type: int) -> void:
	# 同一时刻仅允许一个转场；新转场启动前先立即清理上一段未完结的旧屏并 kill 旧 Tween
	if _transitioning_old_screen != null and is_instance_valid(_transitioning_old_screen) and _transitioning_old_screen != old_screen:
		_exit_and_free_screen(_transitioning_old_screen)
	_transitioning_old_screen = null
	if _active_transition != null and _active_transition.is_valid():
		_active_transition.kill()
	_active_transition = _create_tween()

	match transition_type:
		NavTypes.TransitionType.FADE:
			_transitioning_old_screen = old_screen
			_play_fade_transition(old_screen, new_screen)
		NavTypes.TransitionType.SLIDE_LEFT:
			_transitioning_old_screen = old_screen
			_play_slide_transition(old_screen, new_screen, true)
		NavTypes.TransitionType.SLIDE_RIGHT:
			_transitioning_old_screen = old_screen
			_play_slide_transition(old_screen, new_screen, false)
		_:
			_exit_and_free_screen(old_screen)

## 淡入淡出转场：旧屏淡出 + 新屏淡入（交叉淡入淡出）
func _play_fade_transition(old_screen: Control, new_screen: Control) -> void:
	new_screen.modulate.a = 0.0
	_active_transition.set_parallel(true)
	_active_transition.tween_property(new_screen, "modulate:a", 1.0, TRANSITION_DURATION)
	_active_transition.tween_property(old_screen, "modulate:a", 0.0, TRANSITION_DURATION)
	_active_transition.chain().tween_callback(func():
		if _transitioning_old_screen == old_screen:
			_transitioning_old_screen = null
		_exit_and_free_screen(old_screen)
	)

## 滑动转场：旧屏滑出 + 新屏滑入（方向由 slide_left 控制）
func _play_slide_transition(old_screen: Control, new_screen: Control, slide_left: bool) -> void:
	var container_size := _app_root.screen_container.size
	var direction := 1.0 if slide_left else -1.0
	new_screen.position.x = container_size.x * direction
	_active_transition.set_parallel(true)
	_active_transition.tween_property(old_screen, "position:x", -container_size.x * direction, TRANSITION_DURATION)
	_active_transition.tween_property(new_screen, "position:x", 0.0, TRANSITION_DURATION)
	_active_transition.chain().tween_callback(func():
		if _transitioning_old_screen == old_screen:
			_transitioning_old_screen = null
		_exit_and_free_screen(old_screen)
	)

## 创建 Tween（通过 app_root 的场景树，确保 process loop 驱动）
func _create_tween() -> Tween:
	if _app_root != null and _app_root.is_inside_tree():
		return _app_root.create_tween()
	return Tween.new()

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
		EventBusCore.get_instance().emit_log(
			"info",
			TemplateFormatter.format("Toast fallback: {message}", {"message": message})
		)

## 显示全屏 Loading 遮罩
func show_loading(hint: String = "") -> void:
	if _app_root != null and _app_root.loading_overlay != null:
		var effective_hint: String = hint if not hint.is_empty() else UIIntermediary.text("ui.common.loading")
		_app_root.loading_overlay.show_loading(effective_hint)

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
