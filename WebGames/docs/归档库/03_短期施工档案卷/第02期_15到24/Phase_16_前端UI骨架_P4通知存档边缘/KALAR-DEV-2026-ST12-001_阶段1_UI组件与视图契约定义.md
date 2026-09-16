---
档号: KALAR-DEV-2026-ST12-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST12 (Phase_16_前端UI骨架_P4通知存档边缘)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_16_前端UI骨架_P4通知存档边缘 —— 阶段1：UI组件与视图契约定义
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: MiscEdgeView; UI组件; 视图契约定义
---

# 施工细则：Phase 16 前端UI骨架P4闭环 —— 阶段1：UI组件与视图契约定义

> [!NOTE]
> **【施工目标】**：完成 P4 闭环系统（表14 通知公告、表16 系统存档、表17 边缘杂项）11 个界面的 Control 场景树结构与契约定义。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST12-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST12-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表14](../../../../前端架构/前端架构需求表14.md)、[前端架构需求表16](../../../../前端架构/前端架构需求表16.md)、[前端架构需求表17](../../../../前端架构/前端架构需求表17.md) 与 [前端UI骨架建设路线图](../../../../前端架构/前端UI骨架建设路线图.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST12-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST12-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ [阶段3](KALAR-DEV-2026-ST12-003_阶段3_配置驱动与Theme令牌接入.md) ｜ [阶段4](KALAR-DEV-2026-ST12-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端UI骨架建设路线图 P4 闭环期](../../../../前端架构/前端UI骨架建设路线图.md)
* **核心不变量约束断言**：`Toast 队列、Modal 模态、红点树、存档槽位与伪装切换全面组件化`。
* **防漂移最高指示**：严禁在非模态弹窗层拦截全局输入事件。

---

## 一、 UI 视图组件与契约接口 (UI Component & Contract)

```gdscript
# 模块路径: res://frontend/views/misc_edge/misc_edge_view.gd
class_name MiscEdgeView extends Control

enum TabType {
    DISGUISE,       # 身份伪装
    MUTATION,       # 精英突变
    GROUND_DROP,    # 地面掉落
    NAME_REGISTRY   # 命名注册
}

var current_tab: TabType = TabType.DISGUISE
```

---

## 二、 场景树与节点层次 (Scene Tree Hierarchy)

```
NotificationBulletinView (Control)
├── ToastQueueContainer (VBoxContainer)
├── ModalDialogOverlay (PanelContainer)
├── RedDotTreeView (Tree)
└── BulletinBoardPanel (ScrollContainer)
```
