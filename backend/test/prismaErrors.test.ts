import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { isSchemaOutdatedError } from '../src/lib/prismaErrors'
import { GENERIC_ERROR_MESSAGE, isBodyParseError, redactedErrorSummary } from '../src/lib/errorLog'

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`error ${code}`, { code, clientVersion: 'test' })

describe('isSchemaOutdatedError', () => {
  it('recognises missing tables and columns (unapplied migrations)', () => {
    assert.equal(isSchemaOutdatedError(known('P2021')), true)
    assert.equal(isSchemaOutdatedError(known('P2022')), true)
  })

  it('ignores other database errors', () => {
    assert.equal(isSchemaOutdatedError(known('P2002')), false)
    assert.equal(isSchemaOutdatedError(new Error('P2021')), false)
    assert.equal(isSchemaOutdatedError(null), false)
  })
})

describe('redactedErrorSummary (what the error handler may log)', () => {
  const SECRET = 'SECRET-ANSWER-OR-DESCRIPTION'

  it('Prisma errors: name, code and the first message line only, never the invocation arguments', () => {
    const validation = new Prisma.PrismaClientValidationError(
      `\nInvalid \`prisma.questionnaireResponse.create()\` invocation:\n\n{\n  data: {\n    followUpAnswers: { otherText: "${SECRET}" }\n  }\n}\n\nArgument \`x\` is missing.`,
      { clientVersion: 'test' },
    )
    const summary = redactedErrorSummary(validation)!
    assert.equal(summary, 'PrismaClientValidationError: Invalid `prisma.questionnaireResponse.create()` invocation:')
    assert.ok(!summary.includes(SECRET))

    const knownError = new Prisma.PrismaClientKnownRequestError(`\nInvalid invocation:\n\n${SECRET}`, {
      code: 'P2002',
      clientVersion: 'test',
    })
    assert.equal(redactedErrorSummary(knownError), 'PrismaClientKnownRequestError P2002: Invalid invocation:')
    const long = new Prisma.PrismaClientKnownRequestError('x'.repeat(500), { code: 'P2000', clientVersion: 'test' })
    assert.ok(redactedErrorSummary(long)!.length < 260)
  })

  it('body-parser SyntaxError: no message (it quotes the body) and never the body', () => {
    const err = Object.assign(new SyntaxError(`Unexpected token 'S', "{"x": ${SECRET}"... is not valid JSON`), {
      body: `{"x": ${SECRET}`,
      type: 'entity.parse.failed',
      status: 400,
    })
    assert.equal(isBodyParseError(err), true)
    const summary = redactedErrorSummary(err)!
    assert.equal(summary, 'SyntaxError (entity.parse.failed, 400)')
    assert.ok(!summary.includes(SECRET))
  })

  it('other errors are logged as they are', () => {
    assert.equal(redactedErrorSummary(new Error('boom')), null)
    assert.equal(redactedErrorSummary(new SyntaxError('in code, not a request body')), null)
    assert.equal(redactedErrorSummary('text'), null)
    assert.equal(redactedErrorSummary(null), null)
    assert.equal(GENERIC_ERROR_MESSAGE, 'Unexpected error')
  })
})
