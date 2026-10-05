const steps = [
  { n: '1', title: 'Quay & tải video', desc: 'Quay 6–10 giây trẻ đi thẳng, thấy toàn thân.' },
  { n: '2', title: 'AI phân tích', desc: 'Trích khung xương (OpenPose) và phân tích chuyển động.' },
  { n: '3', title: 'Kết quả', desc: 'Mức cần theo dõi và chỉ số dáng đi (tham khảo).' },
]

export function AnalysisSteps() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {steps.map((s) => (
        <div key={s.n} className="card-duo-interactive flex items-start gap-3 p-4">
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-duo-green text-sm font-black text-white">
            {s.n}
          </div>
          <div>
            <div className="text-sm font-extrabold text-duo-ink">{s.title}</div>
            <div className="mt-0.5 text-xs font-semibold leading-relaxed text-duo-mute">{s.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
