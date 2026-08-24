/**
 * AggregatedCsvExporter — 全历史聚合导出器
 *
 * 输出全历史日报序列 CSV（折叠桶 ∪ 当期原始计算），
 * 与面板日报同口径；日期升序。
 */
import { DailyStats } from '../../domain/TimeAggregator';
export declare class AggregatedCsvExporter {
    readonly formatName = "aggregated-csv";
    build(series: DailyStats[], workspaceName: string): string;
}
