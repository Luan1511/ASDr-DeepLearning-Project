import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MessageCircleHeart, Play, Square } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { BuddyCharacter } from '../components/buddy/BuddyCharacter'
import { ARM } from '../lib/buddy/geometry'
import {
  BuddyAntenna,
  BuddyArm,
  BuddyBlush,
  BuddyBrow,
  BuddyCore,
  BuddyEar,
  BuddyEarpiece,
  BuddyEye,
  BuddyForearm,
  BuddyHand,
  BuddyHelmet,
  BuddyJoint,
  BuddyMouth,
  BuddyNeck,
  BuddyTorso,
  BuddyUpperArm,
} from '../components/buddy/BuddyParts'
import {
  BuddyDirector,
  EXPRESSION_LIBRARY,
  GESTURE_NAMES,
  NEUTRAL_POSE,
  normalizeScript,
  useBuddyFrame,
} from '../lib/buddy/engine'
import {
  BROW_SHAPES,
  EAR_MOTIONS,
  EXPRESSIONS,
  EYE_SHAPES,
  HAND_SHAPES,
  MOUTH_SHAPES,
  type ExpressionName,
  type Pose,
} from '../lib/buddy/types'

const EXPRESSION_LABEL: Record<ExpressionName, string> = {
  neutral: 'Bình thường',
  happy: 'Vui vẻ',
  curious: 'Tò mò',
  encourage: 'Động viên',
  surprised: 'Bất ngờ',
  listening: 'Lắng nghe',
  thinking: 'Suy nghĩ',
  sad: 'Buồn',
  proud: 'Tự hào',
}

const GESTURE_LABEL: Record<string, string> = {
  wave: 'Chào hỏi',
  cheer: 'Cổ vũ',
  clap: 'Vỗ tay',
  thumbs_up: 'Like',
  think: 'Suy nghĩ',
  nod: 'Gật đầu',
  shake_head: 'Lắc đầu',
  shrug: 'Nhún vai',
  peace: 'Chữ V',
  ok: 'OK',
  point: 'Chỉ tay',
  hug: 'Ôm an ủi',
  dance: 'Nhún nhảy',
  listen: 'Nghe ngóng',
}

const SAMPLE_SCRIPT = `{
  "steps": [
    { "say": "Xin chào! Bin đây!", "expression": "happy", "gesture": "wave", "ears": "wiggle" },
    { "say": "Bạn làm tốt lắm!", "expression": "proud", "gesture": "clap" },
    { "say": "Hmm, để Bin nghĩ xem...", "expression": "thinking", "gesture": "think", "hold": 2600 },
    {
      "say": "Nhìn Bin tự múa nè!",
      "expression": "encourage",
      "gesture": {
        "duration": 1600,
        "keyframes": [
          { "t": 400, "ease": "back", "pose": { "armLeft.shoulder": 150, "armLeft.elbow": 20, "armLeft.hand": "open",
                                                  "armRight.shoulder": 60, "armRight.elbow": -60, "body.lean": -6 } },
          { "t": 1000, "ease": "ease", "pose": { "armLeft.shoulder": 60, "armLeft.elbow": -60,
                                                  "armRight.shoulder": 150, "armRight.elbow": 20, "armRight.hand": "open", "body.lean": 6 } },
          { "t": 1600, "ease": "ease", "pose": { "body.lean": 0 } }
        ]
      },
      "ears": "flap"
    }
  ],
  "idle": "listening"
}`

function staticFrame(over: Partial<Pose>) {
  return { pose: { ...NEUTRAL_POSE, ...over } as Pose, blink: 0 }
}

function Tile({ label, viewBox, children, size = 'h-24' }: { label: string; viewBox: string; children: ReactNode; size?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl bg-white p-2 shadow-card-inner">
      <svg viewBox={viewBox} className={`${size} w-full`}>
        {children}
      </svg>
      <div className="text-xs font-extrabold text-duo-mute">{label}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card-duo p-5">
      <h2 className="mb-4 inline-block rounded-full bg-[#DCE6FA] px-4 py-1 text-sm font-black text-[#172B6B]">{title}</h2>
      {children}
    </section>
  )
}

export function BuddyStudioPage() {
  const director = useMemo(() => new BuddyDirector(), [])
  const frame = useBuddyFrame(director)
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT)
  const [scriptError, setScriptError] = useState<string | null>(null)
  const [expression, setExpression] = useState<ExpressionName>('neutral')

  const playScript = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(scriptText)
    } catch (e) {
      setScriptError(`JSON lỗi: ${(e as Error).message}`)
      return
    }
    const script = normalizeScript(parsed)
    if (!script) {
      setScriptError('Không có bước nào hợp lệ trong "steps".')
      return
    }
    setScriptError(null)
    director.stopAll()
    void director.runScript(script, (_, step) => step.expression && setExpression(step.expression))
  }

  const chooseExpression = (name: ExpressionName) => {
    setExpression(name)
    director.setExpression(name)
  }

  return (
    <DashboardLayout>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="btn-duo-ghost !px-3">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-duo-ink">Studio nhân vật Bin</h1>
            <p className="text-sm font-semibold text-duo-mute">Bộ phận, biểu cảm, cử chỉ và bộ JSON điều khiển.</p>
          </div>
        </div>
        <Link to="/buddy" className="btn-duo-blue">
          <MessageCircleHeart className="h-4 w-4" /> Trò chuyện với Bin
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          <Section title="Nhân vật chính (thân trên)">
            <div className="rounded-3xl bg-gradient-to-b from-[#EAF1FF] to-white">
              <BuddyCharacter frame={frame} className="mx-auto h-[360px] w-full" />
            </div>
            <div className="mt-2 min-h-[2.5rem] text-center text-lg font-extrabold text-[#172B6B]">{frame.caption?.visible}</div>
            <div className="text-center text-xs font-bold text-duo-mute">Biểu cảm: {EXPRESSION_LABEL[expression]}</div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Biểu cảm khuôn mặt">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
              {EXPRESSIONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => chooseExpression(name)}
                  className={[
                    'flex flex-col items-center rounded-2xl bg-white p-1 shadow-card-inner transition',
                    expression === name ? 'ring-2 ring-[#1E3F9E]' : 'hover:shadow-card-hover',
                  ].join(' ')}
                >
                  <BuddyCharacter
                    frame={staticFrame(EXPRESSION_LIBRARY[name] as Partial<Pose>)}
                    viewBox="70 -20 260 280"
                    className="h-20 w-full"
                  />
                  <span className="text-xs font-extrabold text-duo-ink">{EXPRESSION_LABEL[name]}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Cử chỉ & tai">
            <div className="flex flex-wrap gap-2">
              {GESTURE_NAMES.map((name) => (
                <button key={name} type="button" className="btn-duo-ghost !px-3 !py-2 !text-xs" onClick={() => director.play(name, { id: 'studio' })}>
                  {GESTURE_LABEL[name] ?? name}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EAR_MOTIONS.filter((m) => m !== 'none').map((m) => (
                <button key={m} type="button" className="btn-duo-ghost !px-3 !py-2 !text-xs" onClick={() => director.play(`ears_${m}`, { id: 'studio-ears' })}>
                  Tai: {m}
                </button>
              ))}
              <button
                type="button"
                className="btn-duo-ghost !px-3 !py-2 !text-xs"
                onClick={() => director.say('Bin đang tập nói nè, bạn có nghe thấy không?')}
              >
                Thử miệng nói
              </button>
            </div>
          </Section>

          <Section title="Các bộ phận (parts)">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Tile label="Thân" viewBox="112 248 176 212">
                <BuddyTorso />
              </Tile>
              <Tile label="Cổ" viewBox="170 222 60 56">
                <BuddyNeck />
              </Tile>
              <Tile label="Đầu" viewBox="78 48 244 206">
                <BuddyHelmet />
              </Tile>
              <Tile label="Tai (vẫy được)" viewBox="-40 -105 80 120">
                <BuddyEar />
              </Tile>
              <Tile label="Ăng-ten" viewBox="-25 -55 50 62">
                <BuddyAntenna />
              </Tile>
              <Tile label="Tai nghe" viewBox="-25 -36 50 72">
                <BuddyEarpiece />
              </Tile>
              <Tile label="Cánh tay" viewBox={`-30 -10 60 ${ARM.upper + 20}`}>
                <BuddyUpperArm />
              </Tile>
              <Tile label="Cẳng tay" viewBox={`-30 -10 60 ${ARM.fore + 20}`}>
                <BuddyForearm />
              </Tile>
              <Tile label="Khớp vai / khuỷu" viewBox="-24 -24 48 48">
                <BuddyJoint />
              </Tile>
              <Tile label="Lõi phát sáng" viewBox="-30 -30 60 60">
                <BuddyCore glow={1} />
              </Tile>
              <Tile label="Cả cánh tay" viewBox="-34 -24 68 170">
                <BuddyArm shoulder={0} elbow={0} wrist={0} hand="open" />
              </Tile>
              <Tile label="Má hồng" viewBox="-20 -14 40 28">
                <BuddyBlush amount={1} />
              </Tile>
            </div>

            <h3 className="mb-2 mt-5 text-sm font-black text-duo-ink">Bàn tay</h3>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
              {HAND_SHAPES.map((h) => (
                <Tile key={h} label={h} viewBox="-30 -6 60 60" size="h-16">
                  <BuddyHand shape={h} />
                </Tile>
              ))}
            </div>

            <h3 className="mb-2 mt-5 text-sm font-black text-duo-ink">Mắt · Lông mày · Miệng</h3>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-9">
              {EYE_SHAPES.map((e) => (
                <Tile key={e} label={`mắt: ${e}`} viewBox="-24 -26 48 52" size="h-12">
                  <BuddyEye shape={e === 'wink' ? 'happy' : e} />
                </Tile>
              ))}
              {BROW_SHAPES.map((b) => (
                <Tile key={b} label={`mày: ${b}`} viewBox="-20 -16 40 26" size="h-12">
                  <BuddyBrow shape={b} />
                </Tile>
              ))}
              {MOUTH_SHAPES.map((m) => (
                <Tile key={m} label={`miệng: ${m}`} viewBox="-24 -12 48 40" size="h-12">
                  <BuddyMouth shape={m} />
                </Tile>
              ))}
            </div>
          </Section>

          <Section title="Bộ JSON điều khiển (playground)">
            <p className="mb-3 text-sm font-semibold text-duo-mute">
              Mỗi bước gồm <code>say</code>, <code>expression</code>, <code>gesture</code> (tên trong thư viện hoặc clip keyframe
              tự viết), <code>ears</code>, <code>look</code>, <code>pose</code>, <code>hold</code>. Đây cũng là định dạng backend/LLM trả về.
            </p>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              spellCheck={false}
              className="h-80 w-full rounded-2xl bg-[#0D1B45] p-4 font-mono text-xs leading-relaxed text-[#DCE6FA] outline-none"
            />
            {scriptError && <div className="mt-2 text-sm font-bold text-duo-red">{scriptError}</div>}
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn-duo-blue" onClick={playScript}>
                <Play className="h-4 w-4" /> Chạy script
              </button>
              <button
                type="button"
                className="btn-duo-ghost"
                onClick={() => {
                  director.cancelScript()
                  director.stopAll()
                  director.say('')
                  chooseExpression('neutral')
                }}
              >
                <Square className="h-4 w-4" /> Dừng
              </button>
            </div>
          </Section>
        </div>
      </div>
    </DashboardLayout>
  )
}
