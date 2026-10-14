import { Router } from 'express'
import { authRouter } from './auth'
import { childrenRouter } from './children'
import { consentRouter } from './consent'
import { screeningsRouter } from './screenings'
import { resultsRouter } from './results'
import { chatRouter } from './chat'
import { articlesRouter } from './articles'
import { adminRouter } from './admin'
import { subjectsRouter } from './subjects'
import { pipelineRouter } from './pipeline'
import { skeletonRouter } from './skeleton'
import { exercisesRouter } from './exercises'
import { exerciseSessionsRouter } from './exerciseSessions'
import { childExercisesRouter } from './childExercises'
import { adminExercisesRouter } from './adminExercises'
import { childQuestionnairesRouter, questionnaireResponsesRouter, questionnairesRouter } from './questionnaires'
import { communityRouter } from './community'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use('/children', childrenRouter)
apiRouter.use('/consent', consentRouter)
apiRouter.use('/screenings', screeningsRouter)
apiRouter.use('/results', resultsRouter)
apiRouter.use('/chat', chatRouter)
apiRouter.use('/articles', articlesRouter)
apiRouter.use('/community', communityRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use('/admin/skeleton', skeletonRouter)
// Giai đoạn 4 + questionnaires. The /children/:childId mounts come after
// childrenRouter, which passes on paths it does not handle.
apiRouter.use('/exercises', exercisesRouter)
apiRouter.use('/exercise-sessions', exerciseSessionsRouter)
apiRouter.use('/children/:childId/questionnaires', childQuestionnairesRouter)
apiRouter.use('/children/:childId', childExercisesRouter)
apiRouter.use('/admin/exercises', adminExercisesRouter)
apiRouter.use('/questionnaires', questionnairesRouter)
apiRouter.use('/questionnaire-responses', questionnaireResponsesRouter)
// Raw ML proxies (admin only, see subjects.ts / pipeline.ts).
apiRouter.use('/subjects', subjectsRouter)
apiRouter.use('/pipeline', pipelineRouter)

export { subjectsRouter, pipelineRouter, skeletonRouter }
