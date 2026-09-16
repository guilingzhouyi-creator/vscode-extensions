// ==============================================================================
// 模块归属: 工程效能与质量门禁 (Tooling · 图表语法分析体系)
// 文件路径: WebGames/scripts/js/validate-mermaid.mjs
// 架构定位: 离线解析校验器 (Node.js Validator)
// 依赖与触发: 触发方: check-mermaid.sh / 本地 CLI | 上游: docs/*.md | 下游: 解析报告 | 运行时: Node.js 18+
// 职责说明: 使用 JSDOM 与 Mermaid 原生解析器离线校验文档中的全部 Mermaid 图表语法完整性
// 退出语义与设计依据: 退出码: 0=全图表通过, 1=存在语法错误 | 设计依据: 文档工程化自检契约
// ------------------------------------------------------------------------------
// 用法示例:
//   node WebGames/scripts/js/validate-mermaid.mjs [docsDir]
// ==============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const docsDir = process.argv[2] || path.join(root, 'docs');

// mermaid 面向浏览器：以 jsdom 提供 DOM 环境后调用 parse（不渲染，仅解析）
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, logLevel: 'fatal' });

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.md')) files.push(full);
  }
})(docsDir);
files.sort();

const FENCE_RE = /^([ \t]*)```(\w*)[^\n]*\n([\s\S]*?)^\1```\s*$/gm;
let total = 0;
const failures = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const rel = path.relative(docsDir, file).split(path.sep).join('/');
  let m;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    if (m[2].toLowerCase() !== 'mermaid') continue;
    total++;
    const line = text.slice(0, m.index).split('\n').length;
    try {
      const ok = await mermaid.parse(m[3]);
      if (!ok) throw new Error('parse returned falsy');
    } catch (err) {
      failures.push({ rel, line, msg: String(err.message || err).split('\n')[0] });
    }
  }
}

console.log(`【check-mermaid】解析 ${total} 个 mermaid 图表 / ${files.length} 份文档`);
if (failures.length) {
  console.log(`【check-mermaid】${failures.length} 个失败:`);
  for (const f of failures) console.log(`  · ${f.rel}:${f.line} — ${f.msg}`);
  console.log('【审查结论】未通过');
  process.exit(1);
}
console.log('【审查结论】通过');
