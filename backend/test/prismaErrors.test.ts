import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { isSchemaOutdatedError } from '../src/lib/prismaErrors'

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
