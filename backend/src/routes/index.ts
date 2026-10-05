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

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use('/children', childrenRouter)
apiRouter.use('/consent', consentRouter)
apiRouter.use('/screenings', screeningsRouter)
apiRouter.use('/results', resultsRouter)
apiRouter.use('/chat', chatRouter)
apiRouter.use('/articles', articlesRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use('/admin/skeleton', skeletonRouter)
// Raw ML proxies (admin only, see subjects.ts / pipeline.ts).
apiRouter.use('/subjects', subjectsRouter)
apiRouter.use('/pipeline', pipelineRouter)

export { subjectsRouter, pipelineRouter, skeletonRouter }
