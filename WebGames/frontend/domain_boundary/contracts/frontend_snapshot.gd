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
static func read_string(snapshot_payload: Dictionary, field_key: String, fallback_value: String = "") -> String:
	return str(snapshot_payload.get(field_key, fallback_value))

## 安全读取整型字段，缺失时返回指定默认回退值
static func read_int(snapshot_payload: Dictionary, field_key: String, fallback_value: int = 0) -> int:
	return int(snapshot_payload.get(field_key, fallback_value))

## 安全读取浮点字段，缺失时返回指定默认回退值
static func read_float(snapshot_payload: Dictionary, field_key: String, fallback_value: float = 0.0) -> float:
	return float(snapshot_payload.get(field_key, fallback_value))

## 安全读取布尔字段，缺失时返回指定默认回退值
static func read_bool(snapshot_payload: Dictionary, field_key: String, fallback_value: bool = false) -> bool:
	return bool(snapshot_payload.get(field_key, fallback_value))

## 安全读取数组字段并执行深拷贝，非数组类型时返回空数组以隔离外部引用篡改
static func read_array(snapshot_payload: Dictionary, field_key: String) -> Array:
	var raw_value: Variant = snapshot_payload.get(field_key, [])
	return raw_value.duplicate(true) if raw_value is Array else []

## 安全读取字典字段并执行深拷贝，非字典类型时返回空字典以隔离外部引用篡改
static func read_dict(snapshot_payload: Dictionary, field_key: String) -> Dictionary:
	var raw_value: Variant = snapshot_payload.get(field_key, {})
	return raw_value.duplicate(true) if raw_value is Dictionary else {}
