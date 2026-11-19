# ==============================================================================
# 模块归属: 前端表现层 (Frontend · MOD 工坊子控制器)
# 文件路径: res://frontend/views/mod_workbench/mod_workbench_screen_tabs.gd
# 架构定位: Presentation Sub-Controller / MOD Discovery & Precheck Delegate
# 依赖与触发: 上游: ModWorkbenchScreen | 下游: ServiceLocator, UIIntermediary
# 职责说明: 执行 MOD 包列表渲染、启停与优先级排序调整、提交 SET_MOD_SELECTION 与
#           PRECHECK_MODS 并呈现拓扑与错误摘要。
# 退出语义与设计依据: 随 ModWorkbenchScreen 生命周期释放
# ==============================================================================
## ModWorkbenchScreenTabs：MOD 工坊列表与预检诊断逻辑委托控制器
class_name ModWorkbenchScreenTabs
extends BaseScreen

var _view: BaseScreen = null

## 绑定所属 MOD 工坊视图实例
func setup(host_view: BaseScreen) -> void:
	_view = host_view

## 初始化工坊静态文本
func init_static_text() -> void:
	if _view == null:
		return
	UIIntermediary.resolve(_view.title_label, "ui.mw.header.title")
	UIIntermediary.resolve(_view.save_and_precheck_btn, "ui.mw.btn.save_precheck")
	UIIntermediary.resolve(_view.back_btn, "ui.common.back")
	UIIntermediary.resolve_placeholder(_view.custom_root_edit, "ui.mw.scan.root_ph")
	UIIntermediary.resolve(_view.rescan_packs_btn, "ui.mw.btn.rescan")
	UIIntermediary.resolve(_view.installed_header_label, "ui.mw.list.header")
	UIIntermediary.resolve(_view.toggle_pack_btn, "ui.mw.btn.toggle")
	UIIntermediary.resolve(_view.move_up_btn, "ui.mw.btn.move_up")
	UIIntermediary.resolve(_view.move_down_btn, "ui.mw.btn.move_down")
	UIIntermediary.resolve(_view.detail_header_label, "ui.mw.detail.header")

## 拉取已安装的 MOD 包目录并触发渲染
func refresh_installed_packs() -> void:
	if _view == null:
		return
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return
	world_service.list_installed_mods_async(
		_view.current_account_id,
		_view.current_session_token,
		_view.custom_scan_roots,
		func(response_payload: Dictionary) -> void:
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			var package_rows: Variant = data_map.get("packages", [])
			_view.apply_snapshot({
				"installed_packs": package_rows,
				"selected_pack_ids": data_map.get("selected_pack_ids", _view.selected_pack_ids)
			})
	)

## 渲染工坊全量状态（列表、详情、预检结果与汇总徽章）
func render_all() -> void:
	if _view == null:
		return
	_render_pack_list()
	render_pack_detail()
	render_precheck_report()
	_render_summary_badge()

func _render_pack_list() -> void:
	if _view.installed_pack_list == null:
		return
	_view.installed_pack_list.clear()
	for pack_index in range(_view.installed_packs.size()):
		var pack_entry: Variant = _view.installed_packs[pack_index]
		_append_pack_row(pack_entry, pack_index)

func _append_pack_row(pack_entry: Variant, pack_index: int) -> void:
	if not (pack_entry is Dictionary):
		return
	var entry_map := pack_entry as Dictionary
	var pack_id := str(entry_map.get("pack_id", ""))
	var profile := str(entry_map.get("pack_profile", "CONTENT_ADDON"))
	var enabled_mark := "[ON]" if (pack_id in _view.selected_pack_ids) else "[OFF]"
	var official_mark := "OFFICIAL" if bool(entry_map.get("is_official", false)) else "3P"
	var display_title := str(entry_map.get("display_name", pack_id))
	var row_label := "%s [%s/%s] %s v%s" % [enabled_mark, official_mark, profile, display_title, str(entry_map.get("version", "1.0.0"))]
	var item_index: int = _view.installed_pack_list.add_item(row_label)
	_view.installed_pack_list.set_item_metadata(item_index, pack_id)
	if pack_index == _view.focused_pack_index:
		_view.installed_pack_list.select(item_index)

## 渲染右侧聚焦 MOD 包的完整元数据与 SHA-256 摘要信息
func render_pack_detail() -> void:
	if _view == null or _view.pack_detail_rich_label == null:
		return
	_view.pack_detail_rich_label.clear()
	if _view.focused_pack_index < 0 or _view.focused_pack_index >= _view.installed_packs.size():
		_view.pack_detail_rich_label.append_text(UIIntermediary.text("ui.mw.detail.empty"))
		_sync_studio_focused_pack({})
		return
	var pack_entry: Variant = _view.installed_packs[_view.focused_pack_index]
	if not (pack_entry is Dictionary):
		return
	var entry_map := pack_entry as Dictionary
	var dependencies_value: Variant = entry_map.get("dependencies", [])
	_view.pack_detail_rich_label.append_text(
		UIIntermediary.text("ui.mw.detail.template", {
			"pack_id": str(entry_map.get("pack_id", "")),
			"display_name": str(entry_map.get("display_name", "")),
			"version": str(entry_map.get("version", "")),
			"pack_profile": str(entry_map.get("pack_profile", "")),
			"is_official": str(bool(entry_map.get("is_official", false))),
			"has_prologue_dag": str(bool(entry_map.get("has_prologue_dag", false))),
			"content_sha256": str(entry_map.get("content_sha256", "")),
			"dependencies": str(dependencies_value),
		})
	)
	_sync_studio_focused_pack(entry_map)

## 渲染预检与拓扑排序诊断摘要
func render_precheck_report() -> void:
	if _view == null or _view.precheck_rich_label == null:
		return
	_view.precheck_rich_label.clear()
	if _view.precheck_report.is_empty():
		_view.precheck_rich_label.append_text(UIIntermediary.text("ui.mw.precheck.pending"))
		return
	var precheck_passed := bool(_view.precheck_report.get("success", false))
	var error_code := str(_view.precheck_report.get("error_code", ""))
	var data_map: Dictionary = _view.precheck_report.get("data", _view.precheck_report) as Dictionary
	var has_base := bool(data_map.get("has_base_content_mod", false))
	var load_order: Variant = data_map.get("enabled_pack_ids", _view.selected_pack_ids)
	_view.precheck_rich_label.append_text(
		UIIntermediary.text("ui.mw.precheck.report_template", {
			"passed": str(precheck_passed),
			"has_base": str(has_base),
			"error_code": error_code if not error_code.is_empty() else "NONE",
			"load_order": str(load_order),
		})
	)

func _render_summary_badge() -> void:
	if _view.summary_badge_label == null:
		return
	var has_base := _detect_selected_base_pack()
	_view.summary_badge_label.text = UIIntermediary.text("ui.mw.badge.summary", {
		"enabled": _view.selected_pack_ids.size(),
		"base_status": "OK" if has_base else "MISSING",
	})
	_view.summary_badge_label.modulate = DesignTokens.COLOR_SUCCESS_DEFAULT if has_base else DesignTokens.COLOR_WARNING_DEFAULT

func _detect_selected_base_pack() -> bool:
	for pack_entry in _view.installed_packs:
		if pack_entry is Dictionary:
			var entry_map := pack_entry as Dictionary
			var pack_id := str(entry_map.get("pack_id", ""))
			var profile := str(entry_map.get("pack_profile", ""))
			if (pack_id in _view.selected_pack_ids) and (profile == "OFFICIAL_BASE" or profile == "TOTAL_CONVERSION"):
				return true
	return false

## 切换当前高亮 MOD 包的启用状态
func toggle_focused_pack() -> void:
	if _view == null or _view.focused_pack_index < 0 or _view.focused_pack_index >= _view.installed_packs.size():
		return
	var pack_entry: Variant = _view.installed_packs[_view.focused_pack_index]
	if not (pack_entry is Dictionary):
		return
	var pack_id := str((pack_entry as Dictionary).get("pack_id", ""))
	if pack_id.is_empty():
		return
	if pack_id in _view.selected_pack_ids:
		_view.selected_pack_ids.erase(pack_id)
	else:
		_view.selected_pack_ids.append(pack_id)
	render_all()

## 上下调整当前聚焦已启用 MOD 包的优先级偏移
func move_focused_pack(direction_offset: int) -> void:
	if _view == null or _view.focused_pack_index < 0 or _view.focused_pack_index >= _view.installed_packs.size():
		return
	var pack_entry: Variant = _view.installed_packs[_view.focused_pack_index]
	if not (pack_entry is Dictionary):
		return
	var pack_id := str((pack_entry as Dictionary).get("pack_id", ""))
	var current_order: int = _view.selected_pack_ids.find(pack_id)
	if current_order < 0:
		return
	var target_order: int = clampi(current_order + direction_offset, 0, _view.selected_pack_ids.size() - 1)
	if target_order == current_order:
		return
	_view.selected_pack_ids.remove_at(current_order)
	_view.selected_pack_ids.insert(target_order, pack_id)
	render_all()

## 提交已勾选 MOD 清单到世界网关会话并运行 DAG/兼容预检（透传自定义扫描目录）
func commit_selection_and_precheck(on_completed: Callable = Callable()) -> Dictionary:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var selection_reply: Dictionary = {}
	var precheck_reply: Dictionary = {}
	var selected_ids: Array = (_view.selected_pack_ids as Array).duplicate() if (_view != null and _view.selected_pack_ids is Array) else []
	var custom_roots: Array = (_view.custom_scan_roots as Array).duplicate() if (_view != null and _view.custom_scan_roots is Array) else []
	world_service.set_mod_selection_async(
		_view.current_account_id,
		_view.current_session_token,
		selected_ids,
		func(response_payload: Dictionary) -> void:
			selection_reply.merge(response_payload, true)
			world_service.precheck_mod_stack_async(
				_view.current_account_id,
				_view.current_session_token,
				selected_ids,
				func(precheck_payload: Dictionary) -> void:
					precheck_reply.merge(precheck_payload, true)
					if _view != null and is_instance_valid(_view):
						_view.apply_snapshot({"precheck_report": precheck_payload})
					if on_completed.is_valid():
						on_completed.call(precheck_payload),
				custom_roots
			),
		custom_roots
	)
	return precheck_reply

## 在自定义目录或沙盒根目录创建合规 MOD 骨架并刷新列表
func create_mod_pack(pack_spec: Dictionary = {}, on_completed: Callable = Callable()) -> Dictionary:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var resolved_spec := pack_spec.duplicate(true)
	if not resolved_spec.has("pack_id") and _view != null and _view.pack_id_edit != null:
		resolved_spec["pack_id"] = _view.pack_id_edit.text.strip_edges()
	if not resolved_spec.has("target_root") and _view != null and not _view.custom_scan_roots.is_empty():
		resolved_spec["target_root"] = str(_view.custom_scan_roots[0])
	var create_reply: Dictionary = {}
	world_service.create_mod_pack_async(
		_view.current_account_id if _view != null else "",
		_view.current_session_token if _view != null else "",
		resolved_spec,
		func(response_payload: Dictionary) -> void:
			create_reply.merge(response_payload, true)
			if bool(response_payload.get("success", false)) and _view != null and is_instance_valid(_view):
				var target_root := str((response_payload.get("data", {}) as Dictionary).get("target_root", ""))
				if not target_root.is_empty() and not (target_root in _view.custom_scan_roots):
					_view.custom_scan_roots.append(target_root)
				refresh_installed_packs()
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return create_reply

## 将当前聚焦 MOD 包或指定目录打包为 .kmod 归档文件
func pack_focused_mod_kmod(source_override: String = "", output_override: String = "", on_completed: Callable = Callable()) -> Dictionary:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var source_directory := source_override.strip_edges()
	if source_directory.is_empty() and _view != null and _view.focused_pack_index >= 0 and _view.focused_pack_index < _view.installed_packs.size():
		var entry: Variant = _view.installed_packs[_view.focused_pack_index]
		if entry is Dictionary:
			source_directory = str((entry as Dictionary).get("root_path", ""))
	if source_directory.is_empty() and _view != null and _view.custom_root_edit != null:
		source_directory = _view.custom_root_edit.text.strip_edges()
	var pack_reply: Dictionary = {}
	world_service.pack_mod_kmod_async(
		_view.current_account_id if _view != null else "",
		_view.current_session_token if _view != null else "",
		source_directory,
		output_override,
		func(response_payload: Dictionary) -> void:
			pack_reply.merge(response_payload, true)
			if bool(response_payload.get("success", false)) and _view != null and is_instance_valid(_view):
				refresh_installed_packs()
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return pack_reply

## 将输入的 .kmod 归档或 MOD 目录安装至本地 mods 目录并刷新列表
func install_mod_from_input(source_override: String = "", target_root: String = "user://mods/", on_completed: Callable = Callable()) -> Dictionary:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var source_path := source_override.strip_edges()
	if source_path.is_empty() and _view != null and _view.custom_root_edit != null:
		source_path = _view.custom_root_edit.text.strip_edges()
	var install_reply: Dictionary = {}
	world_service.install_mod_pack_async(
		_view.current_account_id if _view != null else "",
		_view.current_session_token if _view != null else "",
		source_path,
		target_root,
		func(response_payload: Dictionary) -> void:
			install_reply.merge(response_payload, true)
			if bool(response_payload.get("success", false)) and _view != null and is_instance_valid(_view):
				if not (target_root in _view.custom_scan_roots) and target_root != "user://mods/":
					_view.custom_scan_roots.append(target_root)
				refresh_installed_packs()
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return install_reply

## 更新当前聚焦 MOD 的 pack.json 清单元数据（如有 DAG 编辑一并回写）并刷新列表
func update_focused_mod_manifest(update_specification: Dictionary, on_completed: Callable = Callable()) -> Dictionary:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var request_specification: Dictionary = update_specification.duplicate(true)
	var studio_view: Control = _view.get_studio_view() if (_view != null and _view.has_method("get_studio_view")) else null
	if studio_view != null and studio_view.has_method("has_dag_edits") and bool(studio_view.call("has_dag_edits")):
		request_specification["dag_graph"] = studio_view.call("export_dag_dto")
	var update_reply: Dictionary = {}
	world_service.update_mod_manifest_async(
		_view.current_account_id if _view != null else "",
		_view.current_session_token if _view != null else "",
		request_specification,
		func(response_payload: Dictionary) -> void:
			update_reply.merge(response_payload, true)
			var succeeded: bool = bool(response_payload.get("success", false))
			if studio_view != null and is_instance_valid(studio_view) and studio_view.has_method("show_manifest_feedback"):
				var feedback_text: String = UIIntermediary.text("ui.mw.manifest.saved") if succeeded else str(response_payload.get("message", "ERR_MOD_MANIFEST_UPDATE"))
				studio_view.call("show_manifest_feedback", feedback_text, not succeeded)
			if succeeded and _view != null and is_instance_valid(_view):
				refresh_installed_packs()
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return update_reply

## 删除或卸载当前聚焦的非官方本地 MOD 包或归档并从启用列表中剔除
func delete_focused_mod(pack_id_override: String = "", root_path_override: String = "", target_root: String = "user://mods/", on_completed: Callable = Callable()) -> Dictionary:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var target_pack_id: String = pack_id_override.strip_edges()
	var target_pack_root: String = root_path_override.strip_edges()
	if target_pack_id.is_empty() and _view != null and _view.focused_pack_index >= 0 and _view.focused_pack_index < _view.installed_packs.size():
		var focused_entry: Variant = _view.installed_packs[_view.focused_pack_index]
		if focused_entry is Dictionary:
			target_pack_id = str((focused_entry as Dictionary).get("pack_id", ""))
			target_pack_root = str((focused_entry as Dictionary).get("root_path", ""))
	var delete_specification: Dictionary = {"pack_id": target_pack_id, "target_root": target_root}
	if not target_pack_root.is_empty():
		delete_specification["root_path"] = target_pack_root
	var delete_reply: Dictionary = {}
	world_service.delete_mod_pack_async(
		_view.current_account_id if _view != null else "",
		_view.current_session_token if _view != null else "",
		delete_specification,
		func(response_payload: Dictionary) -> void:
			delete_reply.merge(response_payload, true)
			var succeeded: bool = bool(response_payload.get("success", false))
			if succeeded and _view != null and is_instance_valid(_view):
				_view.selected_pack_ids.erase(target_pack_id)
				_view.focused_pack_index = -1
				refresh_installed_packs()
			var studio_view: Control = _view.get_studio_view() if (_view != null and _view.has_method("get_studio_view")) else null
			if studio_view != null and is_instance_valid(studio_view) and studio_view.has_method("show_manifest_feedback"):
				var feedback_text: String = UIIntermediary.text("ui.mw.manifest.deleted") if succeeded else str(response_payload.get("message", "ERR_MOD_DELETE"))
				studio_view.call("show_manifest_feedback", feedback_text, not succeeded)
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return delete_reply

func _sync_studio_focused_pack(pack_entry: Dictionary) -> void:
	if _view == null or not _view.has_method("get_studio_view"):
		return
	var studio_view: Control = _view.get_studio_view()
	if studio_view != null and studio_view.has_method("sync_focused_pack"):
		studio_view.call("sync_focused_pack", pack_entry)
