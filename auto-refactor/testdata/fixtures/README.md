# 🧪 测试夹具库 (Test Fixtures Catalog)

> **目录路径**：`auto-refactor/testdata/fixtures/`  
> **用途**：专用于验证 AST 解析适配器（TypeScript / OXC）、零物化懒投影（Fastpath）、圈复杂度计算与常量提取规则的边界测试用例集。

---

## 📋 夹具文件与测试目标索引

| 夹具文件 | 测试目标 / 语法特征覆盖 | 覆盖规则 |
| :--- | :--- | :--- |
| `fixture-01-expression-deep-literals.ts` | 深度嵌套表达式内的数字与字符串字面量提取 | `constants:magic-number`, `constants:hardcoded-string` |
| `fixture-02-class-field-arrows.ts` | 类属性箭头函数 (Class Field Arrow Functions) 的方法边界与常量 | `constants`, `large-function` |
| `fixture-03-assertion-wrappers.ts` | 类型断言表达式 (`as const`, `as any`, `satisfies`) 的向下递归渗透 | `constants`, `oxc:type-descent` |
| `fixture-04-decorator-arguments.ts` | 类与方法装饰器参数 (`@deco({ length: 100 })`) 的常量提取 | `constants:duplicate-literal` |
| `fixture-05-static-block.ts` | ES2022 类静态初始化块 (`static { ... }`) 复杂度与嵌套计算 | `complexity:high-complexity` |
| `fixture-06-method-inline.ts` | 内联对象方法与紧凑函数体识别 | `complexity`, `constants` |
| `fixture-07-toplevel-exported.ts` | 顶层导出语句 (`export *`, `export { x } from ...`) 模块标识符 | `constants:hardcoded-string` |
| `fixture-08-deep-nesting.ts` | 深度嵌套控制流 (`if/else`, `try/catch`, `while`) 圈复杂度计算 | `complexity:high-complexity` |
| `fixture-09-empty-prefix-nodes.ts` | 紧邻注释、空语句与前置修饰符边界 | `parsers:ast-boundary` |
| `fixture-10-same-line-literals.ts` | 单行包含多个相同或不同字面量的精确定位 | `constants:duplicate-literal` |
| `fixture-11-i18n-tolerated.ts` | 国际化容忍与排除规则 (I18n tolerated strings) | `constants:tolerated` |
| `fixture-12-zero-issue.ts` | 零违规基准文件（确保不产生任何误报） | `baseline:zero-issue` |
| `fixture-13-pure-type.d.ts` | 纯 TypeScript 类型声明文件 (`.d.ts`) | `parsers:dts-handling` |
| `fixture-14-drift-targeted.ts` | 用于增量分析与行号平移探测的靶向函数集合 | `incremental:drift-target` |

---

## ⚙️ 关联基准配置文件

* **`config-mode-a.json`**：Mode A 配置（启用 `constants` 与 `large-file`，禁用 `complexity`）。
* **`config-mode-b.json`**：Mode B 配置（启用 `complexity` 与 `constants`，禁用 `large-file`）。
