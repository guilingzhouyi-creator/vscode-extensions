# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/npc_simulation/npc_legacy_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/npc.json | 信号: EventBus 领域广播
# 职责说明: 寿元大限著书立说、自然坐化与遗产门徒交接。 著书参数与叙事文案由 config/npc.json、config/narratives/npc.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name NPCLifeCycleAndLegacyFSM extends RefCounted

## 幂等提交索引（Phase 32 S2）：来源 NPC 仅能成功提交一次传承（防重复发书/转账）。
## 生命周期与存档一致；超过配置保留窗口后由压缩清理（S3 契约）。
static var _committed_npc_ids: Dictionary = {}

## NPC 自然坐化流程：来源校验 + 幂等提交 → 著书立说 → 遗产交接 → 幂等索引写入（有界裁剪）
static func process_npc_natural_demise(
	npc: AutonomousNPCEntity,
	successor_npc: AutonomousNPCEntity
) -> Dictionary:
	# 0. 来源校验 + 幂等（Phase 32 S2）：来源 NPC 必须有效且未提交过传承
	if npc == null or npc.npc_id.is_empty():
		return { "success": false, "code": "NPC_INVALID" }
	if _committed_npc_ids.has(npc.npc_id):
		return { "success": false, "code": "LEGACY_ALREADY_COMMITTED", "npc_id": npc.npc_id }

	var book_name_suffix := GameConfig.get_string("domains.npc", "legacy/book_name_suffix", "之绝学心法")
	var sentence_count := GameConfig.get_int("domains.npc", "legacy/sentence_count", 3)
	var book_price := GameConfig.get_int("domains.npc", "legacy/book_price", 300)
	var royalty_rate := GameConfig.get_float("domains.npc", "legacy/royalty_rate", 0.30)
	var fallback_heir := GameConfig.get_string("domains.npc", "legacy/fallback_heir_name", "世人")

	# 1. 著书立说留传后世
	var ast := SkillSubgraphAST.new()
	ast.skill_name = npc.personal_name + book_name_suffix
	ast.sentence_count = sentence_count
	var legacy_book = GrimoireAuthoringPipeline.publish_manuscript_book(
		npc.npc_id, ast.skill_name, ast, book_price, royalty_rate
	)

	# 2. 遗产交接
	var transferred_gold = npc.wallet.gold
	if successor_npc != null:
		successor_npc.wallet.gold += transferred_gold
		npc.wallet.gold = 0

	EventBusCore.get_instance().emit_narrative_by_key(
		"npc/demise_legacy", "society",
		[npc.personal_name, legacy_book.custom_name, transferred_gold,
		successor_npc.personal_name if successor_npc else fallback_heir]
	)

	# 提交成功后写入幂等索引（防重复发书/转账；失败路径不记录）
	_committed_npc_ids[npc.npc_id] = true
	# P6：无界补上限——写入后按 committed_ids/max_entries 最旧先出裁剪（原「压缩清理」注释契约落地）
	FifoBudget.trim_oldest(_committed_npc_ids, GameConfig.get_int("domains.npc", "committed_ids/max_entries", 5000))

	return { "success": true, "code": "", "legacy_book": legacy_book, "transferred_gold": transferred_gold }
