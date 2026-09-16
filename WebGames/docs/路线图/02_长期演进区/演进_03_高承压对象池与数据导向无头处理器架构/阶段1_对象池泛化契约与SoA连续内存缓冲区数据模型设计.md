# 施工细则：演进 03 高承压对象池与数据导向无头处理器架构 —— 阶段1：对象池泛化契约与 SoA 连续内存缓冲区数据模型设计

> [!NOTE]
> **【施工目标】**：完成卡拉尔世界引擎全域高承压底座的数据契约与模型设计，确立泛化引用计数对象池（ObjectPool）、SoA（Struct of Arrays）连续内存组件缓冲区以及无头流式批处理管线（Headless Batch Pipeline）的标准数据契约。
> **【授权依据】**：**已获项目负责人/用户明确授权 (Explicit Authorization)**——授权进入 `02_长期演进区` 立项本演进工程。
> **【需求溯源】**：全域后端架构穿透审查报告（后端缺乏对象池与数据导向驱动，瞬态 DTO 与深拷贝造成高频 GC 压力）+ GD老练风格硬性规范标准第 5.2 节（高频对象池化契约）。
> **施工开始日期**: 2026-09-06

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[GD老练风格硬性规范标准.md](../../../模板/GD老练风格硬性规范标准.md) 第 5.2 节（高频对象池化准则）、[game_bootstrap.gd](../../../../backend/infrastructure/game_bootstrap.gd) 幂等单例装配中枢与 [tertiary_timeline_engine.gd](../../../../backend/domains/physics_thermodynamics/tertiary_timeline_engine.gd)（高频瞬态事件 DTO 分配热点）。
* **核心不变量约束断言**：
  - **Inv-POOL-1（生命周期闭环）**：对象从池中获取时必须经由 `reset_state()` 彻底洗净状态；归还时必须校验所有权标记，严禁跨池归还或二次归还；
  - **Inv-POOL-2（容量有界）**：对象池容量必须由配置指定静态预分配（`preallocate_size`）与硬性上限（`max_capacity`），池满归还时自动放弃引用交由 Godot 自动释放，严禁内存无界增长；
  - **Inv-POOL-3（SoA 长度对齐）**：连续内存组件缓冲区内各 `Packed*Array` 元素个数必须严格一致，以行号（`row_id` / `entity_id`）做 $O(1)$ 连续内存寻址；
  - **Inv-POOL-4（纯无头防腐）**：池化管理与无头批处理流水线严禁继承或依赖 Godot 场景树（`Node` / `Node2D` / `Control`），100% 保持在纯逻辑 `RefCounted` 无头沙盒中运转。
* **防漂移最高指示**：严禁侵入破坏现有业务领域（如 combat、spatial_movement）既有的 Result DTO 契约；所有高承压池化和 SoA 处理一律作为可插拔底座，通过适配器桥接，配置未开启时平滑回退传统堆分配模式。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

```gdscript
# 模块路径: res://backend/infrastructure/object_pool.gd
# 职责: 泛化引用计数对象池底座模型与契约定义

# 1. 可池化对象标准接口契约 (Duck-typing 规范)
# 任何接入 ObjectPool 的类必须实现以下两个方法：
# - reset_state() -> void: 清理所有运行时临时属性与上下文，恢复出厂默认值
# - is_pool_acquired() -> bool: 返回当前是否处于被借出使用状态

# 2. 对象池容量与指标配置 DTO
class_name ObjectPoolConfigDTO extends RefCounted:
	var pool_name: String = ""
	var preallocate_size: int = 32
	var max_capacity: int = 512
	var allow_overflow_alloc: bool = true
	var overflow_warning_threshold: int = 256

	func to_dto() -> Dictionary:
		return {
			"pool_name": pool_name,
			"preallocate_size": preallocate_size,
			"max_capacity": max_capacity,
			"allow_overflow_alloc": allow_overflow_alloc,
			"overflow_warning_threshold": overflow_warning_threshold
		}

	static func from_dto(data: Dictionary) -> ObjectPoolConfigDTO:
		var dto := ObjectPoolConfigDTO.new()
		dto.pool_name = str(data.get("pool_name", "generic_pool"))
		dto.preallocate_size = maxi(0, int(data.get("preallocate_size", 32)))
		dto.max_capacity = maxi(dto.preallocate_size, int(data.get("max_capacity", 512)))
		dto.allow_overflow_alloc = bool(data.get("allow_overflow_alloc", true))
		dto.overflow_warning_threshold = maxi(1, int(data.get("overflow_warning_threshold", 256)))
		return dto

# 3. 对象池运行状态遥测快照 DTO
class ObjectPoolStatsDTO extends RefCounted:
	var pool_name: String = ""
	var total_allocated: int = 0
	var active_in_use: int = 0
	var idle_in_pool: int = 0
	var peak_active: int = 0
	var total_acquires: int = 0
	var total_releases: int = 0
	var total_overflows: int = 0

	func to_dto() -> Dictionary:
		return {
			"pool_name": pool_name,
			"total_allocated": total_allocated,
			"active_in_use": active_in_use,
			"idle_in_pool": idle_in_pool,
			"peak_active": peak_active,
			"total_acquires": total_acquires,
			"total_releases": total_releases,
			"total_overflows": total_overflows
		}

# 4. 数据导向 SoA 连续内存缓冲区契约 (面向实体批处理，如移动与物理)
# 模块路径: res://backend/infrastructure/soa_entity_buffer.gd
class_name SoAEntityBuffer extends RefCounted:
	var capacity: int = 0
	var active_count: int = 0
	
	# 平铺连续紧凑数组 (Struct of Arrays)
	var entity_ids: PackedInt32Array = PackedInt32Array()
	var pos_x: PackedFloat32Array = PackedFloat32Array()
	var pos_y: PackedFloat32Array = PackedFloat32Array()
	var vel_x: PackedFloat32Array = PackedFloat32Array()
	var vel_y: PackedFloat32Array = PackedFloat32Array()
	var flags: PackedInt32Array = PackedInt32Array() # 位标记：活跃/销毁/碰撞/冰冻

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
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 1.1: 泛化池化标准契约确立** - 定义 `Poolable` 规范、`acquire` / `release` 生命周期契约，明确状态重置与所有权标记。
- [ ] **Step 1.2: 配置与指标 DTO 定义** - 确立 `ObjectPoolConfigDTO` 与 `ObjectPoolStatsDTO`，涵盖预分配、容量上限与防泄漏安全阈值。
- [ ] **Step 1.3: SoA 密集内存布局契约** - 基于 `PackedFloat32Array` 与 `PackedInt32Array` 定义实体紧凑平铺结构，替代哈希表。
- [ ] **Step 1.4: 静态一致性与门禁守护** - 编写数据契约校验用例，确保数据结构不依赖任何 Godot 场景节点，纯 `RefCounted` 实现。

---

## 三、 阶段交付物与验证断言 (DoD & Verification)

| 交付文件 | 核心职责 | 静态/单测断言指标 |
| :--- | :--- | :--- |
| `backend/infrastructure/object_pool.gd` | 泛化引用计数对象池核心类契约 | 涵盖构造、预分配、借出、归还、清空与遥测六维接口 |
| `backend/infrastructure/soa_entity_buffer.gd` | 连续内存平铺缓冲区契约 | 强类型 Packed 数组尺寸严格对齐断言 `is_aligned() == true` |
| 阶段1 契约验证测试 | 数据契约序列化/反序列化对等测试 | DTO 往返深拷贝 100% 对等，零缺漏字段 |
