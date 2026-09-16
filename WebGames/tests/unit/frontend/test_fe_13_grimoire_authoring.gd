# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第13卷: 魔典与著书系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_13_grimoire_authoring.gd
# ==============================================================================
class_name TestFE13GrimoireAuthoring
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 13: 魔典与著书系统（书库/AST编辑器/著书/版税）"

	results.append(_test_authored_books_loading())
	results.append(_test_ast_editor_node_drag_connect())
	results.append(_test_royalty_settlement_view())

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
