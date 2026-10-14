import { ExternalLink, ListChecks } from 'lucide-react'
import { MCHAT_LINKS, type QuestionnaireLinks } from '../../lib/questionnaires'
import type { QuestionnaireResponseDto } from '../../lib/questionnaireTypes'

/** Next steps for the outcome; the text itself comes from the backend copy (`response.actions`). */
export function NextStepsCard({
  response,
  links = MCHAT_LINKS,
}: {
  response: Pick<QuestionnaireResponseDto, 'outcome' | 'actions'>
  links?: QuestionnaireLinks
}) {
  const link =
    response.outcome === 'FOLLOW_UP_NEEDED'
      ? { href: links.a365Url, label: 'Mở ứng dụng a365' }
      : response.outcome === 'SCREEN_NEGATIVE'
        ? { href: links.cdcMilestonesUrl, label: 'Bảng kiểm các mốc phát triển (CDC)' }
        : null
  return (
    <section className="panel-duo space-y-2 p-4 print:p-0 print:shadow-none" aria-labelledby="questionnaire-next-steps">
      <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">
        <ListChecks className="h-4 w-4 stroke-[2.5] text-duo-green-dark" aria-hidden="true" />
        Bước tiếp theo
      </div>
      <h2 id="questionnaire-next-steps" className="text-base font-black text-duo-ink">
        {response.actions.title}
      </h2>
      {response.actions.body.map((p) => (
        <p key={p} className="text-sm font-semibold leading-relaxed text-duo-ink">
          {p}
        </p>
      ))}
      {link && (
        <a href={link.href} target="_blank" rel="noopener noreferrer" className="link-duo inline-flex items-center gap-1 text-sm print:hidden">
          {link.label}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </section>
  )
}
