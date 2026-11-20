import http, { type Server } from 'http'

/** Relay the one fixed WS path. Gateway authenticates first frame before emitting any user data. */
export function attachKinectSocket(server:Server) {
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/api/kinect/events'){socket.destroy();return}
    const target=new URL(process.env.KINECT_GATEWAY_URL??'http://kinect-companion-gateway:8032')
    const upstream=http.request({hostname:target.hostname,port:target.port||80,path:'/kinect/user-events',method:'GET',headers:{upgrade:'websocket',connection:'Upgrade','sec-websocket-key':req.headers['sec-websocket-key'],'sec-websocket-version':'13'},timeout:10_000})
    upstream.on('upgrade',(response,peer,buffer)=>{
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n')
      if(head.length)peer.write(head);if(buffer.length)socket.write(buffer)
      socket.pipe(peer).pipe(socket);socket.on('error',()=>peer.destroy());peer.on('error',()=>socket.destroy());socket.on('close',()=>peer.destroy());peer.on('close',()=>socket.destroy())
    })
    upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.on('timeout',()=>{upstream.destroy();socket.destroy()});upstream.end()
  })
}
