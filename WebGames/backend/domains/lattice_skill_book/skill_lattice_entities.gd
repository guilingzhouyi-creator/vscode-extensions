# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lattice_skill_book/skill_lattice_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lattice.json | 信号: EventBus 领域广播
# 职责说明: 技能子图 AST 拓扑结构、SHA-256 签名、典籍手稿实体与藏经阁版税。 默认技能名/手稿名/分类/版税由 config/lattice.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

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
static func deserialize(d: Dictionary) -> SkillSubgraphAST:
	var ast := SkillSubgraphAST.new()
	ast.ast_id = d.get("ast_id", "")
	ast.skill_name = d.get("skill_name", GameConfig.get_string("domains.lattice", "ast_defaults/deserialize_skill_name", "自创式"))
	ast.signature_hash = d.get("signature_hash", "")
	ast.sentence_count = d.get("sentence_count", GameConfig.get_int("domains.lattice", "ast_defaults/deserialize_sentence_count", 1))
	ast.nodes = d.get("nodes", {})
	ast.edges = d.get("edges", [])
	return ast

class ManuscriptItemEntity extends RefCounted:
	var item_id: String = ""
	var custom_name: String = GameConfig.get_string("domains.lattice", "manuscript_defaults/custom_name", "古老剑谱残卷")
	var category: String = GameConfig.get_string("domains.lattice", "manuscript_defaults/category", "MANUSCRIPT_GRIMOIRE")
	var author_character_id: String = ""
	var imprinted_ast: SkillSubgraphAST = null
	var royalty_percent: float = GameConfig.get_float("domains.lattice", "manuscript_defaults/royalty_percent", 0.15)
	var market_base_price: int = GameConfig.get_int("domains.lattice", "manuscript_defaults/market_base_price", 50)
	var copy_circulation_count: int = GameConfig.get_int("domains.lattice", "manuscript_defaults/copy_circulation_count", 1)

	## 序列化手稿实体（内嵌 AST 递归序列化）
	func serialize() -> Dictionary:
		return {
			"item_id": item_id,
			"custom_name": custom_name,
			"category": category,
			"author_character_id": author_character_id,
			"imprinted_ast": imprinted_ast.serialize() if imprinted_ast else null,
			"royalty_percent": royalty_percent,
			"market_base_price": market_base_price,
			"copy_circulation_count": copy_circulation_count
		}
