# Python 现代惯用法

> 对应 `PYM` 族 13 条规则。工作区内 59 个 `.py` 文件集中在 `WebGames/scripts` 与 `mod_sdk`，属项目工具链；写法仍须与规则一致。

---

## 一、 类型注解

| 旧写法 | 现代写法 | 规则 |
| :--- | :--- | :--- |
| `from typing import List, Dict, Set, Tuple` | 内建泛型 `list[int]`、`dict[str, int]` | `PYM-GENERIC-001`（error） |
| `Optional[X]` / `Union[X, Y]` | `X \| None` / `X \| Y` | `PYM-UNION-001`（error） |
| `from typing import Iterable` | `from collections.abc import Iterable` | `PYM-ABC-001`（error） |

```python
# 旧
from typing import List, Optional, Dict
def load(paths: List[str]) -> Optional[Dict[str, int]]: ...

# 新
from collections.abc import Sequence
def load(paths: Sequence[str]) -> dict[str, int] | None: ...
```

---

## 二、 资源管理

| 旧写法 | 现代写法 | 规则 |
| :--- | :--- | :--- |
| `f = open(p); ...; f.close()` | `with open(p) as f:` | `PYM-OPEN-001` |
| `os.path.join` / `os.path.exists` | `pathlib.Path` | `PYM-PATH-001` |
| `datetime.timezone.utc` | `datetime.UTC`（3.11+） | `PYM-DATETIME-001`（error） |

```python
# 旧
import os
if os.path.exists(os.path.join(base, "rules.json")):
    with open(os.path.join(base, "rules.json")) as f:
        data = f.read()

# 新
from pathlib import Path
target = Path(base) / "rules.json"
if target.is_file():
    data = target.read_text(encoding="utf-8")
```

---

## 三、 异步

| 反模式 | 问题 | 规则 |
| :--- | :--- | :--- |
| `time.sleep()` 在 `async def` 内 | 阻塞整个事件循环 | `PYM-ASYNC-001`（error） |
| 调用协程但未 `await` | 静默不执行 | `PYM-ASYNC-001` |
| `requests.get()` 在 `async def` 内 | 同步阻塞 | `PYM-ASYNC-001` |

```python
# 旧
async def fetch(url):
    time.sleep(1)            # 阻塞事件循环
    return requests.get(url) # 同步阻塞

# 新
async def fetch(client, url):
    await asyncio.sleep(1)
    return await client.get(url)
```

---

## 四、 函数签名

| 反模式 | 问题 | 规则 |
| :--- | :--- | :--- |
| `def f(items=[])` | 可变默认参数在调用间共享 | `PYM-DEFAULT-001` |
| 参数名遮蔽内建（`list`、`id`、`type`） | 后续无法使用内建 | `PYM-SHADOW-001` |
| `raise ValueError("x")` 在 `except` 内 | 丢失因果链 | `PYM-RAISE-001` |

```python
# 旧
def append_rule(rule, bucket=[]):
    bucket.append(rule)
    return bucket

# 新
def append_rule(rule, bucket: list[str] | None = None) -> list[str]:
    target = bucket if bucket is not None else []
    target.append(rule)
    return target
```

---

## 五、 字符串与格式

| 旧写法 | 现代写法 | 规则 |
| :--- | :--- | :--- |
| `"%s: %d" % (name, count)` | `f"{name}: {count}"` | `PYM-FSTRING-001` |
| `"{0}".format(x)` | `f"{x}"` | `PYM-FSTRING-001` |

---

## 六、 数据类

```python
# 旧：无 slots，每个实例带 __dict__
@dataclass
class Rule:
    id: str
    severity: str

# 新：slots=True 降低内存与属性查找开销
@dataclass(slots=True, frozen=True)
class Rule:
    id: str
    severity: str
```

规则 `PYM-SLOTS-001`：不继承的数据类应声明 `slots=True`。

---

## 七、 导入顺序

`PYM-IMPORT-001` 要求三段式分组并组内字母序：

```python
# 1. 标准库
import json
from pathlib import Path

# 2. 第三方
import pytest

# 3. 本地
from .catalog import load_rules
```

---

## 八、 错误处理

```python
# 旧
try:
    data = json.loads(text)
except Exception:
    pass

# 新
try:
    data = json.loads(text)
except json.JSONDecodeError as err:
    raise CatalogError(f"rule-catalog.json 第 {err.lineno} 行不是合法 JSON") from err
```

对应 `PYM-RAISE-001`（保留因果链）与 `ERR-FLT-001`（禁空捕获）。

---

## 九、 迁移检查清单

- [ ] `typing.List/Dict/Set/Tuple` 是否清零？（`PYM-GENERIC-001`）
- [ ] `Optional` / `Union` 是否改为 `|`？（`PYM-UNION-001`）
- [ ] `typing.Iterable/Sequence/Mapping` 是否改为 `collections.abc`？（`PYM-ABC-001`）
- [ ] `async def` 内是否零阻塞调用？（`PYM-ASYNC-001`）
- [ ] `timezone.utc` 是否改为 `datetime.UTC`？（`PYM-DATETIME-001`）
- [ ] 可变默认参数是否清零？（`PYM-DEFAULT-001`）
- [ ] `open()` 是否全部在 `with` 内？（`PYM-OPEN-001`）
- [ ] `os.path` 是否改为 `pathlib`？（`PYM-PATH-001`）
