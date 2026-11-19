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
	render_controls(host_view)
	render_preview(host_view)
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


## 根据后端受控权限快照填充身世与特质下拉列表及重骰按钮状态
static func render_controls(host_view: Variant) -> void:
	if host_view == null:
		return
	var controls: Dictionary = host_view.creation_ui_controls if host_view.creation_ui_controls is Dictionary else {}
	var allow_origin := bool(controls.get("allow_manual_origin_select", false))
	var allow_trait := bool(controls.get("allow_manual_trait_select", false))
	var allow_reroll := bool(controls.get("allow_attribute_reroll", false))
	_populate_origin_options(host_view, allow_origin)
	_populate_trait_options(host_view, allow_trait)
	if host_view.reroll_btn != null:
		host_view.reroll_btn.disabled = not allow_reroll
	if host_view.control_hints_label != null:
		var hint_key := "ui.cc.hints.manual_enabled" if (allow_origin or allow_trait or allow_reroll) else "ui.cc.hints.authoritative_locked"
		UIIntermediary.resolve(host_view.control_hints_label, hint_key)
		host_view.control_hints_label.modulate = DesignTokens.COLOR_TEXT_MUTED_DEFAULT


## 渲染命途轮盘预览摘要（种族、出身、出生地、六维资质与特质）
static func render_preview(host_view: Variant) -> void:
	if host_view == null or host_view.destiny_preview_rich_label == null:
		return
	var preview_snapshot: Dictionary = host_view.preview_snapshot if host_view.preview_snapshot is Dictionary else {}
	if preview_snapshot.is_empty():
		host_view.destiny_preview_rich_label.text = UIIntermediary.text("ui.cc.preview.empty")
		return
	var attrs: Dictionary = preview_snapshot.get("attributes", {}) if preview_snapshot.get("attributes") is Dictionary else {}
	var lines := PackedStringArray([
		UIIntermediary.text("ui.cc.preview.race_origin", {
			"race": str(preview_snapshot.get("race_name", preview_snapshot.get("race_id", "-"))),
			"origin": str(preview_snapshot.get("origin_name", preview_snapshot.get("origin_id", "-")))
		}),
		UIIntermediary.text("ui.cc.preview.birth_region", {
			"region": str(preview_snapshot.get("birth_region_id", "-")),
			"gender": str(preview_snapshot.get("gender", "-"))
		}),
		UIIntermediary.text("ui.cc.preview.attributes", {
			"str": int(attrs.get("STR", 0)),
			"con": int(attrs.get("CON", 0)),
			"int": int(attrs.get("INT", 0)),
			"agi": int(attrs.get("AGI", 0)),
			"spr": int(attrs.get("SPR", 0)),
			"vit": int(attrs.get("VIT", 0))
		}),
		UIIntermediary.text("ui.cc.preview.traits", {
			"traits": _format_traits_summary(preview_snapshot)
		}),
		UIIntermediary.text("ui.cc.preview.gold", {
			"gold": int(preview_snapshot.get("initial_gold", 0))
		})
	])
	var origin_description := str(preview_snapshot.get("origin_desc", "")).strip_edges()
	if not origin_description.is_empty():
		lines.append(origin_description)
	host_view.destiny_preview_rich_label.text = "\n".join(lines)


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


static func _populate_origin_options(host_view: Variant, allow_origin: bool) -> void:
	var option_button: OptionButton = host_view.origin_option_button
	if option_button == null:
		return
	option_button.clear()
	option_button.disabled = not allow_origin or host_view.available_origins.is_empty()
	if host_view.available_origins.is_empty():
		option_button.add_item(UIIntermediary.text("ui.cc.option.auto_destiny"))
		return
	option_button.add_item(UIIntermediary.text("ui.cc.option.auto_destiny"))
	option_button.set_item_metadata(0, "")
	var selected_index := 0
	for origin_entry in host_view.available_origins:
		var origin_id := extract_origin_id(origin_entry)
		var label_text := _extract_display_name(origin_entry, origin_id)
		var item_index := option_button.item_count
		option_button.add_item(label_text)
		option_button.set_item_metadata(item_index, origin_id)
		if origin_id == str(host_view.selected_origin_id) and not origin_id.is_empty():
			selected_index = item_index
	option_button.select(selected_index)


static func _populate_trait_options(host_view: Variant, allow_trait: bool) -> void:
	var option_button: OptionButton = host_view.trait_option_button
	if option_button == null:
		return
	option_button.clear()
	option_button.disabled = not allow_trait or host_view.available_trait_pairs.is_empty()
	if host_view.available_trait_pairs.is_empty():
		option_button.add_item(UIIntermediary.text("ui.cc.option.auto_destiny"))
		return
	option_button.add_item(UIIntermediary.text("ui.cc.option.auto_destiny"))
	option_button.set_item_metadata(0, "")
	var selected_index := 0
	for trait_entry in host_view.available_trait_pairs:
		var trait_id := extract_positive_trait_id(trait_entry)
		var label_text := _extract_trait_label(trait_entry, trait_id)
		var item_index := option_button.item_count
		option_button.add_item(label_text)
		option_button.set_item_metadata(item_index, trait_id)
		if trait_id == str(host_view.selected_positive_trait) and not trait_id.is_empty():
			selected_index = item_index
	option_button.select(selected_index)


## 从身世条目中提取规范化出身标识
static func extract_origin_id(entry: Variant) -> String:
	if entry is Dictionary:
		return str((entry as Dictionary).get("origin_id", ""))
	return str(entry) if entry is String else ""


## 从特质对条目中提取正向特质标识
static func extract_positive_trait_id(entry: Variant) -> String:
	if entry is Dictionary:
		return str((entry as Dictionary).get("positive", ""))
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


static func _format_traits_summary(preview_snapshot: Dictionary) -> String:
	var details: Variant = preview_snapshot.get("traits_details", [])
	if details is Array and not (details as Array).is_empty():
		var names := PackedStringArray()
		for entry in (details as Array):
			if entry is Dictionary:
				var entry_map := entry as Dictionary
				names.append(str(entry_map.get("name", entry_map.get("trait_id", ""))))
			else:
				names.append(str(entry))
		return ", ".join(names)
	var raw_traits: Variant = preview_snapshot.get("selected_traits", [])
	if raw_traits is Array and not (raw_traits as Array).is_empty():
		return ", ".join(PackedStringArray(raw_traits as Array))
	return "-"
