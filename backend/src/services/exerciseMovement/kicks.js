'use strict';

const { median, round } = require('./coordination.js');

const REPEATED = 'KICK_SAME_LEG_REPEATED';
const EXTENSION = 'KICK_EXTENSION_MISSING';
const LEGS = { right: [9, 10, 11], left: [12, 13, 14] };
const SIDES = Object.keys(LEGS);
const MIN_CONFIDENCE = 0.3;
const REST_RISE = 0.07;
const KICK_RISE = 0.14;
const MAX_SHARED_RISE = 0.25;
const MAX_SAMPLE_GAP = 0.14;
const MIN_EXTENSION_SOURCE_FPS = 12;

function joint(frame, index) {
  const point = frame.pose?.[index];
  return frame.confidence?.[index] >= MIN_CONFIDENCE && point?.every(Number.isFinite) ? point : null;
}

function measureLeg(frame, side) {
  const [hip, knee, ankle] = LEGS[side].map(index => joint(frame, index));
  if (!hip || !ankle) return null;
  const height = ankle[1] - hip[1];
  if (!knee) return { height, angle: null };
  const thigh = [hip[0] - knee[0], hip[1] - knee[1]];
  const shin = [ankle[0] - knee[0], ankle[1] - knee[1]];
  const thighLength = Math.hypot(...thigh);
  const shinLength = Math.hypot(...shin);
  const lengths = thighLength * shinLength;
  const cosine = lengths > 1e-8 ? (thigh[0] * shin[0] + thigh[1] * shin[1]) / lengths : null;
  const angle = cosine === null ? null : Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  return { height, angle, thighLength, shinLength };
}

function measurements(frames) {
  return frames.map(frame => ({ timeSec: frame.timeSec,
    right: measureLeg(frame, 'right'), left: measureLeg(frame, 'left') }));
}

function standing(rows, neutralRows) {
  const pairs = rows.filter(row => row.left && row.right);
  const neutral = neutralRows.filter(row => row.left && row.right);
  const result = {};
  for (const side of SIDES) {
    const candidates = (neutral.length >= 3 ? neutral : pairs).map(row => row[side]);
    if (candidates.length < 3) return null;
    const sorted = candidates.slice().sort((a, b) => a.height - b.height);
    const lowest = neutral.length >= 3 ? sorted : sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.2)));
    result[side] = {
      height: median(lowest.map(leg => leg.height)),
      angle: median(lowest.map(leg => leg.angle)),
      thighLength: median(lowest.map(leg => leg.thighLength)),
      shinLength: median(lowest.map(leg => leg.shinLength)),
    };
  }
  return result;
}

function scanKicks(rows, baseline) {
  if (!baseline) return [];
  const kicks = [];
  let block = 0;
  let restStart = null;
  let ready = false;
  let active = null;
  let lastTime = null;
  let departed = false;
  for (const row of rows) {
    const time = row.timeSec;
    if (!row.right || !row.left || (lastTime !== null && time - lastTime > MAX_SAMPLE_GAP)) {
      block++;
      restStart = null;
      ready = false;
      active = null;
      departed = false;
    }
    lastTime = time;
    if (!row.right || !row.left) continue;

    const rise = { right: row.right.height - baseline.right.height, left: row.left.height - baseline.left.height };
    // Relative elevation cancels common drift from the apparent torso scale or body rise.
    const difference = rise.right - rise.left;
    const elevation = Math.abs(difference);
    const sharedRise = Math.min(rise.right, rise.left);
    if (elevation <= REST_RISE && sharedRise <= MAX_SHARED_RISE) {
      if (active) {
        const duration = time - active.startSec;
        if (duration >= 0.18 && active.samples.length >= 3) {
          kicks.push({ ...active, endSec: time, block });
        } else {
          block++;
        }
        active = null;
        ready = false;
        restStart = null;
      } else if (departed) {
        // A visible but unresolved lift could be a kick on the other leg.
        block++;
        ready = false;
        restStart = null;
      }
      departed = false;
      restStart ??= time;
      ready ||= time - restStart >= 0.12;
      continue;
    }

    const side = difference > 0 ? 'right' : 'left';
    departed = true;
    if (sharedRise > MAX_SHARED_RISE || (active && active.side !== side)) {
      block++;
      restStart = null;
      ready = false;
      active = null;
      continue;
    }
    if (!active && ready && elevation >= KICK_RISE) {
      if (time - restStart > 4) block++;
      active = { side, startSec: time, peakRise: elevation, samples: [] };
    }
    if (active) {
      active.peakRise = Math.max(active.peakRise, elevation);
      active.samples.push({ timeSec: time, rise: elevation, ...row[side] });
    }
  }
  return kicks;
}

function raisedPhase(kick, baseline) {
  if (!baseline || !(baseline.angle >= 145) || !(baseline.thighLength > 0) || !(baseline.shinLength > 0)) return null;
  const raised = kick.samples.filter(sample => sample.rise >= 0.5 * kick.peakRise);
  if (raised.length < 3) return null;
  const observed = raised.every(sample => Number.isFinite(sample.angle) &&
    sample.thighLength >= 0.8 * baseline.thighLength && sample.shinLength >= 0.8 * baseline.shinLength);
  if (!observed) return null;
  const angles = raised.map(sample => sample.angle);
  let smallest = angles[0];
  let maxUnfolding = 0;
  for (const angle of angles) {
    smallest = Math.min(smallest, angle);
    maxUnfolding = Math.max(maxUnfolding, angle - smallest);
  }
  return { durationSec: raised.at(-1).timeSec - raised[0].timeSec,
    maxAngle: Math.max(...angles), maxUnfolding,
    standingAngle: baseline.angle, sampleCount: raised.length };
}

function extensionReference(guideFrames, neutralFrames, sourceFps) {
  if (!(sourceFps >= MIN_EXTENSION_SOURCE_FPS)) {
    return { valid: false, measurableKicks: 0, extendedKicks: 0, reason: 'REFERENCE_FPS_TOO_LOW' };
  }
  const rows = measurements(guideFrames);
  const baseline = standing(rows, measurements(neutralFrames));
  const phases = scanKicks(rows, baseline).map(kick => raisedPhase(kick, baseline[kick.side])).filter(Boolean);
  const clearlyExtended = phases.filter(phase => phase.maxAngle >= phase.standingAngle - 25);
  return { valid: clearlyExtended.length >= 2 && clearlyExtended.length >= 0.75 * phases.length,
    measurableKicks: phases.length, extendedKicks: clearlyExtended.length };
}

function runs(kicks, accept, extendsRun) {
  const result = [];
  let current = [];
  for (const kick of kicks) {
    if (current.length && (!accept(kick) || !extendsRun(current.at(-1), kick))) {
      if (current.length >= 2) result.push(current);
      current = [];
    }
    if (accept(kick)) current.push(kick);
  }
  if (current.length >= 2) result.push(current);
  return result;
}

function sameBlock(a, b) {
  return a.block === b.block;
}

function bounds(group) {
  return { startSec: round(group[0].startSec), endSec: round(group.at(-1).endSec) };
}

function analyzeWithReference(frames, reference, options = {}) {
  const rows = measurements(frames);
  const baseline = standing(rows, measurements(options.neutralFrames ?? []));
  const kicks = scanKicks(rows, baseline);
  const sufficientFps = options.sourceFps >= MIN_EXTENSION_SOURCE_FPS;
  for (const kick of kicks) {
    kick.extension = 'unmeasurable';
    if (!reference.valid || !sufficientFps) continue;
    const phase = raisedPhase(kick, baseline[kick.side]);
    if (!phase || phase.durationSec < 0.23) continue;
    kick.phase = phase;
    // A clear unfolding or a raised, nearly straight leg counts as extension. Use a generous margin
    // from the person's own standing angle and a minimum opening that exceeds small tracking jitter.
    kick.extension = phase.maxAngle < phase.standingAngle - 40 && phase.maxUnfolding < 20 ? 'missing' : 'observed';
  }

  const repeats = runs(kicks, () => true, (a, b) => sameBlock(a, b) && a.side === b.side);
  const missing = runs(kicks, kick => kick.extension === 'missing', sameBlock);
  const repeatEvaluated = kicks.some((kick, index) => index > 0 && sameBlock(kicks[index - 1], kick));
  const extensionEvaluated = kicks.some(kick => kick.extension !== 'unmeasurable');
  const checks = [
    { code: REPEATED, status: repeatEvaluated ? 'evaluated' : 'unmeasurable',
      reason: repeatEvaluated ? undefined : 'NEED_CONSECUTIVE_COMPLETE_VISIBLE_KICKS' },
    { code: EXTENSION, status: extensionEvaluated ? 'evaluated' : 'unmeasurable',
      reason: extensionEvaluated ? undefined : !sufficientFps ? 'SOURCE_FPS_TOO_LOW_OR_UNKNOWN' :
        !reference.valid ? reference.reason ?? 'REFERENCE_EXTENSION_UNCONFIRMED' : 'EXTENSION_PHASE_UNOBSERVABLE' },
  ];
  const events = [
    ...repeats.map(group => ({ code: REPEATED, label: 'Đá liên tiếp cùng một chân', ...bounds(group),
      feedback: 'Con thử đổi sang chân bên kia ở lượt tiếp theo nhé.',
      evidence: { kickCount: group.length, trackedSide: group[0].side,
        kickStartTimesSec: group.map(kick => round(kick.startSec)) } })),
    ...missing.map(group => ({ code: EXTENSION, label: 'Nhấc gối rồi hạ, thiếu pha duỗi chân', ...bounds(group),
      feedback: 'Sau khi nhấc gối, con thử duỗi chân ra một chút rồi hạ xuống nhé.',
      evidence: { kickCount: group.length, maximumKneeAnglesDeg: group.map(kick => round(kick.phase.maxAngle, 1)),
        standingKneeAnglesDeg: group.map(kick => round(kick.phase.standingAngle, 1)),
        kickStartTimesSec: group.map(kick => round(kick.startSec)) } })),
  ].sort((a, b) => a.startSec - b.startSec);
  const diagnostics = kicks.map(({ samples, ...kick }) => kick);
  return { checks, events, kicks: diagnostics, reference };
}

function analyze(frames, guideFrames = [], options = {}) {
  const reference = extensionReference(guideFrames, options.guideNeutralFrames ?? [], options.guideSourceFps ?? 15);
  return analyzeWithReference(frames, reference, options);
}

module.exports = { analyze, buildReference: extensionReference, analyzeWithReference };

