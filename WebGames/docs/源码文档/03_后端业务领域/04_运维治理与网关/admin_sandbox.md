# 管理员 RBAC、沙盒指令与联机追缴 (`admin_sandbox`)

> 对应源码：`backend/domains/admin_sandbox/`（6 个 `.gd`）。作为基础设施豁免域（`config_exempt: true`）复用 `infrastructure.admin`，管理四级管理员 RBAC 权限封印、沙盒调试作弊指令、操作防篡改审计流水及限定于联机模式的非法资产追缴服务。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与安全边界 |
| :--- | :--- | :--- | :--- |
| [admin_permission_entity.gd](../../../../backend/domains/admin_sandbox/admin_permission_entity.gd) | `AdminPermissionAggregate` | 4 级 RBAC 权限聚合体 | 声明 `AdminLevel`；提供 `has_permission()`、`seal_passkey()`、`elevate_permission()`（盐与口令源自 `infrastructure.admin`） |
| [gm_command_catalog.gd](../../../../backend/domains/admin_sandbox/gm_command_catalog.gd) | `GmCommandCatalog` | GM 斜杠命令桥接目录 | `register_default_commands()`、`unregister_default_commands()`（在 `GameBootstrap` 装配） |
| [sandbox_cheat_solver.gd](../../../../backend/domains/admin_sandbox/sandbox_cheat_solver.gd) | `SandboxCheatSolver` | 沙盒测试求解器 | `execute_cheat_command()` 执行测试道具/货币发放、属性调整与时钟推进 |
| [gm_audit_service.gd](../../../../backend/domains/admin_sandbox/gm_audit_service.gd) | `GMArbitrationAuditService` | 管理指令审计服务 | `record_audit()`、`get_recent_audits()` 发布审计事件并保留最近操作流水 |
| [clawback_service.gd](../../../../backend/domains/admin_sandbox/clawback_service.gd) | `ClawbackService` | 非法资产追缴服务 | `clawback_currency()`、`clawback_item_prototype()`、`clawback_item_instance()`；**硬红线：仅 `RUN_MODE_ONLINE` 可用，单机模式拒绝** |
| [clawback_transaction_dto.gd](../../../../backend/domains/admin_sandbox/clawback_transaction_dto.gd) | `ClawbackTransactionDTO` | 追缴事务上下文 DTO | 封装追缴对象与交易凭据 |

---

## 二、关联配置与验证

- **依赖与配置**：依赖 `currency_economy`；配置 `infrastructure.admin`、`narratives.admin`。
- **测试入口**：[test_admin_sandbox.gd](../../../../tests/unit/domains/test_admin_sandbox.gd)。
