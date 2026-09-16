# ==============================================================================
# 单元测试：领域 4 点阵AST拓扑反编译与著书 (Lattice Skill Book Tests)
# 文件路径: res://tests/unit/domains/test_lattice_skill_book.gd
# ==============================================================================
class_name TestLatticeDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_ast_structure())
	results.append(test_dag_acyclic_assertion())
	results.append(test_lattice_optimization())
	results.append(test_grimoire_publishing_and_royalties())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 04: 点阵AST反编译与著书", "all_passed": all_passed, "results": results }

static func test_ast_structure() -> Dictionary:
	var ast := SkillSubgraphAST.new()
	ast.ast_id = "AST_001"
	ast.nodes["n1"] = { "symbol": "STAB", "pos": Vector3(0,0,0) }
	ast.nodes["n2"] = { "symbol": "SLASH", "pos": Vector3(1,0,0) }
	ast.edges.append({ "from": "n1", "to": "n2" })
	var passed = (ast.nodes.size() == 2) and (ast.edges.size() == 1)
	return { "test": "TC-LAT-01: 技能图云三维点阵实体结构完整性", "passed": passed }

static func test_dag_acyclic_assertion() -> Dictionary:
	var ast_valid := SkillSubgraphAST.new()
	ast_valid.nodes = { "n1": {}, "n2": {}, "n3": {} }
	ast_valid.edges = [{ "from": "n1", "to": "n2" }, { "n2": "n3", "from": "n2", "to": "n3" }]
	var ok_dag = LatticeDecompilerService.is_acyclic_dag(ast_valid)

	var ast_cyclic := SkillSubgraphAST.new()
	ast_cyclic.nodes = { "n1": {}, "n2": {} }
	ast_cyclic.edges = [{ "from": "n1", "to": "n2" }, { "from": "n2", "to": "n1" }]
	var cyclic_dag = LatticeDecompilerService.is_acyclic_dag(ast_cyclic)

	var passed = ok_dag and not cyclic_dag
	return { "test": "TC-LAT-02: 技能有向无环图拓扑合法性断言", "passed": passed }

static func test_lattice_optimization() -> Dictionary:
	var ast := SkillSubgraphAST.new()
	ast.sentence_count = 10
	var opt = LatticeDecompilerService.optimize_lattice_path(ast, 80.0)
	var passed = (opt.optimized_sentences < 10) and (opt.energy_loss_reduction > 0.0)
	return { "test": "TC-LAT-03: 三维空间拉线精简句子并降低能损", "passed": passed, "opt": opt }

static func test_grimoire_publishing_and_royalties() -> Dictionary:
	var ast := SkillSubgraphAST.new()
	ast.skill_name = "破空断岳"
	ast.nodes = { "n1": { "symbol": "CRUSH" } }
	var book = GrimoireAuthoringPipeline.publish_manuscript_book("PLAYER_1", "破空断岳", ast, 200, 0.20)
	var payout = GrimoireAuthoringPipeline.settle_book_royalties(book, 10)
	var passed = (book.author_character_id == "PLAYER_1") and (payout == 400) # 10 * 200 * 0.2 = 400
	return { "test": "TC-LAT-04: 自创招式著书立说与藏经阁版权结算", "passed": passed, "payout": payout }
