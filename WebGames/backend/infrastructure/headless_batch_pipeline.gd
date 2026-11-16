# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Headless Batch Pipeline)
# 文件路径: res://backend/infrastructure/headless_batch_pipeline.gd
# 架构定位: SoA Headless Batch Kinematics Pipeline
# 依赖与触发: 上游: 物理/运动域、测试套件 | 下游: SoAEntityBuffer | 配置: config/infrastructure/object_pool.json | 信号: 无
# 职责说明: 基于 SoA 密集连续内存的流式批处理无头管线：就地更新位置与速度，
#           位标记过滤非活跃实体，循环体零瞬态分配，提供高吞吐无头物理推演。
# 退出语义与设计依据: 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

## HeadlessBatchPipeline：SoA Headless Batch Kinematics Pipeline
class_name HeadlessBatchPipeline extends RefCounted

const FLAG_MASK_INACTIVE: int = 0x01

## 批处理一趟推演：就地计算位置变动与阻尼 (纯密集数组线性步进，零堆分配)
static func step_kinematics(buffer: SoAEntityBuffer, delta_time: float, damping: float) -> int:
	var count := buffer.active_count
	if count <= 0 or delta_time <= 0.0:
		return 0

	# 局部变量缓存 Packed 数组引用，避免在紧凑热循环中反复经属性访问器取数组
	var positions_x: PackedFloat32Array = buffer.pos_x
	var positions_y: PackedFloat32Array = buffer.pos_y
	var velocities_x: PackedFloat32Array = buffer.vel_x
	var velocities_y: PackedFloat32Array = buffer.vel_y
	var entity_flags: PackedInt32Array = buffer.flags

	var processed := 0
	for entity_index in range(count):
		if (entity_flags[entity_index] & FLAG_MASK_INACTIVE) != 0:
			continue
		positions_x[entity_index] = positions_x[entity_index] + velocities_x[entity_index] * delta_time
		positions_y[entity_index] = positions_y[entity_index] + velocities_y[entity_index] * delta_time
		if damping < 1.0:
			velocities_x[entity_index] = velocities_x[entity_index] * damping
			velocities_y[entity_index] = velocities_y[entity_index] * damping
		processed += 1

	buffer.pos_x = positions_x
	buffer.pos_y = positions_y
	buffer.vel_x = velocities_x
	buffer.vel_y = velocities_y
	return processed
