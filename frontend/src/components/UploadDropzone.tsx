import { useRef, useState } from 'react'

export function UploadDropzone({
  disabled,
  onFileSelected,
  helperText,
}: {
  disabled?: boolean
  onFileSelected: (file: File) => void
  helperText?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={
        [
          'rounded-2xl border border-dashed p-6 text-center transition',
          dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50',
          disabled ? 'opacity-60' : 'hover:border-indigo-300',
        ].join(' ')
      }
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
        if (disabled) return
        const f = e.dataTransfer.files?.[0]
        if (f) onFileSelected(f)
      }}
    >
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">☁️</div>
      <div className="mt-3 text-sm font-semibold text-slate-900">Kéo và thả video vào đây</div>
      <div className="mt-1 text-xs text-slate-500">hoặc</div>

      <button
        type="button"
        disabled={disabled}
        className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        onClick={() => inputRef.current?.click()}
      >
        Chọn tệp video
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov,.avi"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFileSelected(f)
          e.currentTarget.value = ''
        }}
      />

      {helperText && <div className="mt-3 text-xs text-slate-500">{helperText}</div>}
    </div>
  )
}
