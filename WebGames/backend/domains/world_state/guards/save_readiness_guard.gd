# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/guards/save_readiness_guard.gd
# 架构定位: Domain Guard / Security Validator
# 依赖与触发: 上游: WorldGateway, WorldInstance, ESC 菜单 | 下游: 无 | 配置: 无 | 信号: 无
# 职责说明: 提供保存就绪性校验与存储目录气密隔离性校验纯函数守卫
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SaveReadinessGuard：Domain Guard / Security Validator
class_name SaveReadinessGuard
extends RefCounted

## 错误码常量定义
const ERR_CANNOT_SAVE_IN_COMBAT: String = "ERR_CANNOT_SAVE_IN_COMBAT"
const ERR_CANNOT_SAVE_IN_NARRATIVE: String = "ERR_CANNOT_SAVE_IN_NARRATIVE"
const ERR_WORLD_QUARANTINED: String = "ERR_WORLD_QUARANTINED"
const ERR_ILLEGAL_PATH_TRAVERSAL: String = "ERR_ILLEGAL_PATH_TRAVERSAL"
const ERR_OFFLINE_STORAGE_ESCAPE: String = "ERR_OFFLINE_STORAGE_ESCAPE"
const ERR_ONLINE_CACHE_ESCAPE: String = "ERR_ONLINE_CACHE_ESCAPE"
const ERR_UNKNOWN_GAME_MODE_STORAGE: String = "ERR_UNKNOWN_GAME_MODE_STORAGE"

## 校验当前游戏世界状态是否允许执行安全保存或退网关
static func evaluate_save_readiness(
	in_combat: bool,
	in_critical_narrative: bool,
	is_world_quarantined: bool = false
) -> Dictionary:
	if in_combat:
		return {
			"allowed": false,
			"is_ready": false,
			"can_save": false,
			"can_exit": false,
			"blocked_reason": "CANNOT_SAVE_DURING_COMBAT",
			"error_code": ERR_CANNOT_SAVE_IN_COMBAT,
			"reason_narrative_key": "errors.save_blocked_combat"
		}
	if in_critical_narrative:
		return {
			"allowed": false,
			"is_ready": false,
			"can_save": false,
			"can_exit": false,
			"blocked_reason": "CANNOT_SAVE_DURING_CUTSCENE",
			"error_code": ERR_CANNOT_SAVE_IN_NARRATIVE,
			"reason_narrative_key": "errors.save_blocked_narrative"
		}
	if is_world_quarantined:
		return {
			"allowed": false,
			"is_ready": false,
			"can_save": false,
			"can_exit": false,
			"blocked_reason": "CANNOT_SAVE_WHEN_DEAD",
			"error_code": ERR_WORLD_QUARANTINED,
			"reason_narrative_key": "errors.save_blocked_quarantine"
		}

	return {
		"allowed": true,
		"is_ready": true,
		"can_save": true,
		"can_exit": true,
		"blocked_reason": "",
		"error_code": "",
		"reason_narrative_key": ""
	}

## 校验目标落盘存储路径的物理气密隔离性与安全性
static func evaluate_storage_path_safety(target_path: String, game_mode: int) -> Dictionary:
	# 1. 拦截相对路径穿透与空路径以及反斜杠异常
	if target_path.is_empty() or target_path.contains("..") or target_path.contains("\\"):
		return {
			"safe": false,
			"is_safe": false,
			"error_code": ERR_ILLEGAL_PATH_TRAVERSAL,
			"message": "Path traversal or separator anomaly detected"
		}

	# 2. 模式与存储选型命名空间隔离断言
	match game_mode:
		WorldGatewayModel.GameMode.SINGLE_PLAYER:
			if not target_path.begins_with("user://offline_vault/"):
				return {
					"safe": false,
					"is_safe": false,
					"error_code": ERR_OFFLINE_STORAGE_ESCAPE,
					"message": "Single-player saves must reside strictly under user://offline_vault/"
				}
		WorldGatewayModel.GameMode.MULTIPLAYER:
			if not target_path.begins_with("user://online_cache/"):
				return {
					"safe": false,
					"is_safe": false,
					"error_code": ERR_ONLINE_CACHE_ESCAPE,
					"message": "Multiplayer cache must reside strictly under user://online_cache/"
				}
		_:
			return {
				"safe": false,
				"is_safe": false,
				"error_code": ERR_UNKNOWN_GAME_MODE_STORAGE,
				"message": "Unrecognized game mode for storage validation"
			}

	return {
		"safe": true,
		"is_safe": true,
		"error_code": "",
		"message": "Storage path verified airtight"
	}
