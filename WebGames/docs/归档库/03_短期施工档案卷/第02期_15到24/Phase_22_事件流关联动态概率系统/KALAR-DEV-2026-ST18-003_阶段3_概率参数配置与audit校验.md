---
档号: KALAR-DEV-2026-ST18-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST18 (Phase_22_事件流关联动态概率系统)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_22_事件流关联动态概率系统 —— 阶段3：概率参数配置与audit校验
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 概率参数配置; audit校验; event_probability.json
---

# 施工细则：事件流关联动态概率系统（事件侧三位一体）—— 阶段3：概率参数配置与audit校验

> [!NOTE]
> **【施工目标】**：确立事件概率配置结构（`config/domains/event_probability.json`：基础概率/条件修正/动态调整/事件关联）；audit 新增概率校验（概率值域 0~1 / 配置禁含执行逻辑 / 事件引用已定义 / 条件组合语法 / 关联无环）；登记必需表。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST18-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST18-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：立项需求 ③（配置驱动）④（audit 校验）⑤（概率不得取代事件执行）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST18-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST18-001_阶段1_概率层数据契约与职责边界.md) ｜ [阶段2](KALAR-DEV-2026-ST18-002_阶段2_概率解析器与关联计算实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST18-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 概率参数配置结构

```json
{
  "events": {
    "EVT_BEAST_TIDE": {
      "base_probability": 0.15,
      "conditions": [
        { "id": "town_border", "when": { "type": "TOWN_EQUALS", "val": "TOWN_VALAN" }, "factor": 1.5 },
        { "id": "high_level", "when": { "type": "MIN_LEVEL", "val": 20 }, "factor": 1.2 }
      ],
      "adjustments": [
        { "id": "drought_buff", "when": { "type": "WORLD_FLAG", "val": "DROUGHT" }, "delta": 0.05 }
      ],
      "links": [
        { "linked_event_id": "EVT_MARKET_CRASH", "factor": 1.3 }
      ]
    }
  }
}
```

| 项 | 约定 |
| :--- | :--- |
| 表名 | `domains.event_probability`（`_required_tables` 登记，缺失即告警） |
| 基础概率 | `base_probability`：0~1 浮点（类型校验，越界阻断） |
| 条件修正 | `conditions[].when`（复用事件 AST 求值，上下文只读）+ `factor` 修正系数 |
| 动态调整 | `adjustments[].when` + `delta` 加减量 |
| 事件关联 | `links[].linked_event_id` + `factor`（关联事件触发后联动） |

**契约红线（配置不得成为后门）**：

1. **禁含执行逻辑**：概率配置只允许概率参数/条件/关联——禁出现动作派发、事件生命周期指令、触发判定写回、物品属性定义（与 Phase 21 红线同构）；
2. **值域类型约束**：`base_probability`/`factor`/`delta` 必须数值且概率输出 0~1（代码层钳制 + audit 静态校验）；
3. **事件引用已定义**：`events.<id>` 与 `links.linked_event_id` 必须对应既有事件定义（narrative_orchestration 事件注册/事件域清单），未定义引用 → 阻断；
4. **关联无环**：事件关联图禁止循环（A 联动 B、B 联动 A → 阻断），保证确定性。

---

## 二、 audit 事件概率校验（新增脚本或并入既有链）

| 校验项 | 规则 | 违规级别 |
| :--- | :--- | :--- |
| 概率值域 | `base_probability`/`factor`/`delta` 非数值或越界（概率输出 0~1）→ 违规 | 阻断 |
| 禁执行逻辑 | 配置含动作派发/生命周期/触发写回字段 → 违规 | 阻断 |
| 事件引用 | `events.<id>`/`linked_event_id` ∉ 事件定义清单 → 违规 | 阻断 |
| 条件语法 | `when` 非 AST 合法节点（未知 kind）→ 违规 | 阻断 |
| 关联无环 | 事件关联图存在循环 → 违规 | 阻断 |

- 事实源：`config/domains/event_probability.json` + 事件定义清单（narrative_orchestration/事件域）+ AST kind 白名单；
- 接线：挂入 `audit_runner.py`（`task_id="event_probability"`）；规则声明同步 `audit_docs.py --rules` 或独立规则注释。

---

## 三、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-EVTPROB-S3-01` | 概率值域 | 越界配置样本 | audit 阻断（0~1 类型/值域） |
| `TC-EVTPROB-S3-02` | 禁执行逻辑 | 含派发/生命周期字段样本 | audit 阻断（配置非执行后门） |
| `TC-EVTPROB-S3-03` | 事件引用已定义 | 未定义事件 ID | audit 阻断（引用校验） |
| `TC-EVTPROB-S3-04` | 条件语法 | 未知 AST kind | audit 阻断 |
| `TC-EVTPROB-S3-05` | 关联无环 | 循环关联图 | audit 阻断（确定性保证） |
| `TC-EVTPROB-S3-06` | 必需表登记 | `domains.event_probability` | `_required_tables` 登记，缺失告警 |
