# ==============================================================================
# 模块归属: 前端国际化渲染层 (Frontend · i18n Visual Text Adapter)
# 文件路径: res://frontend/i18n/visual_adapter.gd
# 架构定位: Language-Aware UI Typography & Overflow Adapter
# 依赖与触发: 上游: UIIntermediary | 下游: UITextResolver
# 职责说明: 根据控件类型、可用宽度、文本长度及 CJK/拉丁字符宽度比例，动态调整字号、换行与截断策略，不改写原始语义文本。
# 退出语义与设计依据: 显示层非破坏性溢出截断与 CJK/拉丁差异化字宽估算契约
# ==============================================================================

## VisualAdapter：多语言 UI 文本字号缩放与溢出裁剪适配器
class_name VisualAdapter
extends RefCounted

## 字号阶梯（逐级缩放）
const FONT_SIZE_STEPS := [20, 18, 16, 14, 12]
const BUTTON_FONT_SIZE_STEPS := [16, 14, 12]
const FONT_SIZE_MIN_CJK := 14
const FONT_SIZE_MIN_LATIN := 12
const ELLIPSIS_CHAR := "…"

## 宽度估算系数：全角(中日韩)近似 1.0em、半角(拉丁)近似 0.5em
## 避免统一采用低估值系数导致中文标题被误判溢出并错误缩小字号
const CJK_WIDTH_RATIO := 1.0
const LATIN_WIDTH_RATIO := 0.5

## 宽度估算公共函数：消除 adapt_label/adapt_button 中的重复系数计算
static func _estimate_width(source_text: String, font_size: int, is_cjk: bool) -> float:
	var width_ratio: float = CJK_WIDTH_RATIO if is_cjk else LATIN_WIDTH_RATIO
	return float(source_text.length()) * float(font_size) * width_ratio

## 获取 Label/RichTextLabel 节点当前设置的字号
static func _get_label_current_font_size(target_label: Node) -> int:
	if target_label is Label:
		return (target_label as Label).get_theme_font_size("font_size")
	if target_label is RichTextLabel:
		return (target_label as RichTextLabel).get_theme_default_font_size()
	return 20

## 解析 Label 可用渲染容器宽度
static func _resolve_label_available_width(target_label: Node, container_width: float) -> float:
	if container_width >= 0.0:
		return container_width
	if target_label is Control and (target_label as Control).size.x > 0.0:
		return (target_label as Control).size.x
	return 200.0

## 计算适配阶梯目标字号
static func _resolve_fitted_font_size(source_text: String, available_width: float, current_size: int, is_cjk: bool, min_size: int) -> int:
	var estimated_width := _estimate_width(source_text, current_size, is_cjk)
	if estimated_width <= available_width * 0.9:
		return current_size
	for step_size in FONT_SIZE_STEPS:
		if step_size < min_size:
			break
		if _estimate_width(source_text, step_size, is_cjk) <= available_width * 0.9:
			return step_size
	return min_size

## 应用 Label 样式与溢出策略
static func _apply_label_visual_style(target_label: Node, font_size: int, is_overflow: bool) -> void:
	if target_label is Label:
		var text_label := target_label as Label
		if is_overflow:
			text_label.clip_text = true
			text_label.ellipsis_char = ELLIPSIS_CHAR
		text_label.add_theme_font_size_override("font_size", font_size)
	elif target_label is RichTextLabel:
		var rich_text_label := target_label as RichTextLabel
		if is_overflow:
			rich_text_label.fit_content = true
		rich_text_label.add_theme_font_size_override("normal_font_size", font_size)

## 适配 Label 节点
## 根据文本长度、容器宽度、语言特性自动调整字号和换行模式
static func adapt_label(target_label: Node, source_text: String, container_width: float = -1.0) -> void:
	if not (target_label is Label) and not (target_label is RichTextLabel):
		return

	var is_cjk := UITextResolver.is_cjk_locale()
	var min_size := FONT_SIZE_MIN_CJK if is_cjk else FONT_SIZE_MIN_LATIN
	var current_size := _get_label_current_font_size(target_label)
	var available_width := _resolve_label_available_width(target_label, container_width)

	var fitted_size := _resolve_fitted_font_size(source_text, available_width, current_size, is_cjk, min_size)
	var is_overflow := (fitted_size == min_size) and (_estimate_width(source_text, min_size, is_cjk) > available_width * 0.9)
	_apply_label_visual_style(target_label, fitted_size, is_overflow)

## 适配 Button 节点
## 按钮文本过长时自动缩字号, 保持按钮不溢出
static func adapt_button(button: Button, source_text: String) -> void:
	if button == null:
		return
	var is_cjk := UITextResolver.is_cjk_locale()
	var min_size := FONT_SIZE_MIN_CJK if is_cjk else FONT_SIZE_MIN_LATIN
	var current_size := 16

	var estimated_width := _estimate_width(source_text, current_size, is_cjk)
	var available_width := button.size.x if button.size.x > 0 else 120.0

	var is_fitted := false
	if estimated_width > available_width * 0.85:
		for step_size in BUTTON_FONT_SIZE_STEPS:
			if step_size < min_size:
				break
			var step_width: float = _estimate_width(source_text, step_size, is_cjk)
			if step_width <= available_width * 0.85:
				current_size = step_size
				is_fitted = true
				break

	# 安全回退：逐级降低字号后仍溢出时启用裁剪与省略号，防止按钮文案越界
	if not is_fitted and estimated_width > available_width * 0.85:
		button.clip_text = true
		button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS

	button.add_theme_font_size_override("font_size", current_size)

## 适配 Tab 标题
## 按 tab_index 粒度仅对该项标题生效，不改写整容器字号
static func adapt_tab_title(container: TabContainer, source_text: String, tab_index: int) -> void:
	if container == null:
		return
	if tab_index < 0 or tab_index >= container.get_tab_count():
		# 索引越界：无可作用目标，安全返回（不改写整容器字号）
		return
	var current_size := _fit_tab_size(source_text)
	container.set_tab_title(tab_index, _truncate_for_tab(source_text, current_size))

## 依文本长度与语言求解 Tab 目标字号（阶梯 + 语言下限）
static func _fit_tab_size(source_text: String) -> int:
	var is_cjk := UITextResolver.is_cjk_locale()
	var min_size := FONT_SIZE_MIN_CJK if is_cjk else FONT_SIZE_MIN_LATIN
	var font_size := 16
	if source_text.length() > 6:
		font_size = 14
	if source_text.length() > 10:
		font_size = min_size
	return font_size

## 依字号与语言预算截断 Tab 标题（仅作用于该项显示层）
static func _truncate_for_tab(source_text: String, font_size: int) -> String:
	var is_cjk := UITextResolver.is_cjk_locale()
	var character_budget := 10 if is_cjk else 16
	if font_size <= FONT_SIZE_MIN_LATIN:
		character_budget += 2
	if source_text.length() <= character_budget:
		return source_text
	return source_text.substr(0, character_budget - 1) + ELLIPSIS_CHAR

## 适配 ItemList 项
## 采用 ItemList 显示层溢出策略（text_overrun_behavior），不破坏性改写源文本，
## 确保语言切换或刷新后可完整还原原文
static func adapt_item_list_item(item_list: ItemList, _source_text: String, _item_index: int) -> void:
	if item_list == null:
		return
	item_list.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS

## 批量适配视图中所有 Label 和 Button
## 在视图 _ready() 后调用一次, 自动适配所有文本节点
static func adapt_view(view_node: Control) -> void:
	_adapt_recursive(view_node)

## 递归遍历节点树, 适配每个文本节点
static func _adapt_recursive(target_node: Node) -> void:
	if target_node is Label:
		var text_label := target_node as Label
		if text_label.text.length() > 0:
			adapt_label(text_label, text_label.text)
	elif target_node is Button:
		var button_control := target_node as Button
		if button_control.text.length() > 0:
			adapt_button(button_control, button_control.text)
	elif target_node is RichTextLabel:
		var rich_text_label := target_node as RichTextLabel
		if rich_text_label.text.length() > 0:
			adapt_label(rich_text_label, rich_text_label.text)

	for child_node in target_node.get_children():
		_adapt_recursive(child_node)

## viewport 尺寸变化时重新适配
static func on_viewport_resized(view_node: Control) -> void:
	adapt_view(view_node)
