import React from 'react'

const steps = [
  {
    icon: '☁️',
    color: 'from-sky-400 to-blue-500',
    title: 'Tải video',
    desc: 'Bạn tải video của trẻ lên hệ thống.',
  },
  {
    icon: '🧠',
    color: 'from-violet-400 to-purple-500',
    title: 'Xử lý & phân tích',
    desc: 'AI phân tích hành vi, vận động, biểu cảm, tương tác...',
  },
  {
    icon: '📊',
    color: 'from-indigo-400 to-blue-500',
    title: 'Đánh giá chỉ số',
    desc: 'Đánh giá dựa trên các mô hình học máy đã huấn luyện.',
  },
  {
    icon: '📋',
    color: 'from-amber-400 to-orange-500',
    title: 'Tổng hợp kết quả',
    desc: 'Tổng hợp các chỉ số quan trọng.',
  },
  {
    icon: '✅',
    color: 'from-emerald-400 to-teal-500',
    title: 'Kết quả tham khảo',
    desc: 'Nhận kết quả và khuyến nghị tham khảo.',
  },
]

const Arrow = () => (
  <div className="hidden md:flex items-center justify-center text-slate-300">
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  </div>
)

export function AnalysisSteps() {
  return (
    <div className="flex flex-col md:flex-row items-stretch gap-2 md:gap-0">
      {steps.map((s, idx) => (
        <React.Fragment key={s.title}>
          <div

            className="flex-1 flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-100 text-center"
          >
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${s.color} text-2xl shadow-md`}
            >
              {s.icon}
            </div>
            <div className="text-sm font-bold text-slate-800">{s.title}</div>
            <div className="text-xs leading-relaxed text-slate-500">{s.desc}</div>
          </div>
          {idx < steps.length - 1 && <Arrow key={`arrow-${idx}`} />}
        </React.Fragment>
      ))}
    </div>
  )
}
