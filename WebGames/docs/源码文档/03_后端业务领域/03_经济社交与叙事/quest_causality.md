# 任务因果网、阵营声望与悬赏通缉 (`quest_causality`)

> 对应源码：`backend/domains/quest_causality/`（6 个 `.gd`，含 `dto/`）。用状态事实求解取代硬编码脚本分支，支持强攻/隐匿/外交/黑市多解法任务评估、声望赏金跃迁与注册表一致的物品奖励发放。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与契约 |
| :--- | :--- | :--- | :--- |
| [quest_causality_aggregate.gd](../../../../backend/domains/quest_causality/quest_causality_aggregate.gd) | `QuestCausalityAggregate` | 任务因果聚合根实体 | 管理多分支目标节点与阵营声望奖励，支持 `serialize()`/`deserialize()` |
| [quest_entities.gd](../../../../backend/domains/quest_causality/quest_entities.gd) | `QuestObjectiveNode` | 因果 DAG 目标节点 | 默认配置读取自 `domains.quest:node_defaults/*` 与 `quest_defaults/*` |
| [causality_dag_solver.gd](../../../../backend/domains/quest_causality/causality_dag_solver.gd) | `CausalityDAGSolver` | 因果分支评估器 | `evaluate_quest_completion()` 根据事实状态图评估多路线完成条件 |
| [faction_bounty_and_causality_fsm.gd](../../../../backend/domains/quest_causality/faction_bounty_and_causality_fsm.gd) | `FactionBountyAndCausalityFSM` | 阵营声望与悬赏状态机 | `apply_quest_settlement()` 结算声望偏移并在越过 `bounty/trigger_threshold` 时触发通缉令 |
| [quest_reward_dispatch.gd](../../../../backend/domains/quest_causality/quest_reward_dispatch.gd) | `QuestRewardDispatch` | 权威奖励物品发放器 | `dispatch_item_rewards()` 通过 `ItemInstanceFactory` 签发 `QST_` 前缀权威 UID（背包满则原子拦截） |
| [quest_reward_context_dto.gd](../../../../backend/domains/quest_causality/dto/quest_reward_context_dto.gd) | `QuestRewardContextDto` | 任务奖励上下文 DTO | 支持池化 `reset_state()` 与双向序列化 |

---

## 二、关联配置、存档与验证

- **依赖域**：`inventory`；配置 `domains.quest.core`、`narratives.quest`；登记为支持热重载的 `full` 策略可存档域（序列化类 `QuestCausalityAggregate`）。
- **测试入口**：[test_quest_causality.gd](../../../../tests/unit/domains/test_quest_causality.gd)。
