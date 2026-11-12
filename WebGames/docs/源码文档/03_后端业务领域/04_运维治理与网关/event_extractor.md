# 配置驱动事务事件组合抽取器 (`event_extractor`)

> 对应源码：`backend/domains/event_extractor/`（2 个 `.gd`）。面向跨领域组合审计场景，将同一 `(account_id, transaction_id)` 事务下离散原始事件按配置规则折叠为复合事件，并支持物化记账与多维投影。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与流水线阶段 |
| :--- | :--- | :--- | :--- |
| [composite_event_dto.gd](../../../../backend/domains/event_extractor/composite_event_dto.gd) | `CompositeEventDTO` | 组合事务事件契约 DTO | `add_item_flow()`、`add_currency_delta()`、`validate_dto()`、`validate_grouping_rule()`、`is_valid_event_type()` |
| [composite_event_extractor.gd](../../../../backend/domains/event_extractor/composite_event_extractor.gd) | `CompositeEventExtractor` | 四步折叠抽取与投影管线 | `extract()` 串联 `group_primitive_events()`（分组） -> `compose_group()`（组合折叠） -> `materialize()`（物化） -> `project()`（投影） |

---

## 二、关联配置与验证

- **依赖域**：`item_statistics`、`telemetry_account_lifecycle`；配置 `domains.event_extractor.core`（`enabled` / `grouping_rules` / `projections`）与 `narratives.admin`。
- **测试入口**：[test_event_extractor.gd](../../../../tests/unit/domains/test_event_extractor.gd)。
