# ==============================================================================
# 卡拉尔世界引擎 - 节点↔i18n Key 绑定注册表 (弱引用管理)
# 文件路径: res://frontend/i18n/ui_binding_registry.gd
# 职责: 注册 UI 节点与 i18n key 的映射关系，采用 WeakRef 弱引用防止内存泄漏
# ==============================================================================
class_name UIBindingRegistry
extends Node

static var _instance: UIBindingRegistry
static func get_instance() -> UIBindingRegistry:
	if _instance == null:
		_instance = UIBindingRegistry.new()
		_instance.name = "UIBindingRegistry"
	return _instance

static func reset_instance() -> void:
	if _instance != null and is_instance_valid(_instance):
		_instance._bindings.clear()
		_instance.free()
	_instance = null

## 绑定记录: [{ ref: WeakRef, key: String, params: Dictionary, type: String }]
var _bindings: Array[Dictionary] = []

## R-13 去重索引: node.get_instance_id() -> _bindings 数组下标
## 消除 bind() 每次线性扫描全部 _bindings 去重导致的 O(N²)，降为 O(N)
var _binding_index: Dictionary = {}

## 注册节点的 i18n 绑定 (使用 weakref 弱引用)
func bind(node: Node, key: String, params: Dictionary = {}) -> void:
	if node == null or not is_instance_valid(node):
		return

	# R-13 去重: 经 instance_id 索引 O(1) 命中既有有效绑定则原地更新，避免 O(n) 线性扫描
	var node_id: int = node.get_instance_id()
	if _binding_index.has(node_id):
		var existing_idx: int = _binding_index[node_id]
		if existing_idx >= 0 and existing_idx < _bindings.size() \
				and _bindings[existing_idx].ref.get_ref() == node:
			_bindings[existing_idx].key = key
			_bindings[existing_idx].params = params
			return

	_bindings.append({
		"ref": weakref(node),
		"key": key,
		"params": params,
		"type": _detect_node_type(node)
	})
	_binding_index[node_id] = _bindings.size() - 1

## 解除绑定
func unbind(node: Node) -> void:
	for i in range(_bindings.size() - 1, -1, -1):
		var target: Variant = _bindings[i].ref.get_ref()
		if target == null or target == node:
			_bindings.remove_at(i)
	_rebuild_binding_index()

## 解除一个视图下的所有绑定
func unbind_view(view_node: Node) -> void:
	for i in range(_bindings.size() - 1, -1, -1):
		var target: Variant = _bindings[i].ref.get_ref()
		if target == null or target == view_node or _is_descendant_of(target, view_node):
			_bindings.remove_at(i)
	_rebuild_binding_index()

## 刷新所有绑定
func refresh_all() -> void:
	var dead_indices: Array[int] = []
	for i in range(_bindings.size()):
		var binding := _bindings[i]
		var node: Variant = binding.ref.get_ref()
		if node == null or not is_instance_valid(node):
			dead_indices.append(i)
			continue

		# R-02 单引擎：UITextResolver.resolve 已内置 PlaceholderFiller 填充，杜绝二次空转
		_apply_text(node, UITextResolver.resolve(binding.key, binding.params), binding.type)

	# 倒序清理失效节点，并重建去重索引以对齐数组下标
	if not dead_indices.is_empty():
		for j in range(dead_indices.size() - 1, -1, -1):
			_bindings.remove_at(dead_indices[j])
		_rebuild_binding_index()

## 重建去重索引（数组移除后下标整体漂移，统一重建保证索引与数组恒一致）
func _rebuild_binding_index() -> void:
	_binding_index.clear()
	for i in range(_bindings.size()):
		var target: Object = _bindings[i].ref.get_ref()
		if target != null and is_instance_valid(target):
			_binding_index[target.get_instance_id()] = i

func _apply_text(node: Node, text_val: String, type_str: String) -> void:
	match type_str:
		"text":
			if node is Label:
				(node as Label).text = text_val
			elif node is RichTextLabel:
				(node as RichTextLabel).text = text_val
		"button":
			if node is Button:
				(node as Button).text = text_val
		"placeholder":
			if node is LineEdit:
				(node as LineEdit).placeholder_text = text_val

func count() -> int:
	return _bindings.size()

func get_all_keys() -> Array:
	var keys: Array = []
	for b in _bindings:
		keys.append(b.key)
	return keys

func _detect_node_type(node: Node) -> String:
	if node is Button:
		return "button"
	elif node is LineEdit:
		return "placeholder"
	return "text"

func _is_descendant_of(child: Node, parent: Node) -> bool:
	if child == null or parent == null:
		return false
	var p := child.get_parent()
	while p != null:
		if p == parent:
			return true
		p = p.get_parent()
	return false
