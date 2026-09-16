---
档号: KALAR-DEV-2026-ST41-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST41 (Phase_45_核心战斗逻辑与第三时间轴动态博弈体系完善)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_45_核心战斗逻辑与第三时间轴动态博弈体系完善 —— 阶段3：combat配置驱动与确定性重放工程化
形成日期: 2026-09-03
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: CombatTimelineReplayAudit; StepRecordDTO; 配置段定义; 确定性重放战报记录器; combat.json
---

# 施工细则：Phase 45 核心战斗逻辑与第三时间轴动态博弈体系完善 —— 阶段3：combat配置驱动与确定性重放工程化

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST41-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST41-001_阶段1_战斗初始化与第三时间轴数据契约.md) ｜ [阶段2](KALAR-DEV-2026-ST41-002_阶段2_双离散时间点与三轴联动算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST41-004_阶段4_第三时间轴动态博弈验收测试矩阵.md)

> 施工开始日期: 2026-09-03 上午
> 责任人: 卡拉尔世界引擎架构组
> 状态: ✅ 已施工完毕 · 100% 验收通过 (PASS) — 2026-09-03 第2轮获批闭环

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [config/domains/combat.json](../../../../../config/domains/combat.json)（战斗领域权威真源配置表）
  * [config/README.md](../../../../../config/README.md)（配置层级约定、单一真源与只读规范）
  * [backend/infrastructure/game_config.gd](../../../../../backend/infrastructure/game_config.gd)（类型化获取器与热重载接口）
  * [backend/infrastructure/deterministic_rng.gd](../../../../../backend/infrastructure/deterministic_rng.gd)（确定性随机种子与序列发生器）
* **核心不变量约束断言**：
  1. **零硬编码强类型不变量**：先手权重系数、离散发放与紧张点间隔上下限、待发栏容量上限及满载策略，100% 经由 `GameConfig.get_*` 类型化获取并具备默认值兜底，严禁使用 Variant `get_value`；
  2. **战报确定性全要素可重放不变量**：给定固定的角色初始规格、初始 Seed 与相同的输入操作序列，重放战斗产生的先手方、发牌时序、出牌校验及结算血量必须 100% 逐字元精确吻合；
  3. **向后兼容与配置热更安全防线**：新增配置节点若在缺省场景下，必须完全平滑降级至既有默认参数，不破坏既有 `combat.json` 与测试套件。
* **工程化重构最高指示**：严格遵守 `scripts/config/code_governance_rules.json` 高级规范（ADV-CFG、ADV-TYP、ADV-PRF），循环热路径内严禁重复解析配置路径。

---

## 一、 领域配置扩展与架构模式 (Configuration Schema & Architecture)

### 3.1 `config/domains/combat.json` 新增配置段定义

```json
{
  "initiative_model": {
    "weight_agility": 1.0,
    "weight_perception": 0.8,
    "weight_level": 0.5,
    "jitter_min": -2,
    "jitter_max": 2,
    "lead_ap_bonus": 2,
    "even_tiebreaker_mode": "DETERMINISTIC_50_50"
  },
  "tertiary_timeline": {
    "enabled": true,
    "time_scale": 1.0,
    "dispatch_interval_min_ms": 1200,
    "dispatch_interval_max_ms": 2800,
    "tension_interval_min_ms": 4500,
    "tension_interval_max_ms": 8500,
    "tension_types": [
      "PRESSURE_SURGE",
      "ENVIRONMENT_PULSE",
      "FORCE_ROUND_ADVANCE"
    ]
  },
  "staging_bar": {
    "max_capacity": 5,
    "overflow_policy": "DISCARD_OLDEST",
    "overflow_ap_bonus": 1
  },
  "round_lifecycle": {
    "max_round_duration_ms": 10000,
    "auto_pass_on_ap_exhausted": true,
    "auto_pass_on_hand_empty": true
  }
}
```

### 3.2 确定性重放战报记录器 (`CombatTimelineReplayAudit`)

```gdscript
# 模块路径: res://backend/domains/physics_thermodynamics/combat_timeline_replay_audit.gd
class_name CombatTimelineReplayAudit
extends RefCounted

class StepRecordDTO extends RefCounted:
	var step_index: int = 0
	var timeline_ms: int = 0
	var round_number: int = 1
	var action_type: String = ""             # "INITIATIVE" / "DISPATCH" / "TENSION" / "PLAY_CARD" / "ROUND_TRANSITION"
	var actor_id: String = ""
	var event_data: Dictionary = {}

	func to_dto() -> Dictionary:
		return {
			"step_index": step_index,
			"timeline_ms": timeline_ms,
			"round_number": round_number,
			"action_type": action_type,
			"actor_id": actor_id,
			"data": event_data.duplicate(true),
		}

var battle_id: String = ""
var initial_seed: int = 0
var records: Array[StepRecordDTO] = []
var step_counter: int = 0

func initialize(in_battle_id: String, in_seed: int) -> void:
	battle_id = in_battle_id
	initial_seed = in_seed
	records.clear()
	step_counter = 0

func record_step(timeline_ms: int, round_number: int, action_type: String, actor_id: String, event_data: Dictionary) -> void:
	step_counter += 1
	var rec := StepRecordDTO.new()
	rec.step_index = step_counter
	rec.timeline_ms = timeline_ms
	rec.round_number = round_number
	rec.action_type = action_type
	rec.actor_id = actor_id
	rec.event_data = event_data
	records.append(rec)

func export_replay_payload() -> Dictionary:
	var serialized: Array[Dictionary] = []
	for r in records:
		serialized.append(r.to_dto())
	return {
		"battle_id": battle_id,
		"initial_seed": initial_seed,
		"total_steps": records.size(),
		"records": serialized
	}
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 3.1: 扩展 `combat.json` 配置架构** - 补充 `initiative_model`、`tertiary_timeline`、`staging_bar`、`round_lifecycle` 节点；
- [x] **Step 3.2: 接入 GameConfig 类型化读取与默认值兜底** - 全部采用 `get_int/float/string/array`，零 `get_value`；
- [x] **Step 3.3: 实现战报轻量级确定性审计器 (`CombatTimelineReplayAudit`)** - 记录每步时间戳、随机事件、出牌及换轮动作；
- [x] **Step 3.4: 静态质量门禁自查** - 确保 `audit_hardcode.py` 与 `audit_config.py` 严格 0 警告通过。

---

## 三、 工程化验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-P45-S3-01` | 新增配置表项热读取生效 | 动态微调 `staging_bar/max_capacity = 7` | 待发栏运行时自动生效最大 7 容量 |
| `TC-P45-S3-02` | 缺省配置安全降级回退 | 访问不存在的 `tertiary_timeline/fake_node` | 优雅返回 fallback 默认值，不触发断言崩溃 |
| `TC-P45-S3-03` | 战报重放全要素精确吻合 | 给定 Seed 12345 运行 20 步战斗 | `export_replay_payload()` 步骤总数与时间轴单调递增 |
| `TC-P45-S3-04` | 静态无硬编码审查通过 | 执行 `audit_hardcode.py` 扫描 | 核心战斗与时间轴代码 0 硬编码违规 |
