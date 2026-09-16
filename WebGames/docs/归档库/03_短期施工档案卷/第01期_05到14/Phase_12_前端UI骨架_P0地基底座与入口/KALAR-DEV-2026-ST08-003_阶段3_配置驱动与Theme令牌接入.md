---
档号: KALAR-DEV-2026-ST08-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST08 (Phase_12_前端UI骨架_P0地基底座与入口)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_12_前端UI骨架_P0地基底座与入口 —— 阶段3：配置驱动与Theme令牌接入
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: ThemeManager; ui.json
---

# 施工细则：Phase 12 前端UI骨架P0地基 —— 阶段3：配置驱动与Theme令牌接入

> [!NOTE]
> **【施工目标】**：实现 P0 视图文案与布局全面接入 `ui.json`，事件配色接入 `event_categories.json`。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST08-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST08-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表2](../../../../前端架构/前端架构需求表2.md) 与 [前端架构需求表15](../../../../前端架构/前端架构需求表15.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST08-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST08-001_阶段1_UI组件与视图契约定义.md) ｜ [阶段2](KALAR-DEV-2026-ST08-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST08-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端UI骨架建设路线图 4.4 规范](../../../../前端架构/前端UI骨架建设路线图.md) ｜ [config/frontend/ui.json](..\..\..\..\..\config\frontend\ui.json)
* **核心不变量约束断言**：`删除任一配置键必须自动回退至兜底默认值，界面永不崩溃；配色令牌与分类 100% 映射`。
* **防漂移最高指示**：严禁在代码中写死按钮文案与 Hex 颜色值。

---

## 一、 Theme 令牌与配置映射实现 (Theme Token & Config Binding)

```gdscript
# 模块路径: res://frontend/theme/theme_manager.gd
class_name ThemeManager extends RefCounted

static func get_category_color(category_name: String) -> Color:
    var categories := GameConfig.get_dict("infrastructure", "event_categories", {})
    for key in categories:
        var entry: Dictionary = categories[key]
        if entry.get("name", "") == category_name:
            return Color.html(entry.get("color", "#94a3b8"))
    return Color("#94a3b8") # 兜底默认色

static func get_ui_text(path_key: String, default_text: String) -> String:
    var parts := path_key.split("/")
    if parts.size() < 2:
        return default_text
    return GameConfig.get_string("frontend.ui", path_key, default_text)
```

---

## 二、 零硬编码配置项映射清单

| 配置键名 | 默认值 | 作用组件 |
| :--- | :--- | :--- |
| `frontend.ui:hud/topbar/title` | `"卡拉尔世界"` | `MainHUDView` 顶栏标题 |
| `frontend.ui:account/login/btn_text` | `"登录游戏"` | `AccountEntryView` 登录按钮 |
| `frontend.ui:settings/audio/master_volume` | `"主音量"` | `SettingsCenterView` 音频滑块 |
| `infrastructure.event_categories:combat/color` | `"#f87171"` | 战报终端战斗分类色 |
