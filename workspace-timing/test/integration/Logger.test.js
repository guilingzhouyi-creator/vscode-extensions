/**
 * Module: Logger.test — 跨层无依赖统一日志与双轨事件汇流引擎单测
 * Architecture Role: Integration layer unit test suite verifying log level filtering, sink dispatch, lazy evaluation, and error cause unrolling
 */
'use strict';

const assert = require('assert');
const {
  LogLevel,
  setLogLevel,
  getLogLevel,
  isLogLevelEnabled,
  isDebugEnabled,
  isInfoEnabled,
  addLogSink,
  removeLogSink,
  clearLogSinks,
  getLogSinksCount,
  log,
  logger,
} = require('../../out/integration/logger');

describe('Logger（统一日志与双轨事件汇流引擎）', () => {
  const originalLevel = getLogLevel();

  beforeEach(() => {
    clearLogSinks();
    setLogLevel(LogLevel.Debug);
  });

  afterEach(() => {
    clearLogSinks();
    setLogLevel(originalLevel);
  });

  it('日志分级阈值过滤：低于当前阈值的日志被静默过滤', () => {
    setLogLevel(LogLevel.Warn);
    assert.strictEqual(getLogLevel(), LogLevel.Warn);

    const received = [];
    addLogSink((entry) => received.push(entry));

    log(LogLevel.Debug, 'debug-message');
    log(LogLevel.Info, 'info-message');
    assert.strictEqual(received.length, 0);

    log(LogLevel.Warn, 'warn-message');
    log(LogLevel.Error, 'error-message');
    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[0].level, LogLevel.Warn);
    assert.strictEqual(received[1].level, LogLevel.Error);
  });

  it('LogLevel.None 模式下物理阻断一切输出', () => {
    setLogLevel(LogLevel.None);
    assert.strictEqual(isLogLevelEnabled(LogLevel.Error), false);
    assert.strictEqual(isDebugEnabled(), false);
    assert.strictEqual(isInfoEnabled(), false);

    const received = [];
    addLogSink((entry) => received.push(entry));

    log(LogLevel.Error, 'critical-error');
    assert.strictEqual(received.length, 0);
  });

  it('日志等级探针 API 精确反映当前激活阈值', () => {
    setLogLevel(LogLevel.Info);
    assert.strictEqual(isLogLevelEnabled(LogLevel.Debug), false);
    assert.strictEqual(isLogLevelEnabled(LogLevel.Info), true);
    assert.strictEqual(isLogLevelEnabled(LogLevel.Warn), true);
    assert.strictEqual(isDebugEnabled(), false);
    assert.strictEqual(isInfoEnabled(), true);
  });

  it('惰性消息求值：当日志级别被过滤时，绝不调用 supplier 函数（零 GC 开销）', () => {
    setLogLevel(LogLevel.Warn);

    let evaluated = 0;
    const expensiveSupplier = () => {
      evaluated++;
      return 'expensive-computed-string';
    };

    // Debug 与 Info 应被过滤，supplier 不会被调用
    log(LogLevel.Debug, expensiveSupplier);
    log(LogLevel.Info, expensiveSupplier);
    assert.strictEqual(evaluated, 0);

    // Warn 处于阈值内，supplier 被调用一次
    log(LogLevel.Warn, expensiveSupplier);
    assert.strictEqual(evaluated, 1);
  });

  it('LogSink 广播机制：支持多个接收器独立消费且支持安全注销', () => {
    const sink1Entries = [];
    const sink2Entries = [];

    const sink1 = (entry) => sink1Entries.push(entry);
    const sink2 = (entry) => sink2Entries.push(entry);

    const unsubscribe1 = addLogSink(sink1);
    addLogSink(sink2);
    assert.strictEqual(getLogSinksCount(), 2);

    log(LogLevel.Info, 'broadcast-test');
    assert.strictEqual(sink1Entries.length, 1);
    assert.strictEqual(sink2Entries.length, 1);
    assert.strictEqual(sink1Entries[0].message, 'broadcast-test');

    // 注销 sink1
    unsubscribe1();
    assert.strictEqual(getLogSinksCount(), 1);

    log(LogLevel.Info, 'broadcast-second');
    assert.strictEqual(sink1Entries.length, 1);
    assert.strictEqual(sink2Entries.length, 2);

    // 使用 removeLogSink 注销 sink2
    removeLogSink(sink2);
    assert.strictEqual(getLogSinksCount(), 0);
  });

  it('LogSink 容灾保护：异常接收器抛出错误不会导致主进程崩溃', () => {
    const faultySink = () => {
      throw new Error('Sink crash simulated');
    };
    const healthyEntries = [];
    const healthySink = (entry) => healthyEntries.push(entry);

    addLogSink(faultySink);
    addLogSink(healthySink);

    // log 调用不应抛出
    assert.doesNotThrow(() => {
      log(LogLevel.Info, 'resilience-test');
    });

    assert.strictEqual(healthyEntries.length, 1);
  });

  it('Error 与递归 Cause 因果链深度提取与结构化展开', () => {
    const innerError = new Error('Database file locked');
    const rootError = new Error('Session save failed', { cause: innerError });

    const received = [];
    addLogSink((entry) => received.push(entry));

    log(LogLevel.Error, 'Storage persistence exception', rootError);
    assert.strictEqual(received.length, 1);

    const entry = received[0];
    assert.strictEqual(entry.level, LogLevel.Error);
    assert.strictEqual(entry.message, 'Storage persistence exception');
    assert.strictEqual(entry.error, rootError);
    assert.ok(entry.detail);
    assert.ok(entry.detail.includes('Session save failed'));
    assert.ok(entry.detail.includes('Caused by:'));
    assert.ok(entry.detail.includes('Database file locked'));
  });

  it('不可变只读门面对象（logger）方法与状态冻结验证', () => {
    assert.strictEqual(Object.isFrozen(logger), true);

    const received = [];
    addLogSink((entry) => received.push(entry));

    logger.debug('facade-debug');
    logger.info('facade-info');
    logger.warn('facade-warn');
    logger.error('facade-error');

    assert.strictEqual(received.length, 4);
    assert.strictEqual(received[0].level, LogLevel.Debug);
    assert.strictEqual(received[1].level, LogLevel.Info);
    assert.strictEqual(received[2].level, LogLevel.Warn);
    assert.strictEqual(received[3].level, LogLevel.Error);

    assert.strictEqual(logger.isDebugEnabled(), true);
    assert.strictEqual(logger.isInfoEnabled(), true);
    assert.strictEqual(logger.isLevelEnabled(LogLevel.Warn), true);
  });
});
