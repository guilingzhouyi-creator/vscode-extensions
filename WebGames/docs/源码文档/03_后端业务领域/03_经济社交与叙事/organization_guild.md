# 公会组织、权限治理与驻地科技 (`organization_guild`)

> 对应源码：`backend/domains/organization_guild/`（3 个 `.gd`）。提供原生公会与自建组织实体模型、分层 RBAC 权限校验、公共金库审计与外交宣战切换，以及全员驻地科技光环加成计算。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置键 |
| :--- | :--- | :--- | :--- |
| [organization_aggregate.gd](../../../../backend/domains/organization_guild/organization_aggregate.gd) | `OrganizationAggregate` | 公会/组织聚合根 | 定义 `OrganizationType`、`DiplomaticStance`、`GuildRole`；提供 `add_member()`、`get_member_role()` |
| [organization_governance_solver.gd](../../../../backend/domains/organization_guild/organization_governance_solver.gd) | `OrganizationGovernanceSolver` | RBAC 与外交治理求解器 | `can_perform_action()`（匹配 `rbac/actions/*`）、`withdraw_from_treasury()`、`set_diplomatic_stance()` |
| [organization_tech_fsm.gd](../../../../backend/domains/organization_guild/organization_tech_fsm.gd) | `OrganizationTechFSM` | 驻地科技升级状态机 | `upgrade_facility()`、`calculate_guild_buff_modifiers()` 结算经验/耐久减损/药水恢复光环（`tech/*`） |

---

## 二、关联配置与验证

- **依赖域**：`world_navigation`；配置 `domains.organization_guild.core` 与 `narratives.organization_guild`。
- **测试入口**：[test_organization_guild.gd](../../../../tests/unit/domains/test_organization_guild.gd)。
