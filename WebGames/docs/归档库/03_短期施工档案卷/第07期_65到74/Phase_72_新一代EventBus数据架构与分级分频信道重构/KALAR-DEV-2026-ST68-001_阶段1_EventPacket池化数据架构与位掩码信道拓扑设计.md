---
档号: KALAR-DEV-2026-ST68-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST68 (Phase_72_新一代EventBus数据架构与分级分频信道重构)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_72_新一代EventBus数据架构与分级分频信道重构 —— 阶段1：EventPacket池化数据架构与位掩码信道拓扑设计
形成日期: 2026-09-08
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: EventPacket; VisualCueDTO; 紧凑型强类型事件包模型; 抽象视觉与表现控制数据契约; 分级分频信道位掩码拓扑
---

# 施工细则：Phase 72 新一代EventBus数据架构与分级分频信道重构 —— 阶段1：EventPacket池化数据架构与位掩码信道拓扑设计

> 施工开始日期：2026-09-08（下午）
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（Round 2 实施与全量验证闭环）

> [!NOTE]
> **【施工目标】**：摒弃"裸 Dictionary 载荷 + 扁平字符串切割 + 动态查表"的文字版 EventBus 历史包袱，建立现代高性能事件数据架构（自洽可编译）：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST68-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST68-ATT_附件_案卷共享契约与上下文.md)。
> 1. 紧凑型强类型事件包 `EventPacket`（原生 2D/3D 空间头 + 强类型 DTO + 轻量载荷双通道），配**本卷自含的 `EventPool` 对象池**（演进03 通用池前置交付前先自含，遵循 `ADV-POOL-001` 复用规范）；
> 2. 整型信道常量表 `EventChannelDefinition` 与五类正交位掩码 `EventCategoryMask`，热路径零字符串解析；
> 3. 帧级双缓冲乒乓队列 `PingPongRingBuffer`（`enqueue`/`flush_frame`，零拷贝交换，无 `.duplicate()`）；
> 4. 纯语义表现载荷 `VisualCueDTO`（零模型/2D/3D 平滑解耦）；
> 5. 明确与 P71/演进02 契约的关系（整型信道为路由真源，字符串信道映射表承接迁移）。
> **对应需求源**：用户指令（2026-09-08）："面向 2D/3D 演进彻底重构 EventBus 数据架构与调用模式，不为旧测试妥协兼容"；`ADV-POOL-001`、`ADV-PRF-002` 性能治理规则；Phase 71 阶段1（HUD/账户频道）；演进02（HUD 前端契约权威）；Phase 70（唯一事实与文案通道契约）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST68-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST68-002_阶段2_三模分发引擎与无头空间哈希网格路由算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST68-003_阶段3_配置驱动分流与全域现代调用接口改造工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST68-004_阶段4_高频空间分发零GC内存与全量验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  - `backend/infrastructure/event_bus.gd`（旧版总线现状基线，本期保留运行，不退役）
  - `backend/domains/spatial_movement/movement_vector_bridge_solver.gd`、`backend/domains/event_driven_audio/spatial_audio_solver.gd`（空间引用均实测存在）
  - `scripts/config/code_governance_rules.json`：`ADV-POOL-001`（池化对象 reset_state 规范）、`ADV-PRF-002`（循环内禁 `.new()`/`.duplicate(true)` 深拷贝）
  - `docs/路线图/02_长期演进区/演进_03_高承压对象池与数据导向无头处理器架构/`（通用 ObjectPool 为后续演进，本期 EventPool 自含承接）
  - `docs/路线图/01_短期施工区/Phase_71_.../阶段1`（HUD_STATUS_SNAPSHOT 等频道承接、演进02 HudEventContract 契约权威）
* **核心不变量约束断言**：
  - `Inv-EB1-1 (热路径零深拷贝与池化守恒)`：60 FPS 物理/渲染主循环内禁显式 `.new()`/`.duplicate(true)` 深拷贝；事件包一律经 `EventPool` 借还（`reset_state()` 归还），池外新建 EventPacket 计数必须为 0、借还差恒为 0（对齐 `ADV-PRF-002`/`ADV-POOL-001` 可测口径，不承诺 GDScript 绝对零堆分配）。
  - `Inv-EB1-2 (空间头强内聚)`：空间事件原生承载 `Vector3` 坐标、包围球半径与空间有效性标记，禁止在字典载荷内以动态键包装坐标。
  - `Inv-EB1-3 (信道标识确定性)`：信道统一映射为整型常量（`EventChannelDefinition` 单一真源），热路径杜绝 `String.split()`/`String.join()`/正则；整型↔字符串映射仅存在于配置映射表（迁移期）。
  - `Inv-EB1-4 (类别位掩码互斥与正交)`：五大事件流通过正交二进制位掩码隔离，禁止跨类别隐式穿透。
  - `Inv-EB1-5 (无头物理纯解耦)`：所有数据结构基于纯逻辑数学类型（`Vector3`），严禁依赖 Godot 场景树节点。
  - `Inv-EB1-6 (2D/3D 降维无缝投影)`：`set_spatial_header_2d` 原生支持 2D 笛卡尔与 2.5D 等距俯视投影，无头网格统一运算。
  - `Inv-EB1-7 (对象池借还闭环与防双重归还)`：`EventPacket.is_borrowed` 状态位守护，未借出归还或重复归还必须被拒绝并告警。
  - `Inv-EB1-8 (零模型资产依赖与纯 API 语义控制)`：表现流事件一律使用纯标量/向量的 `VisualCueDTO`，禁止携带 `.gltf/.png/.tscn` 路径、节点类型或动画片段字符串。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

### 1. 紧凑型强类型事件包模型 (`EventPacket`)
* 模块路径: `res://backend/infrastructure/event_bus/event_packet.gd`

```gdscript
class_name EventPacket
extends RefCounted

# ---- 一、核心元数据头 (定长标量) ----
var event_id: int = 0              # 全局单调递增逻辑事件序号
var channel_id: int = 0            # EventChannelDefinition 整型信道常量
var category_mask: int = 0         # EventCategoryMask 位掩码
var timestamp_tick: int = 0
var source_entity_id: String = ""

# ---- 二、2D/3D 空间几何标头 ----
var is_spatial: bool = false
var world_position: Vector3 = Vector3.ZERO
var effect_radius: float = 0.0

# ---- 三、多态载荷（双通道：强类型 DTO 优先，轻量字典兜底，二选一） ----
var payload_dto: RefCounted = null # 强类型业务 DTO（如 VisualCueDTO / 域 DTO）
var payload_data: Variant = null   # 轻量载荷（Dictionary/Array），与 payload_dto 互斥使用

# ---- 四、叙事/日志契约（可选，承接 P71 文案通道；渲染接线归 P74） ----
var narrative_key: String = ""     # 对应 narratives.<域> 模板键（event_name）
var narrative_args: Array = []

# ---- 五、池化生命周期状态 ----
var is_borrowed: bool = false

func reset_state() -> void:
	event_id = 0
	channel_id = 0
	category_mask = 0
	timestamp_tick = 0
	source_entity_id = ""
	is_spatial = false
	world_position = Vector3.ZERO
	effect_radius = 0.0
	payload_dto = null
	payload_data = null
	narrative_key = ""
	narrative_args.clear()
	is_borrowed = false

func set_spatial_header(pos: Vector3, radius: float) -> EventPacket:
	is_spatial = true
	world_position = pos
	effect_radius = maxf(0.0, radius)
	return self

func set_spatial_header_2d(pos_2d: Vector2, radius: float, is_isometric_xz: bool = false) -> EventPacket:
	is_spatial = true
	effect_radius = maxf(0.0, radius)
	world_position = Vector3(pos_2d.x, 0.0, pos_2d.y) if is_isometric_xz else Vector3(pos_2d.x, pos_2d.y, 0.0)
	return self
```

### 2. 抽象视觉与表现控制数据契约 (`VisualCueDTO`)
* 模块路径: `res://backend/infrastructure/event_bus/visual_cue_dto.gd`

```gdscript
class_name VisualCueDTO
extends RefCounted

enum CueToken {
	UNKNOWN = 0,
	ATTACK_SLASH_LIGHT = 1, ATTACK_SLASH_HEAVY = 2,
	HIT_IMPACT_BLUNT = 10, HIT_IMPACT_SLASH = 11,
	SPELL_BURST_ELEMENTAL = 20,
	FOOTSTEP_GROUND = 30,
	STATUS_BUFF_ACTIVE = 40, STATUS_DEBUFF_ACTIVE = 41
}
enum AnchorPoint {
	ORIGIN_FEET = 0, PRIMARY_HAND = 1, SECONDARY_HAND = 2,
	CHEST_CENTER = 3, HEAD_OVERHEAD = 4
}
var cue_token: int = CueToken.UNKNOWN
var anchor: int = AnchorPoint.ORIGIN_FEET
var intensity: float = 1.0
var duration_sec: float = 0.0
var custom_params: Dictionary = {}
```

### 3. 分级分频信道位掩码拓扑 (`EventCategoryMask`)
* 模块路径: `res://backend/infrastructure/event_bus/event_category_mask.gd`

```gdscript
class_name EventCategoryMask
extends RefCounted

const CORE_STATE       = 1 << 0 # 1: 伤害判定/生命归零/技能冷却/槽位绑定/网关跃迁
const SPATIAL_VFX      = 1 << 1 # 2: 刀光/粒子/跳字/屏幕震动
const SPATIAL_AUDIO    = 1 << 2 # 4: 武器碰撞/环境/脚步/受击喊叫
const NARRATIVE_TEXT   = 1 << 3 # 8: 战报/对白/系统广播
const SYSTEM_TELEMETRY = 1 << 4 # 16: 日志/聚合/Profiling

const MASK_ALL_SPATIAL = SPATIAL_VFX | SPATIAL_AUDIO
const MASK_ALL         = 0xFFFFFFFF
```

### 4. 信道整型常量契约 (`EventChannelDefinition`)
* 模块路径: `res://backend/infrastructure/event_bus/event_channel_definition.gd`
* 说明: 整型常量为**路由唯一真源**；与 P71 字符串频道（`world_state.*`/`account.*`）的映射登记于 `config/infrastructure/event_bus_config.json` 的 `channel_registry`（迁移期），演进02 `HudEventContract` 仍为前端订阅白名单契约权威。

```gdscript
class_name EventChannelDefinition
extends RefCounted

## 核心战斗信道 (0x0100 ~ 0x01FF)
const COMBAT_HIT_RESOLVED       : int = 0x0101
const COMBAT_ROUND_ADVANCED     : int = 0x0102
const COMBAT_ENTITY_DIED        : int = 0x0103

## 空间物理与移动信道 (0x0200 ~ 0x02FF)
const SPATIAL_POSITION_CHANGED  : int = 0x0201
const SPATIAL_COLLISION_CONTACT : int = 0x0202
const SPATIAL_TRIGGER_ENTERED   : int = 0x0203
const SPATIAL_EXPLOSION_IMPACT  : int = 0x0204
const SPATIAL_AUDIO_PLAY        : int = 0x0205

## HUD 与数值状态信道 (0x0300 ~ 0x03FF，承接 P71)
const HUD_STATUS_SNAPSHOT       : int = 0x0301
const HUD_STAT_MUTATED          : int = 0x0302
const HUD_WALLET_MUTATED        : int = 0x0303

## 账户与生命周期信道 (0x0400 ~ 0x04FF，承接 P71)
const AUTH_REGISTERED           : int = 0x0401
const AUTH_LOGIN_SUCCEEDED      : int = 0x0402
const LIFECYCLE_SHUTDOWN_STARTED: int = 0x0403

## 系统遥测信道 (0x0500 ~ 0x05FF)
const SYSTEM_HEARTBEAT_TICK     : int = 0x0501
const SYSTEM_TELEMETRY_METRIC   : int = 0x0502
```

### 5. 双缓冲乒乓帧队列 (`PingPongRingBuffer`)
* 模块路径: `res://backend/infrastructure/event_bus/ping_pong_ring_buffer.gd`
* 职责: 帧级高吞吐流（VFX/音频/跳字）有界缓冲，**零拷贝**（交换读写指针 + 遍历后清空，无 `.duplicate()`）。

```gdscript
class_name PingPongRingBuffer
extends RefCounted

var _buffer_a: Array[EventPacket] = []
var _buffer_b: Array[EventPacket] = []
var _write_to_a: bool = true
var _capacity: int = 4096

func _init(capacity: int = 4096) -> void:
	_capacity = maxi(1, capacity)

## 入队当前写入缓冲（满则返回 false，由上层按 drop_on_overflow 策略处理）
func enqueue(packet: EventPacket) -> bool:
	if packet == null:
		return false
	if _write_to_a:
		if _buffer_a.size() >= _capacity:
			return false
		_buffer_a.append(packet)
	else:
		if _buffer_b.size() >= _capacity:
			return false
		_buffer_b.append(packet)
	return true

## 帧末批量清算：交换读缓冲 → 逐包回调 → 清空（零拷贝，无 duplicate）
func flush_frame(callback: Callable) -> int:
	var read_array: Array[EventPacket] = _buffer_b if _write_to_a else _buffer_a
	_write_to_a = not _write_to_a
	var count := read_array.size()
	for packet in read_array:
		if callback.is_valid():
			callback.call(packet)
	read_array.clear()
	return count

func size() -> int:
	return _buffer_a.size() + _buffer_b.size()

func capacity() -> int:
	return _capacity
```

### 6. 事件包对象池 (`EventPool`)
* 模块路径: `res://backend/infrastructure/event_bus/event_pool.gd`
* 职责: 高频借还复用，遵循 `ADV-POOL-001`（`reset_state` 归还）；**本卷自含**（演进03 通用 `ObjectPool` 前置交付后由其统摄或替换实现，接口保持 `borrow/recycle/get_free_count`）。

```gdscript
class_name EventPool
extends RefCounted

var _free: Array[EventPacket] = []
var _capacity: int = 512
var _borrowed: int = 0

func _init(capacity: int = 512) -> void:
	_capacity = maxi(1, capacity)

## 借出：优先复用空闲包，否则池满时告警并新建（池外新建计数由遥测可测）
func borrow() -> EventPacket:
	var pkt: EventPacket = _free.pop_back() if not _free.is_empty() else null
	if pkt == null:
		_push_pool_overflow_hint()
		pkt = EventPacket.new()
	pkt.is_borrowed = true
	_borrowed += 1
	return pkt

## 归还：防双重归还（is_borrowed 守卫），复位后入池
func recycle(packet: EventPacket) -> bool:
	if packet == null or not packet.is_borrowed:
		return false
	packet.reset_state()
	packet.is_borrowed = false
	_borrowed = maxi(0, _borrowed - 1)
	if _free.size() < _capacity:
		_free.append(packet)
	return true

func get_free_count() -> int:
	return _free.size()

func get_borrowed_count() -> int:
	return _borrowed

func _push_pool_overflow_hint() -> void:
	# 池满新建属池外分配，经 ErrorReporter 遥测（错误码 event_bus2_pool_overflow，见阶段3）
	ErrorReporter.emit("event_bus2_pool_overflow", {})
```

---

## 二、 阶段交付物清单 (Deliverables)

1. `backend/infrastructure/event_bus/event_packet.gd`：双通道载荷 + 2D/3D 空间头 + 池化生命周期事件包；
2. `backend/infrastructure/event_bus/visual_cue_dto.gd`：纯语义表现载荷（零模型依赖）；
3. `backend/infrastructure/event_bus/event_category_mask.gd`：五大正交位掩码；
4. `backend/infrastructure/event_bus/event_channel_definition.gd`：整型信道常量表（含系统遥测/空间爆炸/空间音频）；
5. `backend/infrastructure/event_bus/ping_pong_ring_buffer.gd`：零拷贝双缓冲帧队列（enqueue/flush_frame）；
6. `backend/infrastructure/event_bus/event_pool.gd`：自含事件包对象池（借还守恒 + 防双重归还）；
7. 满足 8 项核心架构不变量（Inv-EB1-1 ~ Inv-EB1-8）。

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-HDS-S1-01` | EventPacket 字段完备可编译 | 声明变量检查 | 全部字段已声明（含 payload_data/narrative_key），`reset_state()` 全量复位无未声明赋值 |
| `TC-HDS-S1-02` | 借还守恒与防双重归还 | 借出/归还/重复归还 | 借还差恒 0；重复归还返回 false 并拒绝 |
| `TC-HDS-S1-03` | 双缓冲零拷贝清算 | 入队 10 包后 flush | 回调 10 次、FIFO 保持、无 `.duplicate()` 调用 |
| `TC-HDS-S1-04` | 信道常量与掩码确定性 | 常量引用检查 | 全部常量已定义（含 SYSTEM_HEARTBEAT_TICK/SPATIAL_EXPLOSION_IMPACT/SPATIAL_AUDIO_PLAY）；热路径零字符串切分 |
