# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_instance_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 封装世界实例元数据、运行模式绑定、版本及灰度标签
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name WorldInstanceDTO
extends RefCounted

var world_id: String = ""
var world_name: String = ""
var mode: int = WorldGatewayModel.GameMode.SINGLE_PLAYER
var seed_value: int = 0
var world_version: String = "1.0.0"
var is_active: bool = true
var max_concurrent_players: int = 1
var canary_feature_tag: String = ""

## 序列化世界实例为字典
func to_dto() -> Dictionary:
	return {
		"world_id": world_id,
		"world_name": world_name,
		"mode": mode,
		"seed_value": seed_value,
		"world_version": world_version,
		"is_active": is_active,
		"max_concurrent_players": max_concurrent_players,
		"canary_feature_tag": canary_feature_tag
	}

## 从字典重建世界实例（空字典回退 fallback_world_id）
static func from_dto(d: Dictionary, fallback_world_id: String = "") -> WorldInstanceDTO:
	var inst := WorldInstanceDTO.new()
	if d.is_empty():
		inst.world_id = fallback_world_id
		return inst
	inst.world_id = str(d.get("world_id", fallback_world_id))
	if inst.world_id.is_empty():
		inst.world_id = fallback_world_id
	inst.world_name = str(d.get("world_name", ""))
	inst.mode = int(d.get("mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
	inst.seed_value = int(d.get("seed_value", 0))
	inst.world_version = str(d.get("world_version", "1.0.0"))
	inst.is_active = bool(d.get("is_active", true))
	inst.max_concurrent_players = int(d.get("max_concurrent_players", 1))
	inst.canary_feature_tag = str(d.get("canary_feature_tag", ""))
	return inst
