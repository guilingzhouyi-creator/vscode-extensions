# 命名与契约

> 命名是唯一零成本、零运行时开销的文档。本指南给出可机械判定的命名判据，以及把坏名字改写成好名字的操作步骤。

---

## 一、 四条可判定判据

| 判据 | 通过条件 | 对应规则 |
| :--- | :--- | :--- |
| **可判性** | 只读名字即可推断输入、输出与副作用 | `NAM-VAG-001` |
| **粒度一致** | 同层级名字的抽象度对齐 | `NAM-DEC-001` |
| **长度有界** | 单字母仅限循环计数器与丢弃符号；长度落在 3~30 字符 | `NAM-SGL-001`、`NAM-LEN-001`、`NAM-LEN-002` |
| **词性正确** | 函数=动词短语，布尔=`is/has/should`，集合=复数或 `...List` | `NAM-COL-001` |

---

## 二、 词性对照表

| 语义 | 推荐形态 | 反例 |
| :--- | :--- | :--- |
| 纯计算 | `computeXxx`、`deriveXxx` | `xxxHandler` |
| 副作用写入 | `applyXxx`、`persistXxx`、`resetXxx` | `xxxData` |
| 判定 | `isXxx`、`hasXxx`、`canXxx` | `xxxCheck` |
| 转换 | `toXxx`（无副作用）、`parseXxx`（可失败） | `xxxConvert` |
| 集合 | `sessions`、`ruleList` | `sessionArr`、`list1` |
| 映射 | `countByFamily`、`nameToId` | `map`、`dict2` |

---

## 三、 改写操作步骤

1. **写下调用现场**：先用最终会出现的调用语句写出目标行，例如 `collectExpiredSessions(now, ttl)`；
2. **回读判据**：该行是否无需注释即可理解？若需要注释，名字本身不成立；
3. **全局重命名**：用编辑器符号重命名，而非文本替换——文本替换会误伤字符串与注释；
4. **同步非代码引用**：文档、测试描述、日志字段、配置键一并更新；
5. **复跑门禁**：`node scripts/common/validate-skills.js` 与项目测试，确认零断裂。

> [!WARNING]
> 只改声明处、不改调用处的「半重命名」会让代码进入比原名更糟的状态：读者会看到两个名字指向同一概念，且无法判断哪个是权威。

---

## 四、 缩写与领域词

- 通用缩写仅允许已被广泛接受的集合：`id`、`url`、`http`、`api`、`ttl`、`pid`、`cfg`（限配置对象局部变量）；
- 自造缩写（`usrMgr`、`cfgHdlr`）一律按 `NAM-ABR-001` 改写为完整词；
- 领域专有词（如 `taxis`、`praxis`、`kalar`）保留原拼写，不翻译、不缩写；
- 缩写大小写遵循所在语言惯例：TypeScript `parseUrl`，常量 `MAX_TTL_MS`。

---

## 五、 文件与目录命名

| 语言 / 领域 | 约定 | 规则 |
| :--- | :--- | :--- |
| TypeScript / JavaScript | `kebab-case` | `NAM-FIL-001` |
| Python / Rust / GDScript | `snake_case` | `NAM-FIL-001` |
| WebGames 配置与 `.gd` | `snake_case` | `NAM-FIL-001` |
| 目录名 | 全小写 kebab-case 或单词 | `NAM-DIR-001` |

禁止在文件名中出现批次、阶段或临时标记（`phase2`、`v2-new`、`temp`），见 `NAM-JRG-002`。

---

## 六、 反例库

| 反例 | 问题 | 改写 |
| :--- | :--- | :--- |
| `function handleData(data)` | 动作与对象都不可判 | `function applySnapshot(snapshot)` |
| `const res = await fetch(...)` | 空壳名，读者需回看右值 | `const response = await fetch(...)` |
| `let flag = false` | 布尔语义缺失 | `let isDirty = false` |
| `const tmp = parse(x)` | 临时名掩盖了领域含义 | `const parsedRule = parse(x)` |
| `getUserInfoData()` | 动词 + 冗余后缀堆叠 | `loadUserProfile()` |
| `const items = new Map()` | 集合词性与容器类型冲突 | `const ruleByFamily = new Map()` |
