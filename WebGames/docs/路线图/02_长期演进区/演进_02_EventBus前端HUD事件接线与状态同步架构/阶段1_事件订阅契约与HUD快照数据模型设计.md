# 施工细则：演进 02 EventBus 前端 HUD 事件接线与状态同步架构 —— 阶段1：事件订阅契约与 HUD 快照数据模型设计

> [!NOTE]
> **【施工目标】**：完成前端主页 HUD（`frontend/views/main_hud/main_hud_view.gd`）从零接线骨架到 EventBusCore 事件驱动的数据契约设计：事件订阅契约、HUD 状态快照 DTO、通道白名单路由表与同步不变量。
> **【授权依据】**：**已获项目负责人/用户明确授权 (Explicit Authorization)**——授权进入 `02_长期演进区` 立项本工程。
> **【需求溯源】**：前后端契约审查结论（docs/audit/AUDIT_REPORT_前端可视化.md：前端 17 视图零后端接线、事件总线完全断开）+ 序章生命周期调查（EventBusCore 双通道可达前端进程，`main_dashboard.gd` 已验证消费；`main_hud_view.gd` 零订阅、`update_status_snapshot` 仅测试调用）。
> **施工开始日期**: 2026-09-05（中午时段）

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[docs/audit/AUDIT_REPORT_前端可视化.md](../../../audit/AUDIT_REPORT_前端可视化.md)「一句话结论」节（前端高保真骨架、零后端接线）与 [`EventBusCore` 领域事件信道契约](../../../../backend/infrastructure/event_bus/event_bus_core.gd)（`DOMAIN_EVENT_GENERIC` 无条件广播 + 可解析文案时 `NARRATIVE_EVENT_TEXT` 二次广播）
* **核心不变量约束断言**：`HUD 状态快照必须由事件载荷聚合派生，绝不直读 GameConfig 或 Mock 常量作为运行时权威值；任一 EventBusCore 信道在 HUD 侧至多存在一个订阅接入点（单源订阅）`。
* **防漂移最高指示**：通道白名单与处理策略必须配置化（`config/frontend/views/hud_event_bridge.json`），严禁在代码中散落硬编码通道字符串；订阅必须经 `EventBusCore.get_instance()` 官方唯一入口，严禁绕过 EventBusCore 直连后端求解器。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

```gdscript
# 模块路径: res://frontend/i18n/hud_event_bridge.gd（桥接器入口，见阶段2）
# 本阶段仅定义数据契约，不实现接线逻辑。

# 1. HUD 顶栏状态快照 DTO —— 阶段2 桥接器聚合后经 update_status_snapshot 注入
# 模块路径: res://frontend/views/main_hud/hud_status_snapshot_dto.gd
class_name HudStatusSnapshotDTO extends RefCounted:

    var account_id: String = ""
    var character_id: String = ""
    var character_name: String = ""
    var hp_current: float = 0.0
    var hp_max: float = 1.0
    var mp_current: float = 0.0
    var mp_max: float = 1.0
    var ap_current: float = 0.0
    var ap_max: float = 1.0
    var gold: int = 0
    var mana_crystals: int = 0
    var timestamp_utc: int = 0

    func to_dto() -> Dictionary:
        return {
            "account_id": account_id,
            "character_id": character_id,
            "character_name": character_name,
            "hp_current": hp_current, "hp_max": hp_max,
            "mp_current": mp_current, "mp_max": mp_max,
            "ap_current": ap_current, "ap_max": ap_max,
            "gold": gold, "mana_crystals": mana_crystals,
            "timestamp_utc": timestamp_utc,
        }

    static func from_dto(data: Dictionary) -> HudStatusSnapshotDTO:
        var dto := HudStatusSnapshotDTO.new()
        dto.account_id = str(data.get("account_id", ""))
        dto.character_id = str(data.get("character_id", ""))
        dto.character_name = str(data.get("character_name", ""))
        dto.hp_current = float(data.get("hp_current", 0.0))
        dto.hp_max = maxf(1.0, float(data.get("hp_max", 1.0)))   # 除数下限守卫
        dto.mp_current = float(data.get("mp_current", 0.0))
        dto.mp_max = maxf(1.0, float(data.get("mp_max", 1.0)))
        dto.ap_current = float(data.get("ap_current", 0.0))
        dto.ap_max = maxf(1.0, float(data.get("ap_max", 1.0)))
        dto.gold = int(data.get("gold", 0))
        dto.mana_crystals = int(data.get("mana_crystals", 0))
        dto.timestamp_utc = int(data.get("timestamp_utc", 0))
        return dto
```

```gdscript
# 2. 事件订阅契约枚举 —— 桥接器订阅白名单（策略映射见阶段3 配置表）
# 模块路径: res://frontend/i18n/hud_event_contract.gd
class_name HudEventContract extends RefCounted:

    # EventBusCore 四信道（与 main_dashboard.gd 既有 on_channel 订阅面同构，HUD 侧单源接入）
    enum BusSignal {
        DOMAIN_EVENT,            # domain_event(channel, payload)：结构化域事件
        NARRATIVE_EVENT,         # narrative_event_emitted(packet)：文案型叙事事件
        WORLD_CLOCK_ADVANCED,    # world_clock_advanced(...)：时钟推进
        LOG_MESSAGE_POSTED,      # log_message_posted(level, message)：系统日志
    }

    # 域事件通道白名单（阶段2 实际消费；未登记通道默认降级为 SYSTEM 战报行）
    const CHANNEL_HUD_SNAPSHOT: String = "character_creation.completed"   # 顶栏快照主来源
    const CHANNEL_WORLD_ENTERED: String = "world_gateway.world_entered"   # 进世界 → 视图路由联动
    const CHANNEL_PROLOGUE_STEP: String = "prologue.step_advanced"        # 序章步进 → 剧情终端
    const CHANNEL_NARRATIVE_DAG: String = "narrative.dag.completed"       # DAG 完结 → 任务追踪/剧情收口
    const CHANNEL_WALLET_MUTATED: String = "currency.wallet.mutated"      # 钱包变更 → 顶栏刷新
```

```text
# 3. 通道 → 处理策略路由表（阶段3 落地为 config/frontend/views/hud_event_bridge.json）
#    结构预览（真实配置以阶段3 文件为准）：
#   channels:
#     character_creation.completed: { handler: "snapshot_aggregate", category: "system" }
#     world_gateway.world_entered:  { handler: "route_to_main_hud", category: "system" }
#     prologue.step_advanced:       { handler: "terminal_narrative", category: "narrative" }
#     narrative.dag.completed:      { handler: "quest_tracker", category: "narrative" }
#     currency.wallet.mutated:      { handler: "snapshot_aggregate", category: "economy" }
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 1.1: HUD 状态域拆解与事件源梳理** - 枚举顶栏/聊天/战报/任务追踪四区的事件来源通道，明确输入→状态→输出边界
- [ ] **Step 1.2: 严格类型化快照 DTO 定义** - 声明 `HudStatusSnapshotDTO` 全字段类型、默认值与除数下限（`hp_max/mp_max/ap_max >= 1`）
- [ ] **Step 1.3: 订阅契约与白名单建立** - 定义 `HudEventContract` 四信号枚举与通道常量，声明单源订阅不变量
- [ ] **Step 1.4: 数据合法性校验与防御性兜底** - 空 payload / 缺字段 / 负值注入一律回退安全默认值，杜绝 HUD 状态脏写

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-EV02-S1-01` | 快照 DTO 完整实例化 | 合法初始化字典 | 全字段类型与默认值 100% 匹配，除数下限钳制生效 |
| `TC-EV02-S1-02` | DTO 序列化与反序列化对等 | DTO 实例对象 | `from_dto(to_dto())` 保持深度等价（含嵌套字典） |
| `TC-EV02-S1-03` | 非法/空缺数据防御性兜底 | 缺省字段空字典 | 安全填充默认值，hp_max 等分母不为 0，杜绝除零崩溃 |
| `TC-EV02-S1-04` | 通道白名单完整性 | 契约枚举 vs 阶段3 配置表 | 代码常量与配置路由表双向一致，零孤儿通道 |
