# 主权国家、爵位封赏与政变演化 (`sovereignty_realm`)

> 对应源码：`backend/domains/sovereignty_realm/`（5 个 `.gd`）。管理主权国家与封地实体的动态创建、战功声望联动爵位晋升、宫廷政变推翻以及政权剧变触发的世界经济与生态连锁反应。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置键 |
| :--- | :--- | :--- | :--- |
| [knighthood_title.gd](../../../../backend/domains/sovereignty_realm/knighthood_title.gd) | `KnighthoodTitle` | 爵位枚举与骑士称号定义 | 声明 `TitleRank` 枚举 |
| [fief_demesne_entity.gd](../../../../backend/domains/sovereignty_realm/fief_demesne_entity.gd) | `FiefDemesneEntity` | 领地封邑实体模型 | 记录所属城镇、领主与地方税率设置（读取 `fief_defaults/*`） |
| [nation_realm_aggregate.gd](../../../../backend/domains/sovereignty_realm/nation_realm_aggregate.gd) | `NationRealmAggregate` | 国家疆域聚合根实体 | 管理国库金币、稳定度、税率与封地集合，提供 `serialize()`（读取 `nation_defaults/*`） |
| [sovereignty_and_feoffment_solver.gd](../../../../backend/domains/sovereignty_realm/sovereignty_and_feoffment_solver.gd) | `SovereigntyAndFeoffmentSolver` | 爵位晋升与封赏评估器 | `evaluate_knighthood_promotion()`、`get_title_name()` 比对战功与声望配置阈值（`promotion_thresholds/*`） |
| [nation_sovereignty_and_coup_fsm.gd](../../../../backend/domains/sovereignty_realm/nation_sovereignty_and_coup_fsm.gd) | `NationSovereigntyAndCoupFSM` | 建国与宫廷政变状态机 | `establish_new_sovereign_nation()`、`execute_palace_coup()` 结算政变成功/失败稳定性跌落与权力更迭 |

---

## 二、关联配置与验证

- **配置映射**：`domains.sovereignty.core` 与 `narratives.sovereignty`。
- **测试入口**：[test_sovereignty_realm.gd](../../../../tests/unit/domains/test_sovereignty_realm.gd)。
