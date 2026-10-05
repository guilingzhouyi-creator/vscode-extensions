# 单行空包跳板判定与全库安全消融指南 (`ARCH-ABS-001`)

## 一、 什么是单行空包跳板？

凡满足以下所有特征的文件即判定为空包跳板（Trampoline / Bounce Forwarder）：
1. 源码文件（`.ts` / `.js`）除去头部注释后，有效代码行 $\text{ELOC} \le 3$；
2. 内容仅为 `export * from './sub'` 或 `export { X } from './sub'`；
3. 本地无任何声明（无类型、无函数、无类、无常量）；
4. 仅向单一目标文件透传。

---

## 二、 安全消融作业流程

1. **查找全库引用**：
   ```bash
   git grep -n "import .* from '.*old-trampoline'"
   ```
2. **直连底层真实模块**：
   - 将所有调用方的 `import` 路径直接修改为底层的真实模块；
3. **物理删除跳板文件**：
   ```bash
   git rm path/to/old-trampoline.ts
   ```
4. **验证全仓跳板数清零**：
   ```bash
   node auto-refactor/scripts/validate-facade-governance.js
   ```
