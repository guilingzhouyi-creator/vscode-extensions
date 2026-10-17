# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/mode_feature_manifest_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 游戏模式特性清单传输对象，声明不同运行模式下各功能系统的启用状态。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ModeFeatureManifestDTO：Value Object DTO / Data Transport Model
class_name ModeFeatureManifestDTO
extends RefCounted

var game_mode: int = 0
var show_matchmaking: bool = false
var show_online_chat: bool = false
var show_real_money_shop: bool = false
var show_cross_server_guild: bool = false
var enable_offline_cdkey: bool = false
var enable_offline_gacha: bool = false
var enable_local_story_mail: bool = false
var party_matchmaking_enabled: bool:
	get:
		return show_matchmaking
	set(value):
		show_matchmaking = value

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"game_mode": game_mode,
		"show_matchmaking": show_matchmaking,
		"party_matchmaking_enabled": show_matchmaking,
		"show_online_chat": show_online_chat,
		"show_real_money_shop": show_real_money_shop,
		"show_cross_server_guild": show_cross_server_guild,
		"enable_offline_cdkey": enable_offline_cdkey,
		"enable_offline_gacha": enable_offline_gacha,
		"enable_local_story_mail": enable_local_story_mail
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> ModeFeatureManifestDTO:
	var dto := ModeFeatureManifestDTO.new()
	dto.game_mode = int(data.get("game_mode", 0))
	dto.show_matchmaking = bool(data.get("show_matchmaking", data.get("party_matchmaking_enabled", false)))
	dto.show_online_chat = bool(data.get("show_online_chat", false))
	dto.show_real_money_shop = bool(data.get("show_real_money_shop", false))
	dto.show_cross_server_guild = bool(data.get("show_cross_server_guild", false))
	dto.enable_offline_cdkey = bool(data.get("enable_offline_cdkey", false))
	dto.enable_offline_gacha = bool(data.get("enable_offline_gacha", false))
	dto.enable_local_story_mail = bool(data.get("enable_local_story_mail", false))
	return dto
