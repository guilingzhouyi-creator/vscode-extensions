# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lattice_skill_book/grimoire_authoring_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lattice.json | 信号: EventBus 领域广播
# 职责说明: 招式手稿物品实例化、藏经阁流通与作者版税分润结算。 ID/名称前缀、默认价格版税与叙事文案由 config/lattice.json、 config/narratives/lattice.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name GrimoireAuthoringPipeline extends RefCounted

## base_market_price / royalty_rate 传 -1 时取配置默认值（GDScript 默认参数须为常量表达式）
static func publish_manuscript_book(
	author_id: String,
	book_title: String,
	source_ast: SkillSubgraphAST,
	base_market_price: int = -1,
	royalty_rate: float = -1.0
) -> SkillSubgraphAST.ManuscriptItemEntity:
	var price = base_market_price
	if price < 0:
		price = GameConfig.get_int("domains.lattice", "manuscript_defaults/default_price", 100)
	var royalty = royalty_rate
	if royalty < 0.0:
		royalty = GameConfig.get_float("domains.lattice", "manuscript_defaults/default_royalty_rate", 0.20)
	royalty = clampf(royalty, 0.0, 1.0)

	var id_prefix := GameConfig.get_string("domains.lattice", "manuscript_defaults/item_id_prefix", "MANUSCRIPT_")
	var name_prefix := GameConfig.get_string("domains.lattice", "manuscript_defaults/display_name_prefix", "【著书】")
	var initial_circulation := GameConfig.get_int("domains.lattice", "manuscript_defaults/copy_circulation_count", 1)
	var hash_preview_len := GameConfig.get_int("domains.lattice", "decompiler/hash_preview_len", 8)

	# 1. 签名与拓扑审计
	LatticeDecompilerService.generate_ast_signature(source_ast)

	# 2. 实例化典籍手稿实体
	var manuscript := SkillSubgraphAST.ManuscriptItemEntity.new()
	manuscript.item_id = UniqueIdGenerator.next_id(id_prefix)
	manuscript.custom_name = name_prefix + book_title
	manuscript.author_character_id = author_id
	manuscript.imprinted_ast = source_ast
	manuscript.market_base_price = price
	manuscript.royalty_percent = royalty
	manuscript.copy_circulation_count = initial_circulation

	EventBusCore.get_instance().emit_narrative_by_key(
		"lattice/book_published", "grimoire",
		[author_id, manuscript.custom_name, source_ast.signature_hash.substr(0, hash_preview_len)],
		{ "book_id": manuscript.item_id, "author_id": author_id, "price": price, "hash": source_ast.signature_hash }
	)

	return manuscript

static func settle_book_royalties(manuscript: SkillSubgraphAST.ManuscriptItemEntity, copies_sold: int) -> int:
	var total_gross = copies_sold * manuscript.market_base_price
	var author_payout = int(floor(float(total_gross) * manuscript.royalty_percent))
	manuscript.copy_circulation_count += copies_sold

	EventBusCore.get_instance().emit_narrative_by_key(
		"lattice/royalties_settled", "economy",
		[manuscript.custom_name, copies_sold, manuscript.author_character_id, author_payout]
	)
	return author_payout
