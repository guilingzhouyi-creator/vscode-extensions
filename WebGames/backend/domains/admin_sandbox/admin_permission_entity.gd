# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/admin_permission_entity.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 玩家/巡查/GM/RootAdmin 4 级基于角色的权限访问控制 (RBAC) 矩阵契约 盐与口令由 config/infrastructure/admin.json 驱动（支持配置化轮换）。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name AdminPermissionAggregate extends RefCounted

enum AdminLevel {
	LEVEL_PLAYER = 0,
	LEVEL_MODERATOR = 1,
	LEVEL_GAME_MASTER = 2,
	LEVEL_ROOT_ADMIN = 3
}

var current_level: int = AdminLevel.LEVEL_PLAYER
var authorized_admin_id: String = ""
var session_passkey_hash: String = ""
var granted_permissions: Array = []

## 权限判定：目标级别 ≥ PLAYER 且当前级别 ≥ 目标级别且不越权（上限 max_level 配置钳制）
func has_permission(required_level: int) -> bool:
	return required_level >= AdminLevel.LEVEL_PLAYER and current_level >= required_level and current_level <= _max_level()

## 细粒度权限判定：授权清单中是否存在（规范化大写 + 去空白后精确匹配）
func has_granted_permission(permission: String) -> bool:
	var normalized := str(permission).strip_edges().to_upper()
	return not normalized.is_empty() and granted_permissions.has(normalized)

## 权限盐（infrastructure.admin salt 配置驱动，支持配置化轮换）
static func _salt() -> String:
	return GameConfig.get_string("infrastructure.admin", "salt", "")

## 配置化口令清单（infrastructure.admin passkeys 数组）
static func _passkeys() -> Array:
	return GameConfig.get_array("infrastructure.admin", "passkeys", [])

## 最大可达级别（admin/max_level 配置，clampi 钳制于 PLAYER~ROOT_ADMIN 区间）
static func _max_level() -> int:
	return clampi(GameConfig.get_int("infrastructure.admin", "admin/max_level", AdminLevel.LEVEL_ROOT_ADMIN), AdminLevel.LEVEL_PLAYER, AdminLevel.LEVEL_ROOT_ADMIN)

## 口令密封：加盐 SHA-256 哈希（空口令返回空串）
static func seal_passkey(passkey_plain: String) -> String:
	if passkey_plain.is_empty():
		return ""
	return (passkey_plain + _salt()).sha256_text()

## 权限清单规范化：大写去空白去重并排序（防重复授权）
static func _normalize_permissions(permissions: Array) -> Array:
	var normalized: Array = []
	for permission in permissions:
		var value := str(permission).strip_edges().to_upper()
		if not value.is_empty() and not normalized.has(value):
			normalized.append(value)
	normalized.sort()
	return normalized

## 越权提升：口令与配置口令匹配即升至目标级别（广播 admin.permission_elevated 文案）；不匹配返回 false
func elevate_permission(passkey_plain: String, target_level: int) -> bool:
	if passkey_plain.is_empty() or target_level < AdminLevel.LEVEL_PLAYER or target_level > _max_level():
		return false
	var expected_hash := seal_passkey(passkey_plain)
	var keys: Array = _passkeys()
	var matched := false
	for key in keys:
		var configured := str(key)
		var configured_hash := configured if configured.length() == 64 else seal_passkey(configured)
		if configured_hash == expected_hash:
			matched = true
			break
	if matched:
		current_level = target_level
		session_passkey_hash = expected_hash
		granted_permissions = _normalize_permissions(GameConfig.get_array("infrastructure.admin", "admin/permissions", []))
		EventBusCore.get_instance().emit_narrative_by_key(
			"admin/permission_elevated", "system", [current_level]
		)
		return true
	return false
