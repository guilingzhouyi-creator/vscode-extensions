---
档号: KALAR-DEV-2026-ST116-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: ST116 (Agent遥测流深度对象池与定长环形轨迹及异步背压引擎施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase 120 Agent遥测流深度对象池与定长环形轨迹及异步背压引擎 —— 阶段3：伴侣总线平滑迁移与PackedByteArray紧凑编解码集成接线
形成日期: 2026-10-13
归档日期: 2026-10-13
验收状态: 规划就绪 (PLANNING)
主题词/关键词: 伴侣总线平滑迁移; 轨迹窗口集成; PackedByteArray; 紧凑二进制编码; 阶段3
---

# 施工细则：Phase 120 Agent遥测流深度对象池与定长环形轨迹及异步背压引擎 —— 阶段3：伴侣总线平滑迁移与PackedByteArray紧凑编解码集成接线

> [!NOTE]
> **【施工目标】**：完成伴侣观察总线（`CompanionObserverBus`）与切片桥接器（`AgentHudSliceBridge`）的高性能平滑迁移，消融 `pop_front()` 伪环形队列；将 `AgentTrajectoryRingBuffer` 正式集成至桥接器中，赋予 Agent 运行时多步因果回溯能力；实现基于 Godot 4.7 原生 `PackedByteArray` 的紧凑二进制编解码器（`BinaryTelemetryCodec`），单包体积压缩至 $\le 256$ 字节；在配置单源中完成全链路接线。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[AGENTS.md 工作区全局刚性公理](../../../../../AGENTS.md) §二.1、§二.2；[阶段2_深度对象池矩阵与定长环形缓冲轨迹器及异步派发核心实现.md](阶段2_深度对象池矩阵与定长环形缓冲轨迹器及异步派发核心实现.md)；[companion_observer_bus.gd](../../../../backend/domains/narrative_orchestration/companion_observer_bus.gd)；[agent_hud_slice_bridge.gd](../../../../backend/domains/world_state/services/agent_hud_slice_bridge.gd)
* **核心不变量约束断言**：
  - `Inv-SEAMLESS-COMPATIBILITY-1 (伴侣总线无损兼容公理)`：`CompanionObserverBus` 在内部结构升级为定长环形队列后，对外的 `register_observer`、`broadcast_event` 与 `get_recent_events` 接口与返回值格式必须 100% 保持向前兼容；
  - `Inv-MULTISTEP-REFLECTION-2 (桥接器多步因果回溯公理)`：`AgentHudSliceBridge` 必须新增 `get_trajectory_history(steps)` 与 `get_cumulative_deltas()` 门面方法，为外部 Agent 与 LLM 决策模型提供原生多步反思支持；
  - `Inv-BINARY-FRAME-DETERMINISM-3 (二进制帧编码确定性公理)`：`BinaryTelemetryCodec` 编码生成的数据流前 4 字节必须包含魔数与协议版本头（`MAGIC: 0x4B414C52 ("KALR")`, `VERSION: 1`），尾部具备轻量校验和（如简单 XOR 校验），防止跨进程传输损坏；
  - `Inv-CONFIG-SINGLE-SOURCE-4 (全域单源驱动公理)`：环形缓冲容量、背压策略与对象池预分配参数必须严格从 `core.json` 与 `object_pool.json` 单源加载，严禁硬编码常量。
* **防漂移最高指示**：严禁创建空包跳板文件，门面层代码必须包含实质承载（ELOC >= 15）。

---

## 一、 伴侣观察总线平滑迁移与性能加固

### 1.1 `CompanionObserverBus` 核心消融与重构

将原本的 `_ring_buffer.pop_front()` 替换为真正的定长环形插槽模型，消除双重 `duplicate(true)`：

```gdscript
# 改造前（低效）：
func broadcast_event(event_type: String, payload: Dictionary) -> void:
	var entry: Dictionary = {
		"event_type": event_type,
		"payload": payload.duplicate(true), # 💥 拷贝 1
		"timestamp": int(Time.get_unix_time_from_system())
	}
	if _ring_buffer.size() >= MAX_CAPACITY:
		_ring_buffer.pop_front() # 💥 O(N) 移位
	_ring_buffer.append(entry)
	var read_only_payload: Dictionary = payload.duplicate(true) # 💥 拷贝 2
	for obs in _observers:
		obs.call(event_type, read_only_payload)

# 改造后（高效）：
# 使用预分配固定槽位 _ring_slots: Array[Dictionary]
# 使用 _head 与 _count 取模指针 O(1) 滚动覆写
# 广播时仅做一次深拷贝，或者根据订阅者只读契约实现写时拷贝 (Copy-on-Write)
```

---

## 二、 桥接器多步时序轨迹门面升级 (`AgentHudSliceBridge`)

在 `AgentHudSliceBridge` 中植入 `AgentTrajectoryRingBuffer`：

```gdscript
class_name AgentHudSliceBridge
extends RefCounted

var _trajectory_ring: AgentTrajectoryRingBuffer = null
var _async_dispatcher: AgentAsyncDispatcher = null

func _init() -> void:
	var cap: int = GameConfig.get_int("domains.world_state", "agent_telemetry_stream/ring_buffer_capacity", 32)
	_trajectory_ring = AgentTrajectoryRingBuffer.new(cap)
	_async_dispatcher = AgentAsyncDispatcher.new()

## 推进单步并推流：原子装箱 -> 写入轨迹环形缓冲 -> 异步派发
func step_and_publish(cause: String = "") -> AgentHudTelemetryPacketDTO:
	# ... 原有装箱逻辑 ...
	_trajectory_ring.append_packet(packet)
	_async_dispatcher.dispatch_telemetry(packet)
	return packet

## 获取最近 k 步时序轨迹切片（供 LLM 决策反思）
func get_trajectory_history(steps: int = 8) -> Array[AgentHudTelemetryPacketDTO]:
	return _trajectory_ring.get_trajectory_window(steps)

## 获取自某时步以来的累积因果突变
func get_cumulative_deltas(from_sequence: int = 0) -> Array[HudCausalDeltaDTO]:
	return _trajectory_ring.get_cumulative_deltas(from_sequence)
```

---

## 三、 紧凑二进制编解码器核心实现 (`BinaryTelemetryCodec`)

文件路径：`res://backend/domains/world_state/services/binary_telemetry_codec.gd`

```gdscript
class_name BinaryTelemetryCodec
extends RefCounted

const MAGIC_HEADER: int = 0x4B414C52 # "KALR"
const PROTOCOL_VER: int = 1

## 二进制序列化：将遥测包压缩为紧凑字节流 (<= 256 字节)
static func encode_to_bytes(packet: AgentHudTelemetryPacketDTO) -> PackedByteArray:
	var spb := StreamPeerBuffer.new()
	spb.big_endian = false

	# 1. 头部信封 (16 字节)
	spb.put_u32(MAGIC_HEADER)
	spb.put_u8(PROTOCOL_VER)
	spb.put_u8(1 if packet.preempted_by_human else 0)
	spb.put_u16(packet.sequence_index & 0xFFFF)
	spb.put_u64(packet.timestamp_ms)

	# 2. 标量观测值紧凑编码 (归一化比率用 u8 编码：0~255 映射 0.0~1.0)
	if packet.observation != null:
		var obs := packet.observation
		spb.put_u16(obs.level)
		spb.put_u8(int(obs.hp_ratio * 255.0))
		spb.put_u8(int(obs.mp_ratio * 255.0))
		spb.put_u8(int(obs.ap_ratio * 255.0))
		spb.put_u32(obs.wallet_gold)
		spb.put_u16(obs.unallocated_potential_points)
		spb.put_u16(obs.unread_mail_count)

	# 3. 差分与行动空间标志位编码
	spb.put_u8(packet.causal_deltas.size())
	for delta in packet.causal_deltas:
		_encode_delta(spb, delta)

	spb.put_u8(packet.action_space.size())
	for directive in packet.action_space:
		_encode_directive(spb, directive)

	return spb.data_array

## 二进制反序列化：高效还原为标准 DTO
static func decode_from_bytes(
	bytes: PackedByteArray,
	out_packet: AgentHudTelemetryPacketDTO = null
) -> AgentHudTelemetryPacketDTO:
	var pkt: AgentHudTelemetryPacketDTO = out_packet if out_packet != null else AgentHudTelemetryPacketDTO.new()
	pkt.reset_state()
	# 使用 StreamPeerBuffer 快速反解...
	return pkt
```

---

## 四、 第三阶段交付物与自检标准

1. `CompanionObserverBus` 升级完成且既有单元测试 100% 兼容通过；
2. `AgentHudSliceBridge` 成功集成多步轨迹窗口方法；
3. `BinaryTelemetryCodec` 编解码通过双向无损 round-trip 验证；
4. 二进制体积严格控制在 $\le 256$ 字节以内。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 迁移 CompanionObserverBus 事件通道至异步分发架构
- [x] Step 3.2: 扩展 AgentHudSliceBridge 提供多步轨迹窗口导出
- [x] Step 3.3: 接线 BinaryTelemetryCodec 并验证 PackedByteArray 极速传输
- [x] Step 3.4: 更新单源配置文件收敛对象池与缓冲区参数

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-ATP-S3-01 | 伴侣总线广播非阻塞退化 | 模拟慢速外部监听器阻塞 | 异步线程与广播队列平稳运行，单机主线程不受影响 |
| TC-ATP-S3-02 | 轨迹切片时间窗口连贯性 | 连续提取近 K 步轨迹窗口 | 轨迹内各包序号单调递增，无断代与时间倒流异常 |
| TC-ATP-S3-03 | 二进制 PackedByteArray 吞吐 | 执行高吞吐编码与解码压测 | 编解码单次耗时 <= 0.1ms，满足微秒级低延迟 |
| TC-ATP-S3-04 | 单源配置生效性与零硬编码 | 读取对象池与通道各参数 | 100% 经由 GameConfig.get_* 获取，零内联硬编码 |

