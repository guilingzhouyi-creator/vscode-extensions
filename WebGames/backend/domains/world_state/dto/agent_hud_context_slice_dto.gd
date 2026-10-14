# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: AuthoritativeHudSnapshotDTO, AgentHudSliceSolver | 下游: AgentHudTelemetryPacketDTO | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 面向 Agent 的主页 HUD 纯净状态观测切片，100% 剥离表现层渲染杂质，提供强类型标量与去表现化通知列表。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎施工细则 (Inv-AGENT-SLICE-PURITY-3)
# ==============================================================================

## AgentHudContextSliceDTO：Value Object DTO / Data Transport Model
class_name AgentHudContextSliceDTO
extends RefCounted

# 一、基础身份切片
var account_id: String = ""
var character_id: String = ""
var character_name: String = ""
var race_id: String = "HUMAN"
var level: int = 1

# 二、生理体能切片 (数值与归一化安全比率 0.0 ~ 1.0)
var hp_current: float = 100.0
var hp_max: float = 100.0
var hp_ratio: float = 1.0

var mp_current: float = 100.0
var mp_max: float = 100.0
var mp_ratio: float = 1.0

var ap_current: float = 10.0
var ap_max: float = 10.0
var ap_ratio: float = 1.0

# 三、资产与潜能切片
var wallet_gold: int = 0
var wallet_mana_monocrystals: int = 0
var ledger_nonce: int = 0
var unallocated_potential_points: int = 0
var attribute_values: Dictionary = {}
var title_rank_key: String = ""

# 四、环境历法切片
var calendar_year: int = 1
var calendar_month: int = 1
var calendar_day: int = 1
var day_phase_key: String = "DAWN"
var season_key: String = "SPRING"
var weather_key: String = "CLEAR"

# 五、任务进度切片 (标量)
var active_quest_id: String = ""
var active_quest_target_count: int = 0
var active_quest_current_count: int = 0
var is_quest_completable: bool = false

# 六、系统与网络元数据
var game_mode: String = "SINGLE_PLAYER"
var is_multiplayer_ready: bool = false
var unread_mail_count: int = 0

# 七、UI 引导提示与活动模态通知切片 (去表现化纯文本与交互指令)
var ui_notices: Array[HudUiNoticeDTO] = []

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	account_id = ""
	character_id = ""
	character_name = ""
	race_id = "HUMAN"
	level = 1

	hp_current = 100.0
	hp_max = 100.0
	hp_ratio = 1.0
	mp_current = 100.0
	mp_max = 100.0
	mp_ratio = 1.0
	ap_current = 10.0
	ap_max = 10.0
	ap_ratio = 1.0

	wallet_gold = 0
	wallet_mana_monocrystals = 0
	ledger_nonce = 0
	unallocated_potential_points = 0
	attribute_values.clear()
	title_rank_key = ""

	calendar_year = 1
	calendar_month = 1
	calendar_day = 1
	day_phase_key = "DAWN"
	season_key = "SPRING"
	weather_key = "CLEAR"

	active_quest_id = ""
	active_quest_target_count = 0
	active_quest_current_count = 0
	is_quest_completable = false

	game_mode = "SINGLE_PLAYER"
	is_multiplayer_ready = false
	unread_mail_count = 0

	ui_notices.clear()

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	var notices_arr: Array[Dictionary] = []
	for n in ui_notices:
		if n != null:
			notices_arr.append(n.to_dto())

	return {
		"account_id": account_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"level": level,
		"hp_current": hp_current,
		"hp_max": hp_max,
		"hp_ratio": hp_ratio,
		"mp_current": mp_current,
		"mp_max": mp_max,
		"mp_ratio": mp_ratio,
		"ap_current": ap_current,
		"ap_max": ap_max,
		"ap_ratio": ap_ratio,
		"wallet_gold": wallet_gold,
		"wallet_mana_monocrystals": wallet_mana_monocrystals,
		"ledger_nonce": ledger_nonce,
		"unallocated_potential_points": unallocated_potential_points,
		"attribute_values": attribute_values.duplicate(true),
		"title_rank_key": title_rank_key,
		"calendar_year": calendar_year,
		"calendar_month": calendar_month,
		"calendar_day": calendar_day,
		"day_phase_key": day_phase_key,
		"season_key": season_key,
		"weather_key": weather_key,
		"active_quest_id": active_quest_id,
		"active_quest_target_count": active_quest_target_count,
		"active_quest_current_count": active_quest_current_count,
		"is_quest_completable": is_quest_completable,
		"game_mode": game_mode,
		"is_multiplayer_ready": is_multiplayer_ready,
		"unread_mail_count": unread_mail_count,
		"ui_notices": notices_arr
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> AgentHudContextSliceDTO:
	var dto := AgentHudContextSliceDTO.new()
	dto.account_id = str(data.get("account_id", ""))
	dto.character_id = str(data.get("character_id", ""))
	dto.character_name = str(data.get("character_name", ""))
	dto.race_id = str(data.get("race_id", "HUMAN"))
	dto.level = int(data.get("level", 1))

	dto.hp_current = float(data.get("hp_current", 100.0))
	dto.hp_max = float(data.get("hp_max", 100.0))
	dto.hp_ratio = float(data.get("hp_ratio", 1.0))
	dto.mp_current = float(data.get("mp_current", 100.0))
	dto.mp_max = float(data.get("mp_max", 100.0))
	dto.mp_ratio = float(data.get("mp_ratio", 1.0))
	dto.ap_current = float(data.get("ap_current", 10.0))
	dto.ap_max = float(data.get("ap_max", 10.0))
	dto.ap_ratio = float(data.get("ap_ratio", 1.0))

	dto.wallet_gold = int(data.get("wallet_gold", 0))
	dto.wallet_mana_monocrystals = int(data.get("wallet_mana_monocrystals", 0))
	dto.ledger_nonce = int(data.get("ledger_nonce", 0))
	dto.unallocated_potential_points = int(data.get("unallocated_potential_points", 0))
	dto.attribute_values = data.get("attribute_values", {}).duplicate(true)
	dto.title_rank_key = str(data.get("title_rank_key", ""))

	dto.calendar_year = int(data.get("calendar_year", 1))
	dto.calendar_month = int(data.get("calendar_month", 1))
	dto.calendar_day = int(data.get("calendar_day", 1))
	dto.day_phase_key = str(data.get("day_phase_key", "DAWN"))
	dto.season_key = str(data.get("season_key", "SPRING"))
	dto.weather_key = str(data.get("weather_key", "CLEAR"))

	dto.active_quest_id = str(data.get("active_quest_id", ""))
	dto.active_quest_target_count = int(data.get("active_quest_target_count", 0))
	dto.active_quest_current_count = int(data.get("active_quest_current_count", 0))
	dto.is_quest_completable = bool(data.get("is_quest_completable", false))

	dto.game_mode = str(data.get("game_mode", "SINGLE_PLAYER"))
	dto.is_multiplayer_ready = bool(data.get("is_multiplayer_ready", false))
	dto.unread_mail_count = int(data.get("unread_mail_count", 0))

	dto.ui_notices.clear()
	var raw_notices: Array = data.get("ui_notices", [])
	for item in raw_notices:
		if item is Dictionary:
			dto.ui_notices.append(HudUiNoticeDTO.from_dto(item))

	return dto

