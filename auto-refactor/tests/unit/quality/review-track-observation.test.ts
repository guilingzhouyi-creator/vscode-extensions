/**
 * Module: Review — Dual-Track Invocation Tests
 * File Path: tests/unit/quality/review-track-observation.test.ts
 * Architecture Role: Verify production tracks expose actual bounded and whole-file calls.
 * Dependencies & Triggers: Vitest and the compiled Scanner and dual-track pipeline.
 * Responsibilities: Preserve fast speculation and observe analyzer execution rather than plans.
 * Exit Semantics & Design Rationale: The deep promise remains a separate completion boundary.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getDefaultConfig } from '../../../src/core/config/config';
import type { Scanner as ScannerType } from '../../../src/core/analyzer';
import type * as Pipeline from '../../../src/core/pipeline/dualTrackPipeline';
import type { FileExecutionObservation } from '../../../src/core/review/analyzer-execution';

const require = createRequire(import.meta.url);
const { Scanner } = require('../../../dist/core/analyzer.js') as { Scanner: typeof ScannerType };
const { executeDualTrack } = require('../../../dist/core/pipeline/dualTrackPipeline.js') as typeof Pipeline;

function scanner() {
    return new Scanner({
        ...getDefaultConfig(), root: process.cwd(), archetype: 'library',
        sparseRouting: false, cacheEnabled: false, bypassPreflight: true,
        analyzers: { performance: { enabled: true } },
    });
}
describe('dual-track execution observations', () => {
    it('reports the real fast invocation and retains its explicit line window', async () => {
        const observed: { track: string; execution: FileExecutionObservation }[] = [];
        const result = await executeDualTrack(scanner(), [{
            filePath: 'src/a.ts', oldContent: 'export const a = 1;',
            newContent: 'export const a = 2;', lineBounds: [1, 1],
        }], { forceFull: true, onExecution: event => observed.push(event) });
        expect(observed).toMatchObject([{
            track: 'fast', execution: {
                path: 'src/a.ts', lineBounds: [1, 1],
                analyzers: [{ analyzer: 'performance', status: 'partial', reason: 'line-window' }],
            },
        }]);
        await result.deepPromise;
    });
});
