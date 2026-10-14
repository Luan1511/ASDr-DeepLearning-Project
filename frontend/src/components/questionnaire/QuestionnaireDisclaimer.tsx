import { Info } from 'lucide-react'
import { QUESTIONNAIRE_DISCLAIMER } from '../../lib/questionnaires'

/** Fixed disclaimer of every questionnaire result (spec §6.2); deliberately has no props. */
export function QuestionnaireDisclaimer() {
  return (
    <div className="flex gap-2.5 rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink print:bg-white print:px-0">
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0 stroke-[2.5] text-duo-mute" aria-hidden="true" />
      <p>{QUESTIONNAIRE_DISCLAIMER}</p>
    </div>
  )
}
