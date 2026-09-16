# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/server_grant_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 未来服务器发放奖励/CDKey/邮件礼物的幂等契约：grant_id → uid 只增不删， 防止重放（同 grant 二次发放拒绝）；默认关闭不污染单机模型。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ServerGrantRegistry extends RefCounted

# ==============================================================================
# 一、发放登记与幂等拦截
# ==============================================================================

var grants: Dictionary = {}  # grant_id -> { uid, source, claimed_at }

## 登记发放：grant_id 已存在则幂等拒绝（防重放）
func register_grant(grant_id: String, uid: String, source: String) -> Dictionary:
	if grant_id.is_empty() or uid.is_empty():
		return {"success": false, "error_code": "INVALID_GRANT"}
	if grants.has(grant_id):
		return {"success": false, "error_code": "GRANT_ALREADY_EXISTS", "grant_id": grant_id, "uid": grants[grant_id]["uid"]}
	grants[grant_id] = {"uid": uid, "source": source, "claimed_at": int(Time.get_unix_time_from_system())}
	# P6：无界补上限——登记后按 server_grant/max_entries 最旧先出裁剪（FifoBudget 单次快照）
	FifoBudget.trim_oldest(grants, GameConfig.get_int("domains.item_namespace_registry", "server_grant/max_entries", 10000))
	return {"success": true, "grant_id": grant_id, "uid": uid, "source": source}

# ==============================================================================
# 二、追溯查询与联机开关
# ==============================================================================

## 按 UID 反查 grant（发放来源追溯）
func find_grant_by_uid(uid: String) -> String:
	for grant_id in grants:
		if String(grants[grant_id].get("uid", "")) == uid:
			return str(grant_id)
	return ""

## 联机预留开关（默认关闭，不污染单机）
static func server_grant_enabled() -> bool:
	return GameConfig.get_bool("domains.item_namespace_registry", "server_grant/enabled", false)