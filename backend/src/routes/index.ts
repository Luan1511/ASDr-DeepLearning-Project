import { Router } from 'express'
import { authRouter } from './auth'
import { childrenRouter } from './children'
import { screeningsRouter } from './screenings'
import { resultsRouter } from './results'
import { chatRouter } from './chat'
import { articlesRouter } from './articles'
import { adminRouter } from './admin'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use('/children', childrenRouter)
apiRouter.use('/screenings', screeningsRouter)
apiRouter.use('/results', resultsRouter)
apiRouter.use('/chat', chatRouter)
apiRouter.use('/articles', articlesRouter)
apiRouter.use('/admin', adminRouter)
