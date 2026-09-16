# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端导航层: 视图路由器 (向后兼容代理)
# 文件路径: res://frontend/navigation/view_router.gd
# 职责: 维持存量 17 个视图调用点的向后兼容性，内部全量透明转发至 NavManager
# ==============================================================================
class_name ViewRouter
extends Node

static var _instance: ViewRouter
static func get_instance() -> ViewRouter:
	if _instance == null:
		_instance = ViewRouter.new()
		_instance.name = "ViewRouter"
	return _instance

var current_view: Control:
	get:
		return NavManager.get_instance().get_current_screen()

var current_view_id: String:
	get:
		var curr = NavManager.get_instance().get_current_screen()
		return curr.name if curr != null else ""

## 设置宿主容器 (兼容旧 API)
func set_host(_container: Control) -> void:
	pass

## 压入新视图 (保留历史，可返回)
func push_view(view_id: String) -> Control:
	return NavManager.get_instance().push_screen(view_id)

## 替换当前视图 (不保留历史)
func replace_view(view_id: String) -> Control:
	return NavManager.get_instance().replace_screen(view_id)

## 返回上一视图
func pop_view() -> Control:
	return NavManager.get_instance().pop_screen()

## 注册新视图
func register_view(view_id: String, scene_path: String) -> void:
	NavManager.get_instance().register_screen(view_id, scene_path)

## 检查视图是否已注册（经 NavManager 公开接口，禁止越权访问私有注册表）
func has_view(view_id: String) -> bool:
	return NavManager.get_instance().has_screen(view_id)

## 占位提示
func push_warning(msg: String) -> void:
	NavManager.get_instance().show_toast(msg, NavTypes.ToastLevel.WARNING)
