# 高承压对象池与循环零堆分配设计规范 (`ADV-PRF-002`)

## 一、 核心痛点与性能危机

在 Godot 游戏循环（每秒 60 帧）中，若在 `_process`、`_physics_process` 或粒子/战斗事件流内频繁调用 `Class.new()`，会产生大量瞬态堆内存分配。GDScript 的垃圾回收与引用计数管理会导致严重的微卡顿（GC spikes / frame drops）。

---

## 二、 刚性设计铁律

1. **绝对禁止循环内裸调 `.new()` (`ADV-PRF-002`)**：
   - 战斗伤害漂字、投射物实体、战斗载荷数据包必须预先池化；
   - 静态分析门禁严格监控高频循环体，一经发现堆分配一票阻断。
2. **必须实现 `reset_state()` 接口**：
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
3. **借还生命周期对称性**：
   - 获取：`var bullet = BulletPool.acquire()`（自动调用 `reset_state()` 并标记活跃）；
   - 归还：`BulletPool.release(bullet)`（重置状态并退回待用队列，杜绝脏数据残留）；
   - 析构时批量清理，禁止悬挂引用。
4. **预分配容器容量**：
   - 对象池底层数据结构预先初始化固定容量，避免运行时动态扩容引发的底层重新分配与内存碎片。
