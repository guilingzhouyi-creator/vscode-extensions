---
档号: KALAR-DEV-2026-ST10-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST10 (Phase_14_前端UI骨架_P2世界任务邮件社交)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_14_前端UI骨架_P2世界任务邮件社交 —— 阶段1：UI组件与视图契约定义
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: WorldMapView; UI组件; 视图契约定义
---

# 施工细则：Phase 14 前端UI骨架P2世界 —— 阶段1：UI组件与视图契约定义

> [!NOTE]
> **【施工目标】**：完成 P2 世界探索（表10 世界地图、表7 任务因果、表8 邮件系统、表9 社交公会）19 个界面的 Control 场景树结构与契约定义。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST10-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST10-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表7](../../../../前端架构/前端架构需求表7.md)、[前端架构需求表8](../../../../前端架构/前端架构需求表8.md)、[前端架构需求表9](../../../../前端架构/前端架构需求表9.md)、[前端架构需求表10](../../../../前端架构/前端架构需求表10.md) 与 [前端UI骨架建设路线图](../../../../前端架构/前端UI骨架建设路线图.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST10-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST10-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ [阶段3](KALAR-DEV-2026-ST10-003_阶段3_配置驱动与Theme令牌接入.md) ｜ [阶段4](KALAR-DEV-2026-ST10-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端UI骨架建设路线图 P2 世界期](../../../../前端架构/前端UI骨架建设路线图.md)
* **核心不变量约束断言**：`大地图缩放点击、任务列表/DAG、邮件列表/写信、公会/聊天均有独立场景容器`。
* **防漂移最高指示**：严禁在前端渲染时阻塞 UI 线程。

---

## 一、 UI 视图组件与契约接口 (UI Component & Contract)

```gdscript
# 模块路径: res://frontend/views/world_map/world_map_view.gd
class_name WorldMapView extends Control

enum TabType {
    OVERWORLD_GRID, # 大地图
    TOWN_HUB,       # 城镇
    MARCHING_ROUTE, # 行军探索
    SOVEREIGNTY_MAP,# 主权建国
    TERRITORY_VIEW, # 领地详情
    PATHFINDING_HUD # 寻路导航
}

var current_tab: TabType = TabType.OVERWORLD_GRID
```

---

## 二、 场景树与节点层次 (Scene Tree Hierarchy)

```
QuestCausalityView (Control)
├── QuestListContainer (ScrollContainer)
│   └── QuestItemList (VBoxContainer)
├── QuestDetailPanel (PanelContainer)
├── CausalityDAGView (Control)
└── BountyBoardPanel (PanelContainer)
```
