# ==============================================================================
# 模块归属: 前端国际化渲染层 (Frontend · i18n Binding Registry)
# 文件路径: res://frontend/i18n/ui_binding_registry.gd
# 架构定位: WeakRef Node-to-i18n Binding Registry
# 依赖与触发: 上游: UIIntermediary, BaseScreen | 下游: UITextResolver
# 职责说明: 注册 UI 节点与 i18n 键的参数绑定映射，采用 WeakRef 弱引用与哈希去重索引防止泄漏并支持动态切换语言。
# 退出语义与设计依据: 弱引用防节点泄漏与 O(1) 实例索引去重契约
# ==============================================================================

## UIBindingRegistry：UI 节点与多语言键弱引用绑定注册表
class_name UIBindingRegistry
extends Node

static var _instance: UIBindingRegistry

## 获取 UI 绑定注册表全局单例节点
static func get_instance() -> UIBindingRegistry:
	if _instance == null:
		_instance = UIBindingRegistry.new()
		_instance.name = "UIBindingRegistry"
	return _instance

## 判断静态单例当前是否处于有效激活态（不触发懒加载创建）
static func has_active_instance() -> bool:
	return _instance != null and is_instance_valid(_instance)

## 清理并释放静态注册表单例，供测试 teardown 与环境隔离调用
static func reset_instance() -> void:
	if _instance != null and is_instance_valid(_instance):
		_instance._bindings.clear()
		_instance.free()
	_instance = null

## 绑定记录: [{ ref: WeakRef, key: String, params: Dictionary, type: String }]
var _bindings: Array[Dictionary] = []

## 去重索引: node.get_instance_id() -> _bindings 数组下标
## 消除 bind() 每次线性扫描全部 _bindings 去重导致的 O(N²)，降为均摊 O(1)
var _binding_index: Dictionary = {}

## 注册节点的 i18n 绑定 (使用 weakref 弱引用)
func bind(target_node: Node, i18n_key: String, binding_parameters: Dictionary = {}) -> void:
	if target_node == null or not is_instance_valid(target_node):
		return

	# 通过 instance_id 索引 O(1) 命中既有有效绑定则原地更新，避免 O(n) 线性扫描
	var node_id: int = target_node.get_instance_id()
	if _binding_index.has(node_id):
		var existing_index: int = _binding_index[node_id]
		if existing_index >= 0 and existing_index < _bindings.size() \
				and _bindings[existing_index].ref.get_ref() == target_node:
			_bindings[existing_index].key = i18n_key
			_bindings[existing_index].params = binding_parameters
			return

	_bindings.append({
		"ref": weakref(target_node),
		"key": i18n_key,
		"params": binding_parameters,
		"type": _detect_node_type(target_node)
	})
	_binding_index[node_id] = _bindings.size() - 1

## 解除绑定
func unbind(target_node: Node) -> void:
	for binding_index in range(_bindings.size() - 1, -1, -1):
		var bound_node: Variant = _bindings[binding_index].ref.get_ref()
		if bound_node == null or bound_node == target_node:
			_bindings.remove_at(binding_index)
	_rebuild_binding_index()

## 解除一个视图下的所有绑定
func unbind_view(view_node: Node) -> void:
	for binding_index in range(_bindings.size() - 1, -1, -1):
		var bound_node: Variant = _bindings[binding_index].ref.get_ref()
		if bound_node == null or bound_node == view_node or _is_descendant_of(bound_node, view_node):
			_bindings.remove_at(binding_index)
	_rebuild_binding_index()

## 刷新所有绑定
func refresh_all() -> void:
	var dead_indices: Array[int] = []
	for binding_index in range(_bindings.size()):
		var binding := _bindings[binding_index]
		var bound_node: Variant = binding.ref.get_ref()
		if bound_node == null or not is_instance_valid(bound_node):
			dead_indices.append(binding_index)
			continue

		# UITextResolver.resolve 已内置 PlaceholderFiller 填充，避免二次解析空转
		_apply_text(bound_node, UITextResolver.resolve(binding.key, binding.params), binding.type)

	# 倒序清理失效节点，并重建去重索引以对齐数组下标
	if not dead_indices.is_empty():
		for dead_index_position in range(dead_indices.size() - 1, -1, -1):
			_bindings.remove_at(dead_indices[dead_index_position])
		_rebuild_binding_index()

## 重建去重索引（数组移除后下标整体漂移，统一重建保证索引与数组恒一致）
func _rebuild_binding_index() -> void:
	_binding_index.clear()
	for binding_index in range(_bindings.size()):
		var bound_node: Object = _bindings[binding_index].ref.get_ref()
		if bound_node != null and is_instance_valid(bound_node):
			_binding_index[bound_node.get_instance_id()] = binding_index

func _apply_text(target_node: Node, rendered_text: String, binding_type: String) -> void:
	match binding_type:
		"text":
			if target_node is Label:
				(target_node as Label).text = rendered_text
			elif target_node is RichTextLabel:
				(target_node as RichTextLabel).text = rendered_text
		"button":
			if target_node is Button:
				(target_node as Button).text = rendered_text
		"placeholder":
			if target_node is LineEdit:
				(target_node as LineEdit).placeholder_text = rendered_text

## 返回当前活跃注册的绑定记录总数
func count() -> int:
	return _bindings.size()

## 收集当前所有已绑定节点对应的 i18n 键名列表
func get_all_keys() -> Array:
	var bound_keys: Array = []
	for binding in _bindings:
		bound_keys.append(binding.key)
	return bound_keys

func _detect_node_type(target_node: Node) -> String:
	if target_node is Button:
		return "button"
	elif target_node is LineEdit:
		return "placeholder"
	return "text"

func _is_descendant_of(child_node: Node, parent_node: Node) -> bool:
	if child_node == null or parent_node == null:
		return false
	var ancestor := child_node.get_parent()
	while ancestor != null:
		if ancestor == parent_node:
			return true
		ancestor = ancestor.get_parent()
	return false
