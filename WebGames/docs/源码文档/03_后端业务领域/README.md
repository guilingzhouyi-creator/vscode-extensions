# 03 后端业务领域 (`backend/domains/`)

> 本分卷收录 `WebGames/backend/domains/` 下在 [domains.json](../../../config/infrastructure/domains.json) 显式登记的 **47 个业务领域**（合计 327 个 `.gd` 脚本），按功能相关性划分为四大集群目录，并严格按源码目录名 `1:1` 编写 `<domain_id>.md` 技术参考。
> 另注：`backend/domains/` 下 `contract_registry`、`lifecycle`、`version_governance` 三个跨域基础设施豁免目录独立归档于 [02_后端跨域底座](../02_后端跨域底座/README.md)。

---

## 一、四大业务领域集群

| 集群目录 | 包含领域数 | 覆盖主题 | 入口索引 |
| :--- | :---: | :--- | :--- |
| `01_核心物理与世界/` | 10 | 战斗三轴物理、大地图导航、世界状态与协议中枢、首领/怪物/精英、空间位移与拾取处置、确定性沙盒 | [01_核心物理与世界/README.md](01_核心物理与世界/README.md) |
| `02_角色养成与装备/` | 12 | 账户槽位、权威创角与序章、生理寿命、潜能洗点、背包词缀、战备工坊、技能典籍、魔法规则、命名空间与伪装 | [02_角色养成与装备/README.md](02_角色养成与装备/README.md) |
| `03_经济社交与叙事/` | 13 | 货币水池、商队弹性集市、空间行商、抽卡、任务声望、委托悬赏、NPC/主权/公会、邮件、剧情 DAG、指令/CDKey | [03_经济社交与叙事/README.md](03_经济社交与叙事/README.md) |
| `04_运维治理与网关/` | 12 | 双域存储协议、世界网关与防桥接隔离、GM 追缴、全局设置、灰度熔断、i18n、音频/红点/公告、遥测抽取、输入 | [04_运维治理与网关/README.md](04_运维治理与网关/README.md) |

---

## 二、全域依赖关系核查规则

1. **配置主表映射**：除明确标注 `config_exempt: true` 的领域（`persistence_protocol`、`admin_sandbox`）及 `shared_tables` 跨域共享表外，各域仅直接消费自有 `domains.*` 表；跨领域借用配置必须声明在 `domains.json` 的 `depends_on` 字段中。
2. **测试 1:1 双向对齐**：47 个领域全部在 `tests/unit/domains/test_<id>.gd` 与 `tests/test_registry.gd` 登记注册，由 `TC-ARCH-01 ~ 06` 执行自动化验证。
