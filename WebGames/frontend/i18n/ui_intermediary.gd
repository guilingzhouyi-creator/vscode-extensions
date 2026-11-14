# ==============================================================================
# 模块归属: 前端国际化渲染层 (Frontend · i18n UI Intermediary Mediator)
# 文件路径: res://frontend/i18n/ui_intermediary.gd
# 架构定位: UI Localization & Visual Adaptation Facade
# 依赖与触发: 上游: Frontend Views, BaseScreen, 通用组件 | 下游: UITextResolver, VisualAdapter, UIBindingRegistry
# 职责说明: 统一编排翻译、占位符填充、视觉自适应缩放与弱引用绑定注册，作为业务数据与 UI 节点的标准适配中枢。
# 退出语义与设计依据: 单引擎参数填充与退出阶段免重建短路契约
# ==============================================================================

## UIIntermediary：前端 i18n 文本解析、适配与节点绑定统一门面
class_name UIIntermediary
extends RefCounted

## 单例
static var _instance: UIIntermediary
static func get_instance() -> UIIntermediary:
	if _instance == null:
		_instance = UIIntermediary.new()
	return _instance

## ==============================================================================
## 核心入口: resolve
## 将 i18n key + 业务数据 解析为最终文本, 注入 UI 节点
## ==============================================================================

## 单节点注入
## node: 要注入文本的 UI 节点 (Label/Button/LineEdit/RichTextLabel)
## key: i18n key (如 "ui.fe01.splash.logo")
## data: 业务数据字典 (如 {"amount": 5000, "name": "阿尔托莉雅"})
## 返回: 填充后的最终文本
static func resolve(node: Node, key: String, data: Dictionary = {}) -> String:
	var filled := UITextResolver.resolve(key, data)

	# 3. 注入 UI 节点
	_inject_text(node, filled)

	# 4. 视觉适配
	VisualAdapter.adapt_label(node, filled)

	# 5. 注册绑定（语言切换时自动刷新）
	var registry := UIBindingRegistry.get_instance()
	registry.bind(node, key, data)

	return filled

## 批量注入
## bindings: [{ "node": Node, "key": String, "data": Dictionary }, ...]
static func resolve_batch(bindings: Array) -> void:
	var empty_data: Dictionary = {}
	for binding in bindings:
		resolve(binding.node, binding.key, binding.get("data", empty_data))

## 仅翻译+填充, 不注入节点（用于动态生成文本, 如 ItemList 项）
static func text(key: String, data: Dictionary = {}) -> String:
	return UITextResolver.resolve(key, data)

## 翻译+填充+绑定, 但延迟注入（用于 TabContainer 标题等需要时机的场景）
static func resolve_deferred(node: Node, key: String, data: Dictionary = {}) -> String:
	var filled := UITextResolver.resolve(key, data)
	var registry := UIBindingRegistry.get_instance()
	registry.bind(node, key, data)
	return filled

## Tab 标题注入
static func resolve_tab(container: TabContainer, tab_index: int, key: String, data: Dictionary = {}) -> String:
	var filled := UITextResolver.resolve(key, data)
	container.set_tab_title(tab_index, filled)
	VisualAdapter.adapt_tab_title(container, filled, tab_index)
	# Tab 标题不注册绑定（TabContainer 的 set_tab_title 需要索引, 绑定刷新需特殊处理）
	return filled

## ItemList 项注入
static func resolve_item(item_list: ItemList, text_key: String, data: Dictionary = {}, index: int = -1) -> int:
	var filled := UITextResolver.resolve(text_key, data)
	if index < 0:
		index = item_list.add_item(filled)
	else:
		item_list.set_item_text(index, filled)
	VisualAdapter.adapt_item_list_item(item_list, filled, index if index >= 0 else item_list.item_count - 1)
	return index

## LineEdit 占位符注入
static func resolve_placeholder(line_edit: LineEdit, key: String, data: Dictionary = {}) -> String:
	var filled := UITextResolver.resolve(key, data)
	line_edit.placeholder_text = filled
	var registry := UIBindingRegistry.get_instance()
	registry.bind(line_edit, key, data)
	return filled

## 语言切换入口
static func switch_locale(new_locale: String) -> void:
	UITextResolver.set_locale(new_locale)
	UIBindingRegistry.get_instance().refresh_all()

## 视图加载后批量适配（在 _ready() 最后调用）
static func adapt_view(view_node: Control) -> void:
	VisualAdapter.adapt_view(view_node)

## 视图销毁前解绑（防止悬空引用；实例未构建或已重置时短路，避免退出阶段反向重建单例）
static func clear_view_bindings(view_node: Node) -> void:
	if not UIBindingRegistry.has_active_instance():
		return
	UIBindingRegistry.get_instance().unbind_view(view_node)

## ==============================================================================
## 内部方法
## ==============================================================================

## 将文本注入到 UI 节点
static func _inject_text(node: Node, text: String) -> void:
	if node is Label:
		(node as Label).text = text
	elif node is Button:
		(node as Button).text = text
	elif node is RichTextLabel:
		(node as RichTextLabel).text = text
	elif node is LineEdit:
		(node as LineEdit).placeholder_text = text
