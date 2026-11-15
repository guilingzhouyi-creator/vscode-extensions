# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第1卷 账号与入口后端链路协同辅助器)
# 文件路径: res://frontend/views/account_entry/account_entry_backend_helper.gd
# 架构定位: Presentation Helper / Auth & World Gateway Async Coordinator
# 依赖与触发: 上游: AccountEntryView | 下游: ServiceLocator, AccountEntryTabs, FrontendSnapshot
# 职责说明: 承接实网/后端模式下的登录、注册自动登录、角色创建与世界网关进入异步流程。
# 退出语义与设计依据: 随 AccountEntryView 生命周期协同触发，隔离长视图体积与单向服务边界
# ==============================================================================

## AccountEntryBackendHelper：账号登录、注册、创角与网关进入后端流程辅助器
class_name AccountEntryBackendHelper
extends BaseScreen


## 执行实网或后端模式下的账号登录流程并跳转选角界面
static func login_backend_flow(
    view: AccountEntryView,
    username: String,
    password_text: String,
    on_completed: Callable = Callable()
) -> Dictionary:
    var auth_service: IAuthService = ServiceLocator.get_instance().auth()
    if auth_service == null or not auth_service.has_method("login_async"):
        var missing_reply := {"success": false, "error_code": "ERR_AUTH_SERVICE_UNAVAILABLE"}
        if on_completed.is_valid():
            on_completed.call(missing_reply)
        return missing_reply
    var result_holder: Dictionary = {}
    auth_service.login_async(
        username,
        password_text,
        func(auth_reply: Dictionary) -> void:
            result_holder.merge(auth_reply, true)
            if bool(auth_reply.get("success", false)) and view != null and is_instance_valid(view):
                view.current_account_id = str(auth_reply.get("account_id", ""))
                view.current_session_token = str(auth_reply.get("token", ""))
                var slots_list: Array = auth_reply.get("character_slots", [])
                view.set_character_slots_snapshot(slots_list)
                view.switch_state(AccountEntryView.EntryState.CHARACTER_SELECT)
            if on_completed.is_valid():
                on_completed.call(auth_reply)
    )
    return result_holder


## 执行实网或后端模式下的账号注册流程，启用自动登录并读取权威令牌
static func register_backend_flow(
    view: AccountEntryView,
    username: String,
    password_text: String,
    on_completed: Callable = Callable()
) -> Dictionary:
    var register_reply: Dictionary = {}
    var auth_service: IAuthService = ServiceLocator.get_instance().auth()
    if auth_service == null or not auth_service.has_method("register_async"):
        var missing_reply := {"success": false, "error_code": "ERR_AUTH_SERVICE_UNAVAILABLE"}
        if on_completed.is_valid():
            on_completed.call(missing_reply)
        return missing_reply
    auth_service.register_async(
        username,
        password_text,
        func(reply_payload: Dictionary) -> void:
            register_reply.merge(reply_payload, true)
            if not bool(reply_payload.get("success", false)):
                if on_completed.is_valid():
                    on_completed.call(reply_payload)
                return
            if view != null and is_instance_valid(view):
                view.current_account_id = str(reply_payload.get("account_id", ""))
                view.current_session_token = str(reply_payload.get("token", reply_payload.get("session_token", "")))
            var character_list: Array = reply_payload.get("character_slots", []) if reply_payload.get("character_slots") is Array else []
            var finalize_register := func(slots_array: Array) -> void:
                if view != null and is_instance_valid(view):
                    if not slots_array.is_empty():
                        view.set_character_slots_snapshot(slots_array)
                    view.switch_state(AccountEntryView.EntryState.CHARACTER_CREATE)
                if on_completed.is_valid():
                    on_completed.call(reply_payload)
            if character_list.is_empty() and view != null and auth_service.has_method("get_characters_async"):
                auth_service.get_characters_async(
                    view.current_account_id,
                    func(characters_reply: Dictionary) -> void:
                        var fetched: Array = characters_reply.get("characters", []) if characters_reply.get("characters") is Array else []
                        finalize_register.call(fetched)
                )
                return
            finalize_register.call(character_list),
        true
    )
    return register_reply


## 执行后端模式下的角色创建并刷新角色槽位列表
static func create_character_backend_flow(
    view: AccountEntryView,
    tabs_delegate: AccountEntryTabs,
    character_name: String,
    race: String,
    on_completed: Callable = Callable()
) -> Dictionary:
    var auth_service: IAuthService = ServiceLocator.get_instance().auth()
    if auth_service == null or not auth_service.has_method("create_character_async"):
        return {"_handled": false}
    var result_holder: Dictionary = {"_handled": true}
    auth_service.create_character_async(
        view.current_account_id,
        {"name": character_name, "race": race},
        func(create_reply: Dictionary) -> void:
            result_holder["result"] = create_reply
            if not bool(create_reply.get("success", false)):
                if on_completed.is_valid():
                    on_completed.call(result_holder)
                return
            var finalize_create := func(refreshed_characters: Array) -> void:
                if view != null and is_instance_valid(view):
                    if not refreshed_characters.is_empty():
                        view.set_character_slots_snapshot(refreshed_characters)
                    if tabs_delegate != null:
                        tabs_delegate.populate_character_slots()
                    view.switch_state(AccountEntryView.EntryState.CHARACTER_SELECT)
                if on_completed.is_valid():
                    on_completed.call(result_holder)
            if view != null and auth_service.has_method("get_characters_async"):
                auth_service.get_characters_async(
                    view.current_account_id,
                    func(characters_reply: Dictionary) -> void:
                        var fetched: Array = characters_reply.get("characters", []) if characters_reply.get("characters") is Array else []
                        finalize_create.call(fetched)
                )
                return
            finalize_create.call([])
    )
    return result_holder


## 通过世界边界服务推进网关会话状态机进入游戏世界阶段
static func advance_gateway_to_world(view: AccountEntryView, on_completed: Callable = Callable()) -> void:
    var world_service: IWorldService = ServiceLocator.get_instance().world()
    if world_service == null or view == null or view.current_account_id.is_empty():
        if on_completed.is_valid():
            on_completed.call({"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"})
        return
    var enter_target_world := func(target_world_id: String) -> void:
        if view == null or not is_instance_valid(view):
            return
        world_service.enter_world_async(
            view.current_account_id,
            view.current_session_token,
            target_world_id,
            false,
            func(enter_reply: Dictionary) -> void:
                if on_completed.is_valid():
                    on_completed.call(enter_reply)
        )
    world_service.select_mode_async(
        view.current_account_id,
        view.current_session_token,
        1,
        [],
        func(reply_payload: Dictionary) -> void:
            var selected_world_id := ""
            var response_map: Dictionary = reply_payload.get("data", reply_payload) as Dictionary
            var context_value: Variant = response_map.get("context", {})
            if context_value is Dictionary:
                selected_world_id = str((context_value as Dictionary).get("selected_world_id", ""))
            if view != null and is_instance_valid(view) and not view.selected_character_slot.is_empty():
                world_service.attach_ready_character_async(
                    view.current_account_id,
                    view.current_session_token,
                    view.selected_character_slot,
                    func(_attach_reply: Dictionary) -> void:
                        enter_target_world.call(selected_world_id)
                )
                return
            enter_target_world.call(selected_world_id)
    )
