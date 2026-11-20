import { Router, json } from 'express'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { KINECT_SCOPES, KINECT_STATEMENT, KINECT_VERSION, hashKinect, validBridgeKey, validateKinectCapture } from '../lib/kinectData'
import { gatewayRequest, kinectConsent, serializeKinect } from '../services/kinectService'

export const kinectRouter=Router()
kinectRouter.use(requireAuth)
const uuid=z.string().uuid()
async function owned(id:string,userId:string){return prisma.kinectSession.findFirst({where:{id,userId},include:{child:{select:{id:true,fullName:true}},job:true}})}
function authorization(req:any){return req.headers.authorization as string}
const proxy=asyncHandler(async(req,res)=>{try{const path='/kinect'+req.path;res.status(200).json(await gatewayRequest(path,authorization(req),req.method==='GET'?undefined:req.body,req.method))}catch(e:any){res.status(e.status??503).json({error:'KINECT_GATEWAY_UNAVAILABLE',detail:e.data?.detail})}})
kinectRouter.get('/devices',proxy)
kinectRouter.post('/pairings',proxy)
kinectRouter.get('/devices/:id/commands/:commandId',proxy)
kinectRouter.delete('/devices/:id',proxy)
kinectRouter.get('/consent/:childId',asyncHandler(async(req,res)=>{
 const childId=uuid.parse(req.params.childId);if(!await prisma.childProfile.findFirst({where:{id:childId,userId:req.user!.id}}))return res.status(404).json({error:'CHILD_NOT_FOUND'})
 res.json({statement:KINECT_STATEMENT,consent:await kinectConsent(childId)})
}))
kinectRouter.post('/consent/:childId',asyncHandler(async(req,res)=>{
 const childId=uuid.parse(req.params.childId);if(!await prisma.childProfile.findFirst({where:{id:childId,userId:req.user!.id}}))return res.status(404).json({error:'CHILD_NOT_FOUND'})
 z.object({accepted:z.literal(true),version:z.literal(KINECT_VERSION)}).parse(req.body)
 const consent=await prisma.$transaction(async tx=>{await tx.consentRecord.updateMany({where:{childId,version:KINECT_VERSION,revokedAt:null},data:{revokedAt:new Date()}});return tx.consentRecord.create({data:{userId:req.user!.id,childId,version:KINECT_VERSION,scopes:[...KINECT_SCOPES],statement:KINECT_STATEMENT}})})
 res.status(201).json({consent})
}))
kinectRouter.delete('/consent/:childId',asyncHandler(async(req,res)=>{
 const childId=uuid.parse(req.params.childId);if(!await prisma.childProfile.findFirst({where:{id:childId,userId:req.user!.id}}))return res.status(404).json({error:'CHILD_NOT_FOUND'})
 await prisma.consentRecord.updateMany({where:{childId,version:KINECT_VERSION,revokedAt:null},data:{revokedAt:new Date()}});res.json({revoked:true})
}))
kinectRouter.get('/sessions',asyncHandler(async(req,res)=>{
 const childId=req.query.childId?uuid.parse(req.query.childId):undefined
 const sessions=await prisma.kinectSession.findMany({where:{userId:req.user!.id,childId},include:{child:{select:{id:true,fullName:true}},job:true},orderBy:{createdAt:'desc'},take:100})
 res.json({sessions:sessions.map(serializeKinect)})
}))
kinectRouter.post('/sessions',asyncHandler(async(req,res)=>{
 const {childId,deviceId}=z.object({childId:uuid,deviceId:uuid}).parse(req.body)
 if(!await prisma.childProfile.findFirst({where:{id:childId,userId:req.user!.id}}))return res.status(404).json({error:'CHILD_NOT_FOUND'})
 const consent=await kinectConsent(childId);if(!consent)return res.status(403).json({error:'CONSENT_REQUIRED'})
 const stations=await gatewayRequest('/kinect/devices',authorization(req));if(!stations.devices.some((d:any)=>d.id===deviceId))return res.status(404).json({error:'DEVICE_NOT_FOUND'})
 const s=await prisma.kinectSession.create({data:{userId:req.user!.id,childId,deviceId,consentId:consent.id},include:{child:{select:{id:true,fullName:true}}}})
 res.status(201).json({session:serializeKinect(s)})
}))
kinectRouter.get('/sessions/:id',asyncHandler(async(req,res)=>{
 let s=await owned(uuid.parse(req.params.id),req.user!.id);if(!s)return res.status(404).json({error:'NOT_FOUND'})
 if(['STARTING','STOPPING'].includes(s.status)){
  const id=s.status==='STARTING'?s.startCommandId:s.stopCommandId
  if(id)try{
   const state=await gatewayRequest('/kinect/devices/'+s.deviceId+'/commands/'+id,authorization(req))
   if(state.ack){await prisma.kinectSession.updateMany({where:{id:s.id,status:s.status},data:state.ack.ok?{status:s.status==='STARTING'?'RECORDING':'AWAITING_CAPTURE'}:{status:'FAILED',errorMessage:'DEVICE_COMMAND_REJECTED'}});s=(await owned(s.id,req.user!.id))!}
   else if(state.expired){await prisma.kinectSession.updateMany({where:{id:s.id,status:s.status},data:{status:'FAILED',errorMessage:'DEVICE_COMMAND_EXPIRED'}});s=(await owned(s.id,req.user!.id))!}
  }catch{/* Offline polling keeps the last confirmed state. */}
 }
 res.json({session:serializeKinect(s)})
}))
kinectRouter.post('/sessions/:id/commands',asyncHandler(async(req,res)=>{
 const s=await owned(uuid.parse(req.params.id),req.user!.id);if(!s)return res.status(404).json({error:'NOT_FOUND'})
 if(!await kinectConsent(s.childId))return res.status(403).json({error:'CONSENT_REQUIRED'})
 const {action}=z.object({action:z.enum(['start','stop'])}).parse(req.body)
 const existing=action==='start'?s.startCommandId:s.stopCommandId
 const commandId=existing??randomUUID()
 if(action==='start'&&!['READY','STARTING','RECORDING'].includes(s.status))return res.status(409).json({error:'INVALID_SESSION_STATE'})
 if(action==='stop'&&!['STARTING','RECORDING','STOPPING','AWAITING_CAPTURE','REVIEW'].includes(s.status))return res.status(409).json({error:'INVALID_SESSION_STATE'})
 if(action==='stop'&&['REVIEW','AWAITING_CAPTURE'].includes(s.status))return res.json({session:serializeKinect(s)})
 try{
  await prisma.kinectSession.update({where:{id:s.id},data:action==='start'?{status:'STARTING',startCommandId:commandId}:{status:'STOPPING',stopCommandId:commandId}})
  await gatewayRequest('/kinect/devices/'+s.deviceId+'/commands',authorization(req),{commandId,sessionId:s.id,action,webSession:true})
 }catch(e:any){if(e.status&&e.status<500)await prisma.kinectSession.updateMany({where:{id:s.id,status:{in:['STARTING','STOPPING']}},data:{status:action==='start'?'READY':'RECORDING',errorMessage:'DEVICE_UNAVAILABLE'}});return res.status(e.code==='P2002'?409:503).json({error:e.code==='P2002'?'DEVICE_BUSY':'DEVICE_UNAVAILABLE'})}
 res.status(202).json({session:serializeKinect(await owned(s.id,req.user!.id))})
}))
kinectRouter.get('/sessions/:id/capture',asyncHandler(async(req,res)=>{
 const s=await owned(uuid.parse(req.params.id),req.user!.id);if(!s?.rawCapture)return res.status(404).json({error:'CAPTURE_NOT_FOUND'})
 res.set('Cache-Control','no-store');res.json({capture:JSON.parse(s.rawCapture),checksum:s.captureSha256})
}))
kinectRouter.post('/sessions/:id/analyze',asyncHandler(async(req,res)=>{
 const id=uuid.parse(req.params.id);const input=z.object({start:z.number().int().min(0),end:z.number().int().min(2)}).parse(req.body)
 const s=await owned(id,req.user!.id);if(!s)return res.status(404).json({error:'NOT_FOUND'})
 const consent=await kinectConsent(s.childId);if(!consent)return res.status(403).json({error:'CONSENT_REQUIRED'})
 if(!s.frameCount||input.end>s.frameCount||input.end-input.start<2)return res.status(422).json({error:'INVALID_TRIM'})
 if(['QUEUED','PROCESSING','COMPLETED'].includes(s.status)){if(s.trimStart===input.start&&s.trimEnd===input.end)return res.json({session:serializeKinect(s)});return res.status(409).json({error:'ANALYSIS_LOCKED'})}
 if(!['REVIEW','FAILED'].includes(s.status)||!s.rawCapture)return res.status(409).json({error:'CAPTURE_NOT_READY'})
 await prisma.$transaction(async tx=>{
  const changed=await tx.kinectSession.updateMany({where:{id,status:s.status},data:{status:'QUEUED',consentId:consent.id,trimStart:input.start,trimEnd:input.end,errorMessage:null}})
  if(!changed.count)throw new Error('CONCURRENT_ANALYSIS')
  await tx.kinectJob.upsert({where:{sessionId:id},create:{sessionId:id},update:{status:'QUEUED',attempts:0,runAfter:new Date(),lockedAt:null,lockedBy:null,lastError:null}})
 })
 res.status(202).json({session:serializeKinect(await owned(id,req.user!.id))})
}))
kinectRouter.post('/sessions/:id/derive',asyncHandler(async(req,res)=>{
 const s=await owned(uuid.parse(req.params.id),req.user!.id);if(!s?.rawCapture)return res.status(404).json({error:'CAPTURE_NOT_FOUND'})
 const consent=await kinectConsent(s.childId);if(!consent)return res.status(403).json({error:'CONSENT_REQUIRED'})
 const copy=await prisma.kinectSession.create({data:{userId:s.userId,childId:s.childId,deviceId:s.deviceId,consentId:consent.id,status:'REVIEW',rawCapture:s.rawCapture,captureId:s.captureId,captureSha256:s.captureSha256,frameCount:s.frameCount,sourceSessionId:s.id},include:{child:{select:{id:true,fullName:true}}}})
 res.status(201).json({session:serializeKinect(copy)})
}))
kinectRouter.post('/sessions/:id/cancel',asyncHandler(async(req,res)=>{
 const id=uuid.parse(req.params.id);const s=await owned(id,req.user!.id);if(!s)return res.status(404).json({error:'NOT_FOUND'})
 if(['QUEUED','PROCESSING','COMPLETED'].includes(s.status))return res.status(409).json({error:'ANALYSIS_LOCKED'})
 if(['STARTING','RECORDING','STOPPING'].includes(s.status))try{await gatewayRequest('/kinect/devices/'+s.deviceId+'/commands',authorization(req),{commandId:randomUUID(),sessionId:id,action:'stop',webSession:true})}catch{/* Operator still has stop on companion. */}
 await prisma.kinectSession.update({where:{id},data:{status:'CANCELED'}});res.json({canceled:true})
}))
kinectRouter.delete('/sessions/:id',asyncHandler(async(req,res)=>{
 const id=uuid.parse(req.params.id);const s=await owned(id,req.user!.id);if(!s)return res.status(404).json({error:'NOT_FOUND'})
 if(['STARTING','RECORDING','STOPPING','AWAITING_CAPTURE','PROCESSING'].includes(s.status))return res.status(409).json({error:'SESSION_BUSY'})
 await prisma.kinectSession.delete({where:{id}});res.json({deleted:true,localStationCopyRetained:true})
}))

export const internalKinectRouter=Router()
internalKinectRouter.use((req,res,next)=>validBridgeKey(req.headers['x-kinect-bridge-key'])?next():res.status(401).json({error:'UNAUTHORIZED'}))
internalKinectRouter.use(json({limit:'4mb',verify:(req:any,_res,buf)=>{req.captureBytes=Buffer.from(buf)}}))
internalKinectRouter.post('/sessions/:id/capture',asyncHandler(async(req,res)=>{
 const id=uuid.parse(req.params.id);const s=await prisma.kinectSession.findUnique({where:{id}});if(!s)return res.status(404).json({error:'NOT_FOUND'})
 const body=req.body
 try{validateKinectCapture(body)}catch{return res.status(422).json({error:'INVALID_KINECT_CAPTURE'})}
 if(body.sessionId!==s.id||body.deviceId!==s.deviceId||!uuid.safeParse(body.captureId).success)return res.status(403).json({error:'CAPTURE_SESSION_MISMATCH'})
 const checksum=hashKinect((req as any).captureBytes)
 if(req.headers['x-capture-sha256']!==checksum)return res.status(422).json({error:'CHECKSUM_MISMATCH'})
 if(!await kinectConsent(s.childId))return res.status(403).json({error:'CONSENT_REQUIRED'})
 if(s.captureSha256){if(s.captureSha256!==checksum||s.captureId!==body.captureId)return res.status(409).json({error:'CAPTURE_CONFLICT'});return res.json({status:'REVIEW',sessionId:id,captureId:s.captureId,receivedFrames:s.frameCount})}
 if(!['STARTING','RECORDING','STOPPING','AWAITING_CAPTURE'].includes(s.status))return res.status(409).json({error:'SESSION_NOT_RECORDING'})
 const changed=await prisma.kinectSession.updateMany({where:{id,captureSha256:null,status:{in:['STARTING','RECORDING','STOPPING','AWAITING_CAPTURE']}},data:{status:'REVIEW',captureId:body.captureId,captureSha256:checksum,rawCapture:(req as any).captureBytes.toString("utf8"),frameCount:body.xyz.length,errorMessage:null}})
 if(!changed.count)return res.status(503).json({error:'RETRY_CAPTURE'})
 res.json({status:'REVIEW',sessionId:id,captureId:body.captureId,receivedFrames:body.xyz.length})
}))
