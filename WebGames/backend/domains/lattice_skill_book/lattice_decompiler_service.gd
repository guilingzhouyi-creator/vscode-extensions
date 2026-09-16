# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lattice_skill_book/lattice_decompiler_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lattice.json | 信号: EventBus 领域广播
# 职责说明: 空间测地线拓扑剪枝降能损、DAG 环路检测与拓扑哈希生成。 剪枝率/能损系数/签名格式由 config/lattice.json 驱动（签名格式 变化会破坏跨版本指纹兼容，改配置需谨慎）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name LatticeDecompilerService extends RefCounted

## 三维点阵空间拉线反编译优化求解器
static func optimize_lattice_path(ast: SkillSubgraphAST, learner_int: float) -> Dictionary:
	var path_reduction := GameConfig.get_float("domains.lattice", "decompiler/path_reduction", 0.35) # 空间拓扑测地线缩短 35%
	var loss_coefficient := GameConfig.get_float("domains.lattice", "decompiler/loss_coefficient", 0.40)
	# L1（Phase 55）：归一化分母下限守卫（Inv-VD-1）——配置 0 时 float 除零产出 inf 污染能量损耗指标
	var learner_normalize := maxf(1.0, GameConfig.get_float("domains.lattice", "decompiler/learner_normalize", 50.0))
	var min_sentences := GameConfig.get_int("domains.lattice", "decompiler/min_sentences", 1)

	var original_sentences = ast.sentence_count
	var optimized_sentences = max(min_sentences, int(round(float(original_sentences) * (1.0 - path_reduction))))
	ast.sentence_count = optimized_sentences

	var loss_bonus = path_reduction * loss_coefficient * (max(1.0, learner_int) / learner_normalize)

	return {
		"original_sentences": original_sentences,
		"optimized_sentences": optimized_sentences,
		"path_reduction_percent": path_reduction * 100.0,
		"energy_loss_reduction": loss_bonus
	}

## 检测技能 DAG 图中是否存在死循环/环路 (拓扑合法性校验)
static func is_acyclic_dag(ast: SkillSubgraphAST) -> bool:
	var in_degree: Dictionary = {}
	var adj: Dictionary = {}

	for node_id in ast.nodes:
		in_degree[node_id] = 0
		adj[node_id] = []

	for edge in ast.edges:
		var u = edge.get("from", "")
		var v = edge.get("to", "")
		if in_degree.has(v) and adj.has(u):
			in_degree[v] += 1
			adj[u].append(v)

	var queue: Array[String] = []
	for node_id in in_degree:
		if in_degree[node_id] == 0:
			queue.append(node_id)

	var visited_count := 0
	while queue.size() > 0:
		var curr = queue.pop_front()
		visited_count += 1
		for nxt in adj.get(curr, []):
			in_degree[nxt] -= 1
			if in_degree[nxt] == 0:
				queue.append(nxt)

	return visited_count == ast.nodes.size()

static func generate_ast_signature(ast: SkillSubgraphAST) -> String:
	var prefix := GameConfig.get_string("domains.lattice", "decompiler/signature_prefix", "AST:")
	var title_sep := GameConfig.get_string("domains.lattice", "decompiler/signature_title_sep", ":")
	var node_format := GameConfig.get_string("domains.lattice", "decompiler/signature_node_format", "%s:%s;")

	var repr_str = prefix + ast.skill_name + title_sep
	var sorted_keys = ast.nodes.keys()
	sorted_keys.sort()
	for k in sorted_keys:
		var n = ast.nodes[k]
		repr_str += node_format % [k, n.get("symbol", "")]

	ast.signature_hash = repr_str.sha256_text()
	return ast.signature_hash
