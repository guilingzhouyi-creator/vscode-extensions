# ==============================================================================
# 卡拉尔世界引擎 - 动态视觉适配器
# 文件路径: res://frontend/i18n/visual_adapter.gd
# 职责: 根据 UI 类型、可用空间、文本长度、语言特性进行字号/换行/截断动态适配
# 边界: 不修改文本内容, 不做语言转换, 只调整视觉呈现参数
# ==============================================================================
class_name VisualAdapter
extends RefCounted

## 字号阶梯（逐级缩放）
const FONT_SIZE_STEPS := [20, 18, 16, 14, 12]
const BUTTON_FONT_SIZE_STEPS := [16, 14, 12]
const FONT_SIZE_MIN_CJK := 14
const FONT_SIZE_MIN_LATIN := 12
const ELLIPSIS_CHAR := "…"

## R-14 宽度估算系数：全角(中日韩)近似 1.0em、半角(拉丁)近似 0.5em
## 旧实现统一用 0.6 低估 CJK 宽度，导致中文标题被误判溢出并错误降字号
const CJK_WIDTH_RATIO := 1.0
const LATIN_WIDTH_RATIO := 0.5

## 宽度估算公共函数：消除 adapt_label/adapt_button 中的重复系数计算
static func _estimate_width(text: String, size: int, is_cjk: bool) -> float:
	var ratio: float = CJK_WIDTH_RATIO if is_cjk else LATIN_WIDTH_RATIO
	return float(text.length()) * float(size) * ratio

## 获取 Label/RichTextLabel 节点当前设置的字号
static func _get_label_current_font_size(label: Node) -> int:
	if label is Label:
		return (label as Label).get_theme_font_size("font_size")
	if label is RichTextLabel:
		return (label as RichTextLabel).get_theme_default_font_size()
	return 20

## 解析 Label 可用渲染容器宽度
static func _resolve_label_available_width(label: Node, container_width: float) -> float:
	if container_width >= 0.0:
		return container_width
	if label is Control and (label as Control).size.x > 0.0:
		return (label as Control).size.x
	return 200.0

## 计算适配阶梯目标字号
static func _resolve_fitted_font_size(text: String, avail_width: float, current_size: int, is_cjk: bool, min_size: int) -> int:
	var estimated_width := _estimate_width(text, current_size, is_cjk)
	if estimated_width <= avail_width * 0.9:
		return current_size
	for step_size in FONT_SIZE_STEPS:
		if step_size < min_size:
			break
		if _estimate_width(text, step_size, is_cjk) <= avail_width * 0.9:
			return step_size
	return min_size

## 应用 Label 样式与溢出策略
static func _apply_label_visual_style(label: Node, font_size: int, is_overflow: bool) -> void:
	if label is Label:
		var lbl := label as Label
		if is_overflow:
			lbl.clip_text = true
			lbl.ellipsis_char = ELLIPSIS_CHAR
		lbl.add_theme_font_size_override("font_size", font_size)
	elif label is RichTextLabel:
		var rlbl := label as RichTextLabel
		if is_overflow:
			rlbl.fit_content = true
		rlbl.add_theme_font_size_override("normal_font_size", font_size)

## 适配 Label 节点
## 根据文本长度、容器宽度、语言特性自动调整字号和换行模式
static func adapt_label(label: Node, text: String, container_width: float = -1.0) -> void:
	if not (label is Label) and not (label is RichTextLabel):
		return

	var is_cjk := UITextResolver.is_cjk_locale()
	var min_size := FONT_SIZE_MIN_CJK if is_cjk else FONT_SIZE_MIN_LATIN
	var current_size := _get_label_current_font_size(label)
	var avail_width := _resolve_label_available_width(label, container_width)

	var fitted_size := _resolve_fitted_font_size(text, avail_width, current_size, is_cjk, min_size)
	var is_overflow := (fitted_size == min_size) and (_estimate_width(text, min_size, is_cjk) > avail_width * 0.9)
	_apply_label_visual_style(label, fitted_size, is_overflow)

## 适配 Button 节点
## 按钮文本过长时自动缩字号, 保持按钮不溢出
static func adapt_button(button: Button, text: String) -> void:
	if button == null:
		return
	var is_cjk := UITextResolver.is_cjk_locale()
	var min_size := FONT_SIZE_MIN_CJK if is_cjk else FONT_SIZE_MIN_LATIN
	var current_size := 16

	var estimated_width := _estimate_width(text, current_size, is_cjk)
	var avail_width := button.size.x if button.size.x > 0 else 120.0

	var fitted := false
	if estimated_width > avail_width * 0.85:
		for step_size in BUTTON_FONT_SIZE_STEPS:
			if step_size < min_size:
				break
			var step_width: float = _estimate_width(text, step_size, is_cjk)
			if step_width <= avail_width * 0.85:
				current_size = step_size
				fitted = true
				break

	# R-15 兜底：逐级降字号仍溢出时，启用裁剪 + 省略号，保证按钮文案不溢出
	if not fitted and estimated_width > avail_width * 0.85:
		button.clip_text = true
		button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS

	button.add_theme_font_size_override("font_size", current_size)

## 适配 Tab 标题
## R-16：按 tab_index 粒度仅对该项标题生效（不再改写整容器字号）
static func adapt_tab_title(container: TabContainer, text: String, tab_index: int) -> void:
	if container == null:
		return
	if tab_index < 0 or tab_index >= container.get_tab_count():
		# 索引越界：无可作用目标，安全返回（不改写整容器字号）
		return
	var current_size := _fit_tab_size(text)
	container.set_tab_title(tab_index, _truncate_for_tab(text, current_size))

## 依文本长度与语言求解 Tab 目标字号（阶梯 + 语言下限）
static func _fit_tab_size(text: String) -> int:
	var is_cjk := UITextResolver.is_cjk_locale()
	var min_size := FONT_SIZE_MIN_CJK if is_cjk else FONT_SIZE_MIN_LATIN
	var size := 16
	if text.length() > 6:
		size = 14
	if text.length() > 10:
		size = min_size
	return size

## 依字号与语言预算截断 Tab 标题（仅作用于该项显示层）
static func _truncate_for_tab(text: String, font_size: int) -> String:
	var is_cjk := UITextResolver.is_cjk_locale()
	var budget := 10 if is_cjk else 16
	if font_size <= FONT_SIZE_MIN_LATIN:
		budget += 2
	if text.length() <= budget:
		return text
	return text.substr(0, budget - 1) + ELLIPSIS_CHAR

## 适配 ItemList 项
## R-17：改用 ItemList 显示层溢出策略（text_overrun_behavior），不再破坏性改写源文本，
## 语言切换/刷新后可完整还原原文
static func adapt_item_list_item(item_list: ItemList, _text: String, _index: int) -> void:
	if item_list == null:
		return
	item_list.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS

## 批量适配视图中所有 Label 和 Button
## 在视图 _ready() 后调用一次, 自动适配所有文本节点
static func adapt_view(view_node: Control) -> void:
	_adapt_recursive(view_node)

## 递归遍历节点树, 适配每个文本节点
static func _adapt_recursive(node: Node) -> void:
	if node is Label:
		var label := node as Label
		if label.text.length() > 0:
			adapt_label(label, label.text)
	elif node is Button:
		var btn := node as Button
		if btn.text.length() > 0:
			adapt_button(btn, btn.text)
	elif node is RichTextLabel:
		var rtl := node as RichTextLabel
		if rtl.text.length() > 0:
			adapt_label(rtl, rtl.text)

	for child in node.get_children():
		_adapt_recursive(child)

## viewport 尺寸变化时重新适配
static func on_viewport_resized(view_node: Control) -> void:
	adapt_view(view_node)
