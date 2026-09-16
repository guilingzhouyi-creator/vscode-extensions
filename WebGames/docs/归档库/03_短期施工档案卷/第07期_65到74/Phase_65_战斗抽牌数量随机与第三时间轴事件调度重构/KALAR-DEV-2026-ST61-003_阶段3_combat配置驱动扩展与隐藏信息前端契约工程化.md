---
档号: KALAR-DEV-2026-ST61-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST61 (Phase_65_战斗抽牌数量随机与第三时间轴事件调度重构)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_65_战斗抽牌数量随机与第三时间轴事件调度重构 —— 阶段3：combat配置驱动扩展与隐藏信息前端契约工程化
形成日期: 2026-09-05
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 增量配置声明; 规则扩展契约; combat.json
---

# 施工细则：Phase 65 战斗抽牌数量随机与第三时间轴事件调度重构 —— 阶段3：combat配置驱动扩展与隐藏信息前端契约工程化

> 施工开始日期：2026-09-05 晚
> 责任人：卡拉尔世界引擎架构组
> 状态：🚧 实施中（获批实施，进入第2轮代码与测试落地）

> [!NOTE]
> **【施工目标】**：完成配置层、契约层与静态门禁工程化改造，彻底消除数值硬编码并构筑信息安全防线：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST61-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST61-ATT_附件_案卷共享契约与上下文.md)。
> 1. `config/domains/combat.json` 模式扩展：引入首次遇敌发牌区间、后续回合数量离散分布字典、单回合时间轴事件数量范围与最小保护间距；
> 2. 声明式配置值域校验规则扩展（`value_domain_rules.json`）：新增发牌离散概率字典归一化（$\sum P_i = 1.0$）与时间轴间距合法性门禁；
> 3. 前端契约与脱敏视图工程化：规范 `combat_view` 与前端 Presenter 仅消费 `progress_ratio`（当前进度）与 `resolved_events`（公开历史），彻底封堵未来倒计时推算入口；
> 4. EventBus 广播载荷脱敏治理：梳理战斗通道事件，确保广播出的战斗事件不夹带内部 `trigger_time_ms` 字段。
> **对应需求源**：Phase 65 阶段 2 算法落地 → 配置驱动与契约安全工程化。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST61-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST61-001_阶段1_手牌数量双随机与时间轴离散事件数据模型设计.md) ｜ [阶段2](KALAR-DEV-2026-ST61-002_阶段2_分层抽牌求解器与回合时间轴预排期算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST61-004_阶段4_零手牌推进与双随机调度端到端测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  - `config/domains/combat.json`：既有 `round_hand` 与 `tertiary_timeline` 结构；
  - `scripts/config/value_domain_rules.json`：既有 27 项声明式值域规则；
  - `backend/domains/contract_interface/contract_registry_index.gd`：前端视图契约定义；
  - `backend/domains/event_bus/event_bus.gd`：战斗事件广播通道。

* **核心不变量约束断言**：
  - `Inv-TR3-1`（配置零硬编码契约）：所有首轮/后续发牌数量区间、概率分布字典、事件数量下限与间距毫秒数必须 100% 收敛至 `combat.json`，业务 GDScript 禁止内联任何游戏数值常数；
  - `Inv-TR3-2`（离散概率归一性）：手牌数量概率分布表中的所有权重之和必须满足 $| \sum w_i - 1.0 | \le 0.001$，严禁出现概率不守恒配置；
  - `Inv-TR3-3`（前端零推算漏洞）：表现层 API 响应与广播事件体中严格禁止出现 `trigger_time_ms`、`next_event_time`、`upcoming_count` 等未决信息字段，客户端从技术上无法反推下一事件秒数；
  - `Inv-TR3-4`（进度条确定性单调性）：客户端获取的 `progress_ratio` 仅由权威后端当前已流逝时间与回合时限比值计算得出（$\text{clamp}(t_{\text{elapsed}} / t_{\text{max}}, 0.0, 1.0)$），严禁前端自增累加。

---

## 一、 核心配置扩展与值域规则 (`combat.json` & `value_domain_rules.json`)

### 1.1 `config/domains/combat.json` 增量配置声明

```json
{
  "round_hand": {
    "hand_cap": 5,
    "first_encounter_min": 3,
    "first_encounter_max": 4,
    "hand_count_distribution": {
      "1": 0.25,
      "2": 0.50,
      "3": 0.20,
      "4": 0.05
    },
    "mulligan_stamina_cost": 1,
    "mulligan_max_per_round": 1,
    "end_of_round_policy": "DISCARD"
  },
  "tertiary_timeline": {
    "enabled": true,
    "events_per_round_min": 2,
    "events_per_round_max": 4,
    "min_event_spacing_ms": 1500,
    "event_type_weights": {
      "NORMAL_DRAW": 0.50,
      "ADD_DRAW": 0.25,
      "TENSION_PULSE": 0.25
    },
    "tension_types": [
      "PRESSURE_SURGE",
      "ENVIRONMENT_PULSE",
      "FORCE_ROUND_ADVANCE"
    ]
  }
}
```

### 1.2 `value_domain_rules.json` 规则扩展契约

```json
{
  "rule_id": "VD_COMBAT_HAND_DISTRIBUTION_SUM",
  "category": "COMBAT_DOMAIN",
  "table_name": "domains.combat",
  "key_path": "round_hand/hand_count_distribution",
  "primitive": "SUM_APPROX_EQUAL",
  "target_sum": 1.0,
  "tolerance": 0.005,
  "description": "手牌数量离散概率权重合计必须近似为 1.0"
}
```

---

## 二、 前端表现层契约接入与 EventBus 脱敏

1. **Presenter 接入点**：在 `CombatRoundCoordinator` 中提供 `get_client_snapshot() -> CombatTimelineClientDTO.PresenterSnapshotDTO`，仅返回进度比值与已发生事件；
2. **广播字段净化**：当时间轴触发 `NORMAL_DRAW` 或 `ADD_DRAW` 时，EventBus 仅发送：
   ```json
   {
     "event_name": "combat.timeline_event_resolved",
     "kind": "NORMAL_DRAW",
     "public_message": "战场节拍触发：补充了行动手牌"
   }
   ```
   杜绝将后端内部的排期计划对象外泄。
