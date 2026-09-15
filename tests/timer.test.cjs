const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const blind = (minutes, small = 25) => ({ type: 'blind', minutes, small, big: small * 2 });
const rest = (minutes) => ({ type: 'break', minutes });

function clockHarness(levels, options = {}) {
  let now = options.now ?? new Date(2026, 8, 15, 15, 0, 0).getTime();
  let serial = 0;
  let scheduleRenders = 0;
  let speechCancels = 0;
  const frames = new Map();
  const timeouts = new Map();
  const spoken = [];
  const recordings = [];
  const audioElements = [];
  const elements = new Map();
  const saved = new Map(options.saved || []);
  const documentEvents = new Map();
  if (levels) saved.set('pokerBlindSchedule', JSON.stringify(levels));
  if (options.ante === false) saved.set('pokerAnteEnabled', 'false');
  if (options.anteMode) saved.set('pokerAnteMode', options.anteMode);
  class Element {
    constructor(id) {
      this.id = id;
      this.textContent = '';
      this.value = '';
      this.checked = id === 'soundToggle' || id === 'autoBigToggle';
      this.dataset = {};
      this.children = [];
      this.events = new Map();
      this.attributes = {};
      const classes = new Set(id === 'appShell' ? ['settings-closed'] : []);
      this.classList = {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, force) {
          const on = force === undefined ? !classes.has(name) : Boolean(force);
          on ? classes.add(name) : classes.delete(name);
          return on;
        },
      };
    }
    set innerHTML(value) { this.html = value; this.children = []; if (this.id === 'scheduleList') scheduleRenders += 1; }
    get innerHTML() { return this.html; }
    appendChild(child) { this.children.push(child); }
    querySelector(selector) {
      this.parts ??= new Map();
      if (!this.parts.has(selector)) this.parts.set(selector, new Element(selector));
      return this.parts.get(selector);
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return name === 'src' ? this.src ?? null : this.attributes[name] ?? null; }
    addEventListener(event, fn) { this.events.set(event, [...(this.events.get(event) || []), fn]); }
    dispatch(event, target = this) { (this.events.get(event) || []).forEach(fn => fn({ target })); }
    focus() {}
    play() {
      this.plays = (this.plays || 0) + 1;
      recordings.push(this.src);
      if (options.mediaFailure) return Promise.reject(new Error('Playback blocked'));
      this.onplaying?.();
      return Promise.resolve();
    }
    pause() { this.pauses = (this.pauses || 0) + 1; }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const document = {
    getElementById: get,
    querySelector: selector => selector === 'dialog[open]' ? (options.dialogOpen ? get('dialog') : null) : get(selector),
    createElement: tag => { const element = new Element(tag); if (tag === 'audio') audioElements.push(element); return element; },
    addEventListener: (name, fn) => documentEvents.set(name, [...(documentEvents.get(name) || []), fn]),
    documentElement: {},
  };
  const window = {
    addEventListener() {},
    confirm: () => true,
    speechSynthesis: {
      getVoices: () => [],
      cancel: () => { speechCancels += 1; },
      speak: utterance => { spoken.push(utterance.text); if (options.speechFailure) utterance.onerror?.(); },
      addEventListener() {},
    },
  };
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    document, window, Date: TestDate,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    requestAnimationFrame: fn => { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { const id = ++serial; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id),
    setInterval() {},
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  return {
    get, run, saved, spoken, recordings,
    input(id, value) { get(id).value = String(value); get(id).dispatch('input'); },
    async finishAudio() {
      const playing = audioElements.find(audio => audio.onended);
      playing?.onended();
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    },
    async flushAudio() { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); },
    click: id => get(id).dispatch('click'),
    key(extra = {}) {
      let prevented = false;
      const event = { key: ' ', code: 'Space', target: get('body'), preventDefault: () => { prevented = true; }, ...extra };
      (documentEvents.get('keydown') || []).forEach(fn => fn(event));
      return prevented;
    },
    fireTimeouts() { const callbacks = [...timeouts.values()]; timeouts.clear(); callbacks.forEach(fn => fn()); },
    step(seconds) {
      now += seconds * 1000;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(fn => fn());
    },
    get renders() { return scheduleRenders; },
    get pendingFrames() { return frames.size; },
    get speechCancels() { return speechCancels; },
    changeSchedule(index, field, value) {
      const row = { dataset: { index: String(index) } };
      const input = { value: String(value), dataset: { field }, closest: selector => selector === '.schedule-row' ? row : input };
      get('scheduleList').dispatch('change', input);
    },
  };
}

test('fresh start uses Level 01 and playing-time sum excludes the default break', () => {
  const h = clockHarness();
  assert.equal(h.get('levelLabel').textContent, 'Level 01');
  assert.equal(h.get('timeDisplay').textContent, '20:00');
  assert.equal(h.get('tournamentTime').textContent, '03:00:00');
  assert.equal(h.get('estimatedEndTime').textContent, '—');
  assert.equal(h.get('startPauseText').textContent, '開始');
});

test('existing schedule and Ante preference load with the original storage keys', () => {
  const h = clockHarness([blind(3, 40)], { ante: false });
  assert.equal(h.get('timeDisplay').textContent, '03:00');
  assert.equal(h.get('smallBlind').textContent, '40');
  assert.equal(h.get('ante').textContent, 'OFF');
  assert.equal(h.get('ante').classList.contains('is-off'), true);
  assert.match(h.get('scheduleList').children[0].innerHTML, /<output[^>]+schedule-ante[^>]+>OFF<\/output>/);
  h.get('anteToggle').checked = true;
  h.get('anteToggle').dispatch('change');
  assert.equal(h.get('ante').textContent, '16');
  assert.equal(h.get('ante').classList.contains('is-off'), false);
  assert.equal(h.saved.get('pokerAnteEnabled'), 'true');
});

test('entering, spending time in, and leaving a break never deduct break time from the tournament clock', () => {
  const h = clockHarness([blind(1), rest(1), blind(2, 50)]);
  assert.equal(h.get('tournamentTime').textContent, '00:03:00');
  h.click('startPauseBtn');
  h.step(60);
  assert.equal(h.get('levelLabel').textContent, 'Break');
  assert.equal(h.get('timeDisplay').textContent, '01:00');
  assert.equal(h.get('tournamentTime').textContent, '00:02:00');
  h.get('anteToggle').checked = false;
  h.get('anteToggle').dispatch('change');
  assert.notEqual(h.get('anteToggle').disabled, true);
  assert.notEqual(h.get('autoBigToggle').disabled, true);
  assert.equal(h.get('ante').textContent, '—');
  assert.equal(h.get('nextAnte').textContent, 'Ante OFF');
  h.step(30);
  assert.equal(h.get('timeDisplay').textContent, '00:30');
  assert.equal(h.get('tournamentTime').textContent, '00:02:00');
  h.step(30);
  assert.equal(h.get('levelLabel').textContent, 'Level 02');
  assert.equal(h.get('timeDisplay').textContent, '02:00');
  assert.equal(h.get('tournamentTime').textContent, '00:02:00');
  h.step(1);
  assert.equal(h.get('tournamentTime').textContent, '00:01:59');
});

test('a background gap crosses multiple levels and retains excess seconds', () => {
  const h = clockHarness([blind(1), rest(1), blind(2, 50), blind(1, 100)]);
  h.click('startPauseBtn');
  h.step(135);
  assert.equal(h.get('levelLabel').textContent, 'Level 02');
  assert.equal(h.get('timeDisplay').textContent, '01:45');
  assert.equal(h.get('tournamentTime').textContent, '00:02:45');
  assert.equal(h.run('elapsedSeconds'), 135);
});

test('pause stops both clocks and audio; resume excludes the paused interval', () => {
  const h = clockHarness([blind(3), rest(1), blind(1)]);
  h.click('startPauseBtn');
  h.step(10);
  const cancellations = h.speechCancels;
  h.click('startPauseBtn');
  assert.equal(h.get('statusText').textContent, '已暫停');
  assert.ok(h.speechCancels > cancellations);
  assert.equal(h.get('endLabel').textContent, '恢復後預計結束');
  h.step(100);
  assert.equal(h.get('timeDisplay').textContent, '02:50');
  assert.equal(h.get('tournamentTime').textContent, '00:03:50');
  h.click('startPauseBtn');
  h.step(5);
  assert.equal(h.get('timeDisplay').textContent, '02:45');
  assert.equal(h.recordings.filter(src => src === 'assets/voice/start.wav?v=google-en-us-20260915').length, 1);
});

test('finishing during a long gap clamps to zero and cannot restart until reset', () => {
  const h = clockHarness([blind(1), rest(1), blind(1)]);
  h.click('startPauseBtn');
  h.step(1000);
  assert.equal(h.get('statusText').textContent, '已結束');
  assert.equal(h.get('timeDisplay').textContent, '00:00');
  assert.equal(h.get('tournamentTime').textContent, '00:00:00');
  assert.equal(h.run('elapsedSeconds'), 180);
  assert.equal(h.pendingFrames, 0);
  h.click('startPauseBtn');
  assert.equal(h.pendingFrames, 0);
  h.click('resetBtn');
  assert.equal(h.get('levelLabel').textContent, 'Level 01');
  assert.equal(h.get('timeDisplay').textContent, '01:00');
  h.click('startPauseBtn');
  assert.equal(h.pendingFrames, 1);
});

test('ordinary ticks keep schedule editor rows mounted', () => {
  const h = clockHarness([blind(3), blind(3)]);
  const renders = h.renders;
  const row = h.get('scheduleList').children[0];
  const rowMarkup = row.innerHTML;
  h.click('startPauseBtn');
  h.step(1);
  h.step(1);
  assert.equal(h.renders, renders);
  assert.equal(h.get('scheduleList').children[0], row);
  assert.equal(row.innerHTML, rowMarkup);
});

test('manual next/previous pause first and reset the selected level', () => {
  const h = clockHarness([blind(1), rest(1), blind(2)]);
  h.click('startPauseBtn');
  h.step(10);
  h.click('nextBtn');
  assert.equal(h.get('levelLabel').textContent, 'Break');
  assert.equal(h.run('running'), false);
  assert.equal(h.get('timeDisplay').textContent, '01:00');
  h.click('prevBtn');
  assert.equal(h.get('levelLabel').textContent, 'Level 01');
  assert.equal(h.get('timeDisplay').textContent, '01:00');
});

test('apply-all minutes changes blind durations only, keeping scheduled breaks', () => {
  const h = clockHarness([blind(3), rest(7), blind(4)]);
  h.get('defaultMinutes').value = '12';
  h.click('applyMinutesBtn');
  assert.equal(h.run('schedule[0].minutes'), 12);
  assert.equal(h.run('schedule[1].minutes'), 7);
  assert.equal(h.run('schedule[2].minutes'), 12);
  assert.equal(h.get('tournamentTime').textContent, '00:24:00');
});

test('schedule editing and adding levels cap values while preserving each duration and current countdown', () => {
  const h = clockHarness([blind(3), rest(7), blind(4)]);
  h.changeSchedule(0, 'small', '1e100');
  assert.equal(h.run('schedule[0].small'), 49999999);
  assert.equal(h.run('schedule[0].big'), 99999998);
  h.click('startPauseBtn');
  h.step(7);
  h.click('addLevelBtn');
  assert.equal(h.get('timeDisplay').textContent, '02:53');
  assert.equal(h.run('running'), false);
  assert.equal(h.run('schedule[1].minutes'), 7);
  assert.equal(h.run('schedule[2].minutes'), 4);
  assert.ok(h.run('schedule[3].big') <= 99999999);
  assert.ok(h.run('schedule[3].small') <= 99999999);
  assert.equal(h.run('schedule[3].minutes'), 4);
  assert.equal(h.get('.blinds').classList.contains('long-numbers'), true);
});

test('minute and final-five reminders play once when crossed; background skips do not produce stale speech', () => {
  const h = clockHarness([blind(20)]);
  h.click('startPauseBtn');
  h.step(599);
  h.step(1);
  assert.equal(h.recordings.at(-1), 'assets/voice/ten-minutes.wav?v=google-en-us-20260915');
  h.step(0.2);
  assert.equal(h.recordings.filter(src => src === 'assets/voice/ten-minutes.wav?v=google-en-us-20260915').length, 1);
  h.step(594.8);
  assert.equal(h.get('timeDisplay').textContent, '00:05');
  assert.equal(h.recordings.at(-1), 'assets/voice/ten-minutes.wav?v=google-en-us-20260915');
  h.step(1);
  assert.equal(h.recordings.at(-1), 'assets/voice/four.wav?v=google-en-us-20260915');
  h.step(1);
  assert.equal(h.recordings.at(-1), 'assets/voice/three.wav?v=google-en-us-20260915');
  h.step(1);
  assert.equal(h.recordings.at(-1), 'assets/voice/two.wav?v=google-en-us-20260915');
  h.step(1);
  assert.equal(h.recordings.at(-1), 'assets/voice/one.wav?v=google-en-us-20260915');
});

test('estimated end includes scheduled breaks and labels a cross-date finish', () => {
  const h = clockHarness([blind(10), rest(5), blind(10)], { now: new Date(2026, 8, 15, 23, 55, 0).getTime() });
  h.click('startPauseBtn');
  assert.equal(h.get('tournamentTime').textContent, '00:20:00');
  assert.equal(h.get('estimatedEndTime').textContent, '00:20');
  assert.equal(h.get('endNote').textContent, '9/16・含排定休息');
});

test('the last playing level ends the tournament without executing trailing breaks', () => {
  const h = clockHarness([blind(1), rest(1), blind(1), rest(10), rest(5)]);
  h.click('startPauseBtn');
  assert.equal(h.run('getScheduledSecondsRemaining()'), 180);
  h.step(120);
  assert.equal(h.get('levelLabel').textContent, 'Level 02');
  assert.equal(h.get('nextBreakTime').textContent, '—');
  assert.equal(h.get('nextLevel').textContent, '—');
  h.step(60);
  assert.equal(h.get('statusText').textContent, '已結束');
  assert.equal(h.get('levelLabel').textContent, 'Level 02');
  assert.equal(h.get('timeDisplay').textContent, '00:00');
  assert.equal(h.run('schedule.length'), 5);
  assert.equal(h.pendingFrames, 0);
});

test('a schedule containing only breaks cannot start and asks for a playing level', () => {
  const h = clockHarness([rest(10), rest(5)]);
  assert.equal(h.get('statusText').textContent, '待設定');
  assert.equal(h.get('startPauseBtn').disabled, true);
  assert.equal(h.get('notice').textContent, '請新增至少一個盲注級別');
  h.click('startPauseBtn');
  assert.equal(h.pendingFrames, 0);
  assert.equal(h.run('getScheduledSecondsRemaining()'), 0);
});

test('direct schedule edits respect automatic big blind and only a duration edit resets the countdown', () => {
  const h = clockHarness([blind(3), rest(2), blind(4, 100), blind(5, 400)]);
  h.click('startPauseBtn');
  h.step(7);
  const renders = h.renders;
  const row = h.get('scheduleList').children[0];
  h.get('autoBigToggle').checked = false;
  h.changeSchedule(0, 'small', 40);
  assert.equal(h.get('smallBlind').textContent, '40');
  assert.equal(h.get('bigBlind').textContent, '50');
  assert.equal(h.get('timeDisplay').textContent, '02:53');
  assert.equal(h.run('running'), false);
  assert.equal(h.renders, renders);
  assert.equal(h.get('scheduleList').children[0], row);
  assert.equal(row.querySelector('input[data-field="small"]').value, 40);
  h.get('autoBigToggle').checked = true;
  h.changeSchedule(0, 'small', 60);
  assert.equal(h.get('bigBlind').textContent, '120');
  assert.equal(h.get('ante').textContent, '24');
  assert.equal(row.querySelector('input[data-field="big"]').value, 120);
  assert.equal(row.querySelector('.schedule-ante').textContent, '24');
  assert.equal(h.get('timeDisplay').textContent, '02:53');
  assert.equal(h.run('schedule[0].big'), 120);
  assert.equal(h.run('schedule[2].big'), 200);
  assert.equal(h.run('schedule[3].big'), 800);
  assert.equal(h.run('schedule[3].minutes'), 5);
  assert.equal(h.get('timeDisplay').textContent, '02:53');
  h.changeSchedule(0, 'minutes', 4);
  assert.equal(h.get('timeDisplay').textContent, '04:00');
});

test('Space toggles the clock but ignores repeat, editable controls, and open dialogs', () => {
  const h = clockHarness([blind(3)]);
  assert.equal(h.key({ repeat: true }), false);
  assert.equal(h.run('running'), false);
  assert.equal(h.key({ target: { closest: () => ({}) } }), false);
  assert.equal(h.run('running'), false);
  assert.equal(h.key(), true);
  assert.equal(h.run('running'), true);
  assert.equal(h.key(), true);
  assert.equal(h.run('running'), false);
  const dialog = clockHarness([blind(3)], { dialogOpen: true });
  assert.equal(dialog.key(), false);
  assert.equal(dialog.run('running'), false);
});

test('manual next updates the level before the MP3 cue and leaves the clock paused', () => {
  const h = clockHarness([blind(3), blind(3)]);
  h.click('nextBtn');
  assert.equal(h.get('levelLabel').textContent, 'Level 02');
  assert.equal(h.run('running'), false);
  assert.equal(h.run('levelStartAudio.plays || 0'), 0);
  h.fireTimeouts();
  assert.equal(h.run('levelStartAudio.plays'), 1);
  assert.equal(h.run('running'), false);
});

test('a short delayed frame crossing a minute reminder plays the bundled clip once', () => {
  const h = clockHarness([blind(2)]);
  h.click('startPauseBtn');
  h.step(59.8);
  h.step(1.4);
  assert.equal(h.get('timeDisplay').textContent, '00:59');
  assert.equal(h.recordings.at(-1), 'assets/voice/one-minute.wav?v=google-en-us-20260915');
  h.step(0.2);
  assert.equal(h.recordings.filter(src => src === 'assets/voice/one-minute.wav?v=google-en-us-20260915').length, 1);
  assert.equal(h.spoken.length, 0);
});

test('normal final five seconds each play one bundled recording in order', () => {
  const h = clockHarness([blind(1)]);
  h.click('startPauseBtn');
  h.step(54);
  for (let count = 0; count < 5; count += 1) h.step(1);
  assert.deepEqual(h.recordings.slice(-5), ['five', 'four', 'three', 'two', 'one'].map(key => `assets/voice/${key}.wav?v=google-en-us-20260915`));
  assert.equal(h.recordings.filter(src => src === 'assets/voice/one-minute.wav?v=google-en-us-20260915').length, 0);
});

test('audio preview covers opening, one minute, final countdown and chime without changing the timer', async () => {
  const h = clockHarness([blind(3)]);
  h.click('testSoundBtn');
  assert.equal(h.get('testSoundBtn').textContent, '停止試聽');
  assert.equal(h.get('testSoundBtn').attributes['aria-pressed'], 'true');
  for (let clip = 0; clip < 8; clip += 1) await h.finishAudio();
  assert.deepEqual(h.recordings.slice(0, 7), ['start', 'one-minute', 'five', 'four', 'three', 'two', 'one'].map(key => `assets/voice/${key}.wav?v=google-en-us-20260915`));
  assert.match(h.recordings[7], /seatbelt-ding-dong\.mp3/);
  assert.equal(h.get('testSoundBtn').textContent, '試聽語音與提示音');
  assert.equal(h.get('testSoundBtn').attributes['aria-pressed'], 'false');
  assert.match(h.get('audioStatus').textContent, /試聽播放結束/);
  assert.equal(h.get('timeDisplay').textContent, '03:00');
  assert.equal(h.run('running'), false);
  assert.equal(h.pendingFrames, 0);
});

test('preview cancellation and sound toggle stop queued recordings', async () => {
  const h = clockHarness([blind(3)]);
  h.click('testSoundBtn');
  h.click('testSoundBtn');
  await h.flushAudio();
  assert.equal(h.recordings.length, 1);
  assert.equal(h.run('previewRunning'), false);
  assert.equal(h.run('activeAudioStops.size'), 0);
  h.click('testSoundBtn');
  h.get('soundToggle').checked = false;
  h.get('soundToggle').dispatch('change');
  await h.flushAudio();
  assert.equal(h.recordings.length, 2);
  assert.equal(h.run('previewRunning'), false);
  assert.equal(h.run('activeAudioStops.size'), 0);
  assert.equal(h.get('audioStatus').textContent, '音效已關閉。');
});

test('preview asks to pause instead of interrupting a running tournament', () => {
  const h = clockHarness([blind(3)]);
  h.click('startPauseBtn');
  const recordings = h.recordings.length;
  h.click('testSoundBtn');
  assert.equal(h.run('running'), true);
  assert.equal(h.recordings.length, recordings);
  assert.match(h.get('toast').textContent, /先暫停計時/);
});

test('resuming the tournament stops an active preview before the match continues', async () => {
  const h = clockHarness([blind(3)]);
  h.click('startPauseBtn');
  h.step(1);
  h.click('startPauseBtn');
  h.click('testSoundBtn');
  assert.equal(h.run('previewRunning'), true);
  h.click('startPauseBtn');
  await h.flushAudio();
  assert.equal(h.run('running'), true);
  assert.equal(h.run('previewRunning'), false);
  assert.equal(h.run('activeAudioStops.size'), 0);
  assert.equal(h.recordings.length, 2);
});

test('unplayable recordings and failed speech fallback show a visible error and stop preview', async () => {
  const h = clockHarness([blind(3)], { mediaFailure: true, speechFailure: true });
  h.click('testSoundBtn');
  await h.flushAudio();
  assert.equal(h.recordings.length, 1);
  assert.deepEqual(h.spoken, ["Let's get started"]);
  assert.match(h.get('audioStatus').textContent, /英文提示無法播放/);
  assert.equal(h.get('audioStatus').classList.contains('error'), true);
  assert.equal(h.run('previewRunning'), false);
  assert.equal(h.run('activeAudioStops.size'), 0);
});

test('quick setup drafts preview blind doubling, apply uniform minutes and skip breaks', () => {
  const h = clockHarness([{ ...blind(3), ante: 7 }, rest(8), { ...blind(4, 65), ante: 9 }, { ...blind(5, 170), ante: 11 }]);
  h.get('autoBigToggle').checked = false;
  h.input('quickSmall', 40);
  h.input('defaultMinutes', 12);
  assert.equal(h.get('quickBig').value, '80');
  assert.equal(h.get('quickAnte').value, '16');
  assert.equal(h.get('quickAnte').readOnly, true);
  assert.equal(h.get('quickPreview').textContent, '01  40 / 80 / 16\n02  80 / 160 / 32\n03  160 / 320 / 64');
  assert.equal(h.run('schedule[0].small'), 25);
  assert.equal(h.get('timeDisplay').textContent, '03:00');
  h.click('applyMinutesBtn');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(schedule.map(level => [level.minutes, level.small, level.big, level.ante]))')), [[12, 40, 80, 7], [8, 0, 0, 0], [12, 80, 160, 9], [12, 160, 320, 11]]);
  assert.equal(h.get('ante').textContent, '16');
  assert.equal(h.get('timeDisplay').textContent, '12:00');
  assert.equal(h.get('tournamentTime').textContent, '00:36:00');
});

test('custom Ante quick setup doubles only playing levels and survives AUTO/OFF changes and reload', () => {
  const h = clockHarness([{ ...blind(3), ante: 7 }, rest(8), { ...blind(4), ante: 11 }, { ...blind(5), ante: 19 }]);
  h.click('anteCustomBtn');
  assert.equal(h.get('quickAnte').value, '7');
  assert.equal(h.get('quickAnte').readOnly, false);
  h.input('quickAnte', 13);
  h.click('anteAutoBtn');
  assert.equal(h.get('quickAnte').value, '10');
  h.get('anteToggle').checked = false;
  h.get('anteToggle').dispatch('change');
  assert.equal(h.get('quickAnte').hidden, true);
  assert.equal(h.get('quickAnteOff').hidden, false);
  assert.match(h.get('quickPreview').textContent, /OFF/);
  h.click('anteCustomBtn');
  h.get('anteToggle').checked = true;
  h.get('anteToggle').dispatch('change');
  assert.equal(h.get('quickAnte').value, '13');
  h.click('applyMinutesBtn');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(schedule.map(level => level.ante))')), [13, 0, 26, 52]);
  assert.equal(h.get('ante').textContent, '13');
  assert.equal(h.get('anteCustomBtn').attributes['aria-pressed'], 'true');
  assert.match(h.get('scheduleList').children[0].innerHTML, /<input[^>]+data-field="ante"[^>]+value="13"/);
  const restored = clockHarness(null, { saved: h.saved });
  assert.equal(restored.get('ante').textContent, '13');
  assert.equal(restored.get('quickAnte').value, '13');
  assert.equal(restored.get('anteCustomBtn').attributes['aria-pressed'], 'true');
  assert.equal(restored.get('timeDisplay').textContent, '03:00');
});

test('manual custom Ante edits stay independent of blinds and are read-only in AUTO or OFF', () => {
  const h = clockHarness([{ ...blind(3), ante: 7 }], { anteMode: 'custom' });
  h.changeSchedule(0, 'ante', 77);
  assert.equal(h.get('ante').textContent, '77');
  assert.equal(h.get('quickAnte').value, '77');
  h.click('anteAutoBtn');
  h.changeSchedule(0, 'big', 250);
  h.changeSchedule(0, 'ante', 99);
  assert.equal(h.get('ante').textContent, '50');
  assert.equal(h.run('schedule[0].ante'), 77);
  h.get('anteToggle').checked = false;
  h.get('anteToggle').dispatch('change');
  h.click('anteCustomBtn');
  h.changeSchedule(0, 'ante', 99);
  h.input('quickSmall', 30);
  h.click('applyMinutesBtn');
  assert.equal(h.run('schedule[0].ante'), 77);
  assert.equal(h.get('ante').textContent, 'OFF');
  h.get('anteToggle').checked = true;
  h.get('anteToggle').dispatch('change');
  assert.equal(h.get('ante').textContent, '77');
  assert.equal(h.get('quickAnte').value, '77');
});

test('quick amount changes preserve the current countdown; changed minutes alone reset it', () => {
  const h = clockHarness([blind(3), rest(2), blind(3)]);
  h.click('startPauseBtn');
  h.step(10);
  h.input('quickSmall', 50);
  h.click('applyMinutesBtn');
  assert.equal(h.get('timeDisplay').textContent, '02:50');
  assert.equal(h.run('running'), false);
  h.input('defaultMinutes', 4);
  h.click('applyMinutesBtn');
  assert.equal(h.get('timeDisplay').textContent, '04:00');
  h.click('nextBtn');
  h.click('startPauseBtn');
  h.step(7);
  h.input('defaultMinutes', 5);
  h.click('applyMinutesBtn');
  assert.equal(h.get('levelLabel').textContent, 'Break');
  assert.equal(h.get('timeDisplay').textContent, '01:53');
  assert.equal(h.run('schedule[1].minutes'), 2);
  assert.equal(h.get('tournamentTime').textContent, '00:05:00');
});

test('quick setup rejects later-level blind or custom Ante overflow atomically without pausing', () => {
  const h = clockHarness([blind(3), rest(2), blind(4)]);
  h.click('startPauseBtn');
  h.step(7);
  const original = h.run('JSON.stringify(schedule)');
  h.input('quickSmall', 49999999);
  h.click('applyMinutesBtn');
  assert.match(h.get('quickMessage').textContent, /第 2 級翻倍後超過/);
  assert.equal(h.get('quickMessage').classList.contains('error'), true);
  assert.equal(h.run('JSON.stringify(schedule)'), original);
  assert.equal(h.get('timeDisplay').textContent, '02:53');
  assert.equal(h.run('running'), true);
  h.input('quickSmall', 25);
  h.click('anteCustomBtn');
  h.input('quickAnte', 99999999);
  h.click('applyMinutesBtn');
  assert.match(h.get('quickMessage').textContent, /第 2 級翻倍後超過/);
  assert.equal(h.run('JSON.stringify(schedule)'), original);
  assert.equal(h.run('running'), true);
});

test('quick drafts persist across clock renders and invalid integer input never applies', () => {
  const h = clockHarness([blind(1), blind(1)]);
  h.input('quickSmall', 45);
  h.input('defaultMinutes', 7);
  h.click('startPauseBtn');
  h.step(60);
  assert.equal(h.get('quickSmall').value, '45');
  assert.equal(h.get('defaultMinutes').value, '7');
  assert.equal(h.run('schedule[0].small'), 25);
  const original = h.run('JSON.stringify(schedule)');
  for (const value of ['', '2.5', '121']) {
    h.input('defaultMinutes', value);
    h.click('applyMinutesBtn');
    assert.match(h.get('quickMessage').textContent, /整數分鐘/);
    assert.equal(h.run('JSON.stringify(schedule)'), original);
    assert.equal(h.run('running'), true);
  }
});
