# Godot 4.7 卡拉尔世界三层纯逻辑解耦与高承压对象池 (`ADV-PRF-002`) 规范指南

> 本指南整合了 `WebGames/` 非 Web 游戏技术栈红线、三层解耦拓扑以及高频循环对象池（`ADV-PRF-002`）设计规范。

---

## 一、 非 Web 游戏刚性红线与三层单向解耦拓扑

`WebGames/` 是基于 **Godot 4.7 引擎与 GDScript** 的桌面与无头（Headless）独立系统，**严禁引入任何 DOM、HTML、CSS、Web API 或 JS/TS 前端技术栈**。系统自上而下分为三层：

```text
┌────────────────────────────────────────────────────────┐
│ 前端表现层 (frontend/views/** · Godot Control 节点树)   │
│ • 零业务计算（禁 randf/randi、禁战斗/汇率公式）          │
│ • 强类型 Tabs 控制器引用，唯一数据入口 apply_snapshot()  │
└───────────────────────────▲────────────────────────────┘
                            │ (DTO 快照单向注入)
┌───────────────────────────┴────────────────────────────┐
│ 后端纯逻辑领域层 (domains/** · 无头求解器与状态机)       │
│ • 零 UI 节点依赖，支持脱离渲染管线无头极速单测           │
│ • 帧循环零瞬态堆分配 (ADV-PRF-002)，池化对象 reset_state │
└───────────────────────────▲────────────────────────────┘
                            │ (GameConfig 点分路径读取)
┌───────────────────────────┴────────────────────────────┐
│ 全域配置驱动中心 (config/domains/<domain>/core.json)    │
└────────────────────────────────────────────────────────┘
```

---

## 二、 高承压对象池与循环零瞬态堆分配 (`ADV-PRF-002`)

在每秒 60 帧的 `_process` / `_physics_process` 或战斗事件流中，频繁调用 `Class.new()` 会触发引用计数与内存分配抖动：
1. **禁止循环内裸调 `.new()` (`ADV-PRF-002`)**：伤害跳字、投射物实体与事件载荷必须预先初始化固定容量对象池；
2. **强制实现 `reset_state()` 对称借还契约**：
   ```gdscript
   class_name PooledBullet
   extends RefCounted

   var position: Vector2 = Vector2.ZERO
   var velocity: Vector2 = Vector2.ZERO
   var damage: int = 0
   var is_active: bool = false

   func reset_state() -> void:
       position = Vector2.ZERO
       velocity = Vector2.ZERO
       damage = 0
       is_active = false
   ```
3. **借还对称与原位注入**：`acquire()` 借出与 `release()` 归还时必须调用 `reset_state()` 清除脏状态；跨函数传递高频快照时由调用方传入预分配 `Dictionary`/`Array` 原位覆写。
