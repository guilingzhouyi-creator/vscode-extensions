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
static func switch_gateway_mode(
    host_view: Variant,
    tabs_controller: Variant,
    target_mode: int,
    on_completed: Callable = Callable()
) -> Dictionary:
    var world_service: IWorldService = ServiceLocator.get_instance().world()
    if world_service == null:
        return ServiceLocator.reply_service_unavailable(on_completed)
    var switch_reply: Dictionary = {}
    world_service.switch_gateway_mode_async(
        host_view.current_account_id,
        host_view.current_session_token,
        target_mode,
        func(response_payload: Dictionary) -> void:
            switch_reply.merge(response_payload, true)
            if bool(response_payload.get("success", false)):
                if host_view != null and is_instance_valid(host_view):
                    host_view.current_gateway_mode = target_mode
                if tabs_controller != null:
                    tabs_controller.reset_prepared_world_id()
                if host_view != null and is_instance_valid(host_view) and host_view.mode_tab_container != null:
                    host_view.mode_tab_container.current_tab = 1 if target_mode == 2 else 0
                if tabs_controller != null:
                    tabs_controller.refresh_gateway_state()
            else:
                if host_view != null and is_instance_valid(host_view) and host_view.mode_tab_container != null:
                    host_view.mode_tab_container.current_tab = 1 if host_view.current_gateway_mode == 2 else 0
                NavManager.get_instance().show_toast(str(response_payload.get("error_code", "ERR_SWITCH_MODE_FAILED")), NavTypes.ToastLevel.ERROR)
            if on_completed.is_valid():
                on_completed.call(response_payload)
    )
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


## 校验当前选中联机界域的权威 MOD 清单 SHA-256 摘要，校验通过后切入联机模式并进入世界/创角流程
static func verify_and_enter_selected_realm(
    host_view: Variant,
    tabs_controller: Variant = null,
    on_completed: Callable = Callable()
) -> Dictionary:
    if host_view == null or host_view.selected_realm_index < 0 or host_view.selected_realm_index >= host_view.remote_realms.size():
        NavManager.get_instance().show_toast(UIIntermediary.text("ui.wg.mp.no_realm_selected"), NavTypes.ToastLevel.WARNING)
        var empty_reply := {"success": false, "error_code": "ERR_NO_REALM_SELECTED"}
        if on_completed.is_valid():
            on_completed.call(empty_reply)
        return empty_reply
    var realm_entry: Variant = host_view.remote_realms[host_view.selected_realm_index]
    var realm_map := realm_entry as Dictionary if realm_entry is Dictionary else {}
    var manifest: Variant = realm_map.get("realm_mod_manifest", [])
    var world_service: IWorldService = ServiceLocator.get_instance().world()
    if world_service == null:
        var unavail_reply := {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}
        if on_completed.is_valid():
            on_completed.call(unavail_reply)
        return unavail_reply
    var result_holder: Dictionary = {}
    world_service.verify_realm_manifest_async(
        host_view.current_account_id,
        host_view.current_session_token,
        manifest as Array if manifest is Array else [],
        func(verify_reply: Dictionary) -> void:
            var data_map: Dictionary = verify_reply.get("data", verify_reply) as Dictionary
            var verified := bool(verify_reply.get("success", false)) and bool(data_map.get("verified", true))
            var error_code := str(verify_reply.get("error_code", ""))
            if host_view != null and is_instance_valid(host_view):
                host_view.apply_snapshot({
                    "realm_verification": {
                        "verified": verified,
                        "error_code": error_code
                    }
                })
            if not verified:
                result_holder.merge(verify_reply, true)
                NavManager.get_instance().show_toast(error_code if not error_code.is_empty() else "MOD_ERR_REALM_DIGEST_MISMATCH", NavTypes.ToastLevel.ERROR)
                if on_completed.is_valid():
                    on_completed.call(verify_reply)
                return
            join_verified_realm(host_view, tabs_controller, realm_map, func(join_reply: Dictionary) -> void:
                result_holder.merge(join_reply, true)
                if on_completed.is_valid():
                    on_completed.call(join_reply)
            )
    )
    return result_holder


## 执行已通过清单校验的联机界域接入：对齐联机模式并进入世界或分流创角
static func join_verified_realm(
    host_view: Variant,
    tabs_controller: Variant,
    realm_map: Dictionary,
    on_completed: Callable = Callable()
) -> Dictionary:
    if host_view == null:
        var missing_view_reply := {"success": false, "error_code": "ERR_VIEW_UNAVAILABLE"}
        if on_completed.is_valid():
            on_completed.call(missing_view_reply)
        return missing_view_reply
    var result_holder: Dictionary = {}
    var proceed_enter := func() -> Dictionary:
        var realm_world_id := str(realm_map.get("realm_id", realm_map.get("world_id", "")))
        if realm_world_id.is_empty():
            var verified_reply := {"success": true, "verified": true}
            result_holder.merge(verified_reply, true)
            if on_completed.is_valid():
                on_completed.call(verified_reply)
            return verified_reply
        if tabs_controller != null and tabs_controller.has_method("enter_world_with_routing"):
            var routed: Dictionary = tabs_controller.enter_world_with_routing(
                realm_world_id, 2, true, false, str(realm_map.get("slot_id", "")), func(enter_reply: Dictionary) -> void:
                    result_holder.merge(enter_reply, true)
                    if on_completed.is_valid():
                        on_completed.call(enter_reply)
            )
            if result_holder.is_empty() and not routed.is_empty():
                result_holder.merge(routed, true)
            return result_holder
        var world_service: IWorldService = ServiceLocator.get_instance().world()
        if world_service == null:
            var unavail_reply := {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}
            result_holder.merge(unavail_reply, true)
            if on_completed.is_valid():
                on_completed.call(unavail_reply)
            return unavail_reply
        world_service.enter_world_async(
            host_view.current_account_id,
            host_view.current_session_token,
            realm_world_id,
            false,
            func(response_payload: Dictionary) -> void:
                result_holder.merge(response_payload, true)
                if on_completed.is_valid():
                    on_completed.call(response_payload)
        )
        return result_holder
    if host_view.current_gateway_mode != 2:
        switch_gateway_mode(host_view, tabs_controller, 2, func(switch_reply: Dictionary) -> void:
            if not bool(switch_reply.get("success", false)):
                result_holder.merge(switch_reply, true)
                if on_completed.is_valid():
                    on_completed.call(switch_reply)
                return
            proceed_enter.call()
        )
        return result_holder
    return proceed_enter.call()


## 注销当前登录会话并退回账号首页
static func logout_to_account_entry(host_view: Variant, tabs_controller: Variant, on_completed: Callable = Callable()) -> void:
    var auth_service: IAuthService = ServiceLocator.get_instance().auth()
    var finalize_logout := func() -> void:
        if tabs_controller != null:
            tabs_controller.reset_session_flags()
        ServiceLocator.clear_active_gateway()
        if host_view != null and is_instance_valid(host_view) and host_view.is_mounted_in_tree():
            NavManager.get_instance().replace_screen("account_entry")
    if auth_service != null:
        auth_service.logout_async(
            host_view.current_account_id,
            host_view.current_session_token,
            func(reply: Dictionary) -> void:
                finalize_logout.call()
                if on_completed.is_valid():
                    on_completed.call(reply)
        )
        return
    finalize_logout.call()
    if on_completed.is_valid():
        on_completed.call({"success": true})


## 触发五阶段安全优雅停机退出游戏（headless 运行时仅验证协议闭环而不中断测试进程）
static func quit_desktop_application(host_view: Variant, on_completed: Callable = Callable()) -> Dictionary:
    var account_id := str(host_view.current_account_id) if host_view != null and "current_account_id" in host_view else ""
    var session_token := str(host_view.current_session_token) if host_view != null and "current_session_token" in host_view else ""
    var lifecycle_service: ILifecycleService = ServiceLocator.get_instance().lifecycle()
    var shutdown_reply: Dictionary = {}
    if lifecycle_service == null:
        if host_view != null and DisplayServer.get_name() != "headless" and host_view.is_inside_tree():
            host_view.get_tree().quit()
        if on_completed.is_valid():
            on_completed.call({"success": true})
        return {}
    lifecycle_service.request_graceful_shutdown_async(
        account_id,
        session_token,
        {"exit_reason": 0},
        func(response_payload: Dictionary) -> void:
            shutdown_reply.merge(response_payload, true)
            if not response_payload.is_empty() and not bool(response_payload.get("success", false)):
                var error_code := str(response_payload.get("error_code", "ERR_SHUTDOWN_REJECTED"))
                NavManager.get_instance().show_toast(error_code, NavTypes.ToastLevel.ERROR)
                if on_completed.is_valid():
                    on_completed.call(response_payload)
                return
            if host_view != null and is_instance_valid(host_view) and DisplayServer.get_name() != "headless" and host_view.is_inside_tree():
                host_view.get_tree().quit()
            if on_completed.is_valid():
                on_completed.call(response_payload)
    )
    return shutdown_reply
