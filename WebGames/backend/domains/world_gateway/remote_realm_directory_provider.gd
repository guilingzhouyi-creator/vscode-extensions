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
const EMPTY_REALM_MANIFEST: Array = []

## 枚举可用联机界域卡片列表（只读轻量字典数组）
static func list_realms(_account_id: String = "") -> Array[Dictionary]:
	var results: Array[Dictionary] = []
	var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})

	for world_id in raw_catalog.keys():
		var raw_world_config: Dictionary = raw_catalog[world_id]
		if int(raw_world_config.get("mode", 0)) != WorldGatewayModel.GameMode.MULTIPLAYER:
			continue

		var is_active: bool = bool(raw_world_config.get("is_active", false))
		var canary_tag: String = str(raw_world_config.get("canary_feature_tag", ""))
		var raw_manifest: Variant = raw_world_config.get("realm_mod_manifest")
		var realm_card := {
			"realm_id": str(world_id),
			"realm_name": str(raw_world_config.get("world_name", world_id)),
			"ping_ms": int(raw_world_config.get("ping_ms", DEFAULT_REALM_PING_MS)),
			"status": "ONLINE" if is_active else "MAINTENANCE",
			"is_canary": not canary_tag.is_empty(),
			"realm_mod_manifest": (raw_manifest as Array) if (raw_manifest is Array) else EMPTY_REALM_MANIFEST
		}
		results.append(realm_card)

	return results
