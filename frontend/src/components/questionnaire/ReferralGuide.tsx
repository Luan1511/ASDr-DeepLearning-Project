import { useEffect, useState } from 'react'
import { ExternalLink, MapPin } from 'lucide-react'
import { MCHAT_LINKS, REFERRAL_GUIDE } from '../../lib/questionnaires'

/** Where to take the child, by facility TYPE (no names or phone numbers). Open by default for a high result. */
export function ReferralGuide({ defaultOpen, a365Url = MCHAT_LINKS.a365Url }: { defaultOpen: boolean; a365Url?: string }) {
  const [open, setOpen] = useState(defaultOpen)

  // A closed <details> prints only its summary: open it for the printout.
  useEffect(() => {
    const onBeforePrint = () => setOpen(true)
    window.addEventListener('beforeprint', onBeforePrint)
    return () => window.removeEventListener('beforeprint', onBeforePrint)
  }, [])

  return (
    <details
      className="panel-duo p-4 print:p-0 print:shadow-none"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-black text-duo-ink">
        <MapPin className="h-4 w-4 stroke-[2.5] text-duo-green-dark" aria-hidden="true" />
        Nơi có thể đưa con đi khám và hỗ trợ
        <span className="ml-auto text-xs font-extrabold text-duo-blue print:hidden">{open ? 'Thu gọn' : 'Xem'}</span>
      </summary>
      <ol className="mt-3 space-y-3">
        {REFERRAL_GUIDE.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-duo-mist text-xs font-black text-duo-ink">
              {i + 1}
            </span>
            <div>
              <div className="text-sm font-extrabold text-duo-ink">{step.title}</div>
              <p className="text-sm font-semibold leading-relaxed text-duo-ink">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <a href={a365Url} target="_blank" rel="noopener noreferrer" className="link-duo mt-3 inline-flex items-center gap-1 text-sm print:hidden">
        Mở a365.vn
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </details>
  )
}
