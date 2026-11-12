'use strict'

// Standalone diagnostic layer. It does not change imitation-v1 or define a medical/age norm.
const SETTINGS = Object.freeze({
  version: 'movement-coordination-v0.2-pilot', hz: 15,
  minConfidence: 0.3, maxGapSamples: 2, smoothSamples: 3,
  minArmExcursionTorso: 0.08, minLegExcursionTorso: 0.05,
  minObservedShare: 0.75, minCycleSec: 0.6, maxCycleSec: 4,
  extremumLevel: 0.45, strongRelation: 0.5,
  minReferenceCycles: 3, minReferenceAgreement: 0.8,
  minConsecutiveInvertedCycles: 2, phaseBins: 32,
  armAmplitudePolicy: 'advisory_only_no_error_or_score_deduction',
})
const round = (x, digits = 3) => Number.isFinite(x) ? Number(x.toFixed(digits)) : null
const finite = x => typeof x === 'number' && Number.isFinite(x)
function quantile(values, p) {
  const a = values.filter(finite).sort((x, y) => x-y)
  if (!a.length) return null
  const at = (a.length-1)*p, lo = Math.floor(at), hi = Math.ceil(at)
  return a[lo]+(a[hi]-a[lo])*(at-lo)
}
const median = a => quantile(a, .5)
function excursion(a) { const lo=quantile(a,.1), hi=quantile(a,.9); return lo===null ? 0 : hi-lo }
function pearson(a, b) {
  const pairs=a.map((x,i)=>[x,b[i]]).filter(([x,y])=>finite(x)&&finite(y))
  if(pairs.length<6)return null
  const mx=pairs.reduce((s,p)=>s+p[0],0)/pairs.length, my=pairs.reduce((s,p)=>s+p[1],0)/pairs.length
  let xx=0,yy=0,xy=0
  for(const [x,y] of pairs){xx+=(x-mx)**2;yy+=(y-my)**2;xy+=(x-mx)*(y-my)}
  return xx*yy>1e-12?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null
}
function interpolateSmallGaps(values, maxGap=SETTINGS.maxGapSamples) {
  const out=values.slice()
  for(let i=0;i<out.length;){
    if(finite(out[i])){i++;continue}
    const start=i
    while(i<out.length&&!finite(out[i]))i++
    if(start===0||i===out.length||i-start>maxGap)continue
    const left=out[start-1],right=out[i]
    for(let k=start;k<i;k++)out[k]=left+(right-left)*(k-start+1)/(i-start+1)
  }
  return out
}
function smooth(values) {
  return values.map((value,i)=>{
    if(!finite(value))return null
    const nearby=values.slice(Math.max(0,i-1),Math.min(values.length,i+2)).filter(finite)
    return nearby.length>=2?nearby.reduce((a,b)=>a+b,0)/nearby.length:null
  })
}
function axis(frame, distal, proximal) {
  const joints=[...distal,...proximal]
  if(!frame.pose||joints.some(j=>!frame.pose[j]||!(frame.confidence?.[j]>=SETTINGS.minConfidence)))return null
  return (frame.pose[distal[0]][0]+frame.pose[distal[1]][0]-frame.pose[proximal[0]][0]-frame.pose[proximal[1]][0])/2
}
function signals(frames) {
  // Common horizontal axis, torso scale. These are projected swing proxies, not 3D joint rotations.
  const armRaw=frames.map(f=>axis(f,[4,7],[2,5]))
  const legRaw=frames.map(f=>axis(f,[10,13],[9,12]))
  const arm=smooth(interpolateSmallGaps(armRaw)), leg=smooth(interpolateSmallGaps(legRaw))
  const armLo=quantile(arm,.1), armHi=quantile(arm,.9), legLo=quantile(leg,.1), legHi=quantile(leg,.9)
  const armCenter=armLo===null?0:(armLo+armHi)/2, legCenter=legLo===null?0:(legLo+legHi)/2
  const armScale=armLo===null?0:(armHi-armLo)/2, legScale=legLo===null?0:(legHi-legLo)/2
  return frames.map((frame,i)=>({ timeSec:frame.timeSec, pose:frame.pose,
    arm:arm[i],leg:leg[i], armRaw:armRaw[i],legRaw:legRaw[i],
    observed:finite(armRaw[i])&&finite(legRaw[i]),
    armZ:finite(arm[i])&&armScale>0?(arm[i]-armCenter)/armScale:null,
    legZ:finite(leg[i])&&legScale>0?(leg[i]-legCenter)/legScale:null,
  }))
}
function extrema(rows) {
  const out=[]
  for(let i=1;i+1<rows.length;i++){
    const left=rows[i-1].armZ,x=rows[i].armZ,right=rows[i+1].armZ
    if(![left,x,right].every(finite))continue
    const type=x>=SETTINGS.extremumLevel&&x>=left&&x>right?'max':
      x<=-SETTINGS.extremumLevel&&x<=left&&x<right?'min':null
    if(!type)continue
    const peak={index:i,timeSec:rows[i].timeSec,type,value:x}
    const previous=out.at(-1)
    if(previous?.type===type){if(Math.abs(x)>Math.abs(previous.value))out[out.length-1]=peak}
    else out.push(peak)
  }
  return out
}
function atFraction(rows, key, fraction) {
  const target=rows[0].timeSec+fraction*(rows.at(-1).timeSec-rows[0].timeSec)
  for(let i=0;i+1<rows.length;i++){
    const a=rows[i],b=rows[i+1]
    if(a.timeSec<=target&&target<=b.timeSec){
      if(!finite(a[key])||!finite(b[key]))return null
      return a[key]+(b[key]-a[key])*(target-a.timeSec)/(b.timeSec-a.timeSec)
    }
  }
  return null
}
function phaseLag(rows) {
  const n=SETTINGS.phaseBins
  const a=Array.from({length:n},(_,i)=>atFraction(rows,'arm',i/n))
  const b=Array.from({length:n},(_,i)=>atFraction(rows,'leg',i/n))
  if(a.some(v=>!finite(v))||b.some(v=>!finite(v)))return null
  let best=null
  for(let offset=-n/2;offset<n/2;offset++){
    const correlation=pearson(a,b.map((_,i)=>b[(i+offset+n)%n]))
    if(correlation!==null&&(!best||correlation>best.correlation))best={cycles:offset/n,correlation}
  }
  return best
}
function analyze(frames) {
  const rows=signals(frames), peaks=extrema(rows), cycles=[]
  // First qualifying extremum anchors complete cycles. Its identity is invariant to a global image flip.
  for(let k=0;k+2<peaks.length;k+=2){
    const start=peaks[k],middle=peaks[k+1],end=peaks[k+2]
    const selected=rows.slice(start.index,end.index+1)
    const body=rows.slice(start.index,end.index)
    const duration=end.timeSec-start.timeSec
    const observedShare=body.filter(r=>r.observed).length/body.length
    const armExcursion=excursion(body.map(r=>r.arm)),legExcursion=excursion(body.map(r=>r.leg))
    const correlation=pearson(body.map(r=>r.arm),body.map(r=>r.leg))
    const reasons=[]
    if(duration<SETTINGS.minCycleSec||duration>SETTINGS.maxCycleSec)reasons.push('CYCLE_DURATION_UNSUPPORTED')
    if(observedShare<SETTINGS.minObservedShare)reasons.push('NOT_ENOUGH_OBSERVED_JOINTS')
    if(armExcursion<SETTINGS.minArmExcursionTorso||legExcursion<SETTINGS.minLegExcursionTorso)reasons.push('MOTION_TOO_SMALL_TO_MEASURE_PHASE')
    if(correlation===null)reasons.push('PHASE_UNMEASURABLE')
    cycles.push({id:cycles.length,startSec:start.timeSec,endSec:end.timeSec,durationSec:duration,
      startIndex:start.index,endIndex:end.index,midpointSec:middle.timeSec,firstExtremum:start.type,
      observedShare,armExcursionTorso:armExcursion,legExcursionTorso:legExcursion,
      correlation,phaseLag:phaseLag(selected),valid:!reasons.length,reasons})
  }
  return {rows,extrema:peaks,cycles}
}
function referencePattern(analysis) {
  const cycles=analysis.cycles.filter(c=>c.valid),r=median(cycles.map(c=>c.correlation))
  let relation=r!==null&&r<=-SETTINGS.strongRelation?'opposed':r!==null&&r>=SETTINGS.strongRelation?'together':'uncertain'
  const agreement=cycles.length?cycles.filter(c=>relation==='opposed'?c.correlation<=-SETTINGS.strongRelation:relation==='together'?c.correlation>=SETTINGS.strongRelation:false).length/cycles.length:0
  if(cycles.length<SETTINGS.minReferenceCycles||agreement<SETTINGS.minReferenceAgreement)relation='uncertain'
  return {relation,validCycles:cycles.length,medianCorrelation:r,agreement,
    medianAbsoluteLagCycles:median(cycles.map(c=>c.phaseLag?Math.abs(c.phaseLag.cycles):null))}
}
function compare(reference, analysis) {
  const cycles=analysis.cycles.map(c=>{
    let status='uncertain'
    if(!c.valid)status='unmeasurable'
    else if(reference.relation==='opposed')status=c.correlation>=SETTINGS.strongRelation?'inverted':c.correlation<=-SETTINGS.strongRelation?'matching':'mixed'
    else if(reference.relation==='together')status=c.correlation<=-SETTINGS.strongRelation?'inverted':c.correlation>=SETTINGS.strongRelation?'matching':'mixed'
    return {...c,status}
  })
  const events=[]
  let run=[]
  function flush(){
    if(run.length>=SETTINGS.minConsecutiveInvertedCycles){
      const candidates=run.flatMap(c=>analysis.rows.slice(c.startIndex,c.endIndex)).filter(row=>row.observed&&finite(row.armZ)&&finite(row.legZ)&&
        (reference.relation==='opposed'?row.armZ*row.legZ>0:row.armZ*row.legZ<0))
      const representative=candidates.length?candidates.reduce((best,row)=>Math.min(Math.abs(row.armZ),Math.abs(row.legZ))>Math.min(Math.abs(best.armZ),Math.abs(best.legZ))?row:best):null
      events.push({code:'ARM_LEG_COORDINATION_INVERTED',priority:'primary',
        label:'Quan hệ phối hợp tay–chân đảo pha so với mẫu',startSec:run[0].startSec,endSec:run.at(-1).endSec,
        cycles:run.map(c=>c.id),completeCycles:run.length,medianCorrelation:median(run.map(c=>c.correlation)),
        medianAbsoluteLagCycles:median(run.map(c=>c.phaseLag?Math.abs(c.phaseLag.cycles):null)),representative})
    }
    run=[]
  }
  for(const cycle of cycles){if(cycle.status==='inverted')run.push(cycle);else flush()}
  flush()
  return {cycles,events}
}

module.exports={SETTINGS,round,median,pearson,excursion,signals,extrema,analyze,referencePattern,compare,interpolateSmallGaps}
