# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_instance_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 封装世界实例元数据、运行模式绑定、版本及灰度标签
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldInstanceDTO：Value Object DTO / Data Transport Model
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
static func from_dto(data: Dictionary, fallback_world_id: String = "") -> WorldInstanceDTO:
	var world_instance := WorldInstanceDTO.new()
	if data.is_empty():
		world_instance.world_id = fallback_world_id
		return world_instance
	world_instance.world_id = str(data.get("world_id", fallback_world_id))
	if world_instance.world_id.is_empty():
		world_instance.world_id = fallback_world_id
	world_instance.world_name = str(data.get("world_name", ""))
	world_instance.mode = int(data.get("mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
	world_instance.seed_value = int(data.get("seed_value", 0))
	world_instance.world_version = str(data.get("world_version", "1.0.0"))
	world_instance.is_active = bool(data.get("is_active", true))
	world_instance.max_concurrent_players = int(data.get("max_concurrent_players", 1))
	world_instance.canary_feature_tag = str(data.get("canary_feature_tag", ""))
	return world_instance
