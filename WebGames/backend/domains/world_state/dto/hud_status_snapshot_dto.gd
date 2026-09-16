# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/hud_status_snapshot_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 聚合角色身份、六维 L3 实值、生理层级、展示型生命/行动力与资产钱包， 作为双轨（主动拉取 / 事件推送）的标准快照载荷。 事实溯源（Phase 71 审查整改版，零臆造）： - attribute_values/attribute_levels -> CharacterPhysiologySheet 真实 API - hp_max -> domains.combat participant_defaults/max_hp（配置真源 + 下限守卫） - ap_max -> domains.world_state hud_defaults/ap_max（配置真源 + 下限守卫） - wallet_*  -> CharacterWalletEntity 真实字段（gold/mana_monocrystals） - MP / 等级经验等无权威源展示项不入快照，留待后续域闭环扩展
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

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

static func from_dto(data: Dictionary) -> HudStatusSnapshotDTO:
	var dto := HudStatusSnapshotDTO.new()
	dto.account_id = String(data.get("account_id", ""))
	dto.character_id = String(data.get("character_id", ""))
	dto.character_name = String(data.get("character_name", ""))
	dto.race_id = String(data.get("race_id", "HUMAN"))
	dto.current_location_id = String(data.get("current_location_id", ""))
	var av = data.get("attribute_values", {})
	if av is Dictionary:
		dto.attribute_values = av.duplicate()
	var al = data.get("attribute_levels", {})
	if al is Dictionary:
		dto.attribute_levels = al.duplicate()
	# 除数下限守卫（Inv-HDS-3）：hp_max/ap_max 强保证 >= 1.0
	dto.hp_current = maxf(0.0, float(data.get("hp_current", 0.0)))
	dto.hp_max = maxf(1.0, float(data.get("hp_max", 100.0)))
	dto.ap_current = maxf(0.0, float(data.get("ap_current", 0.0)))
	dto.ap_max = maxf(1.0, float(data.get("ap_max", 10.0)))
	dto.wallet_gold = int(data.get("wallet_gold", 0))
	dto.wallet_mana_monocrystals = int(data.get("wallet_mana_monocrystals", 0))
	dto.timestamp_utc = int(data.get("timestamp_utc", 0))
	return dto
