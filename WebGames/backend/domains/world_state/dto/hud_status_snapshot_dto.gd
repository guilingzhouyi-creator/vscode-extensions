# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/hud_status_snapshot_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 聚合角色身份、六维 L3 实值、生理层级、展示型生命/行动力与资产钱包， 作为双通道（主动拉取 / 事件推送）的标准快照载荷。 事实溯源（审查整改版，零臆造）： - attribute_values/attribute_levels -> CharacterPhysiologySheet 真实 API - hp_max -> domains.combat participant_defaults/max_hp（配置真源 + 下限守卫） - ap_max -> domains.world_state hud_defaults/ap_max（配置真源 + 下限守卫） - wallet_*  -> CharacterWalletEntity 真实字段（gold/mana_monocrystals） - MP / 等级经验等无权威源展示项不入快照，留待后续域完整链路扩展
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## HudStatusSnapshotDTO：Value Object DTO / Data Transport Model
class_name HudStatusSnapshotDTO
extends RefCounted

var account_id: String = ""
var character_id: String = ""
var character_name: String = ""
var race_id: String = "HUMAN"
var current_location_id: String = ""

# 六维 L3 实值与层级（真源：CharacterPhysiologySheet.get_actual_values() / get_all_levels()）
var attribute_values: Dictionary = {}   # attr -> float
var attribute_levels: Dictionary = {}   # attr -> int 1..6

# 展示型生命/行动力（上限真源：combat participant_defaults / world_state hud_defaults；下限守卫 >=1.0）
var hp_current: float = 0.0
var hp_max: float = 100.0
var ap_current: float = 0.0
var ap_max: float = 10.0

# 资产钱包（真源：CharacterWalletEntity 真实字段）
var wallet_gold: int = 0
var wallet_mana_monocrystals: int = 0

# 时钟与时间戳
var timestamp_utc: int = 0

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"current_location_id": current_location_id,
		"attribute_values": attribute_values.duplicate(),
		"attribute_levels": attribute_levels.duplicate(),
		"hp_current": hp_current,
		"hp_max": hp_max,
		"ap_current": ap_current,
		"ap_max": ap_max,
		"wallet_gold": wallet_gold,
		"wallet_mana_monocrystals": wallet_mana_monocrystals,
		"timestamp_utc": timestamp_utc
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary) -> HudStatusSnapshotDTO:
	var snapshot := HudStatusSnapshotDTO.new()
	snapshot.account_id = String(serialized_payload.get("account_id", ""))
	snapshot.character_id = String(serialized_payload.get("character_id", ""))
	snapshot.character_name = String(serialized_payload.get("character_name", ""))
	snapshot.race_id = String(serialized_payload.get("race_id", "HUMAN"))
	snapshot.current_location_id = String(serialized_payload.get("current_location_id", ""))
	var raw_attribute_values: Variant = serialized_payload.get("attribute_values", {})
	if raw_attribute_values is Dictionary:
		snapshot.attribute_values = raw_attribute_values.duplicate()
	var raw_attribute_levels: Variant = serialized_payload.get("attribute_levels", {})
	if raw_attribute_levels is Dictionary:
		snapshot.attribute_levels = raw_attribute_levels.duplicate()
	# 除数下限守卫（Inv-HDS-3）：hp_max/ap_max 强保证 >= 1.0
	snapshot.hp_current = maxf(0.0, float(serialized_payload.get("hp_current", 0.0)))
	snapshot.hp_max = maxf(1.0, float(serialized_payload.get("hp_max", 100.0)))
	snapshot.ap_current = maxf(0.0, float(serialized_payload.get("ap_current", 0.0)))
	snapshot.ap_max = maxf(1.0, float(serialized_payload.get("ap_max", 10.0)))
	snapshot.wallet_gold = int(serialized_payload.get("wallet_gold", 0))
	snapshot.wallet_mana_monocrystals = int(serialized_payload.get("wallet_mana_monocrystals", 0))
	snapshot.timestamp_utc = int(serialized_payload.get("timestamp_utc", 0))
	return snapshot
