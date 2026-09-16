---
档号: KALAR-DEV-2026-ST01-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST01 (Phase_05_核心引擎演进)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_05_核心引擎演进 —— 阶段3：世界时钟推进与NPC离线自发演化
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: WorldEvolutionFSM; 世界时钟推进; NPC离线自发演化
---

# 施工细则：Phase 05 核心引擎演进 —— 阶段3：世界时钟推进与NPC离线自发演化

> [!NOTE]
> **【施工目标】**：实现 `WorldClockMaster` 绝对纪元轮转推进、NPC GOAP 离线自发演化与大宗商品物价周期波动的配置文件驱动改造。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST01-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST01-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[后端架构需求表索引](../../../../后端架构/后端架构需求表索引.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST01-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST01-001_阶段1_游戏主循环与状态栈契约.md) ｜ [阶段2](KALAR-DEV-2026-ST01-002_阶段2_2D瓦片物理与视口跟随实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST01-004_阶段4_联机权威同步与验收测试.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[三、 状态机与配置驱动](../../../../后端架构/后端架构需求表索引.md)
* **核心不变量约束断言**：`时间推进必须单向递增，NPC GOAP 决策行为集由配置表动态加载`。

---

## 一、 配置文件驱动映射 (Config-Driven Bindings)

```json
{
  "evolution_cycle": {
    "ticks_per_step": 60,
    "offline_max_hours": 168,
    "commodity_price_volatility": 0.05
  },
  "npc_goap_weights": {
    "survival_food": 1.5,
    "economic_trade": 1.2,
    "social_reputation": 0.8
  }
}
```

```gdscript
# 模块路径: res://backend/domains/world_navigation/world_evolution_fsm.gd
class_name WorldEvolutionFSM extends RefCounted:

    static func advance_offline_evolution(clock: WorldClockMaster, hours: int) -> void:
        var max_hours := GameConfig.get_int("domains.world", "evolution_cycle/offline_max_hours", 168)
        var safe_hours = clampi(hours, 0, max_hours)
        clock.advance_travel_hours(safe_hours)
        EventBus.get_instance().emit_narrative_by_key("world/evolution_tick", "world", [safe_hours])
```
