# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lattice_skill_book/manuscript_item_entity.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GrimoireAuthoringPipeline | 下游: SkillSubgraphAST, GameConfig | 配置: config/domains/lattice.json
# 职责说明: 技能书手稿物品实体模型，承载作者标识、刻印子图 AST 与版税定价契约。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
# ==============================================================================

## ManuscriptItemEntity：技能书手稿物品实体模型，承载作者标识、刻印子图 AST 与版税定价契约。
class_name ManuscriptItemEntity
extends RefCounted

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
