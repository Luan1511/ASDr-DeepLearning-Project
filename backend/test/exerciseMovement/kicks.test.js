'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../../src/services/exerciseMovement/kicks.js');

const REPEATED = 'KICK_SAME_LEG_REPEATED';
const EXTENSION = 'KICK_EXTENSION_MISSING';
const radians = degrees => degrees * Math.PI / 180;

function frame(index, side, lift, bend, visibility = 'full') {
  const pose = Array(25).fill(null);
  const confidence = Array(25).fill(1);
  pose[8] = [0, 0];
  for (const [name, start, x] of [['right', 9, -0.2], ['left', 12, 0.2]]) {
    const active = name === side;
    const thigh = radians(active ? lift : 0);
    const shin = radians(active ? lift - bend : 0);
    const length = active && visibility === 'foreshortened' ? 0.4 : 0.6;
    pose[start] = [x, 0];
    pose[start + 1] = [x + Math.sin(thigh) * length, -Math.cos(thigh) * length];
    pose[start + 2] = [pose[start + 1][0] + Math.sin(shin) * length,
      pose[start + 1][1] - Math.cos(shin) * length];
    if (active && visibility === 'hidden-knee') confidence[start + 1] = 0.1;
    if (active && visibility === 'hidden-ankle') confidence[start + 2] = 0.1;
  }
  return { timeSec: index / 15, pose, confidence };
}

function recording(kicks, { lift = 65, bend = 0, slowdown = 1, visibility = 'full' } = {}) {
  const frames = [];
  const add = (side, a, b, mode) => frames.push(frame(frames.length, side, a, b, mode));
  for (let i = 0; i < 8; i++) add(null, 0, 0);
  for (const side of kicks) {
    for (let i = 1; i <= 6 * slowdown; i++) {
      const fraction = i / (6 * slowdown);
      add(side, lift * fraction, bend * fraction, fraction >= 0.75 ? visibility : 'full');
    }
    for (let i = 0; i < 7 * slowdown; i++) add(side, lift, bend, visibility);
    for (let i = 6 * slowdown - 1; i >= 0; i--) {
      const fraction = i / (6 * slowdown);
      add(side, lift * fraction, bend * fraction, fraction >= 0.75 ? visibility : 'full');
    }
    for (let i = 0; i < 7; i++) add(null, 0, 0);
  }
  return frames;
}

const guide = recording(['left', 'right', 'left', 'right']);
const run = (frames, options = {}) => analyze(frames, guide, { sourceFps: 15, guideSourceFps: 15, ...options });
const status = (report, code) => report.checks.find(check => check.code === code).status;

test('detects two same-leg kicks and keeps the preceding opposite kick out of the event', () => {
  const result = run(recording(['left', 'right', 'right']));
  const repeat = result.events.find(event => event.code === REPEATED);
  assert.equal(repeat.evidence.kickCount, 2);
  assert.equal(repeat.evidence.trackedSide, 'right');
  assert.ok(repeat.startSec > result.kicks[0].endSec);
  assert.ok(repeat.endSec <= result.kicks.at(-1).endSec + 0.001);
});

test('detects both faults in the same bout using separate observations', () => {
  const result = run(recording(['right', 'right', 'right'], { lift: 70, bend: 70 }));
  assert.deepEqual(new Set(result.events.map(event => event.code)), new Set([REPEATED, EXTENSION]));
  const missing = result.events.find(event => event.code === EXTENSION);
  assert.equal(missing.evidence.kickCount, 3);
  assert.ok(missing.evidence.maximumKneeAnglesDeg.every(angle => angle < 140));
});

test('accepts alternating lower kicks and a slower pace', () => {
  const result = run(recording(['left', 'right', 'left'], { lift: 34, slowdown: 2 }));
  assert.equal(result.kicks.length, 3);
  assert.equal(status(result, REPEATED), 'evaluated');
  assert.equal(status(result, EXTENSION), 'evaluated');
  assert.deepEqual(result.events, []);
});

test('hidden knees and foreshortening leave extension unmeasurable even when foot lifts are visible', () => {
  for (const visibility of ['hidden-knee', 'foreshortened']) {
    const result = run(recording(['left', 'left'], { lift: 70, bend: 70, visibility }));
    assert.equal(status(result, EXTENSION), 'unmeasurable');
    assert.ok(result.events.some(event => event.code === REPEATED));
    assert.ok(result.events.every(event => event.code !== EXTENSION));
  }
});

test('sparse source frames cannot establish absence of extension after resampling', () => {
  const result = run(recording(['right', 'right'], { lift: 70, bend: 70 }), { sourceFps: 5 });
  assert.equal(status(result, EXTENSION), 'unmeasurable');
  assert.deepEqual(result.events.map(event => event.code), [REPEATED]);
});

test('a sparse guide cannot establish the expected extension phase', () => {
  const result = run(recording(['right', 'right'], { lift: 70, bend: 70 }), { guideSourceFps: 5 });
  assert.equal(status(result, EXTENSION), 'unmeasurable');
  assert.equal(result.reference.reason, 'REFERENCE_FPS_TOO_LOW');
  assert.deepEqual(result.events.map(event => event.code), [REPEATED]);
});

test('a shared change in projected leg height does not hide a visible alternating kick', () => {
  const frames = recording(['left', 'right', 'left']);
  const neutralFrames = frames.slice(0, 8);
  for (const sample of frames.slice(8)) {
    for (const joint of [10, 11, 13, 14]) sample.pose[joint][1] *= 0.9;
  }
  const result = run(frames, { neutralFrames });
  assert.deepEqual(result.kicks.map(kick => kick.side), ['left', 'right', 'left']);
  assert.ok(result.events.every(event => event.code !== REPEATED));
});

test('a hidden intervening kick prevents inferring repeated side', () => {
  const frames = recording(['left', 'right', 'left']);
  for (const sample of frames.slice(8 + 26, 8 + 26 + 19)) {
    sample.confidence[11] = 0.1;
  }
  const result = run(frames);
  assert.equal(result.kicks.length, 2);
  assert.equal(status(result, REPEATED), 'unmeasurable');
  assert.ok(result.events.every(event => event.code !== REPEATED));
});

test('an unresolved smaller movement between two kicks breaks repetition evidence', () => {
  const frames = recording(['left', 'right', 'left']);
  const small = recording(['right'], { lift: 26 });
  frames.splice(8 + 26, 26, ...small.slice(8).map((sample, index) => ({ ...sample, timeSec: (8 + 26 + index) / 15 })));
  const result = run(frames);
  assert.equal(result.kicks.length, 2);
  assert.equal(status(result, REPEATED), 'unmeasurable');
  assert.ok(result.events.every(event => event.code !== REPEATED));
});

test('an unfinished last kick cannot provide repetition evidence', () => {
  const result = run(recording(['left', 'left']).slice(0, 8 + 26 + 13));
  assert.equal(result.kicks.length, 1);
  assert.equal(status(result, REPEATED), 'unmeasurable');
  assert.deepEqual(result.events, []);
});

