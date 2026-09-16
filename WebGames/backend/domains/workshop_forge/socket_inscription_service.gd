# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/workshop_forge/socket_inscription_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: config/domains/workshop.json | 信号: EventBus 领域广播
# 职责说明: 装备孔位打孔开槽、符文铭刻与神圣附魔矩阵共鸣 孔位默认与上限由 config/domains/workshop.json 驱动，文案由 narratives/workshop.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name SocketInscriptionService extends RefCounted

## 符文铭刻：孔位占满拦截 → 追加符文并广播铭刻叙事
static func inscribe_rune(item: ItemEntity, rune_id: String) -> Dictionary:
	var default_sockets := GameConfig.get_int("domains.workshop", "socket/default_total_sockets", 2)
	var total_sockets = int(item.affix_sockets.get("total_sockets", default_sockets))
	var runes: Array = item.affix_sockets.get("imprinted_runes", [])

	if runes.size() >= total_sockets:
		var msg := GameConfig.get_string("narratives.workshop", "no_socket", "No available sockets on item.")
		return { "success": false, "reason": msg }

	runes.append(rune_id)
	item.affix_sockets["imprinted_runes"] = runes

	EventBusCore.get_instance().emit_narrative_by_key(
		"workshop/inscribe_success", "economy", [rune_id, item.custom_name, runes.size(), total_sockets]
	)
	return { "success": true, "socket_index": runes.size() - 1, "runes": runes }

## 打孔开槽：达上限拒绝，否则孔位 +1
static func add_socket_to_item(item: ItemEntity, max_limit: int = -1) -> bool:
	var limit := max_limit if max_limit >= 0 else GameConfig.get_int("domains.workshop", "socket/max_limit", 4)
	var cur_sockets = int(item.affix_sockets.get("total_sockets", GameConfig.get_int("domains.workshop", "socket/default_total_sockets", 2)))
	if cur_sockets >= limit:
		return false
	item.affix_sockets["total_sockets"] = cur_sockets + 1
	return true
