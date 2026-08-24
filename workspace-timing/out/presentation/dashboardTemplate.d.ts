/**
 * dashboardTemplate — 面板 HTML 模板（纯数据，零逻辑）
 *
 * 从 DashboardPanel.ts 机械搬移而来：仅 ${args.nonce}/${cspSource} 两类插值改为参数化。
 * 边界：不引用任何 VS Code API 与运行时状态；面板生命周期逻辑见 DashboardPanel.ts。
 */
export interface DashboardTemplateArgs {
    /** CSP nonce（每次渲染唯一） */
    nonce: string;
    /** webview 资源源（panel.webview.cspSource） */
    cspSource: string;
    /**
     * 面板词条表（panel.* 与 confirm.* 子集，由 i18n/labelsWithPrefix 构建）。
     * 静态 HTML 用 ${args.labels['key']} 插值；webview 脚本经 JSON 注入为常量 L。
     */
    labels: Record<string, string>;
}
export declare function buildDashboardHtml(args: DashboardTemplateArgs): string;
