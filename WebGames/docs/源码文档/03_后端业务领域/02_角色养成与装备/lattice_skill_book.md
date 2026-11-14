# 技能点阵 AST 与典籍著书 (`lattice_skill_book`)

> 对应源码：`backend/domains/lattice_skill_book/`（4 个 `.gd`）。建模技能图云有向无环图（DAG/AST）、三维空间测地线剪枝降低施法能损、SHA-256 拓扑指纹校验以及典籍手稿出版流通与作者版税结算。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [skill_subgraph_ast.gd](../../../../backend/domains/lattice_skill_book/skill_subgraph_ast.gd) | `SkillSubgraphAST` | 技能子图实体与典籍模型 | `serialize()`/`deserialize()`；读取 `domains.lattice:ast_defaults/*` 与 `manuscript_defaults/*` |
| [manuscript_item_entity.gd](../../../../backend/domains/lattice_skill_book/manuscript_item_entity.gd) | `ManuscriptItemEntity` | 技能书手稿物品实体 | 承载作者标识、刻印子图 AST 与版税定价契约 |
| [lattice_decompiler_service.gd](../../../../backend/domains/lattice_skill_book/lattice_decompiler_service.gd) | `LatticeDecompilerService` | AST 剪枝优化与拓扑签名 | `optimize_lattice_path()`（降能损）、`is_acyclic_dag()`（环路检测）、`generate_ast_signature()` |
| [grimoire_authoring_pipeline.gd](../../../../backend/domains/lattice_skill_book/grimoire_authoring_pipeline.gd) | `GrimoireAuthoringPipeline` | 著书出版与版税结算管线 | `publish_manuscript_book()`、`settle_book_royalties()`（计算发行份数、基础定价与版税分润） |

---

## 二、关联配置、存档与验证

- **配置与存档**：`domains.lattice.core`（别名 `domains.lattice`）与 `narratives.lattice`；在 `domains.json` 中登记为 `full` 策略可存档域（序列化类 `SkillSubgraphAST`）。
- **测试入口**：[test_lattice_skill_book.gd](../../../../tests/unit/domains/test_lattice_skill_book.gd)。
