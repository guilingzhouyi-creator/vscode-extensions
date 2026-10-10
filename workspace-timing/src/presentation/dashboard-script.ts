/**
 * Module: DashboardScript — 仪表盘前端交互运行时脚本生成器
 * File Path: src/presentation/dashboard-script.ts
 * Architecture Role: Presentation layer Webview client-side controller and vector graphics renderer
 * Dependencies & Triggers: Injected into Webview HTML template by dashboardTemplate.ts; runs within isolated VS Code Webview context
 * Responsibilities: Render dynamic SVG spline active curves, 24-week activity heatmaps, and hourly distribution bars; manage bidirectional postMessage protocol with extension host; bind UI form controls
 * Exit Semantics & Design Rationale: Bundled as an IIFE with CSP nonce protection; communicates exclusively via acquireVsCodeApi postMessage with zero external CDN dependencies
 */

export function buildDashboardScript(labels: Record<string, string>): string {
    return /* javascript */ `
    (function() {
      const vscode = acquireVsCodeApi();
      // 国际化契约：词条表（渲染时由扩展宿主按当前语言序列化注入）
      const L = ${JSON.stringify(labels)};
      // 格式化契约：{0}/{1} 占位符格式化（与宿主 i18n format 语义一致）
      function fmt(tpl) {
        const args = Array.prototype.slice.call(arguments, 1);
        return String(tpl).replace(/{([0-9]+)}/g, function(_, idx) {
          const i = parseInt(idx, 10);
          return args[i] !== undefined ? String(args[i]) : '{' + idx + '}';
        });
      }
      let pendingData = null;
      let isTodaySessionsExpanded = false;
      let isWsExpanded = false;
      let cachedActiveCurveWidth = 0;
      let activeCurveResizeObserver = null;

      /**
       * 渲染折叠/展开交互按钮 HTML。
       *
       * @param {string} id - 切换条 DOM 唯一标识
       * @param {boolean} isExpanded - 当前展开状态
       * @param {string} showLessText - 收起态文案
       * @param {string} showMoreText - 展开态模板文案
       * @param {number} count - 列表总元素计数
       * @returns {string} 格式化后的按钮 HTML
       */
      function renderFoldToggle(id, isExpanded, showLessText, showMoreText, count) {
        const text = isExpanded ? showLessText : fmt(showMoreText, count);
        const arrow = isExpanded ? '▲' : '▼';
        return '<div class="fold-toggle" id="' + id + '" role="button" tabindex="0">' +
          '<span>' + text + '</span>' +
          '<span class="toggle-arrow">' + arrow + '</span>' +
        '</div>';
      }

      /**
       * 绑定折叠切换按钮的点击事件并实时更新样式类与提示词条。
       *
       * @param {string} id - 切换条元素标识
       * @param {HTMLElement} container - 宿主容器元素
       * @param {() => boolean} onToggle - 状态切换回调
       * @param {() => { less: string, more: string }} getTexts - 国际化文本提供者
       */
      function bindFoldToggle(id, container, onToggle, getTexts) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', function() {
          const expanded = onToggle();
          container.classList.toggle('is-collapsed', !expanded);
          const textSpan = btn.querySelector('span:first-child');
          const arrowSpan = btn.querySelector('.toggle-arrow');
          if (textSpan) textSpan.textContent = expanded ? getTexts().less : getTexts().more;
          if (arrowSpan) arrowSpan.textContent = expanded ? '▲' : '▼';
        });
      }

      // 渲染契约：更新 UI 主视图各卡片组件 (View update pipeline)
      function updateUI(data) {
        // 性能契约：读写分离预读，在批量写 DOM 之前预先读取曲线容器宽度，彻底消除强制同步布局 (FSL)
        const acEl = document.getElementById('activeCurve');
        if (!cachedActiveCurveWidth && acEl && acEl.clientWidth > 0) {
          cachedActiveCurveWidth = acEl.clientWidth;
        }

        // 视图契约：统计概览卡片更新
        document.getElementById('statToday').textContent = formatDuration(data.todayMs);
        document.getElementById('statWeek').textContent = formatDuration(data.weekTotalMs || 0);
        document.getElementById('statTotal').textContent = formatDuration(data.totalMs);
        document.getElementById('statGlobalTotal').textContent = formatDuration(data.globalTotalMs || 0);
        document.getElementById('statSessions').textContent = String(data.sessionsCount);

        const statusEl = document.getElementById('statStatus');
        if (data.globalDisabled) {
          statusEl.innerHTML = '<span class="status-badge status-disabled">' + L['panel.js.badgeGlobalDisabled'] + '</span>';
        } else if (!data.isEnabled) {
          statusEl.innerHTML = '<span class="status-badge status-disabled">' + L['panel.js.badgeDisabled'] + '</span>';
        } else {
          statusEl.innerHTML = '<span class="status-badge status-running">' + L['panel.js.badgeRunning'] + '</span>';
        }

        // 表单契约：设置项控件同步
        setChecked('chkEnabled', data.isEnabled);
        setChecked('chkGlobalDisabled', data.globalDisabled);
        setChecked('chkStatusBar', data.statusBarEnabled);
        setValue('selLocale', data.locale || 'auto');
        setChecked('chkJournal', data.journalEnabled);
        setChecked('chkBackup', data.backupToFile);
        setValue('numRingBuffer', data.ringBufferCapacity);
        setValue('numJournalInterval', data.journalFlushIntervalMs);
        setValue('numFullSaveInterval', data.fullSaveIntervalMs);
        setValue('numMaxSessions', data.maxSessions);
        setChecked('chkWeeklyLimit', data.weeklyLimitEnabled);
        setValue('numWeeklyLimitHours', data.weeklyLimitHours || 40);
        setChecked('chkChartDualTrack', data.chartDualTrackDisplay !== false);

        // 对比契约：跨工作区对比视图渲染
        renderWorkspaceCompare(data.workspaceList, data.workspaceCount, data.globalTotalMs);

        // 指标契约：周报关键指标（日均/活跃天/最活跃日） + 多周趋势 + 今日明细
        renderWeeklySummary(data.weeklySummary, data.weeklyTrend, data.weeklyLimitEnabled, data.weeklyLimitHours);
        renderTodayDetail(data.todayDetail, data.chartDualTrackDisplay !== false);

        // 矩阵契约：活动时间线热力图矩阵渲染
        renderHeatmap(data.heatmap);

        // 算法契约：周报活跃曲线常驻渲染（双曲线支持）
        renderActiveCurve(data.dailyStats, data.chartDualTrackDisplay !== false);

        pendingData = data;
      }

      function setChecked(id, val) {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
      }
      function setValue(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = String(val);
      }

      function formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return m + 'm ' + sec + 's';
        return sec + 's';
      }

      // ---- 跨工作区对比视图渲染（R1：多工作区时长对比可视化） ----
      function renderWorkspaceCompare(workspaces, count, globalTotalMs) {
        const container = document.getElementById('workspaceList');
        const badgeEl = document.getElementById('globalTotalBadge');

        if (!workspaces || workspaces.length <= 1) {
          container.innerHTML = '<div class="chart-empty">' + L['panel.global.empty'] + '</div>';
          if (badgeEl) badgeEl.innerHTML = '';
          return;
        }

        // 单趟循环合并求最大值与总和，消除 reduce 闭包与多次遍历开销 (CPX-SPACE-001)
        let maxVal = 1;
        let sumTotal = 0;
        for (let i = 0; i < workspaces.length; i++) {
          const t = workspaces[i].totalMs || 0;
          if (t > maxVal) maxVal = t;
          sumTotal += t;
        }
        const grandTotal = globalTotalMs || sumTotal;

        // ★ 兜底：count 必须为有限数字，否则 fmt 会输出字面量占位符（如 "（{0} 个工作区）"）。
        //   宿主数据异常（旧版 globalState 缺 workspaces 字段）时以实际列表长度兜底。
        const wsCount = typeof count === 'number' && Number.isFinite(count)
            ? count
            : (Array.isArray(workspaces) ? workspaces.length : 0);

        if (badgeEl) {
          badgeEl.innerHTML = L['panel.js.grandTotalPrefix'] + '<strong>' + formatDuration(grandTotal) +
            '</strong><span class="ws-compare-count">' + fmt(L['panel.js.workspaceCountFmt'], wsCount) + '</span>';
        }

        // 循环流式字符串拼接，消除 new Array 堆分配与 .join('') (CPX-SPACE-001)
        let html = '';
        for (let i = 0; i < workspaces.length; i++) {
          const ws = workspaces[i];
          const totalMs = ws.totalMs || 0;
          const pct = Math.max((totalMs / maxVal) * 100, 2);
          const share = grandTotal > 0 ? Math.round((totalMs / grandTotal) * 100) : 0;
          const extraCls = i >= 5 ? ' ws-extra' : '';
          const escapedName = escapeHtml(ws.name);
          html +=
            '<div class="ws-compare-row' + extraCls + '">' +
              '<div class="ws-compare-header">' +
                '<div class="ws-compare-name" title="' + escapedName + '">' + escapedName + '</div>' +
                '<div class="ws-compare-value">' + formatDuration(totalMs) +
                  '<span class="ws-compare-share">' + share + '%</span></div>' +
              '</div>' +
              '<div class="ws-compare-track">' +
                '<div class="ws-compare-fill" style="--fill-scale:' + (pct / 100).toFixed(4) + ';"></div>' +
              '</div>' +
            '</div>';
        }

        if (workspaces.length > 5) {
          html += renderFoldToggle(
            'wsFoldToggle',
            isWsExpanded,
            L['panel.global.showLess'],
            L['panel.global.showMore'],
            workspaces.length
          );
        }

        container.innerHTML = html;
        container.classList.toggle('is-collapsed', workspaces.length > 5 && !isWsExpanded);

        if (workspaces.length > 5) {
          bindFoldToggle(
            'wsFoldToggle',
            container,
            function() {
              isWsExpanded = !isWsExpanded;
              return isWsExpanded;
            },
            function() {
              return {
                less: L['panel.global.showLess'],
                more: fmt(L['panel.global.showMore'], workspaces.length),
              };
            }
          );
        }
      }

      function escapeHtml(str) {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      // ---- 周报活跃曲线渲染（常驻展示，支持双轨同轴对比，5 级精细 Y 轴刻度）----
      function renderActiveCurve(dailyStats, isDualTrack) {
        const el = document.getElementById('activeCurve');
        const emptyEl = document.getElementById('chartEmpty');
        const weekTotalEl = document.getElementById('weekTotal');
        const legendEl = document.getElementById('acLegend');
        if (!el) return;

        if (typeof ResizeObserver !== 'undefined' && !activeCurveResizeObserver) {
          activeCurveResizeObserver = new ResizeObserver(entries => {
            for (let i = 0; i < entries.length; i++) {
              const rect = entries[i].contentRect;
              if (rect && rect.width > 0) {
                const w = Math.round(rect.width);
                if (Math.abs(w - cachedActiveCurveWidth) > 2) {
                  cachedActiveCurveWidth = w;
                  if (pendingData && pendingData.dailyStats) {
                    renderActiveCurve(pendingData.dailyStats, pendingData.chartDualTrackDisplay !== false);
                  }
                }
              }
            }
          });
          activeCurveResizeObserver.observe(el);
        }

        const data = dailyStats || [];
        const hasData = data.length > 0 && data.some(d => d.totalMs > 0);
        if (!hasData) {
          el.innerHTML = '';
          if (emptyEl) emptyEl.style.display = 'block';
          if (weekTotalEl) weekTotalEl.style.display = 'none';
          if (legendEl) legendEl.style.display = 'none';
          return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        // 动态读取容器真实宽度（尺寸缓存与 ResizeObserver 解耦，消除 FSL 强制同步布局）
        const rawW = cachedActiveCurveWidth || el.clientWidth || (el.parentElement ? el.parentElement.clientWidth : 960);
        if (rawW > 0) cachedActiveCurveWidth = rawW;
        const W = Math.max(Math.round(rawW - 32), 680);
        const H = 232;
        const PAD_LEFT = 56, PAD_RIGHT = 36;
        const PEAK_Y = 38;
        const BASE_Y = 168;
        const EFFECTIVE_H = BASE_Y - PEAK_Y; // 130px 有效曲线落差
        const DRAW_W = W - PAD_LEFT - PAD_RIGHT;

        // 单趟循环合并极值查找与求和，消除 reduce 闭包与 map 瞬态堆分配 (CPX-SPACE-001)
        let maxVal = 1;
        let peakIndex = 0;
        let totalMs = 0;
        for (let i = 0; i < data.length; i++) {
          const ms = data[i].totalMs || 0;
          totalMs += ms;
          if (ms > maxVal) maxVal = ms;
          if (ms > (data[peakIndex] ? (data[peakIndex].totalMs || 0) : 0)) {
            peakIndex = i;
          }
        }

        const dualTrack = isDualTrack !== false;
        if (legendEl) {
          legendEl.style.display = dualTrack ? 'inline-flex' : 'none';
        }

        // 计算各天数据点物理坐标 (cx, cy)
        const pts = data.map((d, i) => {
          const cx = PAD_LEFT + (i / (data.length - 1)) * DRAW_W;
          const cy = d.totalMs > 0 ? BASE_Y - (d.totalMs / maxVal) * EFFECTIVE_H : BASE_Y;
          return [cx, cy];
        });

        const ptsManual = dualTrack ? data.map((d, i) => {
          const cx = PAD_LEFT + (i / (data.length - 1)) * DRAW_W;
          const mMs = d.manualMs !== undefined ? d.manualMs : (d.totalMs || 0);
          const cy = mMs > 0 ? BASE_Y - (mMs / maxVal) * EFFECTIVE_H : BASE_Y;
          return [cx, cy];
        }) : pts;

        const ptsAi = dualTrack ? data.map((d, i) => {
          const cx = PAD_LEFT + (i / (data.length - 1)) * DRAW_W;
          const aMs = d.aiMs !== undefined ? d.aiMs : 0;
          const cy = aMs > 0 ? BASE_Y - (aMs / maxVal) * EFFECTIVE_H : BASE_Y;
          return [cx, cy];
        }) : [];

        // Fritsch-Carlson 单调三次 Hermite 样条算法（零下冲、零穿模、保单调性）
        function buildMonotonePath(pList, bY) {
          const n = pList.length;
          if (n < 2) return '';
          if (n === 2) {
            return 'M ' + pList[0][0].toFixed(1) + ',' + pList[0][1].toFixed(1) +
                   ' L ' + pList[1][0].toFixed(1) + ',' + pList[1][1].toFixed(1);
          }

          const dx = new Float64Array(n - 1);
          const delta = new Float64Array(n - 1);
          for (let i = 0; i < n - 1; i++) {
            const hx = pList[i + 1][0] - pList[i][0];
            const hy = pList[i + 1][1] - pList[i][1];
            dx[i] = hx;
            delta[i] = hx !== 0 ? hy / hx : 0;
          }

          const m = new Float64Array(n);
          m[0] = delta[0];
          m[n - 1] = delta[n - 2];
          for (let i = 1; i < n - 1; i++) {
            if (delta[i - 1] * delta[i] <= 0) {
              m[i] = 0;
            } else {
              m[i] = (delta[i - 1] + delta[i]) / 2;
            }
          }

          for (let i = 0; i < n - 1; i++) {
            if (Math.abs(delta[i]) < 1e-7) {
              m[i] = 0;
              m[i + 1] = 0;
              continue;
            }
            const alpha = m[i] / delta[i];
            const beta = m[i + 1] / delta[i];
            if (alpha < 0 || beta < 0) {
              if (alpha < 0) m[i] = 0;
              if (beta < 0) m[i + 1] = 0;
            } else {
              const hyp = alpha * alpha + beta * beta;
              if (hyp > 9) {
                const tau = 3 / Math.sqrt(hyp);
                m[i] = tau * alpha * delta[i];
                m[i + 1] = tau * beta * delta[i];
              }
            }
          }

          let pathResult = 'M ' + pList[0][0].toFixed(1) + ',' + pList[0][1].toFixed(1);
          for (let i = 0; i < n - 1; i++) {
            const currPt = pList[i];
            const nextPt = pList[i + 1];
            const h = dx[i];
            const c1x = currPt[0] + h / 3;
            let c1y = currPt[1] + (m[i] * h) / 3;
            const c2x = nextPt[0] - h / 3;
            let c2y = nextPt[1] - (m[i + 1] * h) / 3;

            // 零下冲防护：控制点 Y 不可超越基线
            if (c1y > bY) c1y = bY;
            if (c2y > bY) c2y = bY;

            pathResult += ' C ' + c1x.toFixed(1) + ',' + c1y.toFixed(1) +
                          ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) +
                          ' ' + nextPt[0].toFixed(1) + ',' + nextPt[1].toFixed(1);
          }
          return pathResult;
        }

        const linePath = buildMonotonePath(ptsManual, BASE_Y);
        const areaPath = linePath +
          ' L ' + ptsManual[ptsManual.length - 1][0].toFixed(1) + ',' + BASE_Y.toFixed(1) +
          ' L ' + ptsManual[0][0].toFixed(1) + ',' + BASE_Y.toFixed(1) + ' Z';

        let aiSvg = '';
        if (dualTrack && ptsAi.length > 0) {
          const lineAiPath = buildMonotonePath(ptsAi, BASE_Y);
          const areaAiPath = lineAiPath +
            ' L ' + ptsAi[ptsAi.length - 1][0].toFixed(1) + ',' + BASE_Y.toFixed(1) +
            ' L ' + ptsAi[0][0].toFixed(1) + ',' + BASE_Y.toFixed(1) + ' Z';
          aiSvg =
            '<path class="ac-area-ai" d="' + areaAiPath + '"></path>' +
            '<path class="ac-line-ai" d="' + lineAiPath + '"></path>';
        }

        // 5 级精细水平网格与左端参考刻度
        const yLevels = [
          { ratio: 1.0, val: maxVal, isBase: false },
          { ratio: 0.75, val: Math.round(maxVal * 0.75), isBase: false },
          { ratio: 0.50, val: Math.round(maxVal * 0.50), isBase: false },
          { ratio: 0.25, val: Math.round(maxVal * 0.25), isBase: false },
          { ratio: 0.0, val: 0, isBase: true },
        ];

        let gridSvg = '';
        for (let i = 0; i < yLevels.length; i++) {
          const lvl = yLevels[i];
          const y = BASE_Y - lvl.ratio * EFFECTIVE_H;
          const lineCls = lvl.isBase ? 'ac-grid-base' : 'ac-grid-line';
          const valText = lvl.val > 0 ? formatDuration(lvl.val) : '0';
          gridSvg +=
            '<line class="' + lineCls + '" x1="' + (PAD_LEFT - 10) + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD_RIGHT + 14) + '" y2="' + y.toFixed(1) + '"/>' +
            '<text class="ac-grid-label" fill="#ffffff" x="' + (PAD_LEFT - 16) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + valText + '</text>';
        }

        let elementsSvg = '';
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          const cx = pts[i][0];
          const cy = pts[i][1];
          const isPeak = i === peakIndex && d.totalMs > 0;
          const hasTime = d.totalMs > 0;
          const durStr = hasTime ? formatDuration(d.totalMs) : '0';

          const mMs = d.manualMs !== undefined ? d.manualMs : (d.totalMs || 0);
          const aMs = d.aiMs !== undefined ? d.aiMs : 0;
          let detailSub = '';
          if (dualTrack && hasTime && (mMs > 0 || aMs > 0)) {
            const mPct = Math.round((mMs / d.totalMs) * 100);
            const aPct = 100 - mPct;
            detailSub = (L['panel.weekly.legendManual'] || 'Manual') + ' ' + formatDuration(mMs) + ' ' + mPct + '% · ' +
                        (L['panel.weekly.legendAi'] || 'AI') + ' ' + formatDuration(aMs) + ' ' + aPct + '%';
          }

          let pillGroup = '';
          if (hasTime) {
            const pillY = Math.max(cy - 16, 15);
            const pillW = Math.max(durStr.length * 7.6 + 20, 56);
            const halfW = pillW / 2;
            const pillTextCls = isPeak ? 'ac-pill-text is-peak' : 'ac-pill-text';
            const pillBgCls = isPeak ? 'ac-pill-bg is-peak' : 'ac-pill-bg';
            const tipText = detailSub ? (durStr + ' (' + detailSub + ')') : durStr;
            const subElem = detailSub ? '<text class="ac-pill-sub" x="0" y="21">' + detailSub + '</text>' : '';
            pillGroup =
              '<g class="ac-pill-group" transform="translate(' + cx.toFixed(1) + ',' + pillY.toFixed(1) + ')">' +
                '<title>' + tipText + '</title>' +
                '<rect class="' + pillBgCls + '" x="-' + halfW.toFixed(1) + '" y="-13" width="' + pillW.toFixed(1) + '" height="22" rx="11"/>' +
                '<text class="' + pillTextCls + '" fill="#ffffff" x="0" y="2">' + durStr + '</text>' +
                subElem +
              '</g>';
          }

          let dotGroup = '';
          if (hasTime) {
            if (dualTrack) {
              const cyM = ptsManual[i][1];
              dotGroup +=
                '<g class="ac-dot-group manual' + (isPeak ? ' is-peak' : '') + '">' +
                  '<circle class="ac-dot-halo" cx="' + cx.toFixed(1) + '" cy="' + cyM.toFixed(1) + '" r="4.5"/>' +
                  '<circle class="ac-dot-core" cx="' + cx.toFixed(1) + '" cy="' + cyM.toFixed(1) + '" r="2.2"/>' +
                '</g>';
              if (aMs > 0 && ptsAi[i]) {
                const cyA = ptsAi[i][1];
                dotGroup +=
                  '<g class="ac-dot-group ai">' +
                    '<circle class="ac-dot-halo-ai" cx="' + cx.toFixed(1) + '" cy="' + cyA.toFixed(1) + '" r="4.5"/>' +
                    '<circle class="ac-dot-core-ai" cx="' + cx.toFixed(1) + '" cy="' + cyA.toFixed(1) + '" r="2.2"/>' +
                  '</g>';
              }
            } else {
              dotGroup =
                '<g class="ac-dot-group' + (isPeak ? ' is-peak' : '') + '">' +
                  '<circle class="ac-dot-halo" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5"/>' +
                  '<circle class="ac-dot-core" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.6"/>' +
                '</g>';
            }
          }

          // 底部双层 X 轴标尺
          const dateCls = 'ac-axis-date';
          const valCls = isPeak ? 'ac-axis-val is-peak' : (hasTime ? 'ac-axis-val' : 'ac-axis-val is-zero');
          const valFill = hasTime ? '#ffffff' : 'rgba(255, 255, 255, 0.55)';
          const axisGroup =
            '<text class="' + dateCls + '" fill="#ffffff" x="' + cx.toFixed(1) + '" y="196">' + escapeHtml(d.weekday) + '</text>' +
            '<text class="' + valCls + '" fill="' + valFill + '" x="' + cx.toFixed(1) + '" y="218">' + durStr + '</text>';

          elementsSvg += pillGroup + dotGroup + axisGroup;
        }

        const tip = L['panel.js.weekTotalPrefix'] + formatDuration(totalMs);

        if (weekTotalEl) {
          weekTotalEl.innerHTML = L['panel.js.weekTotalPrefix'] + '<strong>' + formatDuration(totalMs) + '</strong>';
          weekTotalEl.style.display = 'block';
        }

        el.innerHTML =
          '<svg class="ac-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
            '<defs>' +
              '<linearGradient id="acLineGradient" x1="0" y1="0" x2="1" y2="0">' +
                '<stop offset="0%" stop-color="#818cf8"/>' +
                '<stop offset="60%" stop-color="#38bdf8"/>' +
                '<stop offset="100%" stop-color="#34d399"/>' +
              '</linearGradient>' +
              '<linearGradient id="acGradient" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.28"/>' +
                '<stop offset="60%" stop-color="#818cf8" stop-opacity="0.08"/>' +
                '<stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>' +
              '</linearGradient>' +
              '<linearGradient id="acLineAiGradient" x1="0" y1="0" x2="1" y2="0">' +
                '<stop offset="0%" stop-color="#10b981"/>' +
                '<stop offset="100%" stop-color="#34d399"/>' +
              '</linearGradient>' +
              '<linearGradient id="acGradientAi" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0%" stop-color="#34d399" stop-opacity="0.22"/>' +
                '<stop offset="60%" stop-color="#10b981" stop-opacity="0.05"/>' +
                '<stop offset="100%" stop-color="#34d399" stop-opacity="0.0"/>' +
              '</linearGradient>' +
            '</defs>' +
            '<title>' + tip + '</title>' +
            gridSvg +
            '<path class="ac-area" d="' + areaPath + '"></path>' +
            aiSvg +
            '<path class="ac-line" d="' + linePath + '"></path>' +
            elementsSvg +
          '</svg>';
      }

      // ---- 活动时间线热力图渲染 ----
      // 数据：近 12 周按日格子（周一为首行，current 周未到的天标 future）
      function renderHeatmap(days) {
        const el = document.getElementById('heatmap');
        const rangeEl = document.getElementById('heatmapRange');
        if (!el) return;
        const data = days || [];
        if (data.length === 0) {
          el.innerHTML = '';
          if (rangeEl) rangeEl.textContent = '';
          return;
        }

        // 按 7 天一组切成「周」列，流式字符串拼接消除 weekCols 数组堆分配与 .join('') (CPX-SPACE-001)
        let heatmapHtml = '';
        for (let i = 0; i < data.length; i += 7) {
          let cellHtml = '';
          const end = Math.min(i + 7, data.length);
          for (let j = i; j < end; j++) {
            const d = data[j];
            const cls = 'hm-cell l' + d.level + (d.future ? ' future' : '');
            const tip = d.future ? d.dateStr : (d.dateStr + ' · ' + formatDuration(d.totalMs));
            cellHtml += '<div class="' + cls + '" title="' + tip + '"></div>';
          }
          heatmapHtml += '<div class="heatmap-week">' + cellHtml + '</div>';
        }
        el.innerHTML = heatmapHtml;

        // 日期范围（首日 ~ 末日）
        if (rangeEl) {
          rangeEl.textContent = data[0].dateStr + ' ~ ' + data[data.length - 1].dateStr;
        }
      }

      // ---- 周报指标（日均/活跃天/最活跃日） + 多周趋势渲染 ----
      function renderWeeklySummary(summary, trend, weeklyLimitEnabled, weeklyLimitHours) {
        const trendEl = document.getElementById('weeklyTrend');
        const metricsEl = document.getElementById('weeklyCurveMetrics');

        if (summary && summary.totalMs > 0) {
          if (metricsEl) metricsEl.style.display = 'flex';
          const sumAvgEl = document.getElementById('sumAvg');
          const sumActiveDaysEl = document.getElementById('sumActiveDays');
          const sumPeakDateEl = document.getElementById('sumPeakDate');
          if (sumAvgEl) sumAvgEl.textContent = formatDuration(summary.avgDailyMs);
          if (sumActiveDaysEl) sumActiveDaysEl.textContent = fmt(L['panel.js.daysFmt'], summary.activeDays);
          if (sumPeakDateEl) {
            sumPeakDateEl.textContent = summary.peakDate
              ? summary.peakDate + (summary.peakDateMs > 0 ? ' (' + formatDuration(summary.peakDateMs) + ')' : '')
              : '--';
          }
        } else if (metricsEl) {
          metricsEl.style.display = 'none';
        }

        // 多周趋势
        if (trend && trend.length > 0) {
          trendEl.style.display = 'block';
          const isLimitOn = Boolean(weeklyLimitEnabled) && typeof weeklyLimitHours === 'number' && Number.isFinite(weeklyLimitHours) && weeklyLimitHours >= 1 && weeklyLimitHours <= 168;
          const safeLimitHours = isLimitOn ? Math.min(168, Math.max(1, Math.round(weeklyLimitHours))) : 40;
          const limitMs = isLimitOn ? safeLimitHours * 3600000 : 0;
          let maxTrendMs = 0;
          for (let i = 0; i < trend.length; i++) {
            const tMs = trend[i].totalMs;
            if (Number.isFinite(tMs) && tMs > maxTrendMs) {
              maxTrendMs = tMs;
            }
          }

          // 达标点比例：居中靠右，默认处于总轨道宽度的 75% 处，右侧留出 25% 的超限预警缓冲空间
          const TARGET_DIVIDER_RATIO = 0.75;

          // 刻度上限计算：
          // 1. 开启周上限时：基准刻度按 limitMs / TARGET_DIVIDER_RATIO 缩放；若有超限周则按 maxTrendMs * 1.15 动态延展头部空间
          // 2. 未开启周上限时：按常规最大值 maxTrendMs 缩放
          const scaleMax = isLimitOn
            ? Math.max(limitMs / TARGET_DIVIDER_RATIO, maxTrendMs * 1.15, 1)
            : Math.max(maxTrendMs, 1);

          // 分割线百分比：未超限时精确位于 75%，超限时等比向左收敛
          const dividerPct = isLimitOn ? Math.min(95, Math.max(10, (limitMs / scaleMax) * 100)) : 0;

          let trendHtml = '';
          for (let i = 0; i < trend.length; i++) {
            const w = trend[i];
            const rawMs = (typeof w.totalMs === 'number' && Number.isFinite(w.totalMs) && w.totalMs > 0) ? w.totalMs : 0;
            const pct = Math.min(100, Math.max((rawMs / scaleMax) * 100, rawMs > 0 ? 2 : 0));
            const tooltip = w.weekEnd ? (w.weekStart + ' ~ ' + w.weekEnd) : w.weekStart;

            const fillScale = (pct / 100).toFixed(4);
            let fillClass = 'trend-fill';
            let fillStyle = '--fill-scale:' + fillScale + ';';
            let valueClass = 'trend-value';

            if (isLimitOn && rawMs > 0) {
              const ratio = rawMs / limitMs;
              if (ratio > 1.0) {
                // 越过分割线：红阶加深，高亮并外发光
                fillClass += ' is-over';
                valueClass += ' is-over';
                // 动态计算分割点在 fill 内部的相对百分比
                const splitAt = Math.min(95, Math.max(10, Math.round((1.0 / ratio) * 100)));
                fillStyle += 'background: linear-gradient(90deg, #38bdf8 0%, #f59e0b ' + Math.round(splitAt * 0.75) + '%, #ef4444 ' + splitAt + '%, #dc2626 100%);';
              } else if (ratio >= 0.7) {
                // 靠近分割线（70% ~ 100%）：朝分割线方向平滑变红
                fillStyle += 'background: linear-gradient(90deg, #38bdf8 0%, #3b82f6 40%, #f59e0b 75%, #ef4444 100%);';
              } else {
                // 安全区：现代清爽青蓝渐变
                fillStyle += 'background: linear-gradient(90deg, #38bdf8, #0ea5e9);';
              }
            }

            const dividerHtml = isLimitOn && dividerPct > 0
              ? '<div class="trend-divider-mark" style="left:' + dividerPct.toFixed(2) + '%" title="' + escapeHtml(fmt(L['panel.trend.limitMarker'], safeLimitHours + 'h')) + '"></div>'
              : '';

            trendHtml += '<div class="trend-row">' +
              '<div class="trend-label" title="' + escapeHtml(tooltip) + '">' + escapeHtml(w.label) + '</div>' +
              '<div class="trend-track">' +
                '<div class="' + fillClass + '" style="' + fillStyle + '"></div>' +
                dividerHtml +
              '</div>' +
              '<div class="' + valueClass + '">' + formatDuration(rawMs) + '</div>' +
              '</div>';
          }
          document.getElementById('trendList').innerHTML = trendHtml;
        } else {
          trendEl.style.display = 'none';
        }
      }

      // ---- 今日明细渲染 ----
      function renderTodayDetail(detail) {
        const section = document.getElementById('todaySection');
        const listEl = document.getElementById('sessionList');
        const emptyEl = document.getElementById('sessionEmpty');
        const hourlyEl = document.getElementById('hourlyChart');
        const hourlyTitle = document.getElementById('hourlyTitle');
        const hourlyAxis = document.getElementById('hourlyAxis');

        if (!detail || detail.sessionCount === 0) {
          section.style.display = 'none';
          return;
        }

        section.style.display = 'block';
        document.getElementById('todayDetailTotal').textContent = formatDuration(detail.totalMs);
        document.getElementById('todayDetailCount').textContent = String(detail.sessionCount);
        document.getElementById('todayDetailWindow').textContent = detail.activeWindow || '--';

        if (detail.sessions.length > 0) {
          emptyEl.style.display = 'none';
          listEl.style.display = 'block';

          let listHtml = '';
          const runningText = (typeof window !== 'undefined' && window.__I18N__ && window.__I18N__.panelTodayRunning) ||
            L['panel.today.running'] ||
            ((typeof window !== 'undefined' && window.__LOCALE__ === 'zh-CN') ? '进行中' : 'Running');

          for (let i = 0; i < detail.sessions.length; i++) {
            const s = detail.sessions[i];
            const extraCls = i >= 5 ? ' session-extra' : '';
            const isRunning = Boolean(s.isRunningTail || s.endLabel === '进行中' || s.endLabel === 'Running');
            const endText = isRunning ? runningText : escapeHtml(s.endLabel);
            listHtml +=
              '<div class="session-row' + extraCls + '">' +
                '<div class="session-time">' + escapeHtml(s.startLabel) + ' → ' + endText + '</div>' +
                '<div class="session-dur">' + formatDuration(s.durationMs) + '</div>' +
              '</div>';
          }

          if (detail.sessions.length > 5) {
            listHtml += renderFoldToggle(
              'sessionFoldToggle',
              isTodaySessionsExpanded,
              L['panel.today.showLess'],
              L['panel.today.showMore'],
              detail.sessions.length
            );
          }

          listEl.innerHTML = listHtml;
          listEl.classList.toggle('is-collapsed', detail.sessions.length > 5 && !isTodaySessionsExpanded);

          if (detail.sessions.length > 5) {
            bindFoldToggle(
              'sessionFoldToggle',
              listEl,
              function() {
                isTodaySessionsExpanded = !isTodaySessionsExpanded;
                return isTodaySessionsExpanded;
              },
              function() {
                return {
                  less: L['panel.today.showLess'],
                  more: fmt(L['panel.today.showMore'], detail.sessions.length),
                };
              }
            );
          }
        } else {
          listEl.style.display = 'none';
          emptyEl.style.display = 'block';
        }

        // 按小时分布（24 根柱，支持双色垂直堆叠）
        renderHourly(detail.hourly, detail.peakHour, hourlyEl, hourlyTitle, hourlyAxis, isDualTrack);
      }

      // ---- 按小时分布柱状图 ----
      let currentHourlyBadgeDefault = '';

      function renderHourly(hourly, peakHour, el, titleEl, axisEl, isDualTrack) {
        const wrapper = document.getElementById('hourlyWrapper');
        const badgeEl = document.getElementById('hourlyBadge');
        if (!el || !titleEl) return;
        const buckets = hourly || [];
        if (buckets.length === 0) {
          if (wrapper) wrapper.style.display = 'none';
          el.style.display = 'none';
          titleEl.style.display = 'none';
          if (axisEl) axisEl.style.display = 'none';
          return;
        }
        if (wrapper) wrapper.style.display = 'block';
        titleEl.style.display = 'block';
        el.style.display = 'flex';

        // 展开为 0..23 的类型化数组（缺省小时为 0），单趟循环合并填充与极值统计 (CPX-SPACE-001)
        const hours = new Float64Array(24);
        const hoursManual = new Float64Array(24);
        const hoursAi = new Float64Array(24);
        let maxVal = 1;
        for (let i = 0; i < buckets.length; i++) {
          const b = buckets[i];
          if (b.hour >= 0 && b.hour <= 23) {
            const tot = b.totalMs || 0;
            hours[b.hour] = tot;
            hoursManual[b.hour] = b.manualMs !== undefined ? b.manualMs : tot;
            hoursAi[b.hour] = b.aiMs !== undefined ? b.aiMs : 0;
            if (tot > maxVal) maxVal = tot;
          }
        }

        const peakMs = (peakHour !== undefined && peakHour >= 0 && peakHour < 24) ? hours[peakHour] : 0;
        const peakHourStr = peakHour !== undefined && peakHour >= 0 ? String(peakHour).padStart(2, '0') + ':00' : '';
        const defaultBadgeText = (peakMs > 0 && peakHourStr)
          ? L['panel.today.hourlyPeak'] + ': ' + peakHourStr + ' · ' + formatDuration(peakMs)
          : L['panel.today.hourlyOverview'];

        currentHourlyBadgeDefault = defaultBadgeText;
        if (badgeEl && !el.__isHoveringSlot) badgeEl.textContent = defaultBadgeText;

        // 父容器事件委托（仅绑定一次，彻底消除 48 个独立闭包注册）
        if (!el.__hasHourlyDelegation) {
          el.__hasHourlyDelegation = true;
          el.__isHoveringSlot = false;
          el.addEventListener('mouseover', (e) => {
            const slot = e.target.closest('.hourly-slot');
            if (slot && el.contains(slot)) {
              el.__isHoveringSlot = true;
              if (badgeEl) {
                const tr = slot.getAttribute('data-timerange') || '';
                const dur = slot.getAttribute('data-dur') || '';
                badgeEl.textContent = tr + ' · ' + dur;
              }
            } else {
              el.__isHoveringSlot = false;
              if (badgeEl) badgeEl.textContent = currentHourlyBadgeDefault;
            }
          });
          el.addEventListener('mouseleave', () => {
            el.__isHoveringSlot = false;
            if (badgeEl) badgeEl.textContent = currentHourlyBadgeDefault;
          });
        }

        const dualTrack = isDualTrack !== false;
        const canPatch = el.children.length === 24 && Boolean(el.__isDualTrack) === dualTrack;
        el.__isDualTrack = dualTrack;
        let hourlyHtml = '';

        for (let h = 0; h < 24; h++) {
          const ms = hours[h];
          const mMs = hoursManual[h];
          const aMs = hoursAi[h];
          const pct = ms > 0 ? Math.max((ms / maxVal) * 100, 6) : 0;
          const scale = (pct / 100).toFixed(4);
          const manualScale = (ms > 0 ? (mMs / maxVal) : 0).toFixed(4);
          const aiScale = (ms > 0 ? (aMs / maxVal) : 0).toFixed(4);

          const isPeak = (ms > 0 && h === peakHour) ? ' is-peak' : '';
          const isPeakSlot = (ms > 0 && h === peakHour) ? ' is-peak-slot' : '';
          const hasAct = ms > 0 ? ' has-activity' : '';
          const isPeriodDivider = (h === 3 || h === 7 || h === 11 || h === 15 || h === 19) ? ' has-period-divider' : '';

          const curH = String(h).padStart(2, '0') + ':00';
          const nextH = String(h + 1).padStart(2, '0') + ':00';
          const timeRange = curH + ' - ' + nextH;
          const durStr = ms > 0 ? formatDuration(ms) : L['panel.today.hourlyIdle'];

          let dualDetailTag = '';
          if (dualTrack && ms > 0 && (mMs > 0 || aMs > 0)) {
            const mPct = Math.round((mMs / ms) * 100);
            const aPct = 100 - mPct;
            dualDetailTag = ' (' + (L['panel.weekly.legendManual'] || 'Manual') + ' ' + formatDuration(mMs) + ' ' + mPct + '% · ' +
                            (L['panel.weekly.legendAi'] || 'AI') + ' ' + formatDuration(aMs) + ' ' + aPct + '%)';
          }

          const peakTag = (ms > 0 && h === peakHour) ? ' (' + L['panel.today.hourlyPeak'] + ')' : '';
          const fullDurInfo = durStr + dualDetailTag + peakTag;
          const tip = timeRange + ' : ' + fullDurInfo;
          const slotCls = 'hourly-slot' + isPeakSlot + hasAct + isPeriodDivider;

          if (canPatch) {
            const slot = el.children[h];
            if (slot.className !== slotCls) slot.className = slotCls;
            slot.setAttribute('data-timerange', timeRange);
            slot.setAttribute('data-dur', fullDurInfo);
            slot.title = tip;
            const bar = slot.querySelector('.hourly-bar');
            if (bar) {
              if (dualTrack) {
                bar.style.setProperty('--manual-scale', manualScale);
                bar.style.setProperty('--ai-scale', aiScale);
              } else {
                const barCls = 'hourly-bar' + isPeak;
                if (bar.className !== barCls) bar.className = barCls;
                bar.style.setProperty('--bar-scale', scale);
              }
            }
          } else {
            let barInnerHtml = '';
            if (dualTrack) {
              barInnerHtml =
                '<div class="hourly-bar is-stacked" style="--manual-scale:' + manualScale + ';--ai-scale:' + aiScale + ';">' +
                  '<div class="hourly-bar-manual"></div>' +
                  '<div class="hourly-bar-ai"></div>' +
                '</div>';
            } else {
              barInnerHtml = '<div class="hourly-bar' + isPeak + '" style="--bar-scale:' + scale + ';"></div>';
            }
            hourlyHtml += '<div class="' + slotCls + '" data-timerange="' + timeRange + '" data-dur="' + fullDurInfo + '" title="' + tip + '">' +
              '<div class="hourly-slot-track">' +
                barInnerHtml +
              '</div>' +
              '<div class="hourly-slot-base"></div>' +
            '</div>';
          }
        }

        if (!canPatch) {
          el.innerHTML = hourlyHtml;
        }

        // 连续物理标尺：7 锚点精准对齐（00:00, 04:00, 08:00, 12:00, 16:00, 20:00, 24:00）
        if (axisEl) {
          axisEl.style.display = 'block';
          if (!axisEl.__hasRendered) {
            axisEl.__hasRendered = true;
            const anchors = [
              { pct: 0, label: '00:00', posClass: 'is-start' },
              { pct: 16.6667, label: '04:00', posClass: 'is-mid' },
              { pct: 33.3333, label: '08:00', posClass: 'is-mid' },
              { pct: 50.0000, label: '12:00', posClass: 'is-mid is-noon' },
              { pct: 66.6667, label: '16:00', posClass: 'is-mid' },
              { pct: 83.3333, label: '20:00', posClass: 'is-mid' },
              { pct: 100.000, label: '24:00', posClass: 'is-end' }
            ];

            axisEl.innerHTML = '<div class="hourly-axis-line"></div>' +
              anchors.map(a => {
                const posStyle = a.posClass.includes('is-start')
                  ? 'left:0;'
                  : (a.posClass.includes('is-end') ? 'right:0;' : 'left:' + a.pct + '%;');
                return '<div class="hourly-notch-group ' + a.posClass + '" style="' + posStyle + '">' +
                  '<div class="hourly-notch"></div>' +
                  '<div class="hourly-tick-label">' + a.label + '</div>' +
                '</div>';
              }).join('');
          }
        }
      }

      // 通信契约：Webview 与扩展宿主双向 postMessage 通信管道
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'updateData' && msg.payload) {
          updateUI(msg.payload);
        }
      });

      // 配置契约：向扩展宿主分发实时配置变更消息 (updateConfig)
      function sendUpdate(key, value) {
        vscode.postMessage({ type: 'updateConfig', payload: { [key]: value } });
      }

      // 表单契约：布尔开关状态变更事件绑定与即时同步
      document.querySelectorAll('.toggle input[type="checkbox"]').forEach(el => {
        el.addEventListener('change', () => {
          sendUpdate(el.dataset.key, el.checked);
        });
      });

      // 语言契约：语言下拉菜单变更（显式热切换并触发宿主重新渲染面板）
      document.getElementById('selLocale').addEventListener('change', (e) => {
        sendUpdate('locale', e.target.value);
      });

      // 数值契约：数字输入防抖钳制变更（遵循 min/max 区间合法域不变量）
      document.querySelectorAll('.number-input').forEach(el => {
        let timeout = null;
        el.addEventListener('input', () => {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            const raw = parseInt(el.value, 10);
            if (Number.isNaN(raw)) return;
            const min = el.min ? parseInt(el.min, 10) : 0;
            const max = el.max ? parseInt(el.max, 10) : Number.MAX_SAFE_INTEGER;
            sendUpdate(el.dataset.key, Math.min(Math.max(raw, min), max));
          }, 500);
        });
      });

      // 交互契约：面板核心破坏性与导出动作按钮事件绑定
      document.getElementById('btnNewPeriod').addEventListener('click', () => {
        vscode.postMessage({ type: 'newPeriod' });
        showToast(L['panel.toast.newPeriodRequested']);
      });

      document.getElementById('btnExportCSV').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportCSV' });
        showToast(L['panel.toast.exportCsvRequested']);
      });

      document.getElementById('btnReset').addEventListener('click', () => {
        if (confirm(L['confirm.reset'])) {
          vscode.postMessage({ type: 'reset' });
          showToast(L['panel.toast.resetRequested']);
        }
      });

      // 清理契约：清除历史明细（保留累计时间总计与今日工时）
      document.getElementById('btnClearHistory').addEventListener('click', () => {
        if (confirm(L['confirm.clearHistory'])) {
          vscode.postMessage({ type: 'clearHistory' });
          showToast(L['panel.toast.clearHistoryRequested']);
        }
      });

      // 报表契约：导出多维全历史日报聚合 CSV 数据流水
      document.getElementById('btnExportAggregated').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportAggregated' });
        showToast(L['panel.toast.exportAggregatedRequested']);
      });

      // 报表契约：按需导出结构化 Markdown 日报或周报
      document.getElementById('btnExportDaily').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportReport', payload: { kind: 'daily' } });
        showToast(L['panel.toast.exportDailyRequested']);
      });
      document.getElementById('btnExportWeekly').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportReport', payload: { kind: 'weekly' } });
        showToast(L['panel.toast.exportWeeklyRequested']);
      });

      let resizeTimer = null;
      window.addEventListener('resize', () => {
        if (pendingData && pendingData.dailyStats) {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => renderActiveCurve(pendingData.dailyStats), 80);
        }
      });

      // 通知契约：面板内非阻塞浮动 Toast 提示组件
      function showToast(msg) {
        const toast = document.getElementById('statusToast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
      }
    })();
`;
}
