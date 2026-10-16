/**
 * ProceduralAudioSynth 单元测试套件
 * 运行环境：Node.js Mocha，零外部 Web Audio 硬件依赖
 */
'use strict';

const assert = require('assert');
const { ProceduralAudioSynth } = require('../../out/presentation/procedural-audio-synth.js');

class MockAudioParam {
    constructor(val = 0) {
        this.value = val;
        this.events = [];
    }
    setValueAtTime(val, time) {
        this.events.push({ type: 'setValueAtTime', val, time });
        this.value = val;
    }
    exponentialRampToValueAtTime(val, time) {
        this.events.push({ type: 'exponentialRampToValueAtTime', val, time });
        this.value = val;
    }
}

class MockGainNode {
    constructor() {
        this.gain = new MockAudioParam(1.0);
        this.connectedTo = null;
    }
    connect(dest) { this.connectedTo = dest; }
    disconnect() { this.connectedTo = null; }
}

class MockOscillatorNode {
    constructor() {
        this.frequency = new MockAudioParam(440);
        this.type = 'sine';
        this.connectedTo = null;
        this.started = false;
        this.stopped = false;
        this.startTime = 0;
        this.stopTime = 0;
    }
    connect(dest) { this.connectedTo = dest; }
    disconnect() { this.connectedTo = null; }
    start(t) { this.started = true; this.startTime = t; }
    stop(t) { this.stopped = true; this.stopTime = t; }
}

class MockAudioContext {
    constructor() {
        this.state = 'suspended';
        this.currentTime = 100.0;
        this.destination = {};
        this.resumed = false;
        this.closed = false;
        this.createdGains = [];
        this.createdOscillators = [];
    }
    async resume() {
        this.resumed = true;
        this.state = 'running';
    }
    async close() {
        this.closed = true;
        this.state = 'closed';
    }
    createGain() {
        const g = new MockGainNode();
        this.createdGains.push(g);
        return g;
    }
    createOscillator() {
        const osc = new MockOscillatorNode();
        this.createdOscillators.push(osc);
        return osc;
    }
}

describe('ProceduralAudioSynth（纯原生声学合成器）', () => {
    it('初始化默认音量锁定为 30% (0.3)', () => {
        const synth = new ProceduralAudioSynth();
        assert.strictEqual(synth.volume, 0.3);
    });

    it('自定义音量钳位在 [0, 1] 区间', () => {
        const synthOver = new ProceduralAudioSynth({ volume: 1.5 });
        assert.strictEqual(synthOver.volume, 1.0);

        const synthUnder = new ProceduralAudioSynth({ volume: -0.2 });
        assert.strictEqual(synthUnder.volume, 0.0);
    });

    it('播放 timer_completed 时自愈 suspended 状态并构建双音阶上扬泛音 (440Hz -> 880Hz)', async () => {
        const mockCtx = new MockAudioContext();
        const synth = new ProceduralAudioSynth({ audioContext: mockCtx });

        const played = await synth.playTimerCompleted();
        assert.strictEqual(played, true);
        assert.strictEqual(mockCtx.resumed, true);
        assert.strictEqual(mockCtx.state, 'running');

        assert.strictEqual(mockCtx.createdOscillators.length, 2);
        const [carrier, harmonic] = mockCtx.createdOscillators;

        assert.strictEqual(carrier.type, 'sine');
        assert.strictEqual(carrier.started, true);
        assert.strictEqual(carrier.stopped, true);
        assert.strictEqual(carrier.frequency.events[0].val, 440);
        assert.strictEqual(carrier.frequency.events[1].val, 880);

        assert.strictEqual(harmonic.type, 'triangle');
        assert.strictEqual(harmonic.frequency.events[0].val, 880);
    });

    it('播放 break_ended 时构建温暖木质双谐振 (330Hz / 660Hz)', async () => {
        const mockCtx = new MockAudioContext();
        const synth = new ProceduralAudioSynth({ audioContext: mockCtx });

        const played = await synth.playBreakEnded();
        assert.strictEqual(played, true);
        assert.strictEqual(mockCtx.createdOscillators.length, 2);

        const [fundamental, overtone] = mockCtx.createdOscillators;
        assert.strictEqual(fundamental.type, 'triangle');
        assert.strictEqual(fundamental.frequency.events[0].val, 330);

        assert.strictEqual(overtone.type, 'sine');
        assert.strictEqual(overtone.frequency.events[0].val, 660);
    });

    it('dispose 安全释放上下文且禁止后续播放', async () => {
        const mockCtx = new MockAudioContext();
        const synth = new ProceduralAudioSynth({ audioContext: mockCtx });

        synth.dispose();
        assert.strictEqual(mockCtx.closed, true);

        const played = await synth.playTimerCompleted();
        assert.strictEqual(played, false);
    });
});

