# scripts/py — Python 脚本域（预留）

> 仓库级 Python 脚本统一归属地。当前为空（暂无脚本），规范同 [`../README.md`](../README.md)。

**进入条件**：任务需要 stdlib 或轻量依赖的文本/数据/多步骤处理，且 Bash 单行/管道
无法简洁表达时，才在此新增 `.py` 脚本（避免为可 sh 完成的事引入 Python 运行时依赖）。

**规范要点**：
- 命名：小写 kebab-case（`*.py`），动词开头
- 结构：docstring 头注释（职能域/触发方/用法/退出码）+ `if __name__ == "__main__":` 守卫
- 错误处理：`sys.exit(0/1/2)` 语义与 sh 域一致；参数解析用 `argparse`
- 新增后更新 [`../README.md`](../README.md) 分类矩阵
