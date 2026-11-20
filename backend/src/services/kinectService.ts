import { prisma } from '../lib/prisma'
import { KINECT_SCOPES, KINECT_VERSION } from '../lib/kinectData'

export async function kinectConsent(childId:string) {
  const c=await prisma.consentRecord.findFirst({where:{childId,version:KINECT_VERSION,revokedAt:null},orderBy:{grantedAt:'desc'}})
  return c && KINECT_SCOPES.every(s=>c.scopes.includes(s)) ? c : null
}
export async function gatewayRequest(path:string,authorization:string,body?:unknown,method?:string) {
  const url=(process.env.KINECT_GATEWAY_URL??'http://kinect-companion-gateway:8032')+path
  const response=await fetch(url,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:authorization,'Content-Type':'application/json','X-Kinect-Bridge-Key':process.env.KINECT_BRIDGE_KEY??''},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12_000)})
  const data=await response.json() as any
  if(!response.ok) {const error=Object.assign(new Error('KINECT_GATEWAY_ERROR'),{status:response.status,data});throw error}
  return data
}
export function serializeKinect(s:any) {
  const {rawCapture,...rest}=s
  return {...rest,sourceType:'KINECT_3D',hasCapture:Boolean(rawCapture),hasResult:Boolean(s.result)}
}
