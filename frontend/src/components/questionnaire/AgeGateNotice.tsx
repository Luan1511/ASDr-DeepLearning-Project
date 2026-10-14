import { CalendarClock, ExternalLink } from 'lucide-react'
import { MCHAT_LINKS, tooOldMessage, tooYoungMessage } from '../../lib/questionnaires'
import type { EligibilityDto } from '../../lib/questionnaireTypes'

/** Shown instead of the questionnaire when the child is outside 16–30 months; renders nothing when eligible. */
export function AgeGateNotice({
  eligibility,
  cdcMilestonesUrl = MCHAT_LINKS.cdcMilestonesUrl,
}: {
  eligibility: EligibilityDto
  cdcMilestonesUrl?: string
}) {
  if (eligibility.eligible) return null
  const message =
    eligibility.reason === 'TOO_OLD'
      ? tooOldMessage(eligibility.ageMonths)
      : tooYoungMessage(eligibility.ageMonths, eligibility.eligibleFrom)
  return (
    <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink" role="note">
      <div className="flex gap-2.5">
        <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 stroke-[2.5] text-duo-green-dark" aria-hidden="true" />
        <div className="space-y-2">
          <p>{message}</p>
          <a href={cdcMilestonesUrl} target="_blank" rel="noopener noreferrer" className="link-duo inline-flex items-center gap-1 text-xs">
            Bảng kiểm các mốc phát triển (CDC)
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  )
}
