import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { trimKinectCapture, type KinectCapture } from '../lib/kinectData'
import { kinectConsent } from './kinectService'

const workerId='kinect:'+process.pid+':'+randomUUID()
let stopped=true,busy=false,timer:NodeJS.Timeout|undefined
export function startKinectWorker(){if(!stopped)return;stopped=false;timer=setInterval(()=>void tick(),1500);void tick()}
export function stopKinectWorker(){stopped=true;if(timer)clearInterval(timer)}
async function tick(){
  if(stopped||busy)return;busy=true
  try {
    // Same UTC timestamp/lease mechanism used by screeningProcessor: no SQL NOW timezone ambiguity.
    const cutoff=new Date(Date.now()-120_000)
    await prisma.kinectJob.updateMany({where:{status:'RUNNING',lockedAt:{lt:cutoff}},data:{status:'QUEUED',lockedBy:null,lockedAt:null,runAfter:new Date()}})
    const jobs=await prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{id:string;sessionId:string}[]>(Prisma.sql`SELECT "id","sessionId" FROM "KinectJob" WHERE "status"='QUEUED' AND "runAfter" <= ${new Date().toISOString()}::timestamp ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`)
      if(rows[0])await tx.kinectJob.update({where:{id:rows[0].id},data:{status:'RUNNING',lockedBy:workerId,lockedAt:new Date(),attempts:{increment:1}}})
      return rows
    })
    if(jobs[0])await processJob(jobs[0])
  }catch(error){console.error('[kinect-queue] poll failed',error instanceof Error?error.name:'error')}
  finally{busy=false}
}
async function processJob(job:{id:string;sessionId:string}){
  const heartbeat=setInterval(()=>{void prisma.kinectJob.updateMany({where:{id:job.id,status:'RUNNING',lockedBy:workerId},data:{lockedAt:new Date()}}).catch(()=>{})},15_000)
  try {
    const session=await prisma.kinectSession.findUnique({where:{id:job.sessionId}})
    if(!session)return
    if(!session.rawCapture||session.trimStart===null||session.trimEnd===null)throw new Error('CAPTURE_MISSING')
    if(!(await kinectConsent(session.childId)))throw new Error('CONSENT_REQUIRED')
    await prisma.kinectSession.updateMany({where:{id:session.id,status:{in:['QUEUED','PROCESSING']}},data:{status:'PROCESSING'}})
    const payload=trimKinectCapture(JSON.parse(session.rawCapture) as KinectCapture,session.trimStart,session.trimEnd)
    const response=await fetch((process.env.KINECT_ML_URL??'http://kinect-ensemble:8031')+'/predict/kinect/ensemble',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.KINECT_API_KEY??''},body:JSON.stringify(payload),signal:AbortSignal.timeout(60_000)})
    if(!response.ok)throw new Error(response.status===422?'INVALID_CAPTURE':'ML_UNAVAILABLE')
    const result=await response.json() as any
    if(!['ASD','Typical'].includes(result.prediction)||result.members?.length!==3||result.input?.captureId!==session.captureId||result.modelBundleSha256!==process.env.KINECT_MANIFEST_SHA256)throw new Error('MODEL_BUNDLE_MISMATCH')
    await prisma.$transaction(async tx=>{
      const consent=await tx.consentRecord.findFirst({where:{id:session.consentId,revokedAt:null,version:'kinect-1'}})
      const lease=await tx.kinectJob.findFirst({where:{id:job.id,lockedBy:workerId,status:'RUNNING'}})
      if(!consent||!lease)throw new Error('CONSENT_REQUIRED')
      await tx.kinectSession.update({where:{id:session.id},data:{status:'COMPLETED',result,modelBundleVersion:result.modelBundleVersion,modelBundleSha256:result.modelBundleSha256,errorMessage:null}})
      await tx.kinectJob.update({where:{id:job.id},data:{status:'SUCCEEDED',lockedAt:null,lockedBy:null,lastError:null}})
    })
  }catch(error){
    const code=error instanceof Error?error.message:'ML_UNAVAILABLE'
    const permanent=['CONSENT_REQUIRED','CAPTURE_MISSING','INVALID_CAPTURE','MODEL_BUNDLE_MISMATCH'].includes(code)
    const row=await prisma.kinectJob.findUnique({where:{id:job.id}})
    if(!row||row.lockedBy!==workerId)return
    const failed=permanent||row.attempts>=row.maxAttempts
    await prisma.$transaction(async tx=>{
      const updated=await tx.kinectJob.updateMany({where:{id:job.id,lockedBy:workerId,status:'RUNNING'},data:{status:failed?'FAILED':'QUEUED',lockedAt:null,lockedBy:null,lastError:permanent?code:'ML_UNAVAILABLE',runAfter:new Date(Date.now()+Math.min(60_000,2000*2**row.attempts))}})
      if(updated.count)await tx.kinectSession.updateMany({where:{id:job.sessionId},data:{status:failed?'FAILED':'QUEUED',errorMessage:permanent?code:'ML_UNAVAILABLE'}})
    })
  }finally{clearInterval(heartbeat)}
}
