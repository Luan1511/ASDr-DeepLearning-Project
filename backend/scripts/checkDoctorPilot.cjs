// Local API integration check. Creates isolated accounts and removes them afterward.
require('dotenv/config')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const database = new URL(process.env.DATABASE_URL)
assert(['localhost', '127.0.0.1'].includes(database.hostname) && database.port === '5435', 'Run only against the local pilot database on port 5435')
const tag = randomUUID()
const accounts = []
let doctorId

async function call(path, token, method = 'GET', body) {
  const response = await fetch(`http://localhost:4000/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, body: await response.json() }
}
async function account(role) {
  const user = await prisma.user.create({ data: { name: `Doctor pilot check ${role}`, email: `${tag}-${role}@example.test`, passwordHash: '!integration-only', role: role === 'ADMIN' ? 'ADMIN' : 'USER' } })
  accounts.push(user.id)
  return { user, token: jwt.sign({ email: user.email, name: user.name, role: user.role }, process.env.JWT_SECRET, { subject: user.id, expiresIn: '10m' }) }
}

async function main() {
  const admin = await account('ADMIN')
  const parent = await account('PARENT')
  const outsider = await account('OUTSIDER')
  const email = `${tag}-doctor@example.test`
  const invite = await call('/admin/doctors/invitations', admin.token, 'POST', { email, displayName: 'Pilot Check Doctor', title: 'BS.', specialty: 'Nhi khoa', workplace: 'Pilot Test', city: 'Test', bio: 'Integration check', languages: [] })
  assert.equal(invite.status, 201)
  const accepted = await call('/auth/doctor-invitations/accept', null, 'POST', { token: invite.body.invitation.token, password: 'pilot-test-password-2026' })
  assert.equal(accepted.status, 201)
  const doctor = await prisma.doctorProfile.findFirstOrThrow({ where: { user: { email } } })
  doctorId = doctor.id
  accounts.push(doctor.userId)
  assert.equal((await call('/auth/doctor-invitations/accept', null, 'POST', { token: invite.body.invitation.token, password: 'pilot-test-password-2026' })).status, 400)
  const listed = async () => (await call('/doctors', parent.token)).body.doctors.some((row) => row.id === doctorId)
  assert.equal(await listed(), false)
  assert.equal((await call(`/admin/doctors/${doctorId}/active`, admin.token, 'PATCH', { active: true })).status, 409)
  assert.equal((await call(`/admin/doctors/${doctorId}/verification`, admin.token, 'PATCH', { status: 'VERIFIED' })).status, 200)
  assert.equal(await listed(), false)
  assert.equal((await call(`/admin/doctors/${doctorId}/active`, admin.token, 'PATCH', { active: true })).status, 200)
  assert.equal(await listed(), true)
  const login = await call('/auth/login', null, 'POST', { email, password: 'pilot-test-password-2026' })
  assert.equal(login.status, 200)
  const doctorToken = login.body.token
  const child = await prisma.childProfile.create({ data: { userId: parent.user.id, fullName: 'Pilot check child', dateOfBirth: new Date('2023-01-01') } })
  const statement = (await call('/doctors/share-statement', parent.token)).body.statement
  const grant = async () => {
    const result = await call(`/children/${child.id}/doctor-links`, parent.token, 'POST', { doctorId, scopes: ['PROFILE'], accepted: true, version: statement.version, durationDays: 30 })
    assert.equal(result.status, 201)
    return result.body.link
  }
  const link = await grant()
  const directory = (await call('/doctors', parent.token)).body.doctors.find((row) => row.id === doctorId)
  assert.equal(directory.verified, true)
  assert.ok(directory.links[0].expiresAt)
  const patients = await call('/doctor/patients', doctorToken)
  assert.equal(patients.body.patients.find((row) => row.linkId === link.id).expiresAt, link.expiresAt)
  const record = await call(`/doctor/patients/${link.id}`, doctorToken)
  assert.equal(record.status, 200)
  assert.equal('screenings' in record.body, false)
  assert.equal('questionnaires' in record.body, false)
  assert.equal('exercises' in record.body, false)
  assert.equal((await call(`/children/${child.id}/doctor-access-events`, outsider.token)).status, 404)
  assert.equal((await call(`/admin/doctors/${doctorId}/history`, parent.token)).status, 403)
  assert.equal((await call(`/children/${child.id}/doctor-links/${link.id}`, parent.token, 'DELETE')).status, 200)
  assert.equal((await call(`/doctor/patients/${link.id}`, doctorToken)).status, 404)
  const expiring = await grant()
  await prisma.doctorChildLink.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await call(`/doctor/patients/${expiring.id}`, doctorToken)).status, 404)
  const history = await call(`/children/${child.id}/doctor-access-events`, parent.token)
  assert.equal(history.status, 200)
  for (const type of ['GRANTED', 'VIEWED', 'REVOKED', 'EXPIRED']) assert(history.body.events.some((event) => event.type === type), type)
  const management = await call(`/admin/doctors/${doctorId}/history`, admin.token)
  assert.equal(management.status, 200)
  assert.equal(management.body.events.length, 2)
  console.log('PASS: invitations, verification, activation, directory, expiry, scopes, revocation, history and ownership checks')
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (doctorId) await prisma.doctorManagementEvent.deleteMany({ where: { doctorId } })
  await prisma.user.deleteMany({ where: { id: { in: accounts } } })
  await prisma.$disconnect()
})
