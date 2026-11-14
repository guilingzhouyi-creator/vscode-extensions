# ==============================================================================
# 模块归属: Frontend / ViewModels
# 文件路径: res://frontend/view_models/combat_view_model.gd
# 架构定位: 前端状态层战斗响应式视图模型，承载战斗双方状态、战报列表与飘字事件流
# 依赖与触发: 依赖 FrontendSnapshot 防御读取，由战斗桥接层调用 update_from_snapshot 驱动 UI 刷新
# 职责说明: 承载战斗视图的 BOSS 血量、部位状态、战报日志与飘字请求
# 退出语义与设计依据: 中性默认值且不内嵌演示数据；日志按有界队列逐出旧条目，数值经过有限性守卫防 NaN/INF 污染
# ==============================================================================
## CombatViewModel：战斗响应式视图模型，负责战斗快照状态投影与有界战报事件分发
class_name CombatViewModel
extends RefCounted

signal data_changed()
signal floating_text_requested(text: String, is_crit: bool, is_heal: bool, target_position: Vector2)

## 战报日志条数上限（防无界增长；超出时裁剪最旧，严禁魔法数字）
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
## 数值经有限性守卫与区间夹紧、部位改防御读取；缺失键保持既有值以确保契约兼容
func update_from_snapshot(snapshot: Dictionary) -> void:
	boss_name = str(snapshot.get("boss_name", boss_name))
	boss_hp_max = maxf(1.0, _safe_float(snapshot.get("boss_max_hp", boss_hp_max), boss_hp_max))
	boss_hp_current = clampf(_safe_float(snapshot.get("boss_hp", boss_hp_current), boss_hp_current), 0.0, boss_hp_max)
	# 非 Array（含 null）经防御读取返回 []，避免直接强转后调用 duplicate 触发空引用崩溃
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

## 非有限值（NaN/INF）经守卫回退 fallback_value，防止 int(NAN) 等异常整数转换
static func _safe_float(raw_value: Variant, fallback_value: float = 0.0) -> float:
	var numeric_value := float(raw_value)
	return numeric_value if is_finite(numeric_value) else fallback_value

## 追加战斗日志（超上限时裁剪最旧，保持有界）
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
func request_floating_text(display_text: String, is_critical: bool, is_heal: bool, target_position: Vector2) -> void:
	floating_text_requested.emit(display_text, is_critical, is_heal, target_position)
