# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端可视化边界与快照契约验收套件 (Phase 81)
# 文件路径: res://tests/unit/frontend/test_frontend_boundary.gd
# 职责: 验证统一快照 DTO 序列化对等与防御兜底、BaseScreen 唯一注入入口、五态容器与视图基类继承
# ==============================================================================
class_name TestFrontendBoundary
extends TestCase

const FrontendHudSnapshot = preload("res://frontend/domain_boundary/contracts/frontend_hud_snapshot.gd")
const BaseScreenClass = preload("res://frontend/presentation/base/base_screen.gd")
const UIStateContainerClass = preload("res://frontend/presentation/common/ui_state_container.gd")
const MainHUDView = preload("res://frontend/views/main_hud/main_hud_view.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_snapshot_round_trip())
	results.append(_test_snapshot_defensive_defaults())
	results.append(_test_base_screen_snapshot_entry())
	results.append(_test_base_screen_ui_state_states())
	results.append(_test_view_boundary_inheritance())
	results.append(_test_hud_snapshot_render_mapping())
	return TestCase.pack_results("frontend_boundary", results)

## 1. 快照序列化往返深度对等
static func _test_snapshot_round_trip() -> Dictionary:
	var dto := FrontendHudSnapshot.new()
	dto.character_id = "char_81"
	dto.nickname = "边界勇士"
	dto.hp_current = 88.0
	dto.hp_max = 100.0
	dto.gold = 7
	var restored := FrontendHudSnapshot.from_dictionary(dto.to_dictionary())
	var ok := TestCase.assert_eq(restored.to_dictionary(), dto.to_dictionary(), "快照序列化往返深度对等")
	return TestCase.make_result("snapshot_round_trip", ok)

## 2. 空数据防御兜底（零除/越界安全）
static func _test_snapshot_defensive_defaults() -> Dictionary:
	var empty := FrontendHudSnapshot.from_dictionary({})
	var ok := TestCase.assert_gte(empty.hp_max, 1.0, "空数据 hp_max 安全下限")
	ok = ok and TestCase.assert_false(is_nan(empty.get_health_ratio()), "零除防御不产生 NaN")
	ok = ok and TestCase.assert_eq(empty.get_health_ratio(), 0.0, "空数据血量比例归零")
	ok = ok and TestCase.assert_gte(empty.level, 1, "等级不低于 1")
	return TestCase.make_result("snapshot_defensive_defaults", ok)

## 3. BaseScreen 唯一快照注入入口
static func _test_base_screen_snapshot_entry() -> Dictionary:
	var screen := BaseScreenClass.new()
	screen.apply_snapshot({"hp_current": 12.0, "hp_max": 50.0})
	var ok := TestCase.assert_eq(screen.snapshot.get("hp_current", 0.0), 12.0, "apply_snapshot 写入快照")
	screen.free()
	return TestCase.make_result("base_screen_snapshot_entry", ok)

## 4. BaseScreen 五态容器切换契约
static func _test_base_screen_ui_state_states() -> Dictionary:
	var screen := BaseScreenClass.new()
	screen.show_loading_state()
	var ok := TestCase.assert_eq(screen.get_ui_state_container().get_state(), UIStateContainerClass.State.LOADING, "加载态切换")
	screen.show_empty_state()
	ok = ok and TestCase.assert_eq(screen.get_ui_state_container().get_state(), UIStateContainerClass.State.EMPTY, "空态切换")
	screen.show_error_state("边界错误")
	ok = ok and TestCase.assert_eq(screen.get_ui_state_container().get_state(), UIStateContainerClass.State.ERROR, "错误态切换")
	screen.show_ready_state()
	ok = ok and TestCase.assert_eq(screen.get_ui_state_container().get_state(), UIStateContainerClass.State.READY, "就绪态切换")
	screen.free()
	return TestCase.make_result("base_screen_ui_state_states", ok)

## 5. 视图统一继承 BaseScreen 基座（回归：视图越过基座直连数据源）
static func _test_view_boundary_inheritance() -> Dictionary:
	var hud := MainHUDView.new()
	var ok := TestCase.assert_true(hud is BaseScreen, "HUD 视图继承 BaseScreen 基座")
	hud.free()
	return TestCase.make_result("view_boundary_inheritance", ok)

## 6. HUD 快照渲染映射（字段 → 视图状态，不做业务计算）
static func _test_hud_snapshot_render_mapping() -> Dictionary:
	var hud := MainHUDView.new()
	hud.apply_snapshot({
		"nickname": "快照勇士",
		"hp_current": 66.0,
		"hp_max": 100.0,
		"gold": 321,
		"monocrystals": 9,
	})
	var ok := TestCase.assert_eq(hud.stat_hp_current, 66.0, "快照字段映射到状态字段")
	ok = ok and TestCase.assert_eq(hud.wallet_gold, 321, "快照钱包映射")
	ok = ok and TestCase.assert_eq(hud.character_name, "快照勇士", "快照昵称映射")
	hud.free()
	return TestCase.make_result("hud_snapshot_render_mapping", ok)
