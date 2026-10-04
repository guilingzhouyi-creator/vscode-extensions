/**
 * 模块归属: presentation (仪表盘前端交互运行时脚本)
 * 文件路径: workspace-timing/src/presentation/dashboard-script.ts
 * 架构定位: 面板 Webview 客户端交互与图表渲染脚本生成器
 * 职责说明: 负责动态 SVG 曲线生成、热力图矩阵渲染、跨工作区对比与双向事件调度。
 */

export function buildDashboardScript(labels: Record<string, string>): string {
    return /* javascript */ `
    (function() {
      const vscode = acquireVsCodeApi();
      // 词条表（渲染时由扩展宿主按当前语言序列化注入）
      const L = ${JSON.stringify(labels)};
      // {0}/{1} 占位符格式化（与宿主 i18n format 语义一致；curveSegTip 等词条含双占位符）
      function fmt(tpl) {
        const args = Array.prototype.slice.call(arguments, 1);
        return String(tpl).replace(/{([0-9]+)}/g, function(_, idx) {
          const i = parseInt(idx, 10);
          return args[i] !== undefined ? String(args[i]) : '{' + idx + '}';
        });
      }
      let pendingData = null;

      // ---- 更新 UI ----
      function updateUI(data) {
        // 统计卡片
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

        // 设置项
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

        // 跨工作区对比视图
        renderWorkspaceCompare(data.workspaceList, data.workspaceCount, data.globalTotalMs);

        // 周报指标（日均/活跃天/最活跃日） + 多周趋势 + 今日明细
        renderWeeklySummary(data.weeklySummary, data.weeklyTrend, data.weeklyLimitEnabled, data.weeklyLimitHours);
        renderTodayDetail(data.todayDetail);

        // 活动时间线热力图
        renderHeatmap(data.heatmap);

        // 周报曲线（常驻展示，细化 Y 轴刻度）
        renderActiveCurve(data.dailyStats);

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

        if (!workspaces || workspaces.length <= 1) {
          container.innerHTML = '<div class="chart-empty">' + L['panel.global.empty'] + '</div>';
          return;
        }

        // 大数组防护：workspaces 数量无上限，用循环求最大而非 Math.max(...spread)（防栈溢出）
        let maxVal = 1;
        for (const ws of workspaces) {
          if (ws.totalMs > maxVal) maxVal = ws.totalMs;
        }
        const grandTotal = globalTotalMs || workspaces.reduce((sum, ws) => sum + (ws.totalMs || 0), 0);

        let html = '';
        for (const ws of workspaces) {
          const pct = Math.max((ws.totalMs / maxVal) * 100, 2);
          const share = grandTotal > 0 ? Math.round((ws.totalMs / grandTotal) * 100) : 0;
          html +=
            '<div class="ws-compare-row">' +
              '<div class="ws-compare-header">' +
                '<div class="ws-compare-name" title="' + escapeHtml(ws.name) + '">' + escapeHtml(ws.name) + '</div>' +
                '<div class="ws-compare-value">' + formatDuration(ws.totalMs) +
                  '<span class="ws-compare-share">' + share + '%</span></div>' +
              '</div>' +
              '<div class="ws-compare-track">' +
                '<div class="ws-compare-fill" style="width:' + pct + '%"></div>' +
              '</div>' +
            '</div>';
        }

        // ★ 兜底：count 必须为有限数字，否则 fmt 会输出字面量占位符（如 "（{0} 个工作区）"）。
        //   宿主数据异常（旧版 globalState 缺 workspaces 字段）时以实际列表长度兜底。
        const wsCount = typeof count === 'number' && Number.isFinite(count)
            ? count
            : (Array.isArray(workspaces) ? workspaces.length : 0);

        html +=
          '<div class="ws-compare-total">' + L['panel.js.grandTotalPrefix'] + '<strong>' + formatDuration(grandTotal) +
          '</strong><span class="ws-compare-count">' + fmt(L['panel.js.workspaceCountFmt'], wsCount) + '</span></div>';

        container.innerHTML = html;
      }

      function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      }

      // ---- 周报活跃曲线渲染（常驻展示，5 级精细 Y 轴刻度，对标高级可视化）----
      function renderActiveCurve(dailyStats) {
        const el = document.getElementById('activeCurve');
        const emptyEl = document.getElementById('chartEmpty');
        const weekTotalEl = document.getElementById('weekTotal');
        if (!el) return;

        const data = dailyStats || [];
        const hasData = data.length > 0 && data.some(d => d.totalMs > 0);
        if (!hasData) {
          el.innerHTML = '';
          if (emptyEl) emptyEl.style.display = 'block';
          if (weekTotalEl) weekTotalEl.style.display = 'none';
          return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        // 动态读取容器真实宽度，铺满整个面板横向空间，留足顶部胶囊与底部双层标尺高度
        const rawW = el.clientWidth || (el.parentElement ? el.parentElement.clientWidth : 960);
        const W = Math.max(Math.round(rawW - 32), 680);
        const H = 232;
        const PAD_LEFT = 56, PAD_RIGHT = 36;
        const PEAK_Y = 38;
        const BASE_Y = 168;
        const EFFECTIVE_H = BASE_Y - PEAK_Y; // 130px 有效曲线落差
        const DRAW_W = W - PAD_LEFT - PAD_RIGHT;

        const maxVal = Math.max(...data.map(d => d.totalMs), 1);
        const peakIndex = data.reduce((maxI, d, i, arr) => d.totalMs > arr[maxI].totalMs ? i : maxI, 0);

        // 计算各天数据点物理坐标 (cx, cy)
        const pts = data.map((d, i) => {
          const cx = PAD_LEFT + (i / (data.length - 1)) * DRAW_W;
          const cy = d.totalMs > 0
            ? BASE_Y - (d.totalMs / maxVal) * EFFECTIVE_H
            : BASE_Y;
          return [cx, cy];
        });

        // Fritsch-Carlson 单调三次 Hermite 样条算法（零下冲、零穿模、保单调性）
        function buildMonotonePath(pList, bY) {
          const n = pList.length;
          if (n < 2) return '';
          if (n === 2) {
            return 'M ' + pList[0][0].toFixed(1) + ',' + pList[0][1].toFixed(1) +
                   ' L ' + pList[1][0].toFixed(1) + ',' + pList[1][1].toFixed(1);
          }

          const dx = [];
          const dy = [];
          const delta = [];
          for (let i = 0; i < n - 1; i++) {
            dx[i] = pList[i + 1][0] - pList[i][0];
            dy[i] = pList[i + 1][1] - pList[i][1];
            delta[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
          }

          const m = new Array(n);
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

          let path = 'M ' + pList[0][0].toFixed(1) + ',' + pList[0][1].toFixed(1);
          for (let i = 0; i < n - 1; i++) {
            const p1 = pList[i];
            const p2 = pList[i + 1];
            const h = dx[i];
            const c1x = p1[0] + h / 3;
            let c1y = p1[1] + (m[i] * h) / 3;
            const c2x = p2[0] - h / 3;
            let c2y = p2[1] - (m[i + 1] * h) / 3;

            // 零下冲防护：控制点 Y 不可超越基线
            if (c1y > bY) c1y = bY;
            if (c2y > bY) c2y = bY;

            path += ' C ' + c1x.toFixed(1) + ',' + c1y.toFixed(1) +
                    ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) +
                    ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
          }
          return path;
        }

        const linePath = buildMonotonePath(pts, BASE_Y);
        const areaPath = linePath +
          ' L ' + pts[pts.length - 1][0].toFixed(1) + ',' + BASE_Y.toFixed(1) +
          ' L ' + pts[0][0].toFixed(1) + ',' + BASE_Y.toFixed(1) + ' Z';

        // 5 级精细水平网格与左端参考刻度（0%, 25%, 50%, 75%, 100% 精细划分，显式 fill="#ffffff" 确保亮白清晰）
        const yLevels = [
          { ratio: 1.0, val: maxVal, isBase: false },
          { ratio: 0.75, val: Math.round(maxVal * 0.75), isBase: false },
          { ratio: 0.50, val: Math.round(maxVal * 0.50), isBase: false },
          { ratio: 0.25, val: Math.round(maxVal * 0.25), isBase: false },
          { ratio: 0.0, val: 0, isBase: true },
        ];

        const gridSvg = yLevels.map(lvl => {
          const y = BASE_Y - lvl.ratio * EFFECTIVE_H;
          const lineCls = lvl.isBase ? 'ac-grid-base' : 'ac-grid-line';
          const valText = lvl.val > 0 ? formatDuration(lvl.val) : '0';
          return (
            '<line class="' + lineCls + '" x1="' + (PAD_LEFT - 10) + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD_RIGHT + 14) + '" y2="' + y.toFixed(1) + '"/>' +
            '<text class="ac-grid-label" fill="#ffffff" x="' + (PAD_LEFT - 16) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + valText + '</text>'
          );
        }).join('');

        // 7 组悬浮胶囊数值标签 + 同心圆节点 + 底部双层 X 轴标尺
        const elementsSvg = data.map((d, i) => {
          const cx = pts[i][0];
          const cy = pts[i][1];
          const isPeak = i === peakIndex && d.totalMs > 0;
          const hasTime = d.totalMs > 0;
          const durStr = hasTime ? formatDuration(d.totalMs) : '0';

          // 悬浮胶囊标签：仅在有工时的活跃日展示，彻底消除 0 值平原的药丸堆积（鲜亮纯白字体）
          let pillGroup = '';
          if (hasTime) {
            const pillY = Math.max(cy - 16, 15);
            const pillW = Math.max(durStr.length * 7.6 + 20, 56);
            const halfW = pillW / 2;
            const pillTextCls = isPeak ? 'ac-pill-text is-peak' : 'ac-pill-text';
            const pillBgCls = isPeak ? 'ac-pill-bg is-peak' : 'ac-pill-bg';
            pillGroup =
              '<g class="ac-pill-group" transform="translate(' + cx.toFixed(1) + ',' + pillY.toFixed(1) + ')">' +
                '<rect class="' + pillBgCls + '" x="-' + halfW.toFixed(1) + '" y="-13" width="' + pillW.toFixed(1) + '" height="22" rx="11"/>' +
                '<text class="' + pillTextCls + '" fill="#ffffff" x="0" y="2">' + durStr + '</text>' +
              '</g>';
          }

          // 数据节点：0 工时日绝不画圆圈！仅活跃日绘制精致白核发光点
          let dotGroup = '';
          if (hasTime) {
            dotGroup =
              '<g class="ac-dot-group' + (isPeak ? ' is-peak' : '') + '">' +
                '<circle class="ac-dot-halo" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5"/>' +
                '<circle class="ac-dot-core" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.6"/>' +
              '</g>';
          }

          // 底部双层 X 轴标尺（第一行周几鲜亮纯白，第二行对应数值鲜亮纯白）
          const dateCls = 'ac-axis-date';
          const valCls = isPeak ? 'ac-axis-val is-peak' : (hasTime ? 'ac-axis-val' : 'ac-axis-val is-zero');
          const valFill = hasTime ? '#ffffff' : 'rgba(255, 255, 255, 0.55)';
          const axisGroup =
            '<text class="' + dateCls + '" fill="#ffffff" x="' + cx.toFixed(1) + '" y="196">' + escapeHtml(d.weekday) + '</text>' +
            '<text class="' + valCls + '" fill="' + valFill + '" x="' + cx.toFixed(1) + '" y="218">' + durStr + '</text>';

          return pillGroup + dotGroup + axisGroup;
        }).join('');

        const totalMs = data.reduce((s, d) => s + d.totalMs, 0);
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
            '</defs>' +
            '<title>' + tip + '</title>' +
            gridSvg +
            '<path class="ac-area" d="' + areaPath + '"></path>' +
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

        // 按 7 天一组切成「周」列（数据已按周一为首行排布）
        const weeks = [];
        for (let i = 0; i < data.length; i += 7) {
          weeks.push(data.slice(i, i + 7));
        }
        el.innerHTML = weeks.map(week =>
          '<div class="heatmap-week">' + week.map(d => {
            const cls = 'hm-cell l' + d.level + (d.future ? ' future' : '');
            const tip = d.future ? d.dateStr : (d.dateStr + ' · ' + formatDuration(d.totalMs));
            return '<div class="' + cls + '" title="' + tip + '"></div>';
          }).join('') + '</div>'
        ).join('');

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
          const maxTrendMs = Math.max(...trend.map(w => (Number.isFinite(w.totalMs) && w.totalMs > 0 ? w.totalMs : 0)), 0);

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

          document.getElementById('trendList').innerHTML = trend.map(w => {
            const rawMs = (typeof w.totalMs === 'number' && Number.isFinite(w.totalMs) && w.totalMs > 0) ? w.totalMs : 0;
            const pct = Math.min(100, Math.max((rawMs / scaleMax) * 100, rawMs > 0 ? 2 : 0));
            const tooltip = w.weekEnd ? (w.weekStart + ' ~ ' + w.weekEnd) : w.weekStart;

            let fillClass = 'trend-fill';
            let fillStyle = 'width:' + pct.toFixed(2) + '%;';
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

            return '<div class="trend-row">' +
              '<div class="trend-label" title="' + escapeHtml(tooltip) + '">' + escapeHtml(w.label) + '</div>' +
              '<div class="trend-track">' +
                '<div class="' + fillClass + '" style="' + fillStyle + '"></div>' +
                dividerHtml +
              '</div>' +
              '<div class="' + valueClass + '">' + formatDuration(rawMs) + '</div>' +
              '</div>';
          }).join('');
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
          listEl.innerHTML = detail.sessions.map(s =>
            '<div class="session-row">' +
              '<div class="session-time">' + escapeHtml(s.startLabel) + ' → ' + escapeHtml(s.endLabel) + '</div>' +
              '<div class="session-dur">' + formatDuration(s.durationMs) + '</div>' +
            '</div>'
          ).join('');
        } else {
          listEl.style.display = 'none';
          emptyEl.style.display = 'block';
        }

        // 按小时分布（24 根柱，峰值小时高亮）
        renderHourly(detail.hourly, detail.peakHour, hourlyEl, hourlyTitle, hourlyAxis);
      }

      // ---- 按小时分布柱状图 ----
      function renderHourly(hourly, peakHour, el, titleEl, axisEl) {
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

        // 展开为 0..23 的数组（缺省小时为 0）
        const hours = new Array(24).fill(0);
        for (const b of buckets) {
          if (b.hour >= 0 && b.hour <= 23) hours[b.hour] = b.totalMs;
        }
        const maxVal = Math.max(...hours, 1);

        const peakMs = (peakHour !== undefined && peakHour >= 0 && peakHour < 24) ? hours[peakHour] : 0;
        const peakHourStr = peakHour !== undefined && peakHour >= 0 ? String(peakHour).padStart(2, '0') + ':00' : '';
        const defaultBadgeText = (peakMs > 0 && peakHourStr)
          ? L['panel.today.hourlyPeak'] + ': ' + peakHourStr + ' · ' + formatDuration(peakMs)
          : L['panel.today.hourlyOverview'];

        if (badgeEl) badgeEl.textContent = defaultBadgeText;

        // 渲染 24 个槽位骨架（每个包含底轨、立柱、基线指示，并在每 4 小时边界处添加段落分隔）
        el.innerHTML = hours.map((ms, h) => {
          const pct = ms > 0 ? Math.max((ms / maxVal) * 100, 6) : 0;
          const isPeak = (ms > 0 && h === peakHour) ? ' is-peak' : '';
          const isPeakSlot = (ms > 0 && h === peakHour) ? ' is-peak-slot' : '';
          const hasAct = ms > 0 ? ' has-activity' : '';
          const isPeriodDivider = (h === 3 || h === 7 || h === 11 || h === 15 || h === 19) ? ' has-period-divider' : '';

          const curH = String(h).padStart(2, '0') + ':00';
          const nextH = String(h + 1).padStart(2, '0') + ':00';
          const timeRange = curH + ' - ' + nextH;
          const durStr = ms > 0 ? formatDuration(ms) : L['panel.today.hourlyIdle'];
          const peakTag = (ms > 0 && h === peakHour) ? ' (' + L['panel.today.hourlyPeak'] + ')' : '';
          const tip = timeRange + ' : ' + durStr + peakTag;

          return '<div class="hourly-slot' + isPeakSlot + hasAct + isPeriodDivider + '" data-timerange="' + timeRange + '" data-dur="' + durStr + peakTag + '" title="' + tip + '">' +
            '<div class="hourly-slot-track">' +
              '<div class="hourly-bar' + isPeak + '" style="height:' + pct + '%"></div>' +
            '</div>' +
            '<div class="hourly-slot-base"></div>' +
          '</div>';
        }).join('');

        // 槽位鼠标悬停交互：顶部徽章动态联动
        const slots = el.querySelectorAll('.hourly-slot');
        slots.forEach(slot => {
          slot.addEventListener('mouseenter', () => {
            if (badgeEl) {
              const tr = slot.getAttribute('data-timerange') || '';
              const dur = slot.getAttribute('data-dur') || '';
              badgeEl.textContent = tr + ' · ' + dur;
            }
          });
          slot.addEventListener('mouseleave', () => {
            if (badgeEl) {
              badgeEl.textContent = defaultBadgeText;
            }
          });
        });

        // 连续物理标尺：7 锚点精准对齐（00:00, 04:00, 08:00, 12:00, 16:00, 20:00, 24:00）
        if (axisEl) {
          axisEl.style.display = 'block';
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

      // ---- 消息通信 ----
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'updateData' && msg.payload) {
          updateUI(msg.payload);
        }
      });

      // ---- 发送配置变更 ----
      function sendUpdate(key, value) {
        vscode.postMessage({ type: 'updateConfig', payload: { [key]: value } });
      }

      // 复选框变更
      document.querySelectorAll('.toggle input[type="checkbox"]').forEach(el => {
        el.addEventListener('change', () => {
          sendUpdate(el.dataset.key, el.checked);
        });
      });

      // 语言选择变更（显式 i18n 切换；宿主收到后热生效并重建面板）
      document.getElementById('selLocale').addEventListener('change', (e) => {
        sendUpdate('locale', e.target.value);
      });

      // 数字输入变更（按输入框 min/max 钳制；空/非法输入不发送，宿主端亦有下限兜底）
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

      // ---- 操作按钮 ----
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

      // 清除历史（保留累计数字）
      document.getElementById('btnClearHistory').addEventListener('click', () => {
        if (confirm(L['confirm.clearHistory'])) {
          vscode.postMessage({ type: 'clearHistory' });
          showToast(L['panel.toast.clearHistoryRequested']);
        }
      });

      // 导出聚合数据（全历史日报 CSV）
      document.getElementById('btnExportAggregated').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportAggregated' });
        showToast(L['panel.toast.exportAggregatedRequested']);
      });

      // 导出日报 / 周报
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

      // ---- Toast 提示 ----
      function showToast(msg) {
        const toast = document.getElementById('statusToast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
      }
    })();
`;
}
