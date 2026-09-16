---
档号: KALAR-DEV-2026-ST10-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST10 (Phase_14_前端UI骨架_P2世界任务邮件社交)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_14_前端UI骨架_P2世界任务邮件社交 —— 阶段3：配置驱动与Theme令牌接入
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 配置驱动; Theme令牌接入; ui.json
---

# 施工细则：Phase 14 前端UI骨架P2世界 —— 阶段3：配置驱动与Theme令牌接入

> [!NOTE]
> **【施工目标】**：实现世界地图、任务、邮件与公会面板文案与事件配色接入配置表。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST10-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST10-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表7](../../../../前端架构/前端架构需求表7.md)、[前端架构需求表8](../../../../前端架构/前端架构需求表8.md)、[前端架构需求表9](../../../../前端架构/前端架构需求表9.md) 与 [前端架构需求表10](../../../../前端架构/前端架构需求表10.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST10-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST10-001_阶段1_UI组件与视图契约定义.md) ｜ [阶段2](KALAR-DEV-2026-ST10-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST10-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端需求表7~10 令牌定义](../../../../前端架构/前端架构需求表7.md) ｜ [config/frontend/ui.json](..\..\..\..\..\config\frontend\ui.json)
* **核心不变量约束断言**：`任务类型配色（主线/支线/因果/悬赏）严格映射 event_categories.json`。
* **防漂移最高指示**：严禁硬编码地名与公会等级称谓。

---

## 一、 Theme 令牌与配置映射实现 (Theme Token & Config Binding)

```gdscript
# 模块路径: res://frontend/views/quest_causality/quest_causality_view.gd
func get_quest_category_color(quest_type: String) -> Color:
    return ThemeManager.get_category_color("quest")
```

---

## 二、 零硬编码配置项映射清单

| 配置键名 | 默认值 | 作用组件 |
| :--- | :--- | :--- |
| `frontend.ui:world_map/tab_titles/overworld` | `"大地图"` | 地图 Tab |
| `frontend.ui:mail/empty_notice` | `"暂无未读邮件"` | 邮件空态提示 |
| `frontend.ui:guild/create_btn` | `"创建公会"` | 公会面板按钮 |
| `infrastructure.event_categories:travel/color` | `"#34d399"` | 行军探索分类色 |
