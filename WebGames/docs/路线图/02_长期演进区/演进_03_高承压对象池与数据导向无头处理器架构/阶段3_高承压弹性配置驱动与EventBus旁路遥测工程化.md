# 施工细则：演进 03 高承压对象池与数据导向无头处理器架构 —— 阶段3：高承压弹性配置驱动与 EventBus 旁路遥测工程化

> [!NOTE]
> **【施工目标】**：完成全域对象池与批处理管线的配置驱动（零硬编码）、生命周期幂等装配与对称反装配（GameBootstrap 集成），以及基于 EventBusCore 的旁路性能遥测与溢出安全监控。
> **【授权依据】**：**已获项目负责人/用户明确授权 (Explicit Authorization)**——授权进入 `02_长期演进区` 立项本演进工程。
> **【需求溯源】**：阶段1~2 架构实现 + 全域零硬编码与可观测性留痕审计规范。
> **施工开始日期**: 2026-09-06

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[game_bootstrap.gd](../../../../backend/infrastructure/game_bootstrap.gd)（`assemble()` 与 `teardown()` 声明周期装配规范）、[game_config.gd](../../../../backend/infrastructure/game_config.gd)（类型化无硬编码读取）与 [event_bus_core.gd](../../../../backend/infrastructure/event_bus/event_bus_core.gd)（统一事件广播）。
* **核心不变量约束断言**：
  - **Inv-POOL3-1（配置驱动与三层降级）**：全域对象池参数（容量、阈值、溢出策略）一律由 `config/infrastructure/object_pool.json` 驱动，绝对禁止裸写魔法数字；配置缺失时具备安全默认值降级；
  - **Inv-POOL3-2（对称幂等装配与反装配）**：对象池统一经 `GameBootstrap.assemble()` 初始化，经 `GameBootstrap.teardown()` 彻底清空，确保多次热重载与测试回归零状态残留；
  - **Inv-POOL3-3（旁路遥测低开销）**：性能统计与溢出告警采用抽样或跨阈值触发机制，严禁在 `acquire()`/`release()` 高频热路径内无节制派发 EventBusCore 信道事件；
  - **Inv-POOL3-4（死配置零容忍）**：新增配置表必须纳入 `_required_tables` 与 `audit_config_unused.py` 静态治理，保证配置表 100% 被代码消费。
* **防漂移最高指示**：配置开关 `enabled` 控制池化启停；当 `enabled=false` 时，适配层无缝降级为传统 `new()` 构造，不破坏任何上游调用链。

---

## 一、 配置文件与装配工程化设计 (Configuration & Assembly Architecture)

### 1.1 配置文件规划 (`config/infrastructure/object_pool.json`)

```json
{
  "pools": {
    "combat_events": {
      "enabled": true,
      "preallocate_size": 64,
      "max_capacity": 512,
      "allow_overflow_alloc": true,
      "overflow_warning_threshold": 256
    },
    "spatial_triggers": {
      "enabled": true,
      "preallocate_size": 32,
      "max_capacity": 256,
      "allow_overflow_alloc": true,
      "overflow_warning_threshold": 128
    },
    "soa_batch": {
      "default_buffer_capacity": 2048,
      "damping_factor": 0.95
    }
  },
  "telemetry": {
    "emit_stats_interval_ticks": 100,
    "warn_on_overflow": true
  }
}
```

### 1.2 全局对象池管理器与 GameBootstrap 集成

```gdscript
# 模块路径: res://backend/infrastructure/object_pool_manager.gd
# 职责: 全域单例对象池集中管理中枢

class_name ObjectPoolManager extends RefCounted:

	static var _pools: Dictionary = {} # pool_name -> ObjectPool
	static var _initialized: bool = false

	static func initialize() -> void:
		if _initialized:
			return
		_pools.clear()
		_initialized = true

	static func register_pool(pool_name: String, factory: Callable) -> ObjectPool:
		initialize()
		var cfg := _load_pool_config(pool_name)
		var pool := ObjectPool.new(factory, cfg)
		_pools[pool_name] = pool
		return pool

	static func get_pool(pool_name: String) -> ObjectPool:
		return _pools.get(pool_name, null)

	static func teardown() -> void:
		_pools.clear()
		_initialized = false

	static func _load_pool_config(pool_name: String) -> ObjectPoolConfigDTO:
		var prefix := "pools/" + pool_name + "/"
		var dto := ObjectPoolConfigDTO.new()
		dto.pool_name = pool_name
		dto.preallocate_size = maxi(0, GameConfig.get_int("infrastructure.object_pool", prefix + "preallocate_size", 32))
		dto.max_capacity = maxi(dto.preallocate_size, GameConfig.get_int("infrastructure.object_pool", prefix + "max_capacity", 512))
		dto.allow_overflow_alloc = GameConfig.get_bool("infrastructure.object_pool", prefix + "allow_overflow_alloc", true)
		dto.overflow_warning_threshold = maxi(1, GameConfig.get_int("infrastructure.object_pool", prefix + "overflow_warning_threshold", 256))
		return dto
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 3.1: 配置表建档与治理挂接** - 创建 `config/infrastructure/object_pool.json`，在 `GameConfig._required_tables` 中声明注册。
- [ ] **Step 3.2: 全局池管理器实现** - 编写 `ObjectPoolManager.gd`，实现池注册、按需懒获取与配置装配。
- [ ] **Step 3.3: GameBootstrap 幂等集成** - 在 `assemble()` 中完成管理器启动，在 `teardown()` 中完成对称反装配。
- [ ] **Step 3.4: 门禁基线与旁路遥测集成** - 接入 EventBusCore 状态广播信道，确保 `audit_config_unused.py` 静态审查全绿。

---

## 三、 阶段交付物与验证断言 (DoD & Verification)

| 交付文件 | 核心职责 | 静态/单测断言指标 |
| :--- | :--- | :--- |
| `config/infrastructure/object_pool.json` | 对象池与批处理参数表 | JSON 语法 100% 合规，键值由 `audit_config_unused.py` 扫描零死配置 |
| `backend/infrastructure/object_pool_manager.gd` | 单例池管理器 | `initialize()` 与 `teardown()` 连续 100 次幂等调用零崩溃 |
| `backend/infrastructure/game_bootstrap.gd` (修改) | 启动反装配挂载点 | `GameBootstrap.assemble()` 快照返回包含已注册池数量统计 |
