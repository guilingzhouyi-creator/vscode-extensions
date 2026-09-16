# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端基础设施与解耦模型验收测试套件 (Phase 78)
# 文件路径: res://tests/unit/frontend/test_frontend_infrastructure.gd
# 职责: 验证 DesignTokens 设计令牌、AppLifecycleFSM 13 态状态机、八大 UI 基础设施管理器、
#       三层解耦模型映射、Tooltip 防碰撞翻转与通用原子组件行为契约 (TC-P78-S1~S4)
# ==============================================================================
class_name TestFrontendInfrastructure
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_design_tokens_contract())
	results.append(_test_app_lifecycle_fsm())
	results.append(_test_modal_and_dialog_manager())
	results.append(_test_tooltip_flip_algorithm())
	results.append(_test_red_dot_tree_manager())
	results.append(_test_drawer_and_context_menu_manager())
	results.append(_test_three_layer_model_decoupling())
	results.append(_test_universal_components())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "frontend_infrastructure_phase78",
		"total": results.size(),
		"passed": passed_cnt,
		"all_passed": all_passed,
		"results": results
	}

## 1. 验证 DesignTokens 设计令牌常量契约
static func _test_design_tokens_contract() -> Dictionary:
	var test_name := "test_design_tokens_contract"
	var err := ""

	if DesignTokens.COLOR_PRIMARY.a != 1.0:
		err = "COLOR_PRIMARY 不合法"
	elif DesignTokens.SPACING_MD != 16:
		err = "SPACING_MD 必须为 16px"
	elif DesignTokens.FONT_SIZE_BODY != 14:
		err = "FONT_SIZE_BODY 必须为 14"
	elif DesignTokens.DEBOUNCE_DELAY < 0.1:
		err = "DEBOUNCE_DELAY 过小"
	elif DesignTokens.Z_INDEX_OVERLAY <= DesignTokens.Z_INDEX_MODAL:
		err = "Z_INDEX_OVERLAY 必须高于 Z_INDEX_MODAL"

	return {"name": test_name, "passed": err.is_empty(), "error": err}

## 2. 验证 AppLifecycleFSM 13 态状态机与跃迁守卫 (TC-P78-S3-01)
static func _test_app_lifecycle_fsm() -> Dictionary:
	var test_name := "test_app_lifecycle_fsm"
	var err := ""

	var fsm := AppLifecycleFSM.new()
	if fsm.get_current_state() != AppLifecycleFSM.AppState.BOOT:
		err = "初始状态必须为 BOOT"
		return {"name": test_name, "passed": false, "error": err}

	# 测试非法跳跃：BOOT 直接跳 IN_GAME 应被拒绝
	var invalid_jump := fsm.transition_to(AppLifecycleFSM.AppState.IN_GAME)
	if invalid_jump:
		err = "BOOT 直接跳跃至 IN_GAME 未被拦截"
		return {"name": test_name, "passed": false, "error": err}

	if fsm.get_current_state() != AppLifecycleFSM.AppState.BOOT:
		err = "非法跳转后状态发生漂移"
		return {"name": test_name, "passed": false, "error": err}

	# 测试合法时序链
	var s1 := fsm.transition_to(AppLifecycleFSM.AppState.INITIALIZING)
	var s2 := fsm.transition_to(AppLifecycleFSM.AppState.AUTHENTICATING)
	var s3 := fsm.transition_to(AppLifecycleFSM.AppState.MAIN_MENU)
	var s4 := fsm.transition_to(AppLifecycleFSM.AppState.LOBBY)
	var s5 := fsm.transition_to(AppLifecycleFSM.AppState.IN_GAME)
	var s6 := fsm.transition_to(AppLifecycleFSM.AppState.RESULT)

	if not (s1 and s2 and s3 and s4 and s5 and s6):
		err = "合法生命周期跃迁失败"
	elif fsm.get_current_state() != AppLifecycleFSM.AppState.RESULT:
		err = "最终状态不匹配"

	return {"name": test_name, "passed": err.is_empty(), "error": err}

## 3. 验证 ModalManager 与 DialogManager 弹窗调度 (TC-P78-S2-04)
static func _test_modal_and_dialog_manager() -> Dictionary:
	var test_name := "test_modal_and_dialog_manager"
	var err := ""

	var container := Control.new()
	var layer := CanvasLayer.new()
	layer.add_child(container)

	var modal_mgr := ModalManager.new()
	modal_mgr.bind_layer(layer, container)

	var dummy_modal := Control.new()
	dummy_modal.name = "DummyModal"
	modal_mgr.open_modal(dummy_modal, false)

	if modal_mgr.get_modal_count() != 1:
		err = "Modal 计数不为 1"
	elif modal_mgr.get_top_modal() != dummy_modal:
		err = "Top Modal 实例不匹配"

	modal_mgr.close_modal(dummy_modal)
	if modal_mgr.get_modal_count() != 0:
		err = "Modal 关闭后计数未清零"

	layer.queue_free()
	modal_mgr.queue_free()

	return {"name": test_name, "passed": err.is_empty(), "error": err}

## 4. 验证 TooltipManager 防碰撞翻转算法 (TC-P78-S2-02)
static func _test_tooltip_flip_algorithm() -> Dictionary:
	var test_name := "test_tooltip_flip_algorithm"
	var err := ""

	var vp_size := Vector2(1920, 1080)
	var tip_size := Vector2(200, 100)

	# 场景 A: 屏幕中央 (600, 400)，应该在目标右侧展开
	var target_center := Rect2(600, 400, 50, 50)
	var pos_center := TooltipManager.calculate_tooltip_pos(target_center, tip_size, vp_size)
	if pos_center.x <= target_center.position.x + target_center.size.x:
		err = "中央目标 Tooltip 未向右侧偏移"

	# 场景 B: 紧靠屏幕右侧边缘 (1850, 400)，应该自动翻转到左侧
	var target_right := Rect2(1850, 400, 50, 50)
	var pos_right := TooltipManager.calculate_tooltip_pos(target_right, tip_size, vp_size)
	if pos_right.x >= target_right.position.x:
		err = "右侧边缘 Tooltip 未发生向左翻转"
	elif pos_right.x + tip_size.x > vp_size.x:
		err = "翻转后仍然超出视口右边界"

	# 场景 C: 紧靠屏幕底部边缘 (500, 1050)，应该自动向上钳制
	var target_bottom := Rect2(500, 1050, 50, 50)
	var pos_bottom := TooltipManager.calculate_tooltip_pos(target_bottom, tip_size, vp_size)
	if pos_bottom.y + tip_size.y > vp_size.y:
		err = "底部边缘 Tooltip 超出视口底边界"

	return {"name": test_name, "passed": err.is_empty(), "error": err}

## 5. 验证 RedDotTreeManager 树状红点自底向上聚合算法
static func _test_red_dot_tree_manager() -> Dictionary:
	var test_name := "test_red_dot_tree_manager"
	var err := ""

	var rdt := RedDotTreeManager.new()
	rdt.set_count("main_hud.social.mail", 3)

	if rdt.get_count("main_hud.social.mail") != 3:
		err = "叶子节点计数不为 3"
	elif rdt.get_count("main_hud.social") != 3:
		err = "父级节点未继承叶子计数值"
	elif rdt.get_count("main_hud") != 3:
		err = "根级节点未继承叶子计数值"

	# 增加同级叶子
	rdt.set_count("main_hud.social.chat", 2)
	if rdt.get_count("main_hud.social") != 5:
		err = "多叶子节点父级聚合错误"
	elif rdt.get_count("main_hud") != 5:
		err = "多叶子节点根级聚合错误"

	# 清理 mail 叶子
	rdt.set_count("main_hud.social.mail", 0)
	if rdt.get_count("main_hud.social") != 2:
		err = "消除叶子后父级未扣减"

	return {"name": test_name, "passed": err.is_empty(), "error": err}

## 6. 验证 DrawerManager 与 ContextMenuManager 视口挂载
static func _test_drawer_and_context_menu_manager() -> Dictionary:
	var test_name := "test_drawer_and_context_menu_manager"
	var err := ""

	var layer := CanvasLayer.new()
	var container := Control.new()
	layer.add_child(container)

	var drawer_mgr := DrawerManager.new()
	drawer_mgr.bind_layer(layer, container)

	var drawer := Control.new()
	drawer_mgr.open_drawer(drawer, DrawerManager.EdgeSide.RIGHT)
	if not drawer_mgr.is_drawer_open():
		err = "Drawer 未处于打开状态"
	elif drawer_mgr.get_active_drawer() != drawer:
		err = "活跃 Drawer 不匹配"

	drawer_mgr.close_drawer(drawer)
	if drawer_mgr.is_drawer_open():
		err = "Drawer 关闭后仍处于打开状态"

	layer.queue_free()
	drawer_mgr.queue_free()

	return {"name": test_name, "passed": err.is_empty(), "error": err}

## 7. 验证三层模型解耦与零除防御 (TC-P78-S1-02, TC-P78-S1-03)
static func _test_three_layer_model_decoupling() -> Dictionary:
	var test_name := "test_three_layer_model_decoupling"
	var err := ""

	var dto := CharacterHudDecoupled.CharacterTransportDTO.new()
	dto.character_id = "char_99"
	dto.nickname = "测试勇士"
	dto.level_raw = 15
	dto.hp_current = 20.0
	dto.hp_maximum = 100.0
	dto.coins_copper_total = 12345 # 1金 23银 45铜
	dto.mana_monocrystals = 8

	var domain := CharacterHudDecoupled.CharacterDomainModel.from_dto(dto)
	if domain.gold != 1 or domain.silver != 23 or domain.copper != 45:
		err = "货币三元组折算错误"
	elif domain.get_health_ratio() != 0.2:
		err = "血量百分比试算错误"

	# 零除与极端负数防御守卫断言 (TC-P78-S1-03)
	domain.max_hp = 0.0 # 非法值
	var safe_ratio := domain.get_health_ratio()
	if is_nan(safe_ratio) or is_inf(safe_ratio):
		err = "max_hp=0 时产生除零 NaN/INF 崩溃"
	elif safe_ratio != 20.0: # clamped to safe_max 1.0 -> 20/1 = 20 -> clampf = 1.0 (Wait, 20/1.0 clamped to 1.0 is 1.0)
		# let's check: current_hp = 20.0, max_hp = 0.0 -> safe_max = 1.0 -> clampf(20.0 / 1.0, 0.0, 1.0) = 1.0!
		if safe_ratio != 1.0:
			err = "零除安全比率未正确钳制至 1.0"

	var vm := CharacterHudDecoupled.CharacterHUDViewModel.new()
	vm.update_from_domain(domain)
	if vm.name_text != "测试勇士":
		err = "ViewModel 昵称映射失败"
	elif vm.wallet_formatted_string != "1 金 23 银 45 铜":
		err = "ViewModel 钱包格式化串错误: %s" % vm.wallet_formatted_string

	return {"name": test_name, "passed": err.is_empty(), "error": err}

## 8. 验证通用原子组件行为 (KVirtualList 可视范围计算)
static func _test_universal_components() -> Dictionary:
	var test_name := "test_universal_components"
	var err := ""

	# 100 件道具，每件高 50px，滚动到 y=200，视口高 300px
	var rng := KVirtualList.calculate_visible_range(200.0, 300.0, 50.0, 100, 2)
	# 200 / 50 = 4, buffer 2 -> start_idx = 4 - 2 = 2
	# (200 + 300) / 50 = 10, buffer 2 -> end_idx = 10 + 2 = 12
	if rng.x != 2 or rng.y != 12:
		err = "KVirtualList 可视范围计算不符预期: %s" % str(rng)

	# 极端空列表测试
	var empty_rng := KVirtualList.calculate_visible_range(0.0, 400.0, 50.0, 0)
	if empty_rng != Vector2i(-1, -1):
		err = "空数据列表未返回安全负索引"

	return {"name": test_name, "passed": err.is_empty(), "error": err}
