# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 快照契约基类
# 文件路径: res://frontend/domain_boundary/contracts/frontend_snapshot.gd
# 职责: 定义前端统一快照 DTO 的序列化对等契约与防御性读取工具
# 边界: 纯数据契约，严禁业务计算与副作用；字段只承载后端传递的权威数据
# ==============================================================================
class_name FrontendSnapshot
extends RefCounted

## 子类必须覆写为完整字段字典，保证 to_dictionary 与 from_dictionary 深度对等
func to_dictionary() -> Dictionary:
	return {}

## -----------------------------------------------------------------------------
## 防御性读取工具（缺省 / 越界 / 类型漂移输入安全兜底）
## -----------------------------------------------------------------------------
static func read_string(data: Dictionary, key: String, fallback: String = "") -> String:
	return str(data.get(key, fallback))

static func read_int(data: Dictionary, key: String, fallback: int = 0) -> int:
	return int(data.get(key, fallback))

static func read_float(data: Dictionary, key: String, fallback: float = 0.0) -> float:
	return float(data.get(key, fallback))

static func read_bool(data: Dictionary, key: String, fallback: bool = false) -> bool:
	return bool(data.get(key, fallback))

static func read_array(data: Dictionary, key: String) -> Array:
	var value: Variant = data.get(key, [])
	return value.duplicate(true) if value is Array else []

static func read_dict(data: Dictionary, key: String) -> Dictionary:
	var value: Variant = data.get(key, {})
	return value.duplicate(true) if value is Dictionary else {}
