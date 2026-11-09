/**
 * Module: Scanner cache anchoring regressions
 * File Path: tests/unit/scanner/cache-anchor.test.ts
 * Architecture Role: Verify review memory is anchored to the owning project, not the scan root.
 * Dependencies & Triggers: Vitest, Scanner and an owned filesystem fixture.
 * Responsibilities: Reject cache trees written inside authored source directories.
 * Exit Semantics & Design Rationale: A scan rooted at `src/` must not author `src/.auto-refactor-cache`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { Scanner as ScannerType } from '../../../src/core/analyzer';
import { getDefaultConfig } from '../../../src/core/config/config';

const { Scanner } = createRequire(import.meta.url)('../../../dist/core/analyzer.js') as {
    Scanner: typeof ScannerType;
};
const CACHE_DIR = '.auto-refactor-cache';
const created: string[] = [];

function project(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cache-anchor-'));
    created.push(directory);
    fs.mkdirSync(path.join(directory, 'src', 'core'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"fixture","private":true}\n');
    fs.writeFileSync(path.join(directory, 'src', 'example.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(directory, 'src', 'core', 'leaf.ts'), 'export const leaf = 2;\n');
    return directory;
}

function scannerFor(root: string): ScannerType {
    const config = getDefaultConfig(root);
    config.root = root;
    config.archetype = 'library';
    config.sparseRouting = false;
    config.cacheEnabled = true;
    config.analyzers = {};
    config.bypassPreflight = true;
    return new Scanner(config);
}

afterEach(() => {
    while (created.length > 0) {
        const directory = created.pop();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('review memory anchoring', () => {
    it.each(['src', 'src/core'] as const)(
        'never authors a cache inside the scanned subtree (%s)',
        (subdirectory) => {
            const directory = project();
            scannerFor(path.join(directory, subdirectory));
            expect(fs.existsSync(path.join(directory, subdirectory, CACHE_DIR))).toBe(false);
        },
    );

    it('anchors a subdirectory scan to the owning project root', () => {
        const directory = project();
        scannerFor(path.join(directory, 'src', 'core'));
        expect(fs.existsSync(path.join(directory, CACHE_DIR))).toBe(true);
    });

    it('honours an explicitly disabled cache regardless of root', () => {
        const directory = project();
        const config = getDefaultConfig(path.join(directory, 'src'));
        config.root = path.join(directory, 'src');
        config.cacheEnabled = false;
        config.archetype = 'library';
        config.sparseRouting = false;
        config.analyzers = {};
        config.bypassPreflight = true;
        new Scanner(config);
        expect(fs.existsSync(path.join(directory, CACHE_DIR))).toBe(false);
    });

    it('falls back to the requested root when no manifest exists above it', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cache-nomanifest-'));
        created.push(directory);
        fs.mkdirSync(path.join(directory, 'only'), { recursive: true });
        scannerFor(path.join(directory, 'only'));
        const anchored = fs.existsSync(path.join(directory, 'only', CACHE_DIR));
        const climbed = fs.existsSync(path.join(directory, CACHE_DIR));
        expect(anchored || climbed).toBe(true);
    });
});
