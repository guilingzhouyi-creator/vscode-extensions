# 00 架构总览

> 本分卷阐述 WebGames（卡拉尔世界引擎）横跨前后端、配置层与运行时的全局架构规律与不可破坏的工程不变量。

---

## 文档目录

| 文档 | 核心议题 | 关键真源源码 |
| :--- | :--- | :--- |
| [01_分层拓扑与依赖规则.md](01_分层拓扑与依赖规则.md) | 基础设施、跨域底座、47 业务域与前端四层拓扑及单向依赖规则 | [game_bootstrap.gd](../../../backend/infrastructure/game_bootstrap.gd)、[domains.json](../../../config/infrastructure/domains.json) |
| [02_配置驱动与数据流契约.md](02_配置驱动与数据流契约.md) | `GameConfig` 分层加载、多子表智能路由与零硬编码边界 | [game_config.gd](../../../backend/infrastructure/game_config.gd)、[config_router_engine.gd](../../../backend/infrastructure/config_router_engine.gd) |
| [03_确定性与并发安全基线.md](03_确定性与并发安全基线.md) | LCG 伪随机确定性、热路径零堆分配、原子落盘与加密日志 | [deterministic_rng.gd](../../../backend/infrastructure/deterministic_rng.gd)、[atomic_file_writer.gd](../../../backend/infrastructure/atomic_file_writer.gd) |
| [04_前端表现层解耦协议.md](04_前端表现层解耦协议.md) | 待命模式视图、领域边界接口容器与统一请求/响应信封 | [service_container.gd](../../../frontend/domain_boundary/service_container.gd)、[service_locator.gd](../../../frontend/domain_boundary/service_locator.gd) |
