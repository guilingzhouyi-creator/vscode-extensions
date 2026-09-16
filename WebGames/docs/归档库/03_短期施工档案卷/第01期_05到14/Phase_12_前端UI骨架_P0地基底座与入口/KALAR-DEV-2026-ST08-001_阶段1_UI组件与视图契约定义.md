---
档号: KALAR-DEV-2026-ST08-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST08 (Phase_12_前端UI骨架_P0地基底座与入口)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_12_前端UI骨架_P0地基底座与入口 —— 阶段1：UI组件与视图契约定义
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: ViewRouter; UI组件; 视图契约定义; ui.json
---

# 施工细则：Phase 12 前端UI骨架P0地基 —— 阶段1：UI组件与视图契约定义

> [!NOTE]
> **【施工目标】**：完成 P0 地基期（Theme 令牌层、ViewRouter 路由底座、表1 账号入口、表2 主界面 HUD、表15 设置中心）UI 契约与 Control 场景树结构定义。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST08-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST08-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表1](../../../../前端架构/前端架构需求表1.md)、[前端架构需求表2](../../../../前端架构/前端架构需求表2.md)、[前端架构需求表15](../../../../前端架构/前端架构需求表15.md) 与 [前端UI骨架建设路线图](../../../../前端架构/前端UI骨架建设路线图.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST08-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST08-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ [阶段3](KALAR-DEV-2026-ST08-003_阶段3_配置驱动与Theme令牌接入.md) ｜ [阶段4](KALAR-DEV-2026-ST08-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端UI骨架建设路线图 P0 地基期](../../../../前端架构/前端UI骨架建设路线图.md) ｜ [前端需求表索引](../../../../前端架构/前端架构需求表索引.md)
* **核心不变量约束断言**：`所有视图 100% 继承 Control，有 _ready() 桩，场景树层级完整，零 RefCounted 残留`。
* **防漂移最高指示**：严禁在骨架阶段引入业务求解器调用；严禁直接操作物理节点绝对坐标。

---

## 一、 UI 视图组件与契约接口 (UI Component & Contract)

```gdscript
# 模块路径: res://frontend/navigation/view_router.gd
class_name ViewRouter extends Control

enum ViewType {
    ACCOUNT_ENTRY,
    MAIN_HUD,
    CHARACTER_PROGRESSION,
    COMBAT_VIEW,
    ECONOMY_TRADE,
    GACHA_WISH,
    QUEST_CAUSALITY,
    MAIL_SYSTEM,
    GUILD_SOCIAL,
    WORLD_MAP,
    MONSTER_ECOLOGY,
    CRAFTING_WORKSHOP,
    GRIMOIRE_AUTHORING,
    NOTIFICATION_BULLETIN,
    SETTINGS_CENTER,
    SYSTEM_SAVE,
    MISC_EDGE
}

var view_stack: Array[Control] = []
var active_view: Control = null

func push_view(view_type: ViewType, payload: Dictionary = {}) -> void:
    # 压入视图栈并呈现
    pass

func pop_view() -> void:
    # 弹出栈顶视图并恢复上层
    pass
```

---

## 二、 场景树与节点层次 (Scene Tree Hierarchy)

```
AccountEntryView (Control)
├── Background (ColorRect - Theme: --overlay-bg)
├── TitleBanner (Label - ui.json: account/title)
└── TabContainer
    ├── SplashPanel (PanelContainer)
    ├── LoginPanel (PanelContainer)
    ├── RegisterPanel (PanelContainer)
    ├── ServerSelectPanel (PanelContainer)
    └── CharacterSelectPanel (PanelContainer)
```
