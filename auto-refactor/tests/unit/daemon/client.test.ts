import { describe, it, expect } from 'vitest';
import { DaemonClient, tryWarmScan, tryWarmScanDiff } from '../../../src/daemon/client';
import type { ScanConfig } from '../../../src/core/types';

describe('DaemonClient and WarmScan entry points', () => {
    const dummyRoot = 'dummy-daemon-project-root';
    const dummyConfig: ScanConfig = {
        root: dummyRoot,
        include: ['**/*.ts'],
        exclude: ['node_modules'],
        analyzers: [],
        severityThreshold: 'warning',
        effectiveLocThreshold: 800,
        logLevel: 'silent',
    };

    it('initializes DaemonClient with given root and default capabilities', () => {
        const client = new DaemonClient(dummyRoot);
        expect(client.root).toBe(dummyRoot);
        expect(client.hasDiffCap()).toBe(false);
    });

    it('gracefully degrades tryWarmScan to null when daemon is not running', async () => {
        const warmResult = await tryWarmScan({
            root: dummyRoot,
            config: dummyConfig,
            options: {
                cache: false,
            },
        });
        expect(warmResult).toBeNull();
    });

    it('gracefully degrades tryWarmScanDiff to null when daemon is not running', async () => {
        const diffResult = await tryWarmScanDiff({
            root: dummyRoot,
            config: dummyConfig,
            diffs: [],
            options: {
                cache: false,
                verifyDiskContent: false,
                delta: false,
            },
        });
        expect(diffResult).toBeNull();
    });

    it('rejects connect() with NO_DAEMON error when registry does not exist', async () => {
        const client = new DaemonClient(dummyRoot);
        await expect(client.connect(50)).rejects.toThrow('NO_DAEMON');
    });

    it('rejects scan() when client is not connected', async () => {
        const client = new DaemonClient(dummyRoot);
        await expect(
            client.scan(dummyConfig, {
                cache: false,
            }),
        ).rejects.toThrow('NOT_CONNECTED');
    });

    it('rejects scanDiff() when client is not connected', async () => {
        const client = new DaemonClient(dummyRoot);
        await expect(
            client.scanDiff(dummyConfig, [], {
                cache: false,
                verifyDiskContent: false,
                delta: false,
            }),
        ).rejects.toThrow('NOT_CONNECTED');
    });

    it('rejects ping() when client is not connected', async () => {
        const client = new DaemonClient(dummyRoot);
        await expect(client.ping(50)).rejects.toThrow('NOT_CONNECTED');
    });

    it('safely handles shutdown and dispose idempotently when disconnected', () => {
        const client = new DaemonClient(dummyRoot);
        expect(() => client.shutdown()).not.toThrow();
        expect(() => client.dispose()).not.toThrow();
        expect(() => client.close()).not.toThrow();
    });
});
