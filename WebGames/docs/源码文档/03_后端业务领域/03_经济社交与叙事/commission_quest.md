# 冒险者委托悬赏与担保金履约 (`commission_quest`)

> 对应源码：`backend/domains/commission_quest/`（4 个 `.gd`）。规范冒险者资质阶位准入、接取质押保证金、组织税收抽成与成功交付/违约没收结算全状态机。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [commission_aggregate.gd](../../../../backend/domains/commission_quest/commission_aggregate.gd) | `CommissionAggregate` | 委托任务聚合根 | 定义 7 级 `CommissionTier` 门槛与 `CommissionStatus`；读取 `defaults/{org_tax_rate,reward_gold,reward_mana_crystals,security_deposit_required}` |
| [commission_acceptance_dto.gd](../../../../backend/domains/commission_quest/commission_acceptance_dto.gd) | `CommissionAcceptanceDTO` | 接取与派发上下文 DTO | 封装委托双方与钱包上下文 |
| [commission_settlement_solver.gd](../../../../backend/domains/commission_quest/commission_settlement_solver.gd) | `CommissionSettlementSolver` | 资质判定与分账求解器 | `check_qualification()`、`calculate_payout_split()` 计算手续费抽成并分账至接取人及组织金库 |
| [commission_fsm.gd](../../../../backend/domains/commission_quest/commission_fsm.gd) | `CommissionFSM` | 委托全周期状态机 | `accept_commission()`（质押保证金）、`settle_successful_commission()`（解冻保证金+赏金结算）、`handle_commission_breach()`（违约罚没与信誉扣除） |

---

## 二、关联配置与验证

- **配置映射**：`domains.commission_quest.core`、`narratives.commission_quest`。
- **测试入口**：[test_commission_quest.gd](../../../../tests/unit/domains/test_commission_quest.gd)。
