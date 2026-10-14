# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/remote_realm_directory_provider.gd
# 架构定位: Domain Provider / Remote Realm Stub
# 依赖与触发: 上游: WorldGatewayFSM, GameModeRoutingSolver | 下游: 无 | 配置: config/domains/world_gateway/core.json
# 职责说明: 提供联机界域只读目录卡片查询扩展桩，包含延迟、状态与灰度标识。
# 退出语义与设计依据: 业务领域第一性原理 / 联机界域只读扩展与无状态查询契约
# ==============================================================================

## RemoteRealmDirectoryProvider：Domain Provider / Remote Realm Stub
class_name RemoteRealmDirectoryProvider
extends RefCounted

const DEFAULT_REALM_PING_MS: int = 24
const FALLBACK_REALM_ALPHA_PING_MS: int = 28
const FALLBACK_REALM_BETA_PING_MS: int = 45

## 枚举可用联机界域卡片列表（只读轻量字典数组）
static func list_realms(account_id: String = "") -> Array[Dictionary]:
	var results: Array[Dictionary] = []
	var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})

	for wid in raw_catalog.keys():
		var raw: Dictionary = raw_catalog[wid]
		if int(raw.get("mode", 0)) != WorldGatewayModel.GameMode.MULTIPLAYER:
			continue

		var is_active: bool = bool(raw.get("is_active", false))
		var canary_tag: String = str(raw.get("canary_feature_tag", ""))
		var card := {
			"realm_id": str(wid),
			"realm_name": str(raw.get("world_name", wid)),
			"ping_ms": DEFAULT_REALM_PING_MS,
			"status": "ONLINE" if is_active else "MAINTENANCE",
			"is_canary": not canary_tag.is_empty()
		}
		results.append(card)

	if results.is_empty():
		results = _create_fallback_realms()

	return results

## 构建缺省保底界域列表（防止配置为空时外部崩溃）
static func _create_fallback_realms() -> Array[Dictionary]:
	return [
		{
			"realm_id": "REALM_MP_ALPHA_01",
			"realm_name": "卡拉尔公网·天穹界域",
			"ping_ms": FALLBACK_REALM_ALPHA_PING_MS,
			"status": "ONLINE",
			"is_canary": true
		},
		{
			"realm_id": "REALM_MP_BETA_02",
			"realm_name": "卡拉尔公网·深渊之渊",
			"ping_ms": FALLBACK_REALM_BETA_PING_MS,
			"status": "ONLINE",
			"is_canary": false
		}
	]

