# 通知中心、跑马灯与有向红点树 (`notification_red_dot`)

> 对应源码：`backend/domains/notification_red_dot/`（3 个 `.gd`）。提供 Toast/弹窗/跑马灯/系统托盘四级通知分发管线与防环冒泡的有向无环红点计数树状态机。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与机制说明 |
| :--- | :--- | :--- | :--- |
| [red_dot_tree_node.gd](../../../../backend/domains/notification_red_dot/red_dot_tree_node.gd) | `RedDotTreeNode` | 红点 DAG 节点模型 | 定义 `NoticeType`（4 级通知种类）及节点直接计数与聚合计数 |
| [red_dot_tree_fsm.gd](../../../../backend/domains/notification_red_dot/red_dot_tree_fsm.gd) | `RedDotTreeFsm` | 红点向上冒泡状态机 | `set_node_direct_count()`、`recalculate_node_upwards()` 原地更新注册表计数并带环检测守卫 |
| [notification_pipeline.gd](../../../../backend/domains/notification_red_dot/notification_pipeline.gd) | `NotificationPipeline` | 通知推流管线 | `push_notification()` 向表现层广播强类型通知载荷 |

---

## 二、关联配置与验证

- **配置映射**：`domains.notification_red_dot.core`、`narratives.notification_red_dot`。
- **测试入口**：[test_notification_red_dot.gd](../../../../tests/unit/domains/test_notification_red_dot.gd)。
