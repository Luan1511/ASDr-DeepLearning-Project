import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm'
import ortLoader from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url'
import ortWasm from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'

const asset = (url: string) => new URL(url, self.location.origin).href
const model = asset(import.meta.env.BASE_URL + 'buddy-vision/sface-int8.onnx')
env.logLevel = 'error'
env.wasm.numThreads = 1
env.wasm.wasmPaths = { mjs: asset(ortLoader), wasm: asset(ortWasm) }
let recognition: InferenceSession | undefined

self.onmessage = async ({ data }: MessageEvent<Float32Array>) => {
  try {
    recognition ??= await InferenceSession.create(model, { executionProviders: ['wasm'], logSeverityLevel: 3 })
    const result = await recognition.run({
      [recognition.inputNames[0]]: new Tensor('float32', data, [1, 3, 112, 112]),
    })
    const values = result[recognition.outputNames[0]].data
    if (!(values instanceof Float32Array) || values.length !== 128) throw new Error('Invalid embedding')
    const norm = Math.hypot(...values)
    if (!Number.isFinite(norm) || norm <= 0) throw new Error('Invalid embedding')
    self.postMessage(Array.from(values, (value) => value / norm))
  } catch {
    self.postMessage(null)
  }
}
