# ==============================================================================
# 模块归属: Frontend / Systems (模组工坊系统 Mod Workbench)
# 文件路径: res://frontend/systems/mod_workbench/mod_workbench_manifest_panel.gd
# 架构定位: Presentation Component / MOD Manifest Editor & Deletion Guard Panel
# 依赖与触发: 上游: ModWorkbenchView | 下游: DesignTokens, UIIntermediary
# 职责说明: 为当前选中的本地 MOD 提供显示名称、版本号、作者、加载优先级与描述编辑控件，及受核心包保护的保存/删除动作入口。
# 退出语义与设计依据: 纯表现编辑控件，所有持久化更新与删除动作通过信号委托至 IWorldService 网关边界
# ==============================================================================

## ModWorkbenchManifestPanel：MOD 清单元数据编辑与安全删除子面板
class_name ModWorkbenchManifestPanel
extends VBoxContainer

signal save_manifest_requested(update_spec: Dictionary)
signal delete_mod_requested(pack_id: String, root_path: String)

var _focused_pack_id: String = ""
var _focused_root_path: String = ""
var _is_official_pack: bool = false
var _header_label: Label = null
var _display_name_input: LineEdit = null
var _version_input: LineEdit = null
var _author_input: LineEdit = null
var _priority_input: LineEdit = null
var _description_input: LineEdit = null
var _save_button: Button = null
var _delete_button: Button = null
var _feedback_label: Label = null


func _init() -> void:
	name = "ModWorkbenchManifestPanel"
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_build_controls()


## 载入已选中 MOD 条目字典至编辑器字段并按官方核心包保护策略刷新按钮可用态
func load_pack_entry(pack_entry: Dictionary) -> void:
	_focused_pack_id = str(pack_entry.get("pack_id", "")).strip_edges()
	_focused_root_path = str(pack_entry.get("root_path", "")).strip_edges()
	_is_official_pack = bool(pack_entry.get("is_official", false)) or (_focused_pack_id == "official_kalar")

	if _display_name_input != null:
		_display_name_input.text = str(pack_entry.get("display_name", _focused_pack_id))
	if _version_input != null:
		_version_input.text = str(pack_entry.get("version", "1.0.0"))
	if _author_input != null:
		_author_input.text = str(pack_entry.get("author", ""))
	if _priority_input != null:
		_priority_input.text = str(int(pack_entry.get("priority", 100)))
	if _description_input != null:
		_description_input.text = str(pack_entry.get("description", ""))

	var can_mutate: bool = not _focused_pack_id.is_empty() and not _is_official_pack
	if _save_button != null:
		_save_button.disabled = _focused_pack_id.is_empty()
	if _delete_button != null:
		_delete_button.disabled = not can_mutate


## 根据当前表单内容组装 UPDATE_MOD_MANIFEST 协议载荷
func build_update_spec() -> Dictionary:
	return {
		"pack_id": _focused_pack_id,
		"root_path": _focused_root_path,
		"manifest_updates": {
			"display_name": _display_name_input.text.strip_edges() if _display_name_input != null else "",
			"version": _version_input.text.strip_edges() if _version_input != null else "1.0.0",
			"author": _author_input.text.strip_edges() if _author_input != null else "",
			"priority": int(_priority_input.text.strip_edges()) if _priority_input != null else 100,
			"description": _description_input.text.strip_edges() if _description_input != null else "",
		},
	}


## 获取当前加载到编辑面板中的 MOD 标识
func get_focused_pack_id() -> String:
	return _focused_pack_id


## 展示保存或删除操作后的反馈提示文本并按错误语义着色
func set_feedback(feedback_text: String, is_failure: bool = false) -> void:
	if _feedback_label == null:
		return
	_feedback_label.text = feedback_text
	_feedback_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT if is_failure else DesignTokens.COLOR_SUCCESS_DEFAULT


func _build_controls() -> void:
	_header_label = Label.new()
	_header_label.name = "ManifestEditorHeaderLabel"
	UIIntermediary.resolve(_header_label, "ui.mw.manifest.header")
	add_child(_header_label)

	var fields_grid := GridContainer.new()
	fields_grid.name = "ManifestFieldsGrid"
	fields_grid.columns = 2
	add_child(fields_grid)

	_display_name_input = _add_labeled_input(fields_grid, "ui.mw.manifest.name_ph", "DisplayNameInput")
	_version_input = _add_labeled_input(fields_grid, "ui.mw.manifest.version_ph", "VersionInput")
	_author_input = _add_labeled_input(fields_grid, "ui.mw.manifest.author_ph", "AuthorInput")
	_priority_input = _add_labeled_input(fields_grid, "ui.mw.manifest.priority_ph", "PriorityInput")
	_description_input = _add_labeled_input(fields_grid, "ui.mw.manifest.desc_ph", "DescriptionInput")

	var action_row := HBoxContainer.new()
	action_row.name = "ManifestActionRow"
	add_child(action_row)

	_save_button = Button.new()
	_save_button.name = "SaveManifestButton"
	UIIntermediary.resolve(_save_button, "ui.mw.manifest.save")
	_save_button.pressed.connect(_on_save_pressed)
	action_row.add_child(_save_button)

	_delete_button = Button.new()
	_delete_button.name = "DeleteModButton"
	UIIntermediary.resolve(_delete_button, "ui.mw.btn.delete_mod")
	_delete_button.pressed.connect(_on_delete_pressed)
	action_row.add_child(_delete_button)

	_feedback_label = Label.new()
	_feedback_label.name = "ManifestFeedbackLabel"
	add_child(_feedback_label)


func _add_labeled_input(grid_parent: GridContainer, placeholder_key: String, node_name: String) -> LineEdit:
	var caption_label := Label.new()
	UIIntermediary.resolve(caption_label, placeholder_key)
	grid_parent.add_child(caption_label)

	var line_edit := LineEdit.new()
	line_edit.name = node_name
	line_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	UIIntermediary.resolve_placeholder(line_edit, placeholder_key)
	grid_parent.add_child(line_edit)
	return line_edit


func _on_save_pressed() -> void:
	if _focused_pack_id.is_empty():
		return
	save_manifest_requested.emit(build_update_spec())


func _on_delete_pressed() -> void:
	if _focused_pack_id.is_empty() or _is_official_pack:
		return
	delete_mod_requested.emit(_focused_pack_id, _focused_root_path)
