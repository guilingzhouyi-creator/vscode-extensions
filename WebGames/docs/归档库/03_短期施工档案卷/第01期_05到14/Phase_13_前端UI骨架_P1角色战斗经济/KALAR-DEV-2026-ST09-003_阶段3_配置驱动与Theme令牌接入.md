---
档号: KALAR-DEV-2026-ST09-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST09 (Phase_13_前端UI骨架_P1角色战斗经济)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_13_前端UI骨架_P1角色战斗经济 —— 阶段3：配置驱动与Theme令牌接入
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 配置驱动; Theme令牌接入; ui.json
---

# 施工细则：Phase 13 前端UI骨架P1核心 —— 阶段3：配置驱动与Theme令牌接入

> [!NOTE]
> **【施工目标】**：实现角色、战斗与经济面板文案配置化与 Theme 令牌绑定。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST09-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST09-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表3](../../../../前端架构/前端架构需求表3.md)、[前端架构需求表4](../../../../前端架构/前端架构需求表4.md) 与 [前端架构需求表5](../../../../前端架构/前端架构需求表5.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST09-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST09-001_阶段1_UI组件与视图契约定义.md) ｜ [阶段2](KALAR-DEV-2026-ST09-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST09-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端需求表3~5 令牌定义](../../../../前端架构/前端架构需求表3.md) ｜ [config/frontend/ui.json](..\..\..\..\..\config\frontend\ui.json)
* **核心不变量约束断言**：`伤害飘字颜色（物理/魔法/真实/暴击）严格映射 Theme 令牌`。
* **防漂移最高指示**：严禁在 GDScript 中硬编码伤害类型颜色常量。

---

## 一、 Theme 令牌与配置映射实现 (Theme Token & Config Binding)

```gdscript
# 模块路径: res://frontend/views/combat_view/combat_view.gd
func get_damage_color(damage_type: String) -> Color:
    match damage_type:
        "PHYSICAL": return ThemeManager.get_category_color("combat")
        "MAGICAL": return Color.html("#38bdf8")
        "TRUE_DAMAGE": return Color.html("#facc15")
        "CRITICAL": return Color.html("#ef4444")
        _: return Color.WHITE
```

---

## 二、 零硬编码配置项映射清单

| 配置键名 | 默认值 | 作用组件 |
| :--- | :--- | :--- |
| `frontend.ui:character/tab_titles/overview` | `"概览"` | 角色总面板 Tab |
| `frontend.ui:combat/settlement/victory_title` | `"战斗胜利"` | 战斗结算面板 |
| `frontend.ui:economy/currency/copper_name` | `"铜币"` | 钱包面额标签 |
