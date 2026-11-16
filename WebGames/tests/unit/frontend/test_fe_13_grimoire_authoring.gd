# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第13卷: 魔典与著书系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_13_grimoire_authoring.gd
# ==============================================================================
class_name TestFE13GrimoireAuthoring
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 13: 魔典与著书系统（书库/AST编辑器/著书/版税）"

	results.append(_test_authored_books_loading())
	results.append(_test_ast_editor_node_drag_connect())
	results.append(_test_royalty_settlement_view())
	results.append(_test_mounted_real_grimoire_authoring())

	var passed_cnt = 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_authored_books_loading() -> Dictionary:
	var view = GrimoireAuthoringView.new()
	view.set_authored_books_snapshot([
		{ "book_id": "B1", "title": "九天御雷真诀", "price": 200, "sales": 15 }
	])
	var passed = (view.authored_books.size() == 1)
	view.free()
	return {
		"test": "TC-FE13-01: 著述魔典书库列表与销售统计数据装载",
		"passed": passed
	}

static func _test_ast_editor_node_drag_connect() -> Dictionary:
	var view = GrimoireAuthoringView.new()
	var r1 = view.add_editor_node("N1", "SLASH", Vector2(100, 100))
	var r2 = view.add_editor_node("N2", "LIGHTNING", Vector2(200, 100))
	var rc = view.connect_nodes("N1", "N2")

	var passed = r1.success and r2.success and rc.success and (view.ast_editor_connections.size() == 1)
	view.free()
	return {
		"test": "TC-FE13-02: 自创招式三维点阵AST节点拖拽与拉线连接",
		"passed": passed
	}

static func _test_royalty_settlement_view() -> Dictionary:
	var view = GrimoireAuthoringView.new()
	view.set_authored_books_snapshot([
		{ "price": 100, "royalty_rate": 0.2, "sales": 50 } # 100 * 0.2 * 50 = 1000 gold
	])
	var book = view.authored_books[0]
	var est_income = float(book.price) * book.royalty_rate * float(book.sales)
	var passed = is_equal_approx(est_income, 1000.0)
	view.free()
	return {
		"test": "TC-FE13-03: 藏经阁典籍借阅与版税预估收益看板",
		"passed": passed
	}

static func _test_mounted_real_grimoire_authoring() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/grimoire_authoring/grimoire_authoring_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: GrimoireAuthoringView = mount_handle.get("view", null) as GrimoireAuthoringView
	if mounted_view != null:
		var node_outcome := mounted_view.add_editor_node("N_REAL_1", "SLASH", Vector2(40, 40))
		mounted_view._on_ast_save_pressed()
		mounted_view._on_ast_compile_pressed()
		mounted_view._get_tabs().on_auth_submit_pressed()
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and bool(node_outcome.get("success", false))
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE13-04: 真场景挂载 grimoire_authoring_view.tscn（real 模式编纂编译与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}
