---
档号: KALAR-DEV-2026-ST11-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST11 (Phase_15_前端UI骨架_P3抽卡工坊魔典怪物)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_15_前端UI骨架_P3抽卡工坊魔典怪物 —— 阶段3：配置驱动与Theme令牌接入
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 配置驱动; Theme令牌接入; ui.json
---

# 施工细则：Phase 15 前端UI骨架P3深度 —— 阶段3：配置驱动与Theme令牌接入

> [!NOTE]
> **【施工目标】**：实现抽卡、工坊、魔典与怪物面板文案与品阶配色接入配置表。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST11-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST11-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表6](../../../../前端架构/前端架构需求表6.md)、[前端架构需求表11](../../../../前端架构/前端架构需求表11.md)、[前端架构需求表12](../../../../前端架构/前端架构需求表12.md) 与 [前端架构需求表13](../../../../前端架构/前端架构需求表13.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST11-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST11-001_阶段1_UI组件与视图契约定义.md) ｜ [阶段2](KALAR-DEV-2026-ST11-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST11-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端需求表6~13 令牌定义](../../../../前端架构/前端架构需求表6.md) ｜ [config/frontend/ui.json](../../../../../config/frontend/ui.json)
* **核心不变量约束断言**：`抽卡品阶光效与怪物威胁评级配色严格映射 Theme 令牌`。
* **防漂移最高指示**：严禁写死装备品阶色值（1~6阶）。

---

## 一、 Theme 令牌与配置映射实现 (Theme Token & Config Binding)

```gdscript
# 模块路径: res://frontend/views/crafting_workshop/crafting_workshop_view.gd
func get_tier_color(tier_rank: int) -> Color:
    match tier_rank:
        1: return Color.html("#94a3b8") # 普通 (白)
        2: return Color.html("#34d399") # 优秀 (绿)
        3: return Color.html("#38bdf8") # 精良 (蓝)
        4: return Color.html("#c084fc") # 史诗 (紫)
        5: return Color.html("#fbbf24") # 传说 (金)
        6: return Color.html("#f87171") # 神话 (红)
        _: return Color.WHITE
```

---

## 二、 零硬编码配置项映射清单

| 配置键名 | 默认值 | 作用组件 |
| :--- | :--- | :--- |
| `frontend.ui:gacha/banner_title` | `"常驻祈愿·群星契约"` | 抽卡池标题 |
| `frontend.ui:crafting/forge_btn` | `"开始锻造"` | 工坊操作按钮 |
| `frontend.ui:grimoire/compile_btn` | `"编译校验"` | 魔典著书按钮 |
| `infrastructure.event_categories:lifecycle/color` | `"#fbbf24"` | 著书立说分类色 |
