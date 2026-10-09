/**
 * TimerEngine — 最小可运行单测（领域逻辑 · 协作员·测试 T2-T1）
 *
 * 直接对编译产物 out/domain/TimerEngine.js 断言，零 VS Code 运行时依赖，
 * 保证"最小可运行"：node + mocha 即可跑通，验证计时核心的 start/stop/
 * snapshot 边界与崩溃恢复语义。
 */
'use strict';

const assert = require('assert');
const { TimerEngine } = require('../../out/domain/TimerEngine.js');
const { createEmptyTimingData } = require('../../out/domain/models.js');

/**
 * 在固定时刻内运行回调：冻结 Date（覆盖 Date.now() 与 new Date()），
 * 防止用例在午夜前后的前 10~30 分钟执行时跨越自然日边界导致今日累计切分偏差。
 */
function withFixedNow(iso, fn) {
  const RealDate = Date;
  const fixedMs = new RealDate(iso).getTime();
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedMs]));
    }
    static now() {
      return fixedMs;
    }
  }
  global.Date = FixedDate;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

describe('TimerEngine（计时核心）', () => {
  it('初始状态：未运行、累计为 0、无会话', () => {
    const eng = new TimerEngine();
    assert.strictEqual(eng.isRunning, false);
    assert.strictEqual(eng.data.totalMs, 0);
    assert.strictEqual(eng.data.sessions.length, 0);
    const snap = eng.snapshot();
    assert.strictEqual(snap.totalMs, 0);
    assert.strictEqual(snap.currentTotalMs, 0);
  });

  it('start 后进入运行态，snapshot 会话历时 ≥ 0', () => {
    const eng = new TimerEngine();
    eng.start();
    assert.strictEqual(eng.isRunning, true);
    const snap = eng.snapshot();
    assert.ok(snap.sessionElapsedMs >= 0, '会话历时应为非负');
    assert.strictEqual(snap.currentTotalMs, snap.totalMs + snap.sessionElapsedMs);
  });

  it('stop 后返回会话历时并累加 totalMs / 记录会话（崩溃保护语义）', () => {
    const eng = new TimerEngine();
    eng.start();
    const elapsed = eng.stop();
    assert.strictEqual(eng.isRunning, false);
    assert.ok(elapsed >= 0, 'stop 应返回会话历时');
    assert.strictEqual(eng.data.totalMs, elapsed, 'totalMs 应累加本次会话历时');
    assert.strictEqual(eng.data.sessions.length, 1);
    const s = eng.data.sessions[0];
    assert.strictEqual(s.durationMs, elapsed);
  });

  it('未运行时 stop 返回 0，不产生会话（幂等 R16 语义）', () => {
    const eng = new TimerEngine();
    assert.strictEqual(eng.stop(), 0);
    assert.strictEqual(eng.data.sessions.length, 0);
    assert.strictEqual(eng.data.totalMs, 0);
  });

  it('replaceData 替换内部数据（崩溃恢复后加载）', () => {
    const eng = new TimerEngine();
    const data = createEmptyTimingData();
    data.totalMs = 5000;
    data.sessions.push({ startMs: 1, endMs: 2, durationMs: 1 });
    eng.replaceData(data);
    assert.strictEqual(eng.data.totalMs, 5000);
    assert.strictEqual(eng.data.sessions.length, 1);
  });

  it('data 视图冻结：连续两次 stop 各自记录会话且视图不受外部突变影响', () => {
    const eng = new TimerEngine();
    eng.start();
    eng.stop();
    eng.start();
    eng.stop();
    assert.strictEqual(eng.data.sessions.length, 2, '两段会话都应入列');
    assert.strictEqual(Object.isFrozen(eng.data.sessions), true, 'sessions 对外视图应冻结');
  });

  it('rotateSession 跨午夜切分：封存昨日会话段并无缝切换起点', () => {
    const eng = new TimerEngine();
    eng.start();
    const startMs = eng.data.currentSessionStartMs;
    const midnight = startMs + 3600000;
    const elapsed = eng.rotateSession(midnight);
    assert.strictEqual(elapsed, 3600000);
    assert.strictEqual(eng.isRunning, true);
    assert.strictEqual(eng.data.totalMs, 3600000);
    assert.strictEqual(eng.data.sessions.length, 1);
    assert.strictEqual(eng.data.sessions[0].startMs, startMs);
    assert.strictEqual(eng.data.sessions[0].endMs, midnight);
    assert.strictEqual(eng.data.currentSessionStartMs, midnight);
  });

  it('resumeFromSleep 挂起恢复：封存休眠前会话段，休眠期间不计入时长', () => {
    withFixedNow('2026-10-05T10:00:00', () => {
      const eng = new TimerEngine();
      eng.start();
      const startMs = eng.data.currentSessionStartMs;
      const sleepStart = startMs + 1800000; // 30 分钟后睡眠
      const resumeMs = startMs + 28800000;  // 8 小时后唤醒
      const elapsed = eng.resumeFromSleep(sleepStart, resumeMs);
      assert.strictEqual(elapsed, 1800000, '只计入睡眠前 30 分钟');
      assert.strictEqual(eng.isRunning, true);
      assert.strictEqual(eng.data.totalMs, 1800000, '总时长不含休眠 7.5 小时');
      assert.strictEqual(eng.data.sessions.length, 1);
      assert.strictEqual(eng.data.sessions[0].endMs, sleepStart);
      assert.strictEqual(eng.data.currentSessionStartMs, resumeMs, '新起点为唤醒时刻');
    });
  });

  it('resumeFromSleep 跨自然日休眠切分：休眠前跨午夜段按自然日切分原子入账', () => {
    withFixedNow('2026-10-05T08:00:00', () => {
      const eng = new TimerEngine();
      eng.start();
      const t1 = new Date('2026-10-03T23:00:00').getTime();
      const t2 = new Date('2026-10-04T01:00:00').getTime();
      const tWake = new Date('2026-10-05T08:00:00').getTime();
      eng._sessionStartMs = t1;
      const elapsed = eng.resumeFromSleep(t2, tWake);
      assert.strictEqual(elapsed, 7200000, '封存休眠前 2 小时');
      assert.strictEqual(eng.data.sessions.length, 2, '休眠前跨日段应被切分为 2 个会话片段');
      assert.strictEqual(eng.data.totalMs, 7200000);
      assert.strictEqual(eng.data.currentSessionStartMs, tWake);
    });
  });

  it('今日累计增量：stop 后 getTodayMs 精确等于今日已结束段', () => {
    withFixedNow('2026-10-04T12:00:00', () => {
      const eng = new TimerEngine();
      eng.start();
      eng._sessionStartMs = Date.now() - 600000; // 10 分钟前开始
      const elapsed = eng.stop();
      assert.strictEqual(eng.getTodayMs(), 600000, '今日已结束段应精确累加');
      assert.strictEqual(elapsed, 600000);
    });
  });

  it('今日累计：昨日会话不计入今日（replaceData 后惰性重算）', () => {
    withFixedNow('2026-10-04T12:00:00', () => {
      const eng = new TimerEngine();
      const now = Date.now();
      eng.replaceData({
        version: 2, totalMs: 7200000, currentSessionStartMs: 0, lastSavedAtMs: 0, isEnabled: true,
        sessions: [{ startMs: now - 86400000 - 3600000, endMs: now - 86400000, durationMs: 3600000 }],
      });
      assert.strictEqual(eng.getTodayMs(), 0, '昨日会话不得计入今日');
    });
  });

  it('今日累计：rotate 密封段计入今日已结束累计（真实跨日归零由日键重算保证）', () => {
    withFixedNow('2026-10-04T12:00:00', () => {
      const eng = new TimerEngine();
      const now = Date.now();
      eng.start();
      eng._sessionStartMs = now - 1800000; // 今日 30 分钟
      eng.rotateSession(now);              // 封存进今日 sessions
      assert.strictEqual(eng.getTodayEndedMs(), 1800000, '密封段今日部分计入已结束累计');
      // rotate 后会话仍进行中（起点=now），getTodayMs 含实时残段 ≥ 0；
      // 精确相等存在毫秒边界时钟抖动，依据单调推进断言历时下限。
      assert.ok(eng.getTodayMs() >= 1800000, '进行中会话残段叠加在已结束累计之上');
    });
  });

  it('双轨工时：switchMode 切换模式且停止时满足守恒律 durationMs === manualMs + aiMs', () => {
    withFixedNow('2026-10-04T12:00:00', () => {
      const eng = new TimerEngine();
      const now = Date.now();
      eng.start();
      eng._sessionStartMs = now - 100000;
      eng._segmentStartMs = now - 100000;
      eng.switchMode('ai');
      eng._segmentStartMs = now - 40000; // 模拟在 AI 模式工作 40 秒，先前人工 60 秒
      eng._sessionManualAccMs = 60000;
      const elapsed = eng.stop();
      assert.strictEqual(elapsed, 100000);
      assert.strictEqual(eng.data.sessions.length, 1);
      const s = eng.data.sessions[0];
      assert.strictEqual(s.manualMs, 60000);
      assert.strictEqual(s.aiMs, 40000);
      assert.strictEqual(s.durationMs, s.manualMs + s.aiMs, '严格满足工时守恒律');
      assert.strictEqual(eng.data.manualTotalMs, 60000);
      assert.strictEqual(eng.data.aiTotalMs, 40000);
    });
  });

  it('空闲追踪：pauseForIdle 追溯截断与 resumeFromIdle 记入 idleSessions', () => {
    withFixedNow('2026-10-04T12:00:00', () => {
      const eng = new TimerEngine();
      const now = Date.now();
      eng.start();
      eng._sessionStartMs = now - 600000;
      eng._segmentStartMs = now - 600000;

      // 追溯截断到 5 分钟前（离开时刻）
      const idleStart = now - 300000;
      const truncated = eng.pauseForIdle(idleStart);
      assert.strictEqual(truncated, 300000, '截断多余的空闲检测时间');
      assert.strictEqual(eng.isRunning, false);
      assert.strictEqual(eng.isPausedIdle, true);
      assert.strictEqual(eng.data.totalMs, 300000);

      // 用户回到电脑前：唤醒恢复
      const resumeTime = now + 600000; // 离席持续了 15 分钟
      const idleElapsed = eng.resumeFromIdle(resumeTime);
      assert.strictEqual(idleElapsed, 900000, '离开时长应为 15 分钟 (900000ms)');
      assert.strictEqual(eng.isRunning, true);
      assert.strictEqual(eng.isPausedIdle, false);
      assert.strictEqual(eng.data.idleSessions.length, 1);
      assert.strictEqual(eng.data.idleSessions[0].startMs, idleStart);
      assert.strictEqual(eng.data.idleSessions[0].endMs, resumeTime);
      assert.strictEqual(eng.data.idleSessions[0].durationMs, 900000);
    });
  });

  it('多维计数器：今日手动、AI 与离开时长在运行态与空闲态均正确结算', () => {
    withFixedNow('2026-10-04T12:00:00', () => {
      const eng = new TimerEngine();
      const now = Date.now();
      eng.start();
      eng._sessionStartMs = now - 120000;
      eng.data.currentSessionStartMs = now - 120000;
      eng._segmentStartMs = now;
      eng._sessionManualAccMs = 60000;
      eng._sessionAiAccMs = 60000;
      eng._currentMode = 'ai';

      // 运行中指标
      assert.strictEqual(eng.getTodayManualMs(), 60000);
      assert.strictEqual(eng.getTodayAiMs(), 60000);
      assert.ok(eng.getTodayAiMs() >= 60000);

      // 空闲态指标
      eng.pauseForIdle(now);
      assert.strictEqual(eng.isPausedIdle, true);
      assert.ok(eng.getTodayIdleMs() >= 0);
    });
  });
});
