# 七域代码评审清单

> 直接复制到评审意见中逐项勾选。每项都能指向一条已登记规则，避免「我觉得不好」式评论。

---

## 一、 命名

- [ ] 每个导出符号的名字可跳过实现被理解（`NAM-VAG-001`）
- [ ] 单字母名仅出现在循环计数器与丢弃符号（`NAM-SGL-001`）
- [ ] 无超长堆叠名或共享长前缀（`NAM-DEC-001`）
- [ ] 函数为动词短语，布尔为 `is/has/should`，集合为复数（`NAM-COL-001`）
- [ ] 文件名符合语言约定，无批次或临时标记（`NAM-FIL-001`、`NAM-JRG-002`）

## 二、 失败语义

- [ ] 同一模块只用一种失败表达
- [ ] 零空捕获、零裸 `except`（`ERR-FLT-001`）
- [ ] 生产路径零 `unwrap()` / `panic!`（`RSM-UNWRAP-001`、`RSM-PNC-001`）
- [ ] 错误消息含对象、期望、实际（`ERR-MSG-001`）
- [ ] 因果链保留（`PYM-RAISE-001`）

## 三、 类型

- [ ] 联合类型消费点使用 `switch` + `assertNever`
- [ ] `as` 仅紧邻结构校验
- [ ] 零 `!` 非空断言
- [ ] 零 `@ts-ignore`；`@ts-expect-error` 带原因
- [ ] 外部数据只在校验层出现一次 `unknown`

## 四、 接口

- [ ] 每个导出符号都有跨模块调用方
- [ ] 零 `export *`
- [ ] 公开签名引用的类型全部公开
- [ ] 门面满足实质承载（`ARCH-FAC-001`），零 ≤ 3 行跳板（`ARCH-ABS-001`）

## 五、 依赖

- [ ] 基础设施层零反向 import（`DEP-INV-001`）
- [ ] 零循环导入（`import-cycle`）
- [ ] 开发依赖零进入生产路径（`DEP-DEV-001`）
- [ ] 延迟导入均有审计说明（`DEP-LAZ-001`）

## 六、 可测性

- [ ] 时间与随机经注入（`TST-DEN-001`）
- [ ] 核心逻辑零 I/O
- [ ] 零模块级可变单例
- [ ] 每个错误分支可稳定触发
- [ ] 断言描述具体期望值（`TST-TAU-001`）；零跳过用例（`TST-SKP-001`）

## 七、 语言惯用法

- [ ] TypeScript：零 `any` / `var` / `require`（`TSM-ANY-001`、`TSM-VAR-001`、`TSM-REQUIRE-001`）
- [ ] Python：内建泛型、`|` 联合、`collections.abc`、`with` 管资源（`PYM-*`）
- [ ] Rust：`let-else`、`&str`、`// SAFETY:`、零跨 `.await` 持锁（`RSM-*`）
- [ ] Shell：`set -euo pipefail`、变量加引号（`SH-QUOTE-001`）
- [ ] PowerShell：`Verb-Noun`、零 `iex`、句柄 `try/finally`（`PS-*`）

---

## 八、 提交前命令

```powershell
node scripts/common/validate-skills.js
node scripts/common/validate-rule-id-closure.js
node scripts/common/evaluate-eloc-budget.js
node auto-refactor/scripts/validate-comment-governance.js
pwsh -File scripts/ps1/pre-commit-gate.ps1
```
