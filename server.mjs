import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
const port=Number(process.env.PORT||4173);
const allowed=new Set(['index.html','sw.js','manifest.webmanifest','icon.svg','ときの記録.html']);
http.createServer(async(req,res)=>{
 try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=pathname==='/'?'index.html':pathname.slice(1);if(!allowed.has(file)){res.writeHead(404);return res.end('Not found');}
 const body=await readFile(file==='ときの記録.html'?file:'dist/'+file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',...(file==='ときの記録.html'?{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file)}:{})});res.end(body);
 }catch{res.writeHead(500);res.end('Unable to load app. Run npm run build first.');}
}).listen(port,'0.0.0.0',()=>{console.log(`PC: http://localhost:${port}`);for(const list of Object.values(networkInterfaces()))for(const n of list||[])if(n.family==='IPv4'&&!n.internal)console.log(`Same Wi-Fi: http://${n.address}:${port}`);});
