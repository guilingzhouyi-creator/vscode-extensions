# 04. 跨语言泛化审查与项目中立性规范

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：`src/core/profiler/projectProfiler.ts`、`src/core/intelligence/file-role-inference.ts`、`scripts/validate-project-neutrality.js`

---

## 1. 项目中立性不变量 (Project-Agnostic Invariant)

作为服务于不同技术栈（Node CLI、VS Code 扩展、Godot 4 游戏引擎、Python AI 服务、Rust 系统内核）的通用静态审查引擎，`auto-refactor` 核心代码严格遵守**项目中立性铁律**：

1. **零业务仓库硬编码**：`src/` 下任何核心模块与通用分析器严禁硬编码特定消费方项目的私有路径或业务名词。
2. **自动化中立性守卫 (`npm run validate-project-neutrality`)**：`scripts/validate-project-neutrality.js` 静态扫描 `src/**`，一旦发现未经配置注入的特定项目耦合字符串，立即阻断构建。
3. **通过工程原型 (`ProjectArchetype`) 与配置驱动专精化**：针对游戏引擎（`gdscript-game`）或编辑器扩展（`vscode-extension`）的专用规则，统一通过 `detectProjectArchetype` 自动探测项目特征文件（如 `project.godot`、含 `engines.vscode` 的 `package.json`）后按需挂载。

---

## 2. 文件语义角色自动推导 (`src/core/intelligence/file-role-inference.ts`)

同一套阈值若无差别施加于所有文件，必然导致在「协议字典表」上误报魔法数、或在「核心状态机」上误报复杂度。`file-role-inference.ts` 根据路径模式、导出结构与 AST 节点分布，将每个文件精确归类为以下语义角色：

| 语义角色 (`FileSemanticRole`) | 识别特征 | 差异化审查与弹性预算策略 |
| :--- | :--- | :--- |
| **`algorithmic-kernel`** | 高算术/位运算密度、支配树/差分/图遍历核心 | 允许更高的单函数圈复杂度预算（配合文档化说明），严查热循环内存分配 |
| **`declarative-table` / `constants-catalog`** | 纯对象/数组导出占比 $> 80\%$，零控制流分支 | 自动豁免表项级重复结构告警，重点检查常量命名规范 (`NAM-CST-001`) |
| **`entrypoint-cli` / `script-harness`** | 含 shebang、参数解析或位于 `scripts/`、`src/cli/` | 允许顶层同步文件 I/O 与控制台输出，豁免库代码级阻塞 I/O 禁令 |
| **`test-suite` / `fixture`** | 位于 `test/`、`tests/` 或匹配 `*.test.*`、`validate-*` | 激活 `test-modernity` 分析器（拦截恒真断言 `TST-TAU-001`），豁免夹具字面量提取 |
| **`domain-service` / `ui-view`** | 标准业务与视图模块 | 执行最严格的分层依赖 (`ARC-LAY-001`)、魔法数提取与异常上下文链检查 |

---

## 3. 关联文档导航

- [01. 统一语法树 `NormalizedNode` 与八语言语义 IR (`SemanticGraph`)](../02-parsers-and-ast/01-multilang-abstraction.md)
- [05. 外部工程接入与基线棘轮指南](./05-consumer-integration.md)
