const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PORT = Number(process.env.PORT || 3000), ROOT = path.join(__dirname, 'public'), rooms = new Map();
const PUBLIC_ORIGIN = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : null;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const COLORS = ['coral','ocean','sun','moss'], AVATARS = ['🌞','🌊','🌿','🔥','🌙','🍊','⭐','🪷'];
function requestOrigin(req){
  if(PUBLIC_ORIGIN)return PUBLIC_ORIGIN;
  const forwardedHost=String(req.headers['x-forwarded-host']||'').split(',')[0].trim();
  const host=forwardedHost||String(req.headers.host||'localhost').split(',')[0].trim();
  const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim();
  if(forwardedHost||!/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(host)){
    try{return new URL(`${proto}://${host}`).origin;}catch{}
  }
  const ips=Object.values(os.networkInterfaces()).flat().filter(x=>x&&!x.internal&&(x.family==='IPv4'||x.family===4));
  const ip=ips.sort((a,b)=>Number(b.address.startsWith('192.168.'))-Number(a.address.startsWith('192.168.')))[0]?.address||'localhost';
  return `http://${ip}:${PORT}`;
}
const server = http.createServer((req,res)=>{
  let pathname; try { pathname = decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname); } catch { res.writeHead(400).end(); return; }
  const full = path.resolve(ROOT, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!full.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(full,(err,data)=>{ if(err){res.writeHead(404).end('Not found');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data); });
});
function frame(text){const b=Buffer.from(text);let h;if(b.length<126)h=Buffer.from([129,b.length]);else if(b.length<65536){h=Buffer.alloc(4);h[0]=129;h[1]=126;h.writeUInt16BE(b.length,2);}else{h=Buffer.alloc(10);h[0]=129;h[1]=127;h.writeBigUInt64BE(BigInt(b.length),2);}return Buffer.concat([h,b]);}
function send(s,o){if(s&&!s.destroyed)s.write(frame(JSON.stringify(o)));}
function listen(s,head){let b=head||Buffer.alloc(0);s.on('data',c=>{b=Buffer.concat([b,c]);while(b.length>=2){const op=b[0]&15,masked=b[1]&128;let n=b[1]&127,i=2;if(n===126){if(b.length<4)break;n=b.readUInt16BE(2);i=4;}else if(n===127){if(b.length<10)break;const z=b.readBigUInt64BE(2);if(z>1000000n)return s.destroy();n=Number(z);i=10;}if(b.length<i+(masked?4:0)+n)break;let mask;if(masked){mask=b.subarray(i,i+4);i+=4;}const p=Buffer.from(b.subarray(i,i+n));b=b.subarray(i+n);if(masked)for(let x=0;x<p.length;x++)p[x]^=mask[x%4];if(op===8)return s.end();if(op===9){s.write(Buffer.from([138,0]));continue;}if(op===1)try{handle(s,JSON.parse(p.toString()));}catch{send(s,{type:'error',message:'Could not read that action.'});}}});}
const newCard=(color,face)=>({id:crypto.randomUUID(),color,face});
function deck(){const a=[];for(const c of COLORS){a.push(newCard(c,'0'));for(let n=1;n<=9;n++)a.push(newCard(c,''+n),newCard(c,''+n));for(const f of ['Skip','Reverse','Draw Two'])a.push(newCard(c,f),newCard(c,f));}for(let i=0;i<4;i++)a.push(newCard('wild','Wild'),newCard('wild','Wild Four'));return a;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];}return a;}
function publicState(r){return{type:'state',code:r.code,joinUrl:`${r.publicOrigin||'http://localhost:'+PORT}/?room=${r.code}`,phase:r.phase,host:r.host,turn:r.turn,direction:r.direction,activeColor:r.activeColor,top:r.discard.at(-1)||null,drawCount:r.draw.length,winner:r.winner,round:r.round,roundPoints:r.roundPoints||0,scores:r.players.map(p=>({id:p.id,name:p.name,score:p.score})),rules:r.rules,pendingPenalty:r.pendingPenalty,penaltyKind:r.penaltyKind,uncalled:r.uncalled,players:r.players.map((p,i)=>({id:p.id,name:p.name,avatar:p.avatar,count:p.hand.length,ready:p.ready,seat:i,called:p.called})),you:null};}
function broadcast(r){const base=publicState(r);for(const p of r.players)for(const s of p.sockets||[])send(s,{...base,you:p.id,...(s.display?{}:{hand:p.hand,drawnCard:p.drawnCard||null})});}
function refill(r){if(!r.draw.length&&r.discard.length>1){const top=r.discard.pop();r.draw=shuffle(r.discard);r.discard=[top];}}
function next(r,n=1){r.turn=(r.turn+r.direction*n+r.players.length*n)%r.players.length;}
function addDraw(r,p,n){if(n>0){p.called=false;if(r.uncalled===p.id)r.uncalled=null;}for(let i=0;i<n;i++){refill(r);if(r.draw.length)p.hand.push(r.draw.pop());}}
function valid(r,c,p){if(c.face==='Wild Four'&&p?.hand.some(x=>x!==c&&x.color===r.activeColor))return false;return c.color==='wild'||c.color===r.activeColor||c.face===r.discard.at(-1)?.face;}
function scoreRound(r,winner){const points=f=>{if(f==='Wild'||f==='Wild Four')return 50;if(['Skip','Reverse','Draw Two'].includes(f))return 20;return Number(f)||0;};const earned=r.players.filter(p=>p!==winner).reduce((s,p)=>s+p.hand.reduce((t,c)=>t+points(c.face),0),0);winner.score+=earned;r.winner=winner.name;r.roundPoints=earned;r.phase='roundover';}
function rotateHands(r){const old=r.players.map(p=>p.hand);for(let i=0;i<r.players.length;i++){const from=(i-r.direction+r.players.length)%r.players.length;r.players[i].hand=old[from];}}
function deal(r){r.draw=shuffle(deck());r.players.forEach(x=>{x.hand=Array.from({length:7},()=>r.draw.pop());x.called=false;x.drawnCard=null;});let first;do{first=r.draw.pop();}while(first.color==='wild');r.discard=[first];r.activeColor=first.color;r.phase='playing';r.winner=null;r.roundPoints=0;r.turn=0;r.direction=1;r.pendingPenalty=0;r.penaltyKind=null;r.uncalled=null;if(first.face==='Reverse')r.direction=-1;if(first.face==='Skip')next(r);if(first.face==='Draw Two'){addDraw(r,r.players[0],2);next(r);}}
function completePlay(r,p,c,color,targetId){p.hand.splice(p.hand.findIndex(x=>x.id===c.id),1);p.drawnCard=null;r.discard.push(c);r.activeColor=c.color==='wild'?color:c.color;
  if(c.face==='7'&&r.rules.sevenZero){const target=r.players.find(x=>x.id===targetId);if(target&&target!==p){[p.hand,target.hand]=[target.hand,p.hand];target.called=false;if(r.uncalled===target.id)r.uncalled=null;if(target.hand.length===1)r.uncalled=target.id;}}
  if(c.face==='0'&&r.rules.sevenZero)rotateHands(r);
  if(p.hand.length===1&&!p.called){r.uncalled=p.id;}else if(p.hand.length!==1){p.called=false;}
  if(!p.hand.length){scoreRound(r,p);return;}
  if(c.face==='Reverse')r.direction*=-1;
  if(c.face==='Skip')next(r,2);else next(r,1);
  if(c.face==='Draw Two'||c.face==='Wild Four'){
    const amount=c.face==='Draw Two'?2:4;
    if(r.rules.stacking){r.pendingPenalty+=amount;r.penaltyKind=c.face;}
    else{addDraw(r,r.players[r.turn],amount);next(r);}
  }
  if(r.uncalled&&r.players[r.turn]?.id===r.uncalled){const caught=r.players.find(x=>x.id===r.uncalled);addDraw(r,caught,2);caught.called=false;r.uncalled=null;}
}
function handle(s,m){
 if(m.type==='join'){
  let code=String(m.code||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4),r=rooms.get(code);
  if(!r&&m.create){do{code=Array.from({length:4},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('');}while(rooms.has(code));r={code,publicOrigin:s.publicOrigin,phase:'lobby',host:null,turn:0,direction:1,activeColor:null,draw:[],discard:[],players:[],rules:{stacking:false,drawUntilPlayable:false,sevenZero:false},pendingPenalty:0,penaltyKind:null,pendingSwap:null,uncalled:null,round:1};rooms.set(code,r);}
  if(!r)return send(s,{type:'error',message:'Room not found. Check the code and try again.'});let p=r.players.find(x=>x.token===String(m.token||'')&&m.token);
  if(!r.publicOrigin)r.publicOrigin=s.publicOrigin;
  if(p){p.name=String(m.name||p.name).slice(0,18)||p.name;}else{if(r.phase!=='lobby'||r.players.length>=8)return send(s,{type:'error',message:'This room has started or is full.'});p={id:crypto.randomUUID(),token:crypto.randomUUID(),name:String(m.name||'').trim().slice(0,18)||`Player ${r.players.length+1}`,avatar:AVATARS.includes(m.avatar)?m.avatar:AVATARS[r.players.length],ready:!r.host,called:false,hand:[],score:0,sockets:new Set()};if(!r.host)r.host=p.id;r.players.push(p);}
  p.sockets ||= new Set();p.sockets.add(s);s.display=!!m.display;s.player=p;s.room=r;s.on('close',()=>{p.sockets.delete(s);broadcast(r);});send(s,{type:'welcome',token:p.token,code:r.code});broadcast(r);return;
 }
 const r=s.room,p=s.player;if(!r||!p)return;
 if(s.display&&['play','draw','pass','call-last','catch-last','swap'].includes(m.type))return send(s,{type:'error',message:'Open your private hand on a phone to play.'});
 if(m.type==='ready'&&r.phase==='lobby')p.ready=!!m.value;
 if(m.type==='start'&&p.id===r.host&&r.phase==='lobby'&&r.players.length>=2){if(r.players.some(x=>!x.ready&&x.id!==r.host))return send(s,{type:'error',message:'Everyone needs to be ready first.'});r.rules={stacking:!!m.rules?.stacking,drawUntilPlayable:!!m.rules?.drawUntilPlayable,sevenZero:!!m.rules?.sevenZero};deal(r);broadcast(r);return;}
 if(m.type==='play'&&r.phase==='playing'){
  if(r.players[r.turn]!==p)return send(s,{type:'error',message:'It is not your turn.'});const c=p.hand.find(x=>x.id===m.cardId);if(!c)return send(s,{type:'error',message:'That card is not in your hand.'});
  if(r.pendingPenalty){const stackable=r.rules.stacking&&((r.penaltyKind==='Draw Two'&&c.face==='Draw Two')||(r.penaltyKind==='Wild Four'&&c.face==='Wild Four'));if(!stackable)return send(s,{type:'error',message:'Stack a matching draw card or take the penalty.'});}
  else if(p.drawnCard&&p.drawnCard!==c.id)return send(s,{type:'error',message:'After drawing, you may only play the card you just drew.'});else if(!valid(r,c,p))return send(s,{type:'error',message:'That card cannot be played now. Wild Four needs an empty active color.'});
  if(c.color==='wild'&&!COLORS.includes(m.color))return send(s,{type:'error',message:'Choose the next color.'});
  if(c.face==='7'&&r.rules.sevenZero){const t=r.players.find(x=>x.id===m.targetId);if(!t||t===p)return send(s,{type:'error',message:'Choose another player to swap hands with.'});}
  if(r.pendingPenalty){r.pendingPenalty=0;r.penaltyKind=null;}
  completePlay(r,p,c,m.color,m.targetId);broadcast(r);return;
 }
 if(m.type==='draw'&&r.phase==='playing'&&r.players[r.turn]===p){
  if(r.pendingPenalty){addDraw(r,p,r.pendingPenalty);r.pendingPenalty=0;r.penaltyKind=null;p.drawnCard=null;next(r);}
  else{let c;do{refill(r);c=r.draw.pop();if(!c)break;p.hand.push(c);}while(r.rules.drawUntilPlayable&&!valid(r,c,p));if(c&&valid(r,c,p)){p.drawnCard=c.id;}else{p.drawnCard=null;next(r);}}
  broadcast(r);return;
 }
 if(m.type==='pass'&&r.phase==='playing'&&r.players[r.turn]===p&&p.drawnCard&&!r.pendingPenalty){p.drawnCard=null;next(r);broadcast(r);return;}
 if(m.type==='call-last'&&r.phase==='playing'&&p.hand.length===1&&r.uncalled===p.id){p.called=true;r.uncalled=null;broadcast(r);return;}
 if(m.type==='catch-last'&&r.phase==='playing'&&r.uncalled&&r.uncalled!==p.id){const target=r.players.find(x=>x.id===r.uncalled);if(target){addDraw(r,target,2);target.called=false;}r.uncalled=null;broadcast(r);return;}
 if(m.type==='swap'&&r.phase==='playing'&&r.pendingSwap?.player===p.id){const t=r.players.find(x=>x.id===m.targetId);if(t&&t!==p){[p.hand,t.hand]=[t.hand,p.hand];r.pendingSwap=null;broadcast(r);}return;}
 if(m.type==='restart'&&r.phase==='roundover'){r.round++;deal(r);broadcast(r);}
}
server.on('upgrade',(req,s,head)=>{if(req.url!=='/socket')return s.destroy();const key=req.headers['sec-websocket-key'];if(!key)return s.destroy();s.publicOrigin=requestOrigin(req);const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');s.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);listen(s,head);});
server.listen(PORT,'0.0.0.0',()=>console.log(`Tabletop Tumble is ready at http://localhost:${PORT}`));
