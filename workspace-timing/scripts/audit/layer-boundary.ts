// @wt-script audit/layer-boundary
// @purpose L2 结构门禁：按 review-rules.json 依赖矩阵校验 src/ 跨层 import + 全图循环依赖检测
// @origin native（依赖矩阵编码自 docs/architecture.md 五层单向约束；integration→application 的历史违规已固化为禁令）
// @usage node dist/audit/layer-boundary.js [--json] [--root <dir>]
// @exit 0=PASS 1=发现边界违规 2=配置错误

import path from 'node:path';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT, SCRIPTS_DIR } from '../common/paths.js';
import { loadJson, ReviewRules } from '../common/config.js';
import { collectFiles, readFileSafe } from '../common/scan.js';
import { finding, envelope, printEnvelope, STATUS, verdict, Finding } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();

// ── 载入依赖矩阵 ──
const rulesRes = await loadJson<ReviewRules>(path.join(SCRIPTS_DIR, 'config', 'review-rules.json'));
if (!rulesRes.ok || !rulesRes.data.layers) {
    printEnvelope(envelope({ checker: 'L2-LAYERS', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: [rulesRes.ok ? 'review-rules.json 缺少 layers 配置' : rulesRes.error] }));
    process.exit(2);
}
const { layerOf, rules } = rulesRes.data.layers;
if (!layerOf || !rules) {
    printEnvelope(envelope({ checker: 'L2-LAYERS', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: ['layers 配置不完整'] }));
    process.exit(2);
}

/** 文件（项目相对）→ 层名；找不到映射返回 null */
function layerOfFile(relFile: string): string | null {
    const norm = relFile.split(path.sep).join('/');
    for (const [layer, prefix] of Object.entries(layerOf)) {
        if (layer === 'entry') { if (norm === prefix) return layer; continue; }
        if (norm.startsWith(prefix)) return layer;
    }
    return null;
}

/** bare import 外部模块许可匹配：'node:*' 前缀 / '*' 全放行 / 精确名 */
function externalAllowed(rule: { externalModules?: string[] }, spec: string, isNode: boolean): boolean {
    const candidates = [spec];
    if (isNode) candidates.push(`node:${spec.replace(/^node:/, '')}`, 'node:*');
    for (const allow of rule.externalModules ?? []) {
        if (allow === '*' || candidates.includes(allow)) return true;
        if (allow.endsWith(':*') && spec.startsWith(allow.slice(0, -1))) return true;
    }
    return false;
}

/** 跨层相对导入许可：目标层在 mayImportLayers，或解析文件命中 mayImportExternal。
 *  条目语义：'src/x/*' 前缀匹配；'src/a/b.ts' 精确文件；'i18n'（无 / 无 *）整层匹配。 */
function crossLayerAllowed(rule: { mayImportLayers?: string[]; mayImportExternal?: string[] }, targetLayer: string, resolvedFile: string): boolean {
    if ((rule.mayImportLayers ?? []).includes('*') || (rule.mayImportLayers ?? []).includes(targetLayer)) return true;
    for (const allow of rule.mayImportExternal ?? []) {
        if (allow.endsWith('/*')) {
            if (resolvedFile.startsWith(allow.slice(0, -2) + '/')) return true;
        } else if (allow.includes('/')) {
            if (resolvedFile === allow) return true;
        } else if (layerOfFile(resolvedFile) === allow) {
            return true;
        }
    }
    return false;
}

const findings: Finding[] = [];
const files = await collectFiles({ root, include: ['src/**/*.ts'] });
const edges = new Map<string, Set<string>>(); // file -> 目标文件集合（按【扫描根】解析，层无关——环检测不依赖层映射）

const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'crypto', 'url', 'util', 'child_process', 'http', 'https']);

for (const file of files) {
    const text = await readFileSafe(path.join(root, file));
    if (text === null) continue;
    const fromLayer = layerOfFile(file);
    const rule = fromLayer ? rules[fromLayer] : undefined;
    if (fromLayer && !rule) {
        findings.push(finding({ ruleId: 'LAY-IMPORT', severity: 'error', module: fromLayer, file, message: `层 "${fromLayer}" 在依赖矩阵中无规则定义` }));
    }

    const targets = new Set<string>();
    for (const m of text.matchAll(/(?:^|\n)\s*import[\s\S]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2];
        if (!spec) continue;

        if (spec.startsWith('.') || spec.startsWith('/')) {
            // 相对导入：按【扫描根】解析（fixture 自检与项目根两种形态一致），建边不依赖层映射
            const resolved = path.relative(root, path.resolve(path.dirname(path.join(root, file)), spec)).split(path.sep).join('/');
            targets.add(resolved);

            // 层检查仅对有层文件生效（fixture 无层 → 只建边、只测环）
            if (fromLayer && rule) {
                const targetLayer = layerOfFile(resolved);
                if (targetLayer && targetLayer !== fromLayer && !crossLayerAllowed(rule, targetLayer, resolved)) {
                    findings.push(finding({
                        ruleId: 'LAY-IMPORT', severity: 'error', module: fromLayer, file,
                        message: `跨层依赖违规：${fromLayer} → ${targetLayer}（${resolved} 未获矩阵许可）`,
                        evidence: `import ... from '${spec}'`,
                        suggestedFix: '若确属架构需要，先修订 review-rules.json layers 矩阵并说明理由；否则将逻辑下沉到被许可的层',
                    }));
                } else if (!targetLayer) {
                    findings.push(finding({
                        ruleId: 'LAY-UNRESOLVED', severity: 'warning', module: fromLayer, file,
                        message: `相对导入无法解析到已知层文件: '${spec}' → ${resolved}`,
                        evidence: `import ... from '${spec}'`,
                    }));
                }
            }
        } else if (fromLayer && rule) {
            const isNode = spec.startsWith('node:') || NODE_BUILTINS.has(spec);
            if (!externalAllowed(rule, spec, isNode)) {
                findings.push(finding({
                    ruleId: 'LAY-IMPORT', severity: 'error', module: fromLayer, file,
                    message: spec === 'vscode'
                        ? `宿主 API 越层：${fromLayer} 层禁止 import vscode（纯 Node 可测边界被破坏）`
                        : `未许可的外部依赖：${fromLayer} 层 import '${spec}'`,
                    evidence: `import ... from '${spec}'`,
                    suggestedFix: spec === 'vscode' ? '经端口/回调注入宿主能力，保持该层零 vscode 依赖' : '评估是否引入依赖；或在 review-rules.json 声明许可',
                }));
            }
        }
    }
    edges.set(file, targets);
}

// ── 循环依赖检测（三色标记【迭代】DFS：显式帧栈，万节点深链无递归栈溢出风险；
//    节点/邻接排序保证结果确定性。边按无扩展名归一——与导入解析的产物对齐，
//    否则 color 查不到 key 会把整轮遍历跳过（已由夹具自检覆盖））──
const WHITE = 0, GRAY = 1, BLACK = 2;
const stripExt = (p: string): string => p.replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/, '');
const normEdges = new Map<string, Set<string>>();
for (const [file, targets] of edges) {
    const key = stripExt(file);
    const set = normEdges.get(key) ?? new Set<string>();
    for (const t of targets) set.add(stripExt(t));
    normEdges.set(key, set);
}
const color = new Map<string, number>();
const cycles: string[][] = [];

for (const start of [...normEdges.keys()].sort()) {
    // ★ 未访问节点在 color 中不存在 → 缺省必须取 WHITE（取 BLACK 会让整轮遍历被跳过）
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    color.set(start, GRAY);
    const path: string[] = [start];
    const stack: Array<{ node: string; nexts: string[]; idx: number }> = [
        { node: start, nexts: [...(normEdges.get(start) ?? [])].sort(), idx: 0 },
    ];
    while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.idx >= top.nexts.length) {
            color.set(top.node, BLACK);
            stack.pop();
            path.pop();
            continue;
        }
        const next = top.nexts[top.idx++];
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
            const at = path.indexOf(next);
            cycles.push([...path.slice(at), next]);
        } else if (c === WHITE) {
            color.set(next, GRAY);
            path.push(next);
            stack.push({ node: next, nexts: [...(normEdges.get(next) ?? [])].sort(), idx: 0 });
        }
    }
}
for (const cyc of cycles) {
    findings.push(finding({
        ruleId: 'LAY-CYCLE', severity: 'error', file: cyc[0],
        message: `循环依赖: ${cyc.join(' → ')}`,
        evidence: cyc.join(' -> '),
        suggestedFix: '提取共享逻辑到被共同依赖的下层（domain），或经接口反转',
    }));
}

const status = verdict(findings, { blockOn: 'error' });
log.info(`分层审查: ${files.length} 文件, 违规 ${findings.length} 条, 环 ${cycles.length} 个`);

printEnvelope(envelope({
    checker: 'L2-LAYERS',
    status,
    findings,
    filesScanned: files.length,
    durationMs: Date.now() - started,
    notes: [`扫描 ${files.length} 个 src 文件，检出 ${findings.length} 条`],
}));
process.exit(status === STATUS.PASS ? 0 : 1);
