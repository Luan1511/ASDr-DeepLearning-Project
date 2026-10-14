/**
 * What the global error handler may log about an error. Some errors carry
 * request data: Prisma validation errors print the invocation arguments (e.g.
 * questionnaire answers or a Follow-Up "Other" description), and a JSON body
 * that does not parse (body-parser SyntaxError) keeps the raw body and quotes
 * part of it in its message. For those, only the name, the code and the first
 * line of the message are logged; never the body or the arguments.
 */
const MAX_LINE = 200

function firstLine(message: unknown): string {
  if (typeof message !== 'string') return ''
  const line = message.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  return line.trim().slice(0, MAX_LINE)
}

function isPrismaError(err: Error): boolean {
  return err.name.startsWith('PrismaClient')
}

/** express.json() parse failure: a SyntaxError with the raw `body` attached. */
export function isBodyParseError(err: unknown): err is SyntaxError & { type?: string; status?: number } {
  return err instanceof SyntaxError && ('body' in err || (err as { type?: unknown }).type === 'entity.parse.failed')
}

/**
 * A safe one-line summary for errors that may carry request data; null when
 * the error can be logged as is.
 */
export function redactedErrorSummary(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  if (isBodyParseError(err)) {
    // The message of a JSON SyntaxError quotes the body, so it is left out.
    const type = typeof err.type === 'string' ? err.type : 'parse error'
    return `${err.name} (${type}${typeof err.status === 'number' ? `, ${err.status}` : ''})`
  }
  if (isPrismaError(err)) {
    const code = (err as { code?: unknown }).code
    const line = firstLine(err.message)
    return `${err.name}${typeof code === 'string' ? ` ${code}` : ''}${line ? `: ${line}` : ''}`
  }
  return null
}

/** Message of every 500 response: the details stay in the server log. */
export const GENERIC_ERROR_MESSAGE = 'Unexpected error'
