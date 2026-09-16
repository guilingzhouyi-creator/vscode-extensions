---
档号: KALAR-DEV-2026-ST60-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST60 (Phase_64_全域核心算法性能加固与多实体扩展性治理)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_64_全域核心算法性能加固与多实体扩展性治理 —— 阶段2：增量累加倒排索引与DAG邻接表算法实现
形成日期: 2026-09-05
归档日期: 2026-09-06（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: MovementVectorBridgeSolver; 物品统计树自底向上 O(1) 增量累加算法; 空间方位倒排索引预编译与 O(1) 求值算法; 多实体解耦型空间触发器有限状态机求值算法
---

# 施工细则：Phase 64 全域核心算法性能加固与多实体扩展性治理 —— 阶段2：增量累加倒排索引与DAG邻接表算法实现

> 施工开始日期：2026-09-05 下午
> 责任人：卡拉尔世界引擎架构组
> 状态：📝 待获批（第1轮细则已编制，待批准后进入实现）

> [!NOTE]
> **【施工目标】**：完成 5 大性能与扩展性加固的核心算法重写与实施细类落地：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST60-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST60-ATT_附件_案卷共享契约与上下文.md)。
> 1. 物品统计树增量回溯累加算法，彻底移除 `_aggregate_recursive` 全量子树遍历；
> 2. 空间移动方位倒排散列查找算法与参数静态化；
> 3. 多实体解耦型空间触发器有限状态机求值算法；
> 4. 剧情 DAG 邻接表预编译调度与前置依赖哈希判定算法；
> 5. 随身背包容积与质量增量跟踪与常数级入包检查算法。
> **对应需求源**：全域未获批细则专项架构审查报告（2026-09-05）→ 核心算法性能治理要求。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST60-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST60-001_阶段1_性能指标契约与多实体状态解耦数据模型设计.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST60-003_阶段3_工程化缓存驱动与高频路径防御性加固.md) ｜ [阶段4](KALAR-DEV-2026-ST60-004_阶段4_高并发压力与算法复杂度验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  - [阶段1_性能指标契约与多实体状态解耦数据模型设计.md](KALAR-DEV-2026-ST60-001_阶段1_性能指标契约与多实体状态解耦数据模型设计.md)：5 大数据契约与不变量规范；
  - `backend/domains/item_statistics/account_item_library.gd`：`apply_item_delta` 与 `mount_item`；
  - `backend/domains/spatial_movement/movement_vector_bridge_solver.gd`：`translate_text_step_to_vector`；
  - `backend/domains/spatial_movement/spatial_trigger_fsm.gd`：`evaluate_trigger_state`；
  - `backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd`：`execute_node_action` 与 `_get_outgoing_edges`；
  - `backend/domains/inventory/wearable_inventory.gd`：`can_add_item` 与 `add_item`。

* **核心不变量约束断言**：
  - `Inv-ALG-1`（增量计算数学等效）：对任意物品节点的变更，沿父路径各级分类节点的累加和，与对整棵子树全量重算的求和结果绝对恒等（双向无损）；
  - `Inv-ALG-2`（热路径零配置查表）：方位向量解析在倒排表就绪后，绝不在单步计算中调用 `GameConfig.get_dict`；
  - `Inv-ALG-3`（多实体状态并发安全）：多实体同时处于或穿越同一空间触发器区域时，任意实体的进出跃迁严格仅触发属于该实体的独立状态变更；
  - `Inv-ALG-4`（DAG 出边索引一致性）：邻接表记录的所有出边集合与图对象 `graph.edges` 全量数组完全一致。

---

## 一、 核心算法与业务细类实现 (Algorithms & Solvers)

### 1. 物品统计树自底向上 O(1) 增量累加算法

```gdscript
# 模块路径: res://backend/domains/item_statistics/account_item_library.gd
## 增量回溯：仅沿 path: [major_key, minor_key] 对父节点累加 actual_delta
## 彻底废除原有 O(N) 的 _aggregate_recursive 全量子树求和！
static func _apply_delta_upwards(root: Dictionary, path: Array, stat_key: String, actual_delta: int) -> void:
	if actual_delta == 0 or path.size() < 2:
		return
	var major_key: String = str(path[0])
	var minor_key: String = str(path[1])

	var major: Dictionary = root["children"].get(major_key, {})
	if major.is_empty():
		return
	var minor: Dictionary = major["children"].get(minor_key, {})
	if not minor.is_empty():
		var minor_stats: Dictionary = minor["stats"]
		minor_stats[stat_key] = int(minor_stats.get(stat_key, 0)) + actual_delta

	var major_stats: Dictionary = major["stats"]
	major_stats[stat_key] = int(major_stats.get(stat_key, 0)) + actual_delta
```

### 2. 空间方位倒排索引预编译与 O(1) 求值算法

```gdscript
# 模块路径: res://backend/domains/spatial_movement/movement_vector_bridge_solver.gd
class_name MovementVectorBridgeSolver extends RefCounted

static var _alias_cache: Dictionary = {}
static var _is_cache_built: bool = false

## 预编译倒排索引（启动或配置热重载时触发）
static func build_direction_cache() -> void:
	var aliases: Dictionary = GameConfig.get_dict("domains.spatial_movement", "movement/direction_aliases", {})
	var table: Dictionary = {}
	for dir_key in aliases:
		var raw_alias: Variant = aliases[dir_key]
		if raw_alias is not Array:
			continue
		var vec := _direction_key_to_vector(str(dir_key))
		for alias in (raw_alias as Array):
			var normalized_key := str(alias).strip_edges().to_upper()
			table[normalized_key] = vec

	# 内置保底硬编码回退（保障未配置时 100% 兼容）
	var defaults := {
		"NORTH": Vector2(0, -1), "N": Vector2(0, -1), "北": Vector2(0, -1),
		"SOUTH": Vector2(0, 1), "S": Vector2(0, 1), "南": Vector2(0, 1),
		"EAST": Vector2(1, 0), "E": Vector2(1, 0), "东": Vector2(1, 0),
		"WEST": Vector2(-1, 0), "W": Vector2(-1, 0), "西": Vector2(-1, 0),
		"NORTHEAST": Vector2(1, -1).normalized(), "NE": Vector2(1, -1).normalized(), "东北": Vector2(1, -1).normalized(),
		"NORTHWEST": Vector2(-1, -1).normalized(), "NW": Vector2(-1, -1).normalized(), "西北": Vector2(-1, -1).normalized(),
		"SOUTHEAST": Vector2(1, 1).normalized(), "SE": Vector2(1, 1).normalized(), "东南": Vector2(1, 1).normalized(),
		"SOUTHWEST": Vector2(-1, 1).normalized(), "SW": Vector2(-1, 1).normalized(), "西南": Vector2(-1, 1).normalized()
	}
	for k in defaults:
		if not table.has(k):
			table[k] = defaults[k]

	_alias_cache = table
	_is_cache_built = true

## 高性能常数时间方位解析
static func translate_text_step_to_vector(verb_direction: String, distance_meters: float) -> Vector2:
	if not _is_cache_built:
		build_direction_cache()
	var key := verb_direction.strip_edges().to_upper()
	var dir: Vector2 = _alias_cache.get(key, Vector2.ZERO)
	return dir * distance_meters
```

### 3. 多实体解耦型空间触发器有限状态机求值算法

```gdscript
# 模块路径: res://backend/domains/spatial_movement/spatial_trigger_fsm.gd
## 解耦后的状态求值：显式传入 entity_id，区域对象自身仅做纯几何计算
static func evaluate_entity_trigger_state(
	registry: MultiEntityTriggerRegistry,
	trigger: SpatialTriggerArea,
	entity_id: String,
	entity_pos: Vector2
) -> int:
	var is_contained := false
	if trigger.shape == TriggerShape.CIRCLE_RADIUS:
		is_contained = SpatialMath.within_radius(entity_pos, trigger.center_pos, trigger.radius)
	elif trigger.shape == TriggerShape.AABB_RECTANGLE:
		is_contained = trigger.rect_extents.has_point(entity_pos)

	var prev_state: int = registry.get_state(trigger.trigger_id, entity_id)
	var new_state: int = prev_state

	if is_contained:
		if prev_state == TriggerState.OUTSIDE or prev_state == TriggerState.EXITED:
			new_state = TriggerState.ENTERED
		else:
			new_state = TriggerState.INSIDE
	else:
		if prev_state == TriggerState.INSIDE or prev_state == TriggerState.ENTERED:
			new_state = TriggerState.EXITED
		else:
			new_state = TriggerState.OUTSIDE

	registry.update_state(trigger.trigger_id, entity_id, new_state)
	return new_state
```

### 4. 剧情 DAG 出边邻接表调度与会话序列化算法

```gdscript
# 模块路径: res://backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd
## 邻接表出边索引：from_node_id -> Array[NarrativeDAGEdge]
var _outgoing_edges_index: Dictionary = {}
## 前置依赖哈希集合：completed_set: Dictionary[String, bool] 实现 O(1) 依赖查找
var _completed_set: Dictionary = {}

func _build_graph_indices() -> void:
	_outgoing_edges_index.clear()
	for edge in graph.edges:
		if not _outgoing_edges_index.has(edge.from_node_id):
			_outgoing_edges_index[edge.from_node_id] = []
		_outgoing_edges_index[edge.from_node_id].append(edge)

## 高效 O(OutDegree) 出边获取
func _get_outgoing_edges(from_id: String) -> Array[NarrativeDAGEdge]:
	return _outgoing_edges_index.get(from_id, [])

## O(1) 前置依赖检验
func _are_prerequisites_satisfied(node: NarrativeDAGNode) -> bool:
	for pre in node.required_prerequisites:
		if not _completed_set.has(pre):
			return false
	return true
```

### 5. 随身背包度量增量追踪与脏标记算法

```gdscript
# 模块路径: res://backend/domains/inventory/wearable_inventory.gd
var _cached_volume: int = 0
var _cached_weight: float = 0.0
var _is_metric_dirty: bool = true

func _recalculate_metrics_if_dirty(race_bonus: float = 0.0) -> void:
	if not _is_metric_dirty:
		return
	_cached_volume = 0
	_cached_weight = 0.0
	for item in storage_items:
		if item is ItemEntity:
			_cached_volume += item.volume_slots
			_cached_weight += item.mass_kg
	for slot_val in equipped_slots.values():
		if slot_val is ItemEntity:
			_cached_weight += slot_val.mass_kg
	_is_metric_dirty = false

func can_add_item_fast(item: ItemEntity, race_bonus: float = 0.0) -> bool:
	if item == null or item.mass_kg < 0.0 or item.volume_slots < 0:
		return false
	_recalculate_metrics_if_dirty(race_bonus)
	var max_vol = calculate_total_capacity(race_bonus)
	if _cached_volume + item.volume_slots > max_vol:
		return false
	if _cached_weight + item.mass_kg > max_carry_weight_kg:
		return false
	return true
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 2.1: 物品统计增量算法重构** - 将 `AccountItemLibraryAggregate._recalc_upwards` 改写为增量回溯累加；
- [ ] **Step 2.2: 空间移动倒排索引构建** - 在 `MovementVectorBridgeSolver` 引入 `_alias_cache` 静态查找；
- [ ] **Step 2.3: 空间触发器多实体解耦** - 移除 `SpatialTriggerArea.current_state`，引入集中状态注册表；
- [ ] **Step 2.4: DAG 引擎邻接表与依赖集合重构** - 预编译 `_outgoing_edges_index` 与 `_completed_set`；
- [ ] **Step 2.5: 穿戴仓储增量度量优化** - 引入 `_cached_volume`、`_cached_weight` 增量追踪；
- [ ] **Step 2.6: 保持存量单测 100% 兼容** - 确保原有 81 套测试套件 511/511 断言 100% PASS。

---

## 三、 业务功能初步验证矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-PF-S2-01` | 物品增量与全量重算数学等价 | 挂载 100 个道具并执行 50 次增减变动 | 增量路径统计结果与全量子树重算结果 100% 绝对一致 |
| `TC-PF-S2-02` | 倒排方位动词常数级解析 | 传入标准方向及各别名（"NORTH", "北", "NE", "西南"） | 正确解析为归一化 Vector2，计算耗时相较原循环查表提升 10 倍以上 |
| `TC-PF-S2-03` | 触发器双实体状态并发独立 | 实体 A 移入区域，实体 B 移出区域 | 实体 A 状态准确为 `ENTERED`，实体 B 状态准确为 `EXITED`，零相互影响 |
| `TC-PF-S2-04` | 复杂 DAG 邻接调度正确性 | 50 节点菱形汇聚复杂剧情图推进 | 汇聚节点依赖准确受控，出边按邻接表即时调度，动作推进成功 |
| `TC-PF-S2-05` | 背包批量入包增量一致性 | 批量装入 30 件装备并移出 10 件 | `_cached_volume` 与 `_cached_weight` 与全量遍历重算完全一致 |
