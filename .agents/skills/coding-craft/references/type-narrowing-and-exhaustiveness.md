# 类型收窄与穷尽检查

> 类型系统的价值不在声明处，在消费处。本指南规定联合类型如何被安全消费，以及断言允许存在的唯一位置。

---

## 一、 收窄阶梯

从最安全到最危险，只有前三级允许出现在生产代码：

| 级别 | 手段 | 判据 |
| :---: | :--- | :--- |
| 1 | 判别联合 + `switch` + `assertNever` | 新增变体自动编译报错 |
| 2 | 类型守卫函数 `is Xxx(v): v is Xxx` | 守卫内部有真实运行时校验 |
| 3 | 边界校验后收窄（`schema.parse`） | 校验与断言紧邻，无中间语句 |
| 4 | `as` 类型断言 | **仅限测试夹具** |
| 5 | `!` 非空断言 | **禁止**（等价于拒绝证明） |

---

## 二、 判别联合标准写法

```ts
interface Idle { readonly kind: 'idle' }
interface Running { readonly kind: 'running'; readonly pid: number }
type State = Idle | Running;

/**
 * 编译期穷尽断言：新增 State 成员时此处报错。
 *
 * @param value - 未被任何分支消费的残余值。
 * @returns 永不返回。
 */
function assertNever(value: never): never {
  throw new Error(`未处理的 State 变体：${JSON.stringify(value)}`);
}

function describe(state: State): string {
  switch (state.kind) {
    case 'idle': return 'idle';
    case 'running': return `running:${state.pid}`;
    default: return assertNever(state);
  }
}
```

关键点：`default` 分支不是兜底，而是**编译期守卫**。删掉 `case 'running'` 会让 `state` 在 `default` 处的类型不是 `never`，从而编译失败。

---

## 三、 边界校验的唯一形态

外部数据（`JSON.parse`、`process.env`、HTTP body、配置文件）进入系统时必须经过**一次**结构校验，之后全程使用收窄后的类型：

```ts
const raw: unknown = JSON.parse(text);
const parsed = ServerConfigSchema.parse(raw); // 失败即抛出带路径的校验错误
// 此后的 parsed 是 ServerConfig，不再需要断言
```

禁止：

```ts
const cfg = JSON.parse(text) as ServerConfig;        // 断言跳过校验
const port = process.env.PORT!;                      // 非空断言跳过缺失处理
const value = map[key] as string;                    // 索引访问断言
```

---

## 四、 常见收窄反模式

| 反模式 | 问题 | 正确做法 |
| :--- | :--- | :--- |
| `if (x.kind === 'a') {...} else {...}` | `else` 分支承担了未知变体 | 穷尽 `switch` + `assertNever` |
| `default: return null` | 新增变体静默返回空值 | `default: return assertNever(x)` |
| `obj!.prop` | 空值缺陷延后到运行时 | 提前守卫 `if (!obj) return ...` |
| `x as unknown as T` | 双重断言，彻底关闭类型系统 | 重写数据结构或增加校验 |
| `// @ts-ignore` | 让错误消失而非解决 | 修复类型或 `@ts-expect-error` 并写明原因 |

---

## 五、 跨语言对照

| 语言 | 收窄手段 | 穷尽检查 |
| :--- | :--- | :--- |
| TypeScript | 判别联合、类型守卫 | `never` 断言 |
| Python | `match` 语句 + 字面量模式 | `case _: assert_never(x)`（`typing.assert_never`） |
| Rust | `match` + 枚举 | 编译器强制穷尽 |
| GDScript | `match` 语句 | 无编译期检查，需 `assert(false)` 兜底 |

---

## 六、 自检清单

- [ ] 所有联合类型消费点是否使用 `switch` + `assertNever`？
- [ ] 是否所有 `as` 都紧邻结构校验？
- [ ] 是否存在 `!` 非空断言？（应为 0）
- [ ] 是否存在 `@ts-ignore`？（应为 0；`@ts-expect-error` 需带原因）
- [ ] 外部数据是否只在校验层出现一次 `unknown`？
