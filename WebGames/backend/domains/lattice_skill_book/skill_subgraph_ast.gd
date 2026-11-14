# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lattice_skill_book/skill_subgraph_ast.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lattice.json | 信号: EventBus 领域广播
# 职责说明: 技能子图 AST 拓扑结构、SHA-256 签名、典籍手稿实体与藏经阁版税。 默认技能名/手稿名/分类/版税由 config/lattice.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SkillSubgraphAST：Domain Logic Component
class_name SkillSubgraphAST
extends RefCounted

var ast_id: String = ""
var skill_name: String = GameConfig.get_string("domains.lattice", "ast_defaults/skill_name", "破空连斩")
var signature_hash: String = ""
var sentence_count: int = GameConfig.get_int("domains.lattice", "ast_defaults/sentence_count", 4)
var nodes: Dictionary = {} # node_id -> { "symbol": "STAB", "pos": Vector3(x,y,z), "ap": -2, "node_type": "PHYSICAL_VERB" }
var edges: Array = [] # [{ "from": "n1", "to": "n2", "weight": 1.0 }]

## 序列化技能子图 AST（节点/边/签名）
func serialize() -> Dictionary:
	return {
		"ast_id": ast_id,
		"skill_name": skill_name,
		"signature_hash": signature_hash,
		"sentence_count": sentence_count,
		"nodes": nodes,
		"edges": edges
	}

## 从字典重建技能子图（缺省回退默认配置）
static func deserialize(serialized_subgraph: Dictionary) -> SkillSubgraphAST:
	var subgraph_ast := SkillSubgraphAST.new()
	subgraph_ast.ast_id = serialized_subgraph.get("ast_id", "")
	subgraph_ast.skill_name = serialized_subgraph.get("skill_name", GameConfig.get_string("domains.lattice", "ast_defaults/deserialize_skill_name", "自创式"))
	subgraph_ast.signature_hash = serialized_subgraph.get("signature_hash", "")
	subgraph_ast.sentence_count = serialized_subgraph.get("sentence_count", GameConfig.get_int("domains.lattice", "ast_defaults/deserialize_sentence_count", 1))
	subgraph_ast.nodes = serialized_subgraph.get("nodes", {})
	subgraph_ast.edges = serialized_subgraph.get("edges", [])
	return subgraph_ast
