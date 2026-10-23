# WebGames 四阶段施工案卷标准蓝图模板 (`001` ~ `004`)

> 在 `WebGames/docs/路线图/01_短期施工区/<案卷目录>/` 下必须且仅能创建以下 4 份独立 Markdown 文件（严禁自造 `README.md` 或施工批次代号）。

---

## 文件 1：`001_数据契约与实体定义.md`

```markdown
# 阶段 1：数据契约与实体定义规范

## 一、 领域数据契约与强类型 DTO 规范
| 实体名 | 字段名 | 类型 | 约束 / 范围 | 业务含义 |
| :--- | :--- | :--- | :--- | :--- |
| `ItemEntity` | `id` | `String` | 非空，snake_case | 实体唯一标识 |
| `ItemEntity` | `amount` | `int` | $\ge 0$ | 堆叠数量 |

## 二、 快照与持久化 Schema 定义
（声明 JSON Schema 必填字段、类型边界与快照水化默认值）
```

---

## 文件 2：`002_业务逻辑实现与状态机流转.md`

```markdown
# 阶段 2：业务逻辑实现与状态机流转规范

## 一、 无头领域求解器设计
（继承 `RefCounted`，零 UI 节点依赖，循环内遵循 `ADV-PRF-002` 对象池 `reset_state()` 与原位容器复用）

## 二、 状态机转换图谱
（使用 `stateDiagram-v2` 明确定义状态节点、触发动作、退化回退与幂等归位路径）
```

---

## 文件 3：`003_全域配置驱动与泛化路由接入.md`

```markdown
# 阶段 3：全域配置驱动与泛化路由接入规范

## 一、 领域配置表路径与 Schema
归位路径：`config/domains/{domain_name}/core.json`（严禁根目录平铺）

## 二、 `GameConfig` 读取与表现层 `apply_snapshot` 接入
- 后端读取：`GameConfig.get_value("{domain_name}.parameters.default_rate", 1.0)`
- 前端注入：经强类型视图控制器调用 `apply_snapshot(snapshot: Dictionary) -> void` 单向渲染
```

---

## 文件 4：`004_全量回归验收与防复发门禁测试矩阵.md`

```markdown
# 阶段 4：全量回归验收与防复发门禁测试矩阵规范

## 一、 单元测试矩阵 (`tests/unit/domains/{domain_name}_test.gd`)
| 用例 ID | 测试目标 | 输入前置条件 | 预期断言 |
| :--- | :--- | :--- | :--- |
| `TC-DOM-001` | 基础状态流转 | 合法初始状态与动作 | 状态迁移成功且字段精确匹配 |
| `TC-DOM-002` | 负空间与边界容错 | 空载荷或越界参数 | 拒绝执行并返回确定性错误码 |
| `TC-DOM-003` | 配置热重载与排空 | 动态覆盖参数并调用 `flush()` | 新参数即时生效且零后台孤儿线程 |

## 二、 本地门禁验收指令
1. `python WebGames/scripts/py/audit_arch_static.py`
2. `pwsh -File WebGames/scripts/ps1/test-run.ps1`
3. `pwsh -File WebGames/scripts/ps1/audit-all.ps1`
```
