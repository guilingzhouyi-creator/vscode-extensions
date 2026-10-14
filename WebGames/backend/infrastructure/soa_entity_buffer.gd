# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Data-Oriented Memory)
# 文件路径: res://backend/infrastructure/soa_entity_buffer.gd
# 架构定位: Struct of Arrays (SoA) Dense Entity Buffer
# 依赖与触发: 上游: HeadlessBatchPipeline, 物理/移动批处理器 | 下游: PackedArrays | 配置: config/infrastructure/object_pool.json | 信号: 无
# 职责说明: 数据导向 SoA 连续内存缓冲区：基于强类型平铺数组存储实体状态，
#           消除字典与对象引用间接寻址，保障 CPU 缓存局部性与单帧零堆分配推演。
# 退出语义与设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

## SoAEntityBuffer：Struct of Arrays (SoA) Dense Entity Buffer
class_name SoAEntityBuffer extends RefCounted

var capacity: int = 0
var active_count: int = 0

var entity_ids: PackedInt32Array = PackedInt32Array()
var pos_x: PackedFloat32Array = PackedFloat32Array()
var pos_y: PackedFloat32Array = PackedFloat32Array()
var vel_x: PackedFloat32Array = PackedFloat32Array()
var vel_y: PackedFloat32Array = PackedFloat32Array()
var flags: PackedInt32Array = PackedInt32Array()

## 校验结构体内内存块数据结构是否物理对齐
func is_aligned() -> bool:
	var c := active_count
	return (
		entity_ids.size() >= c and
		pos_x.size() >= c and
		pos_y.size() >= c and
		vel_x.size() >= c and
		vel_y.size() >= c and
		flags.size() >= c
	)

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	active_count = 0

## 调整连续内存缓冲区分配容量
func resize(new_capacity: int) -> void:
	capacity = maxi(0, new_capacity)
	entity_ids.resize(capacity)
	pos_x.resize(capacity)
	pos_y.resize(capacity)
	vel_x.resize(capacity)
	vel_y.resize(capacity)
	flags.resize(capacity)
	if active_count > capacity:
		active_count = capacity
