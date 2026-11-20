import { Router } from 'express'
import type { ChildProfile, DoctorChildLink } from '@prisma/client'
import { z } from 'zod'
import { ageInMonths, normalizeScopes, serializeDoctor, type DoctorShareScope } from '../lib/doctorShare'
import { summarizeExerciseProgress } from '../lib/exerciseData'
import { serializePersonalization } from '../lib/personalization'
import { prisma } from '../lib/prisma'
import { serializeQuestionnaireResponse } from '../lib/questionnaireSerializers'
import { serializeResult } from '../lib/serializers'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireDoctor, requireDoctorsEnabled } from '../middleware/requireDoctor'
import { loadProgressRows } from './exercises'

/**
 * Doctor side (read-only): the records parents shared with the signed-in
 * doctor. Every answer is limited to an ACTIVE grant of this doctor and to
 * the scopes of that grant; nothing here writes child data.
 */
export const doctorPortalRouter = Router()

doctorPortalRouter.use(requireAuth, requireDoctorsEnabled, requireDoctor)

type LinkWithChild = DoctorChildLink & { child: ChildProfile; grantedBy: { name: string } }

/** The part of the profile every grant carries (scope PROFILE is mandatory). */
function serializePatient(link: LinkWithChild) {
  return {
    linkId: link.id,
    scopes: normalizeScopes(link.scopes),
    message: link.message,
    grantedAt: link.grantedAt,
    expiresAt: link.expiresAt,
    lastViewedAt: link.lastViewedAt,
    child: {
      fullName: link.child.fullName,
      dateOfBirth: link.child.dateOfBirth,
      ageMonths: ageInMonths(link.child.dateOfBirth),
      gender: link.child.gender,
      note: link.child.note,
    },
    parent: { name: link.grantedBy.name },
  }
}

const activeLinkInclude = { child: true, grantedBy: { select: { name: true } } } as const

doctorPortalRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const doctor = req.doctor!
    const activePatients = await prisma.doctorChildLink.count({ where: { doctorId: doctor.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
    return res.json({ doctor: serializeDoctor(doctor), stats: { activePatients } })
  }),
)

/** Children currently shared with this doctor, most recently shared first. */
doctorPortalRouter.get(
  '/patients',
  asyncHandler(async (req, res) => {
    const links = await prisma.doctorChildLink.findMany({
      where: { doctorId: req.doctor!.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: activeLinkInclude,
      orderBy: { grantedAt: 'desc' },
    })
    return res.json({ patients: links.map(serializePatient) })
  }),
)

/** One shared record with the granted parts. Opening it is noted for the parent. */
doctorPortalRouter.get(
  '/patients/:linkId',
  asyncHandler(async (req, res) => {
    const linkId = z.string().uuid().safeParse(req.params.linkId)
    const link = linkId.success
      ? await prisma.doctorChildLink.findFirst({
          where: { id: linkId.data, doctorId: req.doctor!.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          include: activeLinkInclude,
        })
      : null
    // A revoked or foreign grant looks exactly like one that never existed.
    if (!link) return res.status(404).json({ error: 'PATIENT_NOT_FOUND' })

    const scopes = normalizeScopes(link.scopes)
    const has = (scope: DoctorShareScope) => scopes.includes(scope)
    const childId = link.childId

    const [personalization, screenings, questionnaires, exerciseRows] = await Promise.all([
      has('PERSONALIZATION') ? prisma.childPersonalization.findUnique({ where: { childId } }) : null,
      has('SCREENING')
        ? prisma.videoUpload.findMany({
            where: { childId },
            select: { id: true, status: true, createdAt: true, result: true },
            orderBy: { createdAt: 'desc' },
          })
        : null,
      has('QUESTIONNAIRE')
        ? prisma.questionnaireResponse.findMany({ where: { childId }, orderBy: { completedAt: 'desc' } })
        : null,
      has('EXERCISE') ? loadProgressRows({ childId }) : null,
    ])

    const updated = await prisma.doctorChildLink.updateMany({
      where: { id: link.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      data: { lastViewedAt: new Date(), viewCount: { increment: 1 } },
    })
    // Revoked while the record was being read: do not hand it out.
    if (!updated.count) return res.status(404).json({ error: 'PATIENT_NOT_FOUND' })
    await prisma.doctorAccessEvent.create({ data: { linkId: link.id, actorUserId: req.user!.id, type: 'VIEWED' } })

    return res.json({
      patient: serializePatient(link),
      ...(has('PERSONALIZATION') ? { personalization: serializePersonalization(personalization) } : {}),
      ...(screenings
        ? {
            // No file name, size or path: only when it was analysed and the result.
            screenings: screenings.map((s) => ({
              id: s.id,
              status: s.status,
              createdAt: s.createdAt,
              result: s.result ? serializeResult(s.result) : null,
            })),
          }
        : {}),
      ...(questionnaires ? { questionnaires: questionnaires.map((q) => serializeQuestionnaireResponse(q)) } : {}),
      ...(exerciseRows ? { exercises: summarizeExerciseProgress(exerciseRows) } : {}),
    })
  }),
)
