/**
 * i18n — 语言内核与面板词条完整性单测
 *
 * 1) locale 解析与热切换（语言源经参数注入，纯 Node 运行）
 * 2) 面板词条完整性：dashboardTemplate 中引用的每个 labels key，
 *    必须在 zh-CN 与 en 两套字典中同时存在（防漏译渲染成 undefined）
 */
'use strict';

const assert = require('assert');
const path = require('path');

// TS export default 经 commonjs 编译后位于 .default；做兼容解包
function loadDict(name) {
    const mod = require('../../out/i18n/' + name);
    return mod.default ?? mod;
}

const zhCN = loadDict('zh-CN.js');
const en = loadDict('en.js');
const i18n = require('../../out/i18n/index.js');
const { init, setLocale, currentLocale, resolveLocale, labelsWithPrefix, t } = i18n;

// 从编译后的模板中提取全部 labels 引用：labels['key'] 与 L['key']
function extractTemplateLabelKeys() {
    const fs = require('fs');
    const file = path.join(__dirname, '../../out/presentation/dashboardTemplate.js');
    const src = fs.readFileSync(file, 'utf8');
    const keys = new Set();
    for (const m of src.matchAll(/(?:labels|L)\[(?:'|")([^'"]+)(?:'|")\]/g)) {
        keys.add(m[1]);
    }
    return [...keys];
}

describe('i18n（语言内核）', () => {
    it('resolveLocale：显式指定优先于 VS Code 语言', () => {
        assert.strictEqual(resolveLocale('en', 'zh-CN'), 'en');
        assert.strictEqual(resolveLocale('zh-CN', 'en'), 'zh-CN');
    });

    it('resolveLocale(auto/未指定)：跟随注入的 VS Code 语言', () => {
        assert.strictEqual(resolveLocale(undefined, 'zh-CN'), 'zh-CN');
        assert.strictEqual(resolveLocale('auto', 'en'), 'en');
        assert.strictEqual(resolveLocale(undefined, 'ja'), 'en', '非 zh 开头回退 en');
    });

    it('init：按解析结果装载语言包', () => {
        init('auto', 'en');
        assert.strictEqual(currentLocale(), 'en');
        assert.strictEqual(t()['panel.title'], en['panel.title']);

        init('auto', 'zh-CN');
        assert.strictEqual(currentLocale(), 'zh-CN');
        assert.strictEqual(t()['panel.title'], zhCN['panel.title']);
    });

    it('setLocale：运行期热切换（无需重新 init）', () => {
        init('zh-CN');
        setLocale('en');
        assert.strictEqual(currentLocale(), 'en');
        assert.strictEqual(t()['cmd.enabled'], en['cmd.enabled']);
        setLocale('zh-CN');
        assert.strictEqual(t()['cmd.enabled'], zhCN['cmd.enabled']);
    });
});

describe('i18n（面板词条完整性）', () => {
    const templateKeys = extractTemplateLabelKeys();

    it('模板中存在可提取的词条引用（防提取逻辑失效）', () => {
        assert.ok(templateKeys.length >= 50, '引用数异常偏少: ' + templateKeys.length);
    });

    it('模板引用的每个 key 在两套字典中都存在且非空', () => {
        const missing = [];
        for (const key of templateKeys) {
            if (!(key in zhCN) || !String(zhCN[key]).length) missing.push('zh-CN:' + key);
            if (!(key in en) || !String(en[key]).length) missing.push('en:' + key);
        }
        assert.deepStrictEqual(missing, [], '缺失或空词条: ' + missing.join(', '));
    });

    it('labelsWithPrefix：只返回指定前缀的词条', () => {
        init('zh-CN');
        const labels = labelsWithPrefix(['panel.', 'confirm.']);
        assert.ok(Object.keys(labels).length >= templateKeys.length,
            'labels 应至少覆盖模板全部引用');
        for (const key of Object.keys(labels)) {
            assert.ok(key.startsWith('panel.') || key.startsWith('confirm.'),
                '混入意外前缀: ' + key);
        }
    });
});
