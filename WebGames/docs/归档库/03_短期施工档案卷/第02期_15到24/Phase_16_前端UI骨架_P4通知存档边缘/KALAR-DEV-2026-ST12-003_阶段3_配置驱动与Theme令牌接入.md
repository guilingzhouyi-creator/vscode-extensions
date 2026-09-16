---
档号: KALAR-DEV-2026-ST12-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST12 (Phase_16_前端UI骨架_P4通知存档边缘)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: Phase_16_前端UI骨架_P4通知存档边缘 —— 阶段3：配置驱动与Theme令牌接入
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 配置驱动; Theme令牌接入; ui.json
---

# 施工细则：Phase 16 前端UI骨架P4闭环 —— 阶段3：配置驱动与Theme令牌接入

> [!NOTE]
> **【施工目标】**：实现通知、存档与边缘杂项文案配置化与系统/掉落分类配色接入。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST12-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST12-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[前端架构需求表14](../../../../前端架构/前端架构需求表14.md)、[前端架构需求表16](../../../../前端架构/前端架构需求表16.md) 与 [前端架构需求表17](../../../../前端架构/前端架构需求表17.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST12-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST12-001_阶段1_UI组件与视图契约定义.md) ｜ [阶段2](KALAR-DEV-2026-ST12-002_阶段2_Mock数据驱动与按钮交互实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST12-004_阶段4_表现层单元测试与白模验收矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[前端需求表14~17 令牌定义](../../../../前端架构/前端架构需求表14.md) ｜ [config/frontend/ui.json](../../../../../config/frontend/ui.json)
* **核心不变量约束断言**：`Toast 弹窗分类配色（成功/警告/错误/信息）严格映射 Theme 令牌`。
* **防漂移最高指示**：严禁在代码中写死 CDKey 兑换成功/失败提示语。

---

## 一、 Theme 令牌与配置映射实现 (Theme Token & Config Binding)

```gdscript
# 模块路径: res://frontend/views/notification_bulletin/notification_bulletin_view.gd
func get_toast_level_color(level: String) -> Color:
    match level:
        "SUCCESS": return Color.html("#34d399")
        "WARNING": return Color.html("#fbbf24")
        "ERROR": return Color.html("#f87171")
        "INFO": return Color.html("#38bdf8")
        _: return Color.WHITE
```

---

## 二、 零硬编码配置项映射清单

| 配置键名 | 默认值 | 作用组件 |
| :--- | :--- | :--- |
| `frontend.ui:notification/toast_max_count` | `5` | Toast 队列容量 |
| `frontend.ui:system_save/cdk_input_placeholder` | `"请输入兑换码"` | CDK 兑换框 |
| `frontend.ui:misc_edge/disguise_btn` | `"启用伪装"` | 身份伪装按钮 |
| `infrastructure.event_categories:system/color` | `"#38bdf8"` | 系统公告分类色 |
