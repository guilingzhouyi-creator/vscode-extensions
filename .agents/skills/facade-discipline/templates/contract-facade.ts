/**
 * Module: Substantial Contract Facade Example
 * Architecture Role: Unified entrypoint aggregating >= 3 subdomains with immutability guarantees.
 */

import { DomainA } from './internal/domainA';
import { DomainB } from './internal/domainB';
import { DomainC } from './internal/domainC';

export interface FacadeOptions {
    readonly timeoutMs?: number;
    readonly enableTelemetry?: boolean;
}

export interface UnifiedSnapshot {
    readonly stateA: string;
    readonly stateB: number;
    readonly stateC: boolean;
}

export class SubstantialFacade {
    private readonly a = new DomainA();
    private readonly b = new DomainB();
    private readonly c = new DomainC();

    constructor(private readonly options: FacadeOptions = {}) {
        // 运行时防御性参数校验
        if (options.timeoutMs !== undefined && options.timeoutMs <= 0) {
            throw new Error('timeoutMs must be positive');
        }
    }

    public getSnapshot(): UnifiedSnapshot {
        const rawSnapshot: UnifiedSnapshot = {
            stateA: this.a.getState(),
            stateB: this.b.getCount(),
            stateC: this.c.isActive(),
        };
        // 不可变快照封装保障
        return Object.freeze(rawSnapshot);
    }
}
