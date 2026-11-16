# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 世界网关静态文案与面板渲染器)
# 文件路径: res://frontend/views/world_gateway/world_gateway_render_helper.gd
# 架构定位: Presentation Helper / World Gateway Stateless Widget Renderer
# 依赖与触发: 上游: WorldGatewayView, WorldGatewayTabs | 下游: UIIntermediary, DesignTokens | 配置: config/frontend/ui.json | 信号: 无
# 职责说明: 无状态渲染世界网关页面的静态多语言标签、基础内容包状态横幅、单机档案列表与诊断详情。
# 退出语义与设计依据: 表现层零计算与只读快照映射契约
# ==============================================================================

## WorldGatewayRenderHelper：世界网关视图无状态渲染辅助器
class_name WorldGatewayRenderHelper
extends BaseScreen


## 初始化世界网关静态文案标签与按钮
static func init_static_text(host_view: Variant) -> void:
    if host_view == null:
        return
    UIIntermediary.resolve(host_view.title_label, "ui.wg.header.title")
    UIIntermediary.resolve(host_view.switch_mode_btn, "ui.wg.btn.switch_mode")
    UIIntermediary.resolve(host_view.open_mod_workbench_btn, "ui.wg.btn.mod_workbench")
    UIIntermediary.resolve(host_view.logout_account_btn, "ui.wg.btn.logout")
    UIIntermediary.resolve(host_view.quit_game_btn, "ui.wg.btn.quit")
    UIIntermediary.resolve(host_view.world_list_header_label, "ui.wg.sp.worlds_header")
    UIIntermediary.resolve_placeholder(host_view.new_world_id_edit, "ui.wg.sp.new_world_ph")
    UIIntermediary.resolve(host_view.create_world_btn, "ui.wg.sp.create_world")
    UIIntermediary.resolve(host_view.world_detail_title_label, "ui.wg.sp.diagnostics_header")
    UIIntermediary.resolve(host_view.enter_world_btn, "ui.wg.sp.enter_world")
    UIIntermediary.resolve(host_view.delete_world_btn, "ui.wg.sp.delete_world")
    UIIntermediary.resolve(host_view.refresh_worlds_btn, "ui.wg.sp.refresh")
    UIIntermediary.resolve(host_view.realm_list_header_label, "ui.wg.mp.realms_header")
    UIIntermediary.resolve(host_view.verify_realm_btn, "ui.wg.mp.verify_and_join")
    UIIntermediary.resolve(host_view.refresh_realms_btn, "ui.wg.mp.refresh")


## 统一重绘网关头部横幅、单机档案与联机界域全部子控件
static func render_all(host_view: Variant, select_world_callback: Callable) -> void:
    if host_view == null:
        return
    render_header_and_banner(host_view)
    render_worlds_list(host_view, select_world_callback)
    render_world_diagnostics(host_view)
    render_realms_list(host_view)
    render_realm_status(host_view)


## 汇总 list_installed_mods 响应到网关聚合状态快照
static func collect_installed_mods_snapshot(response_payload: Dictionary, target_snapshot: Dictionary) -> void:
    if not bool(response_payload.get("success", false)):
        return
    var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
    if data_map.has("has_base_content_mod"):
        target_snapshot["base_content_mod_ready"] = bool(data_map.get("has_base_content_mod", false))
    var selected_ids: Variant = data_map.get("selected_pack_ids", [])
    var packages: Variant = data_map.get("packages", [])
    if packages is Array:
        var resolved_base_id := _find_active_base_pack_id(packages as Array, selected_ids as Array if selected_ids is Array else [])
        if not resolved_base_id.is_empty():
            target_snapshot["active_base_pack_id"] = resolved_base_id


static func _find_active_base_pack_id(packages: Array, selected_ids: Array) -> String:
    for pkg_entry in packages:
        if pkg_entry is Dictionary:
            var package_map := pkg_entry as Dictionary
            var pack_identifier := str(package_map.get("pack_id", ""))
            var is_base := bool(package_map.get("is_base_content", false)) or str(package_map.get("pack_profile", "")) in ["OFFICIAL_BASE", "TOTAL_CONVERSION"]
            if is_base and (selected_ids.is_empty() or ("*" in selected_ids) or (pack_identifier in selected_ids)):
                return pack_identifier
    return ""


## 汇总网关探针与模式探测响应到网关聚合状态快照
static func collect_probe_snapshot(response_payload: Dictionary, target_snapshot: Dictionary) -> void:
    if not bool(response_payload.get("success", false)):
        return
    var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
    var probe_reports: Variant = data_map.get("probe_reports", {})
    var base_ready := bool(target_snapshot.get("base_content_mod_ready", false))
    var base_pack_id := str(target_snapshot.get("active_base_pack_id", ""))
    if probe_reports is Dictionary:
        var single_player_entry: Variant = (probe_reports as Dictionary).get("single_player", {})
        if single_player_entry is Dictionary:
            var single_player_report := single_player_entry as Dictionary
            var report_capabilities: Variant = single_player_report.get("capabilities", [])
            base_ready = base_ready or bool(single_player_report.get("base_content_mod_ready", false)) or (report_capabilities is Array and (report_capabilities as Array).has("base_content_mod_ready"))
            if not str(single_player_report.get("active_base_pack_id", "")).is_empty():
                base_pack_id = str(single_player_report.get("active_base_pack_id", ""))
        elif single_player_entry is Object and "capabilities" in single_player_entry:
            var capabilities_value: Variant = single_player_entry.get("capabilities")
            base_ready = base_ready or (capabilities_value is Array and (capabilities_value as Array).has("base_content_mod_ready"))
    if data_map.has("base_content_mod_ready"):
        base_ready = bool(data_map.get("base_content_mod_ready", false))
    if data_map.has("active_base_pack_id") and not str(data_map.get("active_base_pack_id", "")).is_empty():
        base_pack_id = str(data_map.get("active_base_pack_id", ""))
    target_snapshot["base_content_mod_ready"] = base_ready
    if not base_pack_id.is_empty():
        target_snapshot["active_base_pack_id"] = base_pack_id


## 渲染当前运行模式标签、基础 MOD 激活状态横幅及创世按钮可用态
static func render_header_and_banner(host_view: Variant) -> void:
    if host_view.mode_status_label != null:
        var mode_key := "ui.wg.mode.multiplayer" if host_view.current_gateway_mode == 2 else "ui.wg.mode.single_player"
        UIIntermediary.resolve(host_view.mode_status_label, mode_key)
    if host_view.base_mod_banner_label != null:
        if host_view.base_content_mod_ready:
            UIIntermediary.resolve(host_view.base_mod_banner_label, "ui.wg.banner.base_ready", {"pack_id": host_view.active_base_pack_id})
            host_view.base_mod_banner_label.modulate = DesignTokens.COLOR_SUCCESS_DEFAULT
        else:
            UIIntermediary.resolve(host_view.base_mod_banner_label, "ui.wg.banner.base_missing")
            host_view.base_mod_banner_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
    if host_view.create_world_btn != null:
        host_view.create_world_btn.disabled = not host_view.base_content_mod_ready and host_view.current_gateway_mode == 1


## 刷新单机世界档案列表项并在首项未选中时触发选中回调
static func render_worlds_list(host_view: Variant, select_world_callback: Callable) -> void:
    if host_view.world_archive_list == null:
        return
    host_view.world_archive_list.clear()
    for world_index in range(host_view.saved_worlds.size()):
        var world_entry: Variant = host_view.saved_worlds[world_index]
        if not (world_entry is Dictionary):
            continue
        var entry_map := world_entry as Dictionary
        var world_id := str(entry_map.get("world_id", ""))
        var display_name := str(entry_map.get("display_name", world_id))
        var line_text := "%s (%s)" % [display_name, world_id]
        var item_index: int = host_view.world_archive_list.add_item(line_text)
        host_view.world_archive_list.set_item_metadata(item_index, world_id)
        if world_id == host_view.selected_world_id:
            host_view.world_archive_list.select(item_index)
    if host_view.saved_worlds.size() > 0 and host_view.selected_world_id.is_empty() and select_world_callback.is_valid():
        select_world_callback.call(0)


## 渲染当前选中世界档案的 MOD 锁定诊断面板
static func render_world_diagnostics(host_view: Variant) -> void:
    if host_view == null or host_view.world_detail_rich_label == null:
        return
    if host_view.selected_world_id.is_empty():
        host_view.world_detail_rich_label.text = UIIntermediary.text("ui.wg.sp.no_world_selected")
        return
    var status_code := str(host_view.last_world_diagnostics.get("status", "UNKNOWN"))
    var locked_mods: Variant = host_view.last_world_diagnostics.get("locked_mods", [])
    var missing_mods: Variant = host_view.last_world_diagnostics.get("missing_mods", [])
    var mismatch_mods: Variant = host_view.last_world_diagnostics.get("digest_mismatches", [])
    host_view.world_detail_rich_label.text = UIIntermediary.text("ui.wg.sp.diagnostics_summary", {
        "world_id": host_view.selected_world_id,
        "status": status_code,
        "locked": locked_mods.size() if locked_mods is Array else 0,
        "missing": missing_mods.size() if missing_mods is Array else 0,
        "mismatch": mismatch_mods.size() if mismatch_mods is Array else 0
    })


## 刷新联机界域列表控件条目
static func render_realms_list(host_view: Variant) -> void:
    if host_view.remote_realm_list == null:
        return
    host_view.remote_realm_list.clear()
    for realm_entry in host_view.remote_realms:
        if not (realm_entry is Dictionary):
            continue
        var realm_map := realm_entry as Dictionary
        var realm_name := str(realm_map.get("realm_name", realm_map.get("realm_id", "Realm")))
        var manifest: Variant = realm_map.get("realm_mod_manifest")
        var pack_count: int = (manifest as Array).size() if (manifest is Array) else 0
        host_view.remote_realm_list.add_item(UIIntermediary.text("ui.wg.mp.realm_entry_format", {
            "name": realm_name,
            "count": pack_count
        }))


## 更新联机界域摘要校验证状态标签
static func render_realm_status(host_view: Variant) -> void:
    if host_view == null or host_view.realm_digest_status_label == null:
        return
    if host_view.last_realm_verification.is_empty():
        UIIntermediary.resolve(host_view.realm_digest_status_label, "ui.wg.mp.select_prompt")
        host_view.realm_digest_status_label.modulate = DesignTokens.COLOR_TEXT_MUTED_DEFAULT
        return
    if bool(host_view.last_realm_verification.get("verified", false)):
        UIIntermediary.resolve(host_view.realm_digest_status_label, "ui.wg.mp.digest_matched")
        host_view.realm_digest_status_label.modulate = DesignTokens.COLOR_SUCCESS_DEFAULT
    else:
        host_view.realm_digest_status_label.text = str(host_view.last_realm_verification.get("error_code", "MOD_ERR_REALM_DIGEST_MISMATCH"))
        host_view.realm_digest_status_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
