/**
 * ActivityTracker — 编辑活跃度追踪
 *
 * 职责：监听 onDidChangeTextDocument，统计每秒是否有编辑活动。
 *       心跳 (1s) 调用 tick() 消费累积标志，累加每日活跃秒数。
 * 边界：不持久化 — 仅会话内有效，重启归零。
 *
 * 效率 = 活跃时长 / 计时器时长
 */

import * as vscode from 'vscode';
import { MS_PER_SECOND } from '../domain/models';
import { localDateStr } from '../domain/TimeAggregator';

export interface DailyActivitySnapshot {
    date: string;
    activeMs: number;    // 实际编辑时长
    totalMs: number;     // 计时器时长（由外部填充）
    ratio: number;       // 效率 = activeMs / totalMs (0-1)
}

export class ActivityTracker {
    /** dateStr → 活跃秒数 */
    private dailyActiveSeconds = new Map<string, number>();
    private changedSinceLastBeat = false;
    private readonly disposables: vscode.Disposable[] = [];

    /** 启动监听 */
    start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(() => {
                this.changedSinceLastBeat = true;
            }),
        );
    }

    /**
     * 心跳回调 — 每秒由 Scheduler 调用。
     * 消费 changedSinceLastBeat 标志，累加当日活跃秒数。
     */
    tick(): void {
        if (this.changedSinceLastBeat) {
            const today = localDateStr(new Date());
            const current = this.dailyActiveSeconds.get(today) ?? 0;
            this.dailyActiveSeconds.set(today, current + 1);
            this.changedSinceLastBeat = false;
        }
    }

    /** 获取指定日期的活跃时长 (ms) */
    getDailyActiveMs(dateStr: string): number {
        return (this.dailyActiveSeconds.get(dateStr) ?? 0) * MS_PER_SECOND;
    }

    /** 获取最近 7 天的活跃快照（由外部填充 totalMs） */
    getSnapshot(dailyTotalMs: Map<string, number>): DailyActivitySnapshot[] {
        const result: DailyActivitySnapshot[] = [];
        for (const [date, totalMs] of dailyTotalMs) {
            const activeMs = this.getDailyActiveMs(date);
            result.push({
                date,
                activeMs,
                totalMs,
                ratio: totalMs > 0 ? activeMs / totalMs : 0,
            });
        }
        return result;
    }

    /** 停止监听 */
    stop(): void {
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
    }
}
