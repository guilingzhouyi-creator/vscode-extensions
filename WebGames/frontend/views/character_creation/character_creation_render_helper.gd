# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 权威创角与命途轮盘渲染辅助器)
# 文件路径: res://frontend/views/character_creation/character_creation_render_helper.gd
# 架构定位: Presentation Helper / Character Creation Stateless Widget Renderer
# 依赖与触发: 上游: CharacterCreationView | 下游: UIIntermediary, DesignTokens | 配置: 无直读 | 信号: 无
# 职责说明: 无状态渲染权威创角页的静态文案、上下文标识、受控身世/特质选项与命途轮盘预览摘要。
# 退出语义与设计依据: 表现层零计算与只读快照映射契约
# ==============================================================================

## CharacterCreationRenderHelper：权威创角界面无状态渲染辅助器
class_name CharacterCreationRenderHelper
extends BaseScreen


## 初始化权威创角页面全部静态文案与输入占位符
static func init_static_text(host_view: Variant) -> void:
	if host_view == null:
		return
	UIIntermediary.resolve(host_view.title_label, "ui.cc.header.title")
	UIIntermediary.resolve(host_view.back_btn, "ui.common.back")
	UIIntermediary.resolve(host_view.name_header_label, "ui.cc.label.name")
	UIIntermediary.resolve_placeholder(host_view.character_name_edit, "ui.cc.placeholder.name")
	UIIntermediary.resolve(host_view.origin_header_label, "ui.cc.label.origin")
	UIIntermediary.resolve(host_view.trait_header_label, "ui.cc.label.trait")
	UIIntermediary.resolve(host_view.preview_header_label, "ui.cc.label.preview")
	UIIntermediary.resolve(host_view.reroll_btn, "ui.cc.btn.reroll")
	UIIntermediary.resolve(host_view.confirm_create_btn, "ui.cc.btn.confirm")
	render_context_header(host_view)
	render_error_status(host_view)


## 统一重绘创角上下文头部、受控下拉控件与命途预览详情
static func render_all(host_view: Variant) -> void:
	if host_view == null:
		return
	render_context_header(host_view)
	render_context_header(host_view)
	render_error_status(host_view)


## 渲染顶部世界档案与槽位徽章以及状态提示横幅
static func render_context_header(host_view: Variant) -> void:
	if host_view == null:
		return
	if host_view.world_slot_badge_label != null:
		var world_text := str(host_view.current_world_id) if not str(host_view.current_world_id).is_empty() else "-"
		var slot_text := str(host_view.current_slot_id) if not str(host_view.current_slot_id).is_empty() else "SLOT_01"
		UIIntermediary.resolve(host_view.world_slot_badge_label, "ui.cc.badge.world_slot", {
			"world_id": world_text,
			"slot_id": slot_text
		})
	if host_view.status_banner_label != null:
		UIIntermediary.resolve(host_view.status_banner_label, "ui.cc.banner.subtitle")
		host_view.status_banner_label.modulate = DesignTokens.COLOR_TEXT_MUTED_DEFAULT

## 渲染创角错误提示文本与语义颜色
static func render_error_status(host_view: Variant) -> void:
	if host_view == null or host_view.error_status_label == null:
		return
	var error_text := str(host_view.last_error_code).strip_edges()
	if error_text.is_empty():
		host_view.error_status_label.text = ""
		return
	if error_text.begins_with("ui."):
		UIIntermediary.resolve(host_view.error_status_label, error_text)
	else:
		host_view.error_status_label.text = error_text
	host_view.error_status_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT


## 从身世条目中提取规范化出身标识
static func extract_origin_id(entry: Variant) -> String:
	if entry is Dictionary:
		var entry_map := entry as Dictionary
		return str(entry_map.get("origin_id", entry_map.get("id", "")))
	return str(entry) if entry is String else ""


## 从特质对条目中提取正向特质标识
static func extract_positive_trait_id(entry: Variant) -> String:
	if entry is Dictionary:
		var entry_map := entry as Dictionary
		var positive_id := str(entry_map.get("positive", entry_map.get("positive_trait", entry_map.get("positive_id", ""))))
		return positive_id if not positive_id.is_empty() else str(entry_map.get("trait_id", entry_map.get("id", "")))
	return str(entry) if entry is String else ""


static func _extract_display_name(entry: Variant, fallback_id: String) -> String:
	if entry is Dictionary:
		var entry_map := entry as Dictionary
		var label := str(entry_map.get("name", entry_map.get("display_name", fallback_id)))
		return label if not label.is_empty() else fallback_id
	return fallback_id


static func _extract_trait_label(entry: Variant, positive_id: String) -> String:
	if entry is Dictionary:
		var entry_map := entry as Dictionary
		var positive_name := str(entry_map.get("positive_name", entry_map.get("name", positive_id)))
		var neg_name := str(entry_map.get("negative_name", entry_map.get("negative", "")))
		if not neg_name.is_empty():
			return "%s / %s" % [positive_name, neg_name]
		return positive_name
	return positive_id
