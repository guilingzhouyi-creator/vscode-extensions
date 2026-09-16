# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/starter_loadout_dispatcher.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 配置驱动（starter_loadout.json）的新手初始物资发放，含绝对幂等保护： 首次发放 KIT_DISPATCHED；同上下文二次调用 ALREADY_GRANTED 零重复赠予。 种族经 race_kit_map 映射套件，未知种族/缺失套件走安全兜底默认。 关联细则: Phase 49 阶段2 §三（配置驱动新手装备发放算法）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name StarterLoadoutDispatcher
extends RefCounted


## 为角色序章发放新手初始物资（幂等防重复保护；上下文原地标记已发放）
static func dispatch_starter_kit(ctx: CharacterPrologueContext) -> Dictionary:
	if ctx == null or ctx.character_id.is_empty():
		return { "success": false, "error_code": "INVALID_CONTEXT" }

	# 1. 幂等防护：检查是否已发放过新手装备
	if bool(ctx.runtime_placeholders.get("STARTER_KIT_GRANTED", false)):
		return {
			"success": true,
			"code": "ALREADY_GRANTED",
			"message": "该角色已领取过新手装备，触发幂等跳过"
		}

	# 2. 读取配置决定套件 ID（按种族映射；未指派则读映射，仍未中取全局默认）
	var kit_id := ctx.assigned_starter_kit_id
	if kit_id.is_empty():
		kit_id = GameConfig.get_string("domains.starter_loadout", "race_kit_map/" + ctx.race_id, "")
		if kit_id.is_empty():
			kit_id = GameConfig.get_string("domains.starter_loadout", "defaults/fallback_kit", "KIT_HUMAN_DEFAULT")
		ctx.assigned_starter_kit_id = kit_id

	var kit_cfg: Dictionary = GameConfig.get_dict("domains.starter_loadout", "starter_kits/" + kit_id, {})
	if kit_cfg.is_empty():
		# 安全兜底配置（配置缺失仍可发基础金币，杜绝发放中断）
		kit_cfg = {
			"initial_gold": GameConfig.get_int("domains.starter_loadout", "defaults/initial_gold", 50),
			"initial_items": []
		}

	var gold: int = int(kit_cfg.get("initial_gold", 50))
	var items: Array = kit_cfg.get("initial_items", [])

	# 3. 标记已发放
	ctx.runtime_placeholders["STARTER_KIT_GRANTED"] = true
	ctx.runtime_placeholders["STARTER_GOLD"] = gold

	return {
		"success": true,
		"code": "KIT_DISPATCHED",
		"gold": gold,
		"items": items,
		"kit_id": kit_id
	}
