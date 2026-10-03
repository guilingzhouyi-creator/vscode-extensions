# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Headless Batch Pipeline)
# 文件路径: res://backend/infrastructure/headless_batch_pipeline.gd
# 架构定位: SoA Headless Batch Kinematics Pipeline
# 跨域依赖: 上游: 物理/运动域、测试套件 | 下游: SoAEntityBuffer | 配置: config/infrastructure/object_pool.json | 信号: 无
# 职责说明: 基于 SoA 密集连续内存的流式批处理无头管线：就地更新位置与速度，
#           位标记过滤非活跃实体，循环体零瞬态分配，提供高吞吐无头物理推演。
# 设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

class_name HeadlessBatchPipeline extends RefCounted

const SoAEntityBuffer = preload("res://backend/infrastructure/soa_entity_buffer.gd")

const FLAG_MASK_INACTIVE: int = 0x01

## 批处理一趟推演：就地计算位置变动与阻尼 (纯密集数组线性步进，零堆分配)
static func step_kinematics(buffer: SoAEntityBuffer, delta_time: float, damping: float) -> int:
	var count := buffer.active_count
	if count <= 0 or delta_time <= 0.0:
		return 0

	var px: PackedFloat32Array = buffer.pos_x
	var py: PackedFloat32Array = buffer.pos_y
	var vx: PackedFloat32Array = buffer.vel_x
	var vy: PackedFloat32Array = buffer.vel_y
	var fl: PackedInt32Array = buffer.flags

	var processed := 0
	for i in range(count):
		if (fl[i] & FLAG_MASK_INACTIVE) != 0:
			continue
		px[i] = px[i] + vx[i] * delta_time
		py[i] = py[i] + vy[i] * delta_time
		if damping < 1.0:
			vx[i] = vx[i] * damping
			vy[i] = vy[i] * damping
		processed += 1

	buffer.pos_x = px
	buffer.pos_y = py
	buffer.vel_x = vx
	buffer.vel_y = vy
	return processed
