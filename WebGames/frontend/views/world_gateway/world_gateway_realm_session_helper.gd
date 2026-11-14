# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 联机界域校验与网关会话切换辅助器)
# 文件路径: res://frontend/views/world_gateway/world_gateway_realm_session_helper.gd
# 架构定位: Presentation Helper / Multiplayer Realm Verify & Gateway Session Controls
# 依赖与触发: 上游: WorldGatewayView | 下游: ServiceLocator, NavManager | 配置: config/frontend/ui.json | 信号: 无
# 职责说明: 承接世界网关模式切换、联机界域列表刷新、联机权威摘要校验、账号注销及优雅停机退出操作。
# 退出语义与设计依据: 随 WorldGatewayView 生命周期触发，注销清空活跃网关绑定
# ==============================================================================

## WorldGatewayRealmSessionHelper：世界网关模式切换、联机界域与会话退出控制器
class_name WorldGatewayRealmSessionHelper
extends BaseScreen


## 切换网关运行模式 (单机 / 联机) 并触发页签同步
static func switch_gateway_mode(host_view: Variant, tabs_controller: Variant, target_mode: int) -> Dictionary:
    var world_service: IWorldService = ServiceLocator.get_instance().world()
    if world_service == null:
        return {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}
    var switch_reply: Dictionary = {}
    world_service.switch_gateway_mode_async(
        host_view.current_account_id,
        host_view.current_session_token,
        target_mode,
        func(response_payload: Dictionary) -> void:
            switch_reply.merge(response_payload, true)
    )
    if bool(switch_reply.get("success", false)):
        host_view.current_gateway_mode = target_mode
        if tabs_controller != null:
            tabs_controller.reset_prepared_world_id()
        if host_view.mode_tab_container != null:
            host_view.mode_tab_container.current_tab = 1 if target_mode == 2 else 0
        if tabs_controller != null:
            tabs_controller.refresh_gateway_state()
    else:
        NavManager.get_instance().show_toast(str(switch_reply.get("error_code", "ERR_SWITCH_MODE_FAILED")), NavTypes.ToastLevel.ERROR)
    return switch_reply


## 刷新联机界域列表
static func refresh_remote_realms(host_view: Variant) -> void:
    var world_service: IWorldService = ServiceLocator.get_instance().world()
    if world_service == null:
        return
    world_service.list_remote_realms_async(
        host_view.current_account_id,
        host_view.current_session_token,
        func(response_payload: Dictionary) -> void:
            var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
            host_view.apply_snapshot({"realms": data_map.get("realms", response_payload.get("realms", []))})
    )


## 校验当前选中联机界域的权威 MOD 清单 SHA-256 摘要
static func verify_and_enter_selected_realm(host_view: Variant) -> Dictionary:
    if host_view == null or host_view.selected_realm_index < 0 or host_view.selected_realm_index >= host_view.remote_realms.size():
        return {"success": false, "error_code": "ERR_NO_REALM_SELECTED"}
    var realm_entry: Variant = host_view.remote_realms[host_view.selected_realm_index]
    var realm_map := realm_entry as Dictionary if realm_entry is Dictionary else {}
    var manifest: Variant = realm_map.get("realm_mod_manifest", [])
    var world_service: IWorldService = ServiceLocator.get_instance().world()
    if world_service == null:
        return {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}
    var verify_reply: Dictionary = {}
    world_service.verify_realm_manifest_async(
        host_view.current_account_id,
        host_view.current_session_token,
        manifest as Array if manifest is Array else [],
        func(response_payload: Dictionary) -> void:
            verify_reply.merge(response_payload, true)
    )
    var data_map: Dictionary = verify_reply.get("data", verify_reply) as Dictionary
    var verified := bool(verify_reply.get("success", false)) and bool(data_map.get("verified", true))
    host_view.apply_snapshot({
        "realm_verification": {
            "verified": verified,
            "error_code": str(verify_reply.get("error_code", ""))
        }
    })
    return verify_reply


## 注销当前登录会话并退回账号首页
static func logout_to_account_entry(host_view: Variant, tabs_controller: Variant) -> void:
    var auth_service: IAuthService = ServiceLocator.get_instance().auth()
    if auth_service != null:
        auth_service.logout_async(host_view.current_account_id, host_view.current_session_token, func(_reply: Dictionary) -> void: pass)
    if tabs_controller != null:
        tabs_controller.reset_session_flags()
    ServiceLocator.clear_active_gateway()
    if host_view.is_inside_tree() or host_view.get_parent() != null:
        NavManager.get_instance().replace_screen("account_entry")


## 触发安全优雅停机退出游戏
static func quit_desktop_application(host_view: Variant) -> void:
    var lifecycle_service: ILifecycleService = ServiceLocator.get_instance().lifecycle()
    if lifecycle_service != null:
        lifecycle_service.quit_game_async(true, "USER_GATEWAY_QUIT", func(_reply: Dictionary) -> void: pass)
    if host_view != null and host_view.get_tree() != null:
        host_view.get_tree().quit()
