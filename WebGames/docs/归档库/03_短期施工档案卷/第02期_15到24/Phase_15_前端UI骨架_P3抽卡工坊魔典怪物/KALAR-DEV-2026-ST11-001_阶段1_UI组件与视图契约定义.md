---
档号: KALAR-DEV-2026-ST11-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST11 (Phase_15_前端UI骨架_P3抽卡工坊魔典怪物)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_15_前端UI骨架_P3抽卡工坊魔典怪物 —— 阶段1：UI组件与视图契约定义
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: CraftingWorkshopView; UI组件; 视图契约定义
---

# 施工细则：Phase 15 前端UI骨架P3深度 —— 阶段1：UI组件与视图契约定义

> [!NOTE]
> **【施工目标】**：完成 P3 深度系统（表6 抽卡祈愿、表12 制造工坊、表13 魔典著书、表11 怪物生态）15 个界面的 Control 场景树结构与契约定义。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST11-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST11-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表6](../../../../前端架构/前端架构需求表6.md)、[前端架构需求表11](../../../../前端架构/前端架构需求表11.md)、[前端架构需求表12](../../../../前端架构/前端架构需求表12.md)、[前端架构需求表13](../../../../前端架构/前端架构需求表13.md) 与 [前端UI骨架建设路线图](../../../../前端架构/前端UI骨架建设路线图.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST11-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST11-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ [阶段3](KALAR-DEV-2026-ST11-003_阶段3_配置驱动与Theme令牌接入.md) ｜ [阶段4](KALAR-DEV-2026-ST11-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端UI骨架建设路线图 P3 深度期](../../../../前端架构/前端UI骨架建设路线图.md)
* **核心不变量约束断言**：`抽卡演出、工坊配方/分解、魔典 AST 编辑器、怪物图鉴各子系统独立解耦`。
* **防漂移最高指示**：严禁在前端直接计算抽卡伪随机种子。

---

## 一、 UI 视图组件与契约接口 (UI Component & Contract)

```gdscript
# 模块路径: res://frontend/views/crafting_workshop/crafting_workshop_view.gd
class_name CraftingWorkshopView extends Control

enum TabType {
    FORGE_WORKSHOP, # 锻造工坊
    RECIPE_CATALOG, # 配方列表
    ITEM_SALVAGE,   # 物品分解
    MATERIAL_VAULT  # 材料仓库
}

var current_tab: TabType = TabType.FORGE_WORKSHOP
```

---

## 二、 场景树与节点层次 (Scene Tree Hierarchy)

```
GrimoireAuthoringView (Control)
├── LibraryBrowser (PanelContainer)
├── ASTGraphEditor (GraphEdit)
│   └── ASTNodeContainer (Control)
├── PublicationPanel (PanelContainer)
└── RoyaltySettlement (PanelContainer)
```
