import { RESPONDENTS, RESPONDENT_LABEL } from '../../lib/questionnaires'
import type { Respondent } from '../../lib/questionnaireTypes'

/** Who answers the questionnaire (native radios: arrow keys move between options). */
export function RespondentPicker({
  value,
  onChange,
  labelledBy,
  name = 'mchat-respondent',
}: {
  value: Respondent | null
  onChange: (value: Respondent) => void
  labelledBy: string
  name?: string
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {RESPONDENTS.map((r) => (
        <label
          key={r}
          className={[
            'flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold',
            value === r ? 'bg-duo-green-soft text-duo-green-dark ring-2 ring-duo-green' : 'bg-duo-mist text-duo-ink',
          ].join(' ')}
        >
          <input
            type="radio"
            name={name}
            className="h-4 w-4 accent-duo-green"
            checked={value === r}
            onChange={() => onChange(r)}
          />
          {RESPONDENT_LABEL[r]}
        </label>
      ))}
    </div>
  )
}
