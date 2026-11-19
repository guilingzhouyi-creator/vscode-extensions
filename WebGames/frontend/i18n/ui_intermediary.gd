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

const MOD_I18N_EVENT_CHANNELS: Array[String] = [
	"localization_i18n.updated",
	"config.mod_overlay_applied",
	"config.mod_overlay_cleared",
	"lifecycle.teardown_completed",
]

## 单例
static var _instance: UIIntermediary
static var _mod_i18n_bus_tokens: Array[EventBusSubscriptionToken] = []
## 获取 UI 中间体门面全局单例
static func get_instance() -> UIIntermediary:
	if _instance == null:
		_instance = UIIntermediary.new()
	return _instance

## 懒注册领域事件监听：按精准事件信道挂接，在应用/卸载 MOD 多语言包与反装配时实时响应
static func ensure_mod_i18n_subscription() -> void:
	if not _mod_i18n_bus_tokens.is_empty():
		return
	var bus := EventBusCore.get_instance()
	if bus == null:
		return
	for target_channel in MOD_I18N_EVENT_CHANNELS:
		var token := bus.on_channel(target_channel, _on_mod_i18n_domain_packet)
		if token != null:
			_mod_i18n_bus_tokens.append(token)

## 显式解绑静态事件总线监听并清理单例缓存（供测试生命周期无泄漏退出调用）
static func teardown_for_tests() -> void:
	for token in _mod_i18n_bus_tokens:
		if token != null:
			token.unbind()
	_mod_i18n_bus_tokens.clear()
	_instance = null

static func _on_mod_i18n_domain_packet(domain_packet: Variant) -> void:
	var wrapper: Dictionary = domain_packet.payload_data if domain_packet != null and domain_packet.get("payload_data") is Dictionary else {}
	var channel := String(wrapper.get("channel", ""))
	if channel == "lifecycle.teardown_completed":
		UITextResolver.get_instance().clear_mod_translations()
		teardown_for_tests()
		return
	UITextResolver.get_instance().sync_mod_dictionaries_from_config()
	refresh_active_bindings()

## ==============================================================================
## 核心入口: resolve
## 将 i18n key + 业务数据 解析为最终文本, 注入 UI 节点
## ==============================================================================

## 单节点注入
## target_node: 要注入文本的 UI 节点 (Label/Button/LineEdit/RichTextLabel)
## i18n_key: i18n key (如 "ui.fe01.splash.logo")
## template_payload: 业务数据字典 (如 {"amount": 5000, "name": "阿尔托莉雅"})
## 返回: 填充后的最终文本
static func resolve(target_node: Node, i18n_key: String, template_payload: Dictionary = {}) -> String:
	ensure_mod_i18n_subscription()
	# 1-2. i18n 翻译 + 占位符填充（UITextResolver.resolve 已内置单引擎 PlaceholderFiller 填充）
	var rendered_text := UITextResolver.resolve(i18n_key, template_payload)

	# 3. 注入 UI 节点
	_inject_text(target_node, rendered_text)

	# 4. 视觉适配
	VisualAdapter.adapt_label(target_node, rendered_text)

	# 5. 注册绑定（语言切换时自动刷新）
	var registry := UIBindingRegistry.get_instance()
	registry.bind(target_node, i18n_key, template_payload)

	return rendered_text

## 批量注入
## bindings: [{ "node": Node, "key": String, "data": Dictionary }, ...]
static func resolve_batch(bindings: Array) -> void:
	var empty_payload: Dictionary = {}
	for binding in bindings:
		resolve(binding.node, binding.key, binding.get("data", empty_payload))

## 仅翻译+填充, 不注入节点（用于动态生成文本, 如 ItemList 项）
static func text(i18n_key: String, template_payload: Dictionary = {}) -> String:
	ensure_mod_i18n_subscription()
	# resolve 已内置占位符填充，无需二次调用 PlaceholderFiller.fill
	return UITextResolver.resolve(i18n_key, template_payload)

## 翻译+填充+绑定, 但延迟注入（用于 TabContainer 标题等需要时机的场景）
static func resolve_deferred(target_node: Node, i18n_key: String, template_payload: Dictionary = {}) -> String:
	var rendered_text := UITextResolver.resolve(i18n_key, template_payload)
	var registry := UIBindingRegistry.get_instance()
	registry.bind(target_node, i18n_key, template_payload)
	return rendered_text

## Tab 标题注入
static func resolve_tab(container: TabContainer, tab_index: int, i18n_key: String, template_payload: Dictionary = {}) -> String:
	var rendered_text := UITextResolver.resolve(i18n_key, template_payload)
	container.set_tab_title(tab_index, rendered_text)
	VisualAdapter.adapt_tab_title(container, rendered_text, tab_index)
	# Tab 标题不注册绑定（TabContainer 的 set_tab_title 需要索引, 绑定刷新需特殊处理）
	return rendered_text

## ItemList 项注入
static func resolve_item(item_list: ItemList, text_key: String, template_payload: Dictionary = {}, target_index: int = -1) -> int:
	var rendered_text := UITextResolver.resolve(text_key, template_payload)
	if target_index < 0:
		target_index = item_list.add_item(rendered_text)
	else:
		item_list.set_item_text(target_index, rendered_text)
	VisualAdapter.adapt_item_list_item(item_list, rendered_text, target_index if target_index >= 0 else item_list.item_count - 1)
	return target_index

## LineEdit 占位符注入
static func resolve_placeholder(line_edit: LineEdit, i18n_key: String, template_payload: Dictionary = {}) -> String:
	var rendered_text := UITextResolver.resolve(i18n_key, template_payload)
	line_edit.placeholder_text = rendered_text
	var registry := UIBindingRegistry.get_instance()
	registry.bind(line_edit, i18n_key, template_payload)
	return rendered_text

## 语言切换入口
static func switch_locale(new_locale: String) -> void:
	UITextResolver.set_locale(new_locale)
	refresh_active_bindings()

## 当活跃绑定注册表已实例化时原地刷新全部 UI 节点文本（不触发惰性单例重建）
static func refresh_active_bindings() -> void:
	if UIBindingRegistry.has_active_instance():
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
static func _inject_text(target_node: Node, rendered_text: String) -> void:
	if target_node is Label:
		(target_node as Label).text = rendered_text
	elif target_node is Button:
		(target_node as Button).text = rendered_text
	elif target_node is RichTextLabel:
		(target_node as RichTextLabel).text = rendered_text
	elif target_node is LineEdit:
		(target_node as LineEdit).placeholder_text = rendered_text
