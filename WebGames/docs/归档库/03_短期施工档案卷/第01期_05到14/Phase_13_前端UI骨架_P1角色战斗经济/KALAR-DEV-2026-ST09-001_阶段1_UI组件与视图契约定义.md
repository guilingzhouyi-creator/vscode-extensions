---
档号: KALAR-DEV-2026-ST09-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST09 (Phase_13_前端UI骨架_P1角色战斗经济)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_13_前端UI骨架_P1角色战斗经济 —— 阶段1：UI组件与视图契约定义
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: CharacterProgressionView; UI组件; 视图契约定义
---

# 施工细则：Phase 13 前端UI骨架P1核心 —— 阶段1：UI组件与视图契约定义

> [!NOTE]
> **【施工目标】**：完成 P1 核心玩家循环（表3 角色养成、表4 战斗界面、表5 经济交易）20 个子界面的 Control 场景树结构与契约定义。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST09-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST09-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表3](../../../../前端架构/前端架构需求表3.md)、[前端架构需求表4](../../../../前端架构/前端架构需求表4.md)、[前端架构需求表5](../../../../前端架构/前端架构需求表5.md) 与 [前端UI骨架建设路线图](../../../../前端架构/前端UI骨架建设路线图.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST09-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST09-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ [阶段3](KALAR-DEV-2026-ST09-003_阶段3_配置驱动与Theme令牌接入.md) ｜ [阶段4](KALAR-DEV-2026-ST09-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端UI骨架建设路线图 P1 核心期](../../../../前端架构/前端UI骨架建设路线图.md)
* **核心不变量约束断言**：`角色面板 8 子界面、战斗 5 子界面、经济 7 子界面均以独立容器划分，层级严格树状`。
* **防漂移最高指示**：严禁在视图层写入属性换算数学逻辑；严禁将战斗飘字与物理世界混淆。

---

## 一、 UI 视图组件与契约接口 (UI Component & Contract)

```gdscript
# 模块路径: res://frontend/views/character_progression/character_progression_view.gd
class_name CharacterProgressionView extends Control

enum TabType {
    OVERVIEW,       # 总面板
    ATTRIBUTES,     # 六维属性
    PHYSIQUE,       # 生命体质
    SKILLS,         # 技能树
    EQUIPMENT,      # 装备栏
    INVENTORY,      # 背包
    TITLES,         # 称号系统
    POTENTIAL       # 潜能加点
}

var current_tab: TabType = TabType.OVERVIEW
```

---

## 二、 场景树与节点层次 (Scene Tree Hierarchy)

```
CombatView (Control)
├── BackgroundArena (ColorRect)
├── BossHUD (VBoxContainer)
│   ├── BossNameLabel (Label)
│   └── MultiPartHealthBars (VBoxContainer)
├── CombatFloatingTextLayer (Control)
└── SettlementOverlay (PanelContainer)
```
