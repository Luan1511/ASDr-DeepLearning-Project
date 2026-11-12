'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const E=require('../../src/services/exerciseMovement/coordination.js')
function recording({duration=12,period=1.2,arm=.3,leg=.12,relation=-1,phase=0,offset=0,reflect=false}={}){
 return Array.from({length:Math.round(duration*15)},(_,i)=>{
  const a=arm*Math.sin(2*Math.PI*(i/15/period+phase)),k=leg*relation*Math.sin(2*Math.PI*(i/15/period+phase))
  const p=Array(15).fill(null)
  p[0]=[0,1.4];p[1]=[0,1];p[8]=[0,0]
  p[2]=[-.25,.9];p[5]=[.25,.9];p[3]=[-.4+a,.65];p[6]=[.4+a,.65]
  p[4]=[-.3+a,.6];p[7]=[.3+a,.6]
  p[9]=[-.15,0];p[12]=[.15,0];p[10]=[-.15+k,-.7];p[13]=[.15+k,-.7]
  p[11]=[-.15-k,-1.4];p[14]=[.15-k,-1.4]
  return {timeSec:i/15,pose:p.map(point=>point?[(point[0]+offset)*(reflect?-1:1),point[1]]:null),confidence:Array(25).fill(.9)}
 })
}
const reference=E.referencePattern(E.analyze(recording()))
test('reference learns opposed within-person swing from repeated cycles',()=>{
 assert.equal(reference.relation,'opposed');assert.ok(reference.validCycles>=3);assert.ok(reference.medianCorrelation<-.99)
})
test('persistent together-phase movement is identified despite individually plausible joint positions',()=>{
 const out=E.compare(reference,E.analyze(recording({relation:1})))
 assert.ok(out.events.length);assert.ok(out.cycles.every(c=>c.status==='inverted'))
})
test('smaller arm opening with the correct relation is accepted',()=>{
 const out=E.compare(reference,E.analyze(recording({arm:.055,leg:.07})))
 assert.equal(out.events.length,0);assert.ok(out.cycles.length>=3);assert.ok(out.cycles.every(c=>c.status==='matching'))
 assert.equal(E.SETTINGS.armAmplitudePolicy,'advisory_only_no_error_or_score_deduction')
})
test('global mirror cannot erase or create the coordination inversion',()=>{
 const a=E.compare(reference,E.analyze(recording({relation:1})))
 const b=E.compare(reference,E.analyze(recording({relation:1,reflect:true})))
 assert.deepEqual(a.cycles.map(c=>[c.startSec,c.endSec,c.status]),b.cycles.map(c=>[c.startSec,c.endSec,c.status]))
 assert.equal(a.events.length,b.events.length)
})
test('a child performing more slowly with correct coordination is accepted',()=>{
 const out=E.compare(reference,E.analyze(recording({period:2.4})))
 assert.ok(out.cycles.length>=3);assert.equal(out.events.length,0);assert.ok(out.cycles.every(c=>c.status==='matching'))
})
test('unsynchronized start time of both limb signals does not change their relation',()=>{
 const out=E.compare(reference,E.analyze(recording({phase:.27})))
 assert.equal(out.events.length,0);assert.ok(out.cycles.every(c=>c.status==='matching'))
})
test('near-still motion is unmeasurable rather than classified as a mistake',()=>{
 const out=E.compare(reference,E.analyze(recording({arm:.005,leg:.005})))
 assert.equal(out.events.length,0);assert.ok(out.cycles.every(c=>c.status==='unmeasurable'))
})
test('missing observations cannot become successful or erroneous coordination evidence',()=>{
 const rows=recording({relation:1}).map((row,i)=>i%3===0?row:{...row,confidence:Array(25).fill(0)})
 const out=E.compare(reference,E.analyze(rows))
 assert.equal(out.events.length,0);assert.ok(out.cycles.every(c=>c.status==='unmeasurable'))
})
test('low-confidence joints do not create swing signals',()=>{
 const rows=recording().map(row=>({...row,confidence:Array(25).fill(.1)}))
 assert.ok(E.signals(rows).every(row=>row.arm===null&&row.leg===null))
})
test('small gaps can be interpolated but long gaps and clip edges remain unknown',()=>{
 assert.deepEqual(E.interpolateSmallGaps([null,0,null,null,3,null,null,null,7,null]),[null,0,1,2,3,null,null,null,7,null])
})
test('one isolated inverted cycle does not trigger persistent corrective feedback',()=>{
 const fake={cycles:[{id:0,valid:true,correlation:.9,startSec:0,endSec:1,startIndex:0,endIndex:1},
  {id:1,valid:true,correlation:-.9,startSec:1,endSec:2,startIndex:1,endIndex:2}],rows:[]}
 assert.equal(E.compare(reference,fake).events.length,0)
})
test('body translation does not affect within-person centroid relation',()=>{
 const a=E.analyze(recording()),b=E.analyze(recording({offset:7}))
 assert.equal(a.cycles.length,b.cycles.length)
 a.cycles.forEach((cycle,i)=>assert.ok(Math.abs(cycle.correlation-b.cycles[i].correlation)<1e-12))
})
test('an insufficient reference does not create an expected coordination rule',()=>{
 const ref=E.referencePattern(E.analyze(recording({duration:2})))
 assert.equal(ref.relation,'uncertain')
 assert.equal(E.compare(ref,E.analyze(recording({relation:1}))).events.length,0)
})
test('incomplete edge fragments are not counted as complete cycles',()=>{
 const out=E.analyze(recording({duration:.5}))
 assert.equal(out.cycles.length,0)
})

