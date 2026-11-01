/**
 * Module: Trajectory Command Unit Tests
 * File Path: tests/unit/trajectory-cmd.test.ts
 * Architecture Role: Unit-level assertion suite validating trajectory CLI subcommand dispatching,
 *   sparkline mini-histogram rendering, daily/hourly bucket aliasing, and JSON envelope serialization.
 * Dependencies & Triggers: Vitest; trajectoryCommand and renderSparkline from src/cli/trajectory-cmd.
 * Responsibilities:
 *   1. Assert renderSparkline maps numeric sequences to exact relative level glyphs.
 *   2. Assert trajectoryCommand with --daily and --hourly resolves corresponding bucket configurations.
 *   3. Assert trajectoryCommand with --json outputs valid parseable JSON containing sparkline telemetry.
 * Exit Semantics & Design Rationale: Exits cleanly when all assertions match; deterministically mocks
 *   repository path to the workspace root.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { trajectoryCommand, renderSparkline } from '../../src/cli/trajectory-cmd';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

describe('Trajectory Command and Telemetry Visualization', () => {
    describe('renderSparkline', () => {
        it('returns empty string for empty input', () => {
            expect(renderSparkline([])).toBe('');
        });

        it('returns highest block for identical values', () => {
            expect(renderSparkline([50, 50, 50])).toBe('███');
        });

        it('correctly maps linear monotonic values across range', () => {
            const values = [0, 10, 20, 30, 40, 50, 60, 70];
            const spark = renderSparkline(values);
            expect(spark).toHaveLength(8);
            expect(spark[0]).toBe(' ');
            expect(spark[7]).toBe('█');
        });

        it('handles single value input', () => {
            expect(renderSparkline([99.5])).toBe('█');
        });
    });

    describe('trajectoryCommand CLI Dispatching', () => {
        it('executes trajectoryCommand with --daily and --sparkline', async () => {
            const commandResult = await trajectoryCommand([
                '--root',
                WORKSPACE_ROOT,
                '--daily',
                '--sparkline',
            ]);
            expect(commandResult.code).toBe(0);
            expect(commandResult.text).toContain('VIRTUAL TIMELINE PROJECTION (Bucket: day');
            expect(commandResult.text).toContain('AUTO-REFACTOR INTEGRATED TRAJECTORY TELEMETRY');
        });

        it('executes trajectoryCommand with --hourly and --sparkline', async () => {
            const commandResult = await trajectoryCommand([
                '--root',
                WORKSPACE_ROOT,
                '--hourly',
                '--sparkline',
            ]);
            expect(commandResult.code).toBe(0);
            expect(commandResult.text).toContain('VIRTUAL TIMELINE PROJECTION (Bucket: hour');
        });

        it('executes trajectoryCommand with --json and contains sparkline property', async () => {
            const commandResult = await trajectoryCommand([
                '--root',
                WORKSPACE_ROOT,
                '--daily',
                '--sparkline',
                '--json',
            ]);
            expect(commandResult.code).toBe(0);
            const parsed = JSON.parse(commandResult.text);
            expect(parsed).toHaveProperty('lifetime');
            expect(parsed).toHaveProperty('timeline');
            expect(parsed.timeline).toHaveProperty('sparkline');
            expect(parsed.timeline.bucketType).toBe('day');
        });

        it('executes trajectoryCommand with --summary', async () => {
            const commandResult = await trajectoryCommand([
                '--root',
                WORKSPACE_ROOT,
                '--summary',
                '--json',
            ]);
            expect(commandResult.code).toBe(0);
            const parsed = JSON.parse(commandResult.text);
            expect(parsed).toHaveProperty('lifetime');
            expect(parsed).toHaveProperty('rolling');
            expect(parsed).not.toHaveProperty('timeline');
        });
    });
});
