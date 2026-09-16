# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端 UI 状态与 Mock 服务测试套件 (Phase 77)
# 文件路径: res://tests/unit/frontend/test_frontend_ui_state_and_mock.gd
# 职责: 验证 UIStateContainer 5 态流转、HudViewModel P71 约束、Mock 服务与弱引用注册表
# ==============================================================================
class_name TestFrontendUiStateAndMock
extends TestCase

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_ui_state_container_transitions())
	results.append(_test_ui_state_container_retry_callback())
	results.append(_test_hud_view_model_p71_invariants())
	results.append(_test_mock_service_container_and_auth())
	results.append(_test_ui_binding_registry_weakref())
	return TestCase.pack_results("frontend_ui_state_and_mock", results)

## 1. 验证 UIStateContainer 5 态流转
static func _test_ui_state_container_transitions() -> Dictionary:
	var container := UIStateContainer.new()
	container._ready()

	container.set_state(UIStateContainer.State.LOADING)
	var is_loading: bool = container.loading_node.visible and not container.error_node.visible

	container.set_state(UIStateContainer.State.EMPTY)
	var is_empty: bool = container.empty_node.visible and not container.loading_node.visible

	container.set_state(UIStateContainer.State.ERROR)
	var is_error: bool = container.error_node.visible and not container.empty_node.visible

	var ok := TestCase.assert_true(is_loading and is_empty and is_error, "UIStateContainer 5 态正确流转")
	container.free()
	return TestCase.make_result("ui_state_container_transitions", ok)

## 2. 验证 UIStateContainer 错误重试回调 (字典容器按引用闭包捕获)
static func _test_ui_state_container_retry_callback() -> Dictionary:
	var container := UIStateContainer.new()
	container._ready()

	var flag := { "retried": false }
	container.bind_retry_callback(func(): flag["retried"] = true)
	container.set_state(UIStateContainer.State.ERROR)
	container._on_retry_pressed()

	var ok := TestCase.assert_true(bool(flag["retried"]) and (container.get_state() == UIStateContainer.State.LOADING), "重试按钮正确触发回调并切回 LOADING")
	container.free()
	return TestCase.make_result("ui_state_container_retry_callback", ok)

## 3. 验证角色三层解耦链严格遵循 P71 约束与零除防御（HudViewModel 已归并至该链）
static func _test_hud_view_model_p71_invariants() -> Dictionary:
	# 故意注入非法的 0/负上限
	var dto := CharacterHudDecoupled.CharacterTransportDTO.new()
	dto.nickname = "阿尔托莉雅"
	dto.hp_current = 50.0
	dto.hp_maximum = 0.0
	dto.ap_current = 5.0
	dto.ap_maximum = -10.0
	dto.coins_copper_total = 100
	dto.mana_monocrystals = 5

	var domain := CharacterHudDecoupled.CharacterDomainModel.from_dto(dto)
	var zero_div_prevented: bool = (domain.max_hp >= 1.0 and domain.ap_max >= 1.0)
	var wallet_copper_ok: bool = (domain.gold * 10000 + domain.silver * 100 + domain.copper) == 100
	var wallet_ok: bool = wallet_copper_ok and (domain.monocrystals == 5)

	var ok := TestCase.assert_true(zero_div_prevented and wallet_ok, "角色解耦模型零除防护与钱包守卫有效")
	return TestCase.make_result("hud_view_model_p71_invariants", ok)

## 4. 验证 Mock 服务契约（注入零延迟实例同步断言）与容器装配完整性
static func _test_mock_service_container_and_auth() -> Dictionary:
	var container := MockServiceContainer.get_instance()

	# 容器装配完整性：四服务全部注册（auth/world/combat/version）
	var container_ok: bool = (container.auth() != null and container.world() != null
		and container.combat() != null and container.version() != null)

	# 契约行为断言：零延迟实例（同步回调），隔离容器默认 200ms 延迟路径
	var auth := MockAuthService.new(0)
	var world := MockWorldService.new(0)

	var box := {
		"login_success": false,
		"login_fail": false,
		"snapshot_ok": false,
		"version_ok": false
	}

	auth.login_async("test_user", "password123", func(res: Dictionary):
		box["login_success"] = res.get("success", false)
	)

	auth.login_async("", "pwd", func(res: Dictionary):
		box["login_fail"] = not res.get("success", true)
	)

	world.get_hud_snapshot_async("CHAR_01", func(res: Dictionary):
		box["snapshot_ok"] = res.get("success", false)
	)

	MockVersionService.new(0).check_version_async(func(res: Dictionary):
		box["version_ok"] = res.get("success", false)
	)

	var passed: bool = (container_ok and bool(box["login_success"]) and bool(box["login_fail"])
		and bool(box["snapshot_ok"]) and bool(box["version_ok"]))
	var ok := TestCase.assert_true(passed, "MockServiceContainer 四服务装配完整且调用契约正确")
	return TestCase.make_result("mock_service_container_and_auth", ok)

## 5. 验证 UIBindingRegistry WeakRef 弱引用防内存泄漏（相对断言，不依赖单例空态）
static func _test_ui_binding_registry_weakref() -> Dictionary:
	var reg := UIBindingRegistry.get_instance()

	# 记录环境基线（单例可能残留运行时绑定），仅断言本次绑定被正确回收
	var base_count := reg.count()

	var lbl := Label.new()
	reg.bind(lbl, "test.key")
	var count_before := reg.count()

	# 销毁节点
	lbl.free()

	# 刷新所有绑定触发失效弱引用惰性清理
	reg.refresh_all()
	var count_after := reg.count()

	var ok := TestCase.assert_true(count_before == base_count + 1 and count_after == base_count, "UIBindingRegistry 弱引用正确回收已释放节点")
	return TestCase.make_result("ui_binding_registry_weakref", ok)
