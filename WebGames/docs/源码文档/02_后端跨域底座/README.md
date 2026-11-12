# 02 后端跨域底座 (`backend/domains/` 豁免基础设施域)

> 本分卷记录位于 `WebGames/backend/domains/` 下、在 [domains.json](../../../config/infrastructure/domains.json) `_meta.infra_dirs_exempt` 中显式声明为**跨域基础设施**的 **3 个**特殊目录（共 25 个 `.gd` 脚本）。它们横跨全部业务域执行契约治理、生命周期调度与版本门禁，复用 `infrastructure.*` 配置表而不单独绑定 `domains.*` 业务表。

---

## 目录清单

| 文档 | 对应源码目录 | 脚本数 | 架构角色 |
| :--- | :--- | :---: | :--- |
| [contract_registry.md](contract_registry.md) | `backend/domains/contract_registry/` | 7 | 前后端 47 域 × 17 视图契约注册索引、解析器、有界缓存与完备性审计守卫 |
| [lifecycle.md](lifecycle.md) | `backend/domains/lifecycle/` | 9 | 引擎启动/停机多阶段管线、十阶段会话钩子调度器与未接线空槽拦截 |
| [version_governance.md](version_governance.md) | `backend/domains/version_governance/` | 9 | 确定性灰度分群、流式 SHA-256 校验、VFS 热补丁挂载与激活门禁 |
