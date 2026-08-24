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

  it('trimSessions 裁剪会话列表到上限', () => {
    const eng = new TimerEngine();
    const data = createEmptyTimingData();
    data.sessions = [0, 1, 2, 3].map((i) => ({ startMs: i, endMs: i + 1, durationMs: 1 }));
    eng.replaceData(data);
    eng.trimSessions(2);
    assert.strictEqual(eng.data.sessions.length, 2);
    assert.strictEqual(eng.data.sessions[0].startMs, 2, '应保留最近会话');
  });
});
