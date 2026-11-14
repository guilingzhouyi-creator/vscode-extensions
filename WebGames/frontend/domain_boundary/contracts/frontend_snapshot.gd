# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Contracts)
# 文件路径: res://frontend/domain_boundary/contracts/frontend_snapshot.gd
# 架构定位: Base Frontend Snapshot Contract & Defensive Deserialization Helper
# 依赖与触发: 上游: FrontendHudSnapshot 等快照子类 | 下游: 无（纯基类契约）
# 职责说明: 定义前端统一快照 DTO 的序列化对等契约与防御性字典字段读取工具。
# 退出语义与设计依据: 快照双向序列化对等与缺省/类型漂移安全回退契约
# ==============================================================================

## FrontendSnapshot：前端只读快照 DTO 基类与类型安全读取工具
class_name FrontendSnapshot
extends RefCounted

## 子类必须覆写为完整字段字典，保证 to_dictionary 与 from_dictionary 深度对等
func to_dictionary() -> Dictionary:
	return {}

## -----------------------------------------------------------------------------
## 防御性读取工具（缺省 / 越界 / 类型漂移输入安全回退）
## -----------------------------------------------------------------------------
## 安全读取字符串字段，缺失时返回指定默认回退值
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
