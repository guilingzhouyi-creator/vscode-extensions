# ==============================================================================
# 模块归属: 前端测试基础设施 (Tests · Unit · Frontend)
# 文件路径: res://tests/unit/frontend/fe_mount_test_helper.gd
# 架构定位: Test Support Helper / Live SceneTree Mount & Zero-Orphan Teardown
# 依赖与触发: 上游: test_fe_01..17 | 下游: SceneTree, ServiceLocator, NavManager
# 职责说明: 为前端单元测试提供 .tscn 真场景挂载、实时 _ready/@onready 触达与零孤立节点清理工具。
# 退出语义与设计依据: 消除纯 ClassName.new() 脱离场景树盲区并保障 orphan_delta == 0
# ==============================================================================

## FeMountTestHelper：前端 .tscn 真场景挂载与实网模式切换测试辅助器
class_name FeMountTestHelper
extends RefCounted

## 将指定 .tscn 场景装载到活跃 SceneTree 宿主节点并切换服务模式（触发完整 _ready 与 @onready 绑定）
static func mount_scene(scene_path: String, service_mode: String = "real") -> Dictionary:
	var prior_mode := ServiceLocator.get_mode()
	var had_binding_registry := UIBindingRegistry.has_active_instance()
	ServiceLocator.set_mode(service_mode)
	var tree := Engine.get_main_loop() as SceneTree
	var packed: PackedScene = load(scene_path)
	if tree == null or packed == null:
		ServiceLocator.set_mode(prior_mode)
		return {"ok": false, "prior_mode": prior_mode, "had_binding_registry": had_binding_registry, "view": null, "host": null, "tree": tree}
	var host := Control.new()
	host.name = "FeMountTestHost"
	tree.root.add_child(host)
	var view_node: Node = packed.instantiate()
	host.add_child(view_node)
	if not view_node.is_inside_tree():
		_notify_subtree_ready(view_node)
	return {
		"ok": view_node != null and view_node.is_node_ready(),
		"prior_mode": prior_mode,
		"had_binding_registry": had_binding_registry,
		"tree": tree,
		"host": host,
		"view": view_node,
	}

static func _notify_subtree_ready(target_node: Node) -> void:
	if target_node == null:
		return
	for child_node in target_node.get_children():
		if child_node is Node:
			_notify_subtree_ready(child_node as Node)
	if not target_node.is_node_ready():
		target_node.notification(Node.NOTIFICATION_READY)

## 同步卸载测试挂载的 .tscn 场景、重置交互单例并恢复原服务模式（保障孤立节点增量为 0）
static func unmount_scene(mount_handle: Dictionary) -> void:
	var host: Variant = mount_handle.get("host", null)
	var view_node: Variant = mount_handle.get("view", null)
	var tree: Variant = mount_handle.get("tree", null)
	if view_node is Node and is_instance_valid(view_node):
		var view_instance := view_node as Node
		if view_instance.get_parent() != null:
			view_instance.get_parent().remove_child(view_instance)
		view_instance.free()
	if host is Node and is_instance_valid(host):
		var host_node := host as Node
		if tree is SceneTree and host_node.get_parent() == (tree as SceneTree).root:
			(tree as SceneTree).root.remove_child(host_node)
		host_node.free()
	TooltipManager.reset_instance()
	ContextMenuManager.reset_instance()
	DialogManager.reset_instance()
	DrawerManager.reset_instance()
	ModalManager.reset_instance()
	NavManager.reset_instance()
	if not bool(mount_handle.get("had_binding_registry", false)):
		UIBindingRegistry.reset_instance()
	var prior_mode := str(mount_handle.get("prior_mode", "real"))
	ServiceLocator.set_mode(prior_mode)
