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
}
export declare function buildDashboardHtml(args: DashboardTemplateArgs): string;
