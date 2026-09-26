import { useRef, useState } from 'react'
import { Video, Upload } from 'lucide-react'

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
      className={[
        'rounded-2xl border-2 border-dashed p-8 text-center transition-all',
        dragging
          ? 'border-duo-green bg-duo-green-soft shadow-ring-green'
          : 'border-duo-line bg-duo-mist shadow-card-inner',
        disabled ? 'opacity-50' : '',
      ].join(' ')}
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
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-duo-green-soft text-duo-green-dark shadow-sm">
        <Video className="h-7 w-7 stroke-[2.2]" />
      </div>
      <div className="mt-3 text-base font-extrabold text-duo-ink">Kéo video vào đây</div>
      <div className="mt-1 text-sm font-semibold text-duo-mute">hoặc</div>

      <button
        type="button"
        disabled={disabled}
        className="btn-duo mt-4 gap-2"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4 stroke-[2.5]" />
        <span>Chọn tệp</span>
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

      {helperText && <div className="mt-3 text-xs font-bold text-duo-mute">{helperText}</div>}
    </div>
  )
}
