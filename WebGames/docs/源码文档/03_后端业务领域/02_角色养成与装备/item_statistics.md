# 账号物品递归统计树 (`item_statistics`)

> 对应源码：`backend/domains/item_statistics/`（4 个 `.gd`，含 `dto/`）。在每个账号 UID 下维护一棵按大类/小类/原型分层的物品统计树，接收全生命周期事件做增量累计，并支持子树与全服聚合检索。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与复杂度说明 |
| :--- | :--- | :--- | :--- |
| [account_item_library.gd](../../../../backend/domains/item_statistics/account_item_library.gd) | `AccountItemLibraryAggregate` | 账号物品统计树聚合根 | `mount_item()`、`apply_item_delta()`、`find_item_node()`、`query_subtree()`、`query_all_items()`、`serialize()` |
| [item_statistics_solver.gd](../../../../backend/domains/item_statistics/item_statistics_solver.gd) | `ItemStatisticsSolver` | 全生命周期记账与查询 | `record_item_event()`、`query_account_item_stats()`、`query_account_subtree()`、`query_account_all()`、`query_global_item_stats()` |
| [item_stat_delta_dto.gd](../../../../backend/domains/item_statistics/item_stat_delta_dto.gd) | `ItemStatDeltaDTO` | 物品变更增量 DTO | 支撑自底向上 $O(1)$ 路径统计增量传播 |
| [item_stat_aggregation_dto.gd](../../../../backend/domains/item_statistics/dto/item_stat_aggregation_dto.gd) | `ItemStatAggregationDto` | 聚合查询快照 DTO | 支持池化复位 `reset_state()` 与序列化 |

---

## 二、关联配置与验证

- **配置映射**：`domains.item_statistics.core`（控制启停 `enabled`、`global_query_min_level` 与遥测旁路记录开关）与 `narratives.admin`。
- **测试入口**：[test_item_statistics.gd](../../../../tests/unit/domains/test_item_statistics.gd)。
