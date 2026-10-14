import { COPYRIGHT_DOWNLOAD_TEXT, COPYRIGHT_TEXT, MCHAT_LINKS, extraCopyrightNotice } from '../../lib/questionnaires'

/**
 * Required on every questionnaire screen (including the printed result). The official line
 * is always shown; `notice` (the content file's credit line, e.g. the translation source) is
 * shown in addition, verbatim, only when provided and different from the official line.
 */
export function CopyrightLine({
  officialFormUrl = MCHAT_LINKS.officialFormUrl,
  notice,
}: {
  officialFormUrl?: string
  notice?: string | null
}) {
  const extra = extraCopyrightNotice(notice)
  return (
    <p className="text-xs font-semibold leading-relaxed text-duo-mute">
      {COPYRIGHT_TEXT} {COPYRIGHT_DOWNLOAD_TEXT}{' '}
      <a href={officialFormUrl} target="_blank" rel="noopener noreferrer" className="link-duo">
        mchatscreen.com
      </a>
      .{extra && <span className="mt-0.5 block whitespace-pre-line">{extra}</span>}
    </p>
  )
}
