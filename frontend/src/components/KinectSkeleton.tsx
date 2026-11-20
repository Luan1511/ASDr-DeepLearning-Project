import { useEffect, useRef } from 'react'

const NAMES=['Head','Neck','SpineShoulder','ShoulderLeft','ShoulderRight','ElbowLeft','ElbowRight','WristLeft','WristRight','ThumbLeft','ThumbRight','HandLeft','HandRight','HandTipLeft','HandTipRight','SpineMid','SpineBase','HipLeft','HipRight','KneeLeft','KneeRight','AnkleLeft','AnkleRight','FootLeft','FootRight']
const BONES=[[0,1],[1,2],[2,15],[15,16],[2,3],[3,5],[5,7],[7,11],[11,13],[7,9],[2,4],[4,6],[6,8],[8,12],[12,14],[8,10],[16,17],[17,19],[19,21],[21,23],[16,18],[18,20],[20,22],[22,24]]
const COLORS=['#f87171','#fb923c','#facc15','#4ade80','#2dd4bf','#38bdf8','#a78bfa','#e879f9']
export function KinectSkeleton({xyz,names,states}:{xyz?:number[][];names?:string[];states?:number[]}){
 const canvas=useRef<HTMLCanvasElement>(null)
 useEffect(()=>{
  const c=canvas.current;if(!c)return
  const draw=()=>{const rect=c.getBoundingClientRect();const ratio=window.devicePixelRatio||1;c.width=rect.width*ratio;c.height=rect.height*ratio;const g=c.getContext('2d');if(!g)return;g.scale(ratio,ratio);g.fillStyle='#0f172a';g.fillRect(0,0,rect.width,rect.height)
   if(!xyz||!names)return;const order=NAMES.map(n=>names.indexOf(n));if(order.some(i=>i<0))return
   const points=order.map(i=>xyz[i]);if(points.some(p=>!p||p.length!==3||p.some(v=>!Number.isFinite(v))))return
   const valid=points.filter((p,i)=>(!states||states[order[i]]>0)&&p.some(v=>v!==0));if(!valid.length)return
   const xmin=Math.min(...valid.map(p=>p[0])),xmax=Math.max(...valid.map(p=>p[0])),ymin=Math.min(...valid.map(p=>p[1])),ymax=Math.max(...valid.map(p=>p[1]));const scale=Math.min((rect.width-70)/Math.max(.6,xmax-xmin+.3),(rect.height-50)/Math.max(.8,ymax-ymin+.3))
   const pos=(i:number)=>[rect.width/2+(points[i][0]-(xmin+xmax)/2)*scale,rect.height/2-(points[i][1]-(ymin+ymax)/2)*scale]
   BONES.forEach(([a,b],i)=>{if(states&&(states[order[a]]===0||states[order[b]]===0))return;g.strokeStyle=COLORS[i%COLORS.length];g.lineWidth=4;g.setLineDash(states&&(states[order[a]]===1||states[order[b]]===1)?[5,4]:[]);g.beginPath();g.moveTo(...pos(a) as [number,number]);g.lineTo(...pos(b) as [number,number]);g.stroke()});g.setLineDash([])
   points.forEach((_,i)=>{if(states&&states[order[i]]===0)return;g.beginPath();g.arc(...pos(i) as [number,number],4,0,Math.PI*2);g.fillStyle=COLORS[i%COLORS.length];g.fill()})
  };draw();const observer=new ResizeObserver(draw);observer.observe(c);return()=>observer.disconnect()
 },[xyz,names,states])
 return <div className="relative overflow-hidden rounded-2xl bg-slate-900"><canvas ref={canvas} className="block h-[360px] w-full" aria-label="Skeleton Kinect 3D, hình chiếu X–Y"/>{!xyz&&<div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-300">Chờ skeleton từ trạm Kinect</div>}</div>
}
