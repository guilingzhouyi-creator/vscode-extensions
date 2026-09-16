# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端状态层: 战斗响应式数据模型
# 文件路径: res://frontend/view_models/combat_view_model.gd
# 职责: 承载战斗视图的 BOSS 血量/部位状态/战报日志/飘字请求
# 边界: 中性默认值（不内嵌业务演示数据），数据一律经 update_from_snapshot 注入
# ==============================================================================
class_name CombatViewModel
extends RefCounted

signal data_changed()
signal floating_text_requested(text: String, is_crit: bool, is_heal: bool, pos: Vector2)

## 战报日志条数上限（防无界增长；R-09：超出时裁剪最旧，严禁魔法数字）
const MAX_BATTLE_LOGS: int = 100

var boss_name: String = ""
var boss_hp_current: float = 0.0
var boss_hp_max: float = 1.0
var boss_parts: Array = []

var player_name: String = ""
var player_hp_current: float = 0.0
var player_hp_max: float = 1.0
var player_mp_current: float = 0.0
var player_mp_max: float = 1.0
var player_ap_current: float = 0.0
var player_ap_max: float = 1.0

var battle_logs: Array[Dictionary] = []

## 按快照字典增量更新战斗数据
## R-03/R-09：数值经有限性守卫 + clamp、部位改防御读取；缺失键保持既有值（契约零回归）
func update_from_snapshot(snapshot: Dictionary) -> void:
	boss_name = str(snapshot.get("boss_name", boss_name))
	boss_hp_max = maxf(1.0, _safe_float(snapshot.get("boss_max_hp", boss_hp_max), boss_hp_max))
	boss_hp_current = clampf(_safe_float(snapshot.get("boss_hp", boss_hp_current), boss_hp_current), 0.0, boss_hp_max)
	# R-03：非 Array（含 null）经防御读取返回 []，杜绝原 as Array 得 null → .duplicate() 空引用崩溃
	if snapshot.has("boss_parts"):
		boss_parts = FrontendSnapshot.read_array(snapshot, "boss_parts")

	player_name = str(snapshot.get("player_name", player_name))
	player_hp_max = maxf(1.0, _safe_float(snapshot.get("player_hp_max", player_hp_max), player_hp_max))
	player_hp_current = clampf(_safe_float(snapshot.get("player_hp_current", player_hp_current), player_hp_current), 0.0, player_hp_max)
	player_mp_max = maxf(1.0, _safe_float(snapshot.get("player_mp_max", player_mp_max), player_mp_max))
	player_mp_current = clampf(_safe_float(snapshot.get("player_mp_current", player_mp_current), player_mp_current), 0.0, player_mp_max)
	player_ap_max = maxf(1.0, _safe_float(snapshot.get("player_ap_max", player_ap_max), player_ap_max))
	player_ap_current = clampf(_safe_float(snapshot.get("player_ap_current", player_ap_current), player_ap_current), 0.0, player_ap_max)

	data_changed.emit()

## R-03/R-09：非有限值（NaN/INF）经守卫回落 fallback，杜绝 int(NAN) 等异常整数
static func _safe_float(value: Variant, fallback: float = 0.0) -> float:
	var f := float(value)
	return f if is_finite(f) else fallback

## 追加战斗日志（R-09：超上限时裁剪最旧，保持有界）
func append_log(category: String, message: String) -> void:
	while battle_logs.size() >= MAX_BATTLE_LOGS:
		battle_logs.remove_at(0)
	battle_logs.append({
		"category": category,
		"message": message,
		"timestamp": Time.get_ticks_msec()
	})
	data_changed.emit()

## 请求飘字
func request_floating_text(text: String, is_crit: bool, is_heal: bool, pos: Vector2) -> void:
	floating_text_requested.emit(text, is_crit, is_heal, pos)