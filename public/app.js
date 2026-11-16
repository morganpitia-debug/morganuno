const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const avatars = ['🌞','🌊','🌿','🔥','🌙','🍊','⭐','🪷'];
const urlParams = new URLSearchParams(location.search), seatToken = urlParams.get('seat');
let ws, state = null, token = seatToken || localStorage.getItem('tt-token'), roomCode = '';
let chosenAvatar = avatars[0], pendingCard = null, toastTimer, lastTop = null, lastMyTurn = false, lastHandIds = new Set(), soundOn = true, audio, createRoom = false, scene3d, hostInviteShown = false;
let displayMode = !seatToken && localStorage.getItem('tt-display') === '1';

function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2600); }
function send(data) { if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); else toast('Reconnecting to the table…'); }
function connect(code, create=false, name='', options={}) {
  roomCode=code||''; ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/socket`);
  ws.onopen=()=>send({type:'join',code:roomCode,create,token:options.token||token,name,avatar:chosenAvatar,display:options.display??displayMode});
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.type==='error'){toast(m.message);return;} if(m.type==='welcome'){token=m.token;roomCode=m.code;localStorage.setItem('tt-token',token);localStorage.setItem('tt-room',roomCode);$('#roomcode').textContent=roomCode;showGame();return;} if(m.type==='state'){state=m;render();}};
  ws.onclose=()=>{if(roomCode)setTimeout(()=>connect(roomCode,false,localStorage.getItem('tt-name')||''),1200);};
}
function showGame(){ $('#landing').classList.add('hidden'); $('#game').classList.remove('hidden'); }
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function faceSymbol(face){return ({Reverse:'↻',Skip:'⊘','Draw Two':'+2',Wild:'✦','Wild Four':'+4'})[face]||face;}
function canPlay(c, meTurn){
  if(!meTurn)return false;
  if(state.pendingPenalty)return state.rules.stacking&&((state.penaltyKind==='Draw Two'&&c.face==='Draw Two')||(state.penaltyKind==='Wild Four'&&c.face==='Wild Four'));
  if(state.drawnCard&&state.drawnCard!==c.id)return false;
  if(c.face==='Wild Four'&&state.hand.some(x=>x.id!==c.id&&x.color===state.activeColor))return false;
  return c.color==='wild'||c.color===state.activeColor||c.face===state.top?.face;
}
function render(){
  if(!state)return;
  if(window.TumbleScene){scene3d ||= window.TumbleScene.create($('.felt'));scene3d?.update(state,state.hand);$('.felt').classList.add('webgl-active');}
  const inviteLink=hostInviteShown&&state.host===state.you?`${state.joinUrl}&seat=${encodeURIComponent(token)}`:state.joinUrl;
  $('#roomcode').textContent=state.code; $('#player-count').textContent=`${state.players.length} / 8`;
  $('#invite-url').textContent=inviteLink||'';
  $('#host-seat').classList.toggle('hidden',state.host!==state.you);
  if(hostInviteShown){$('#invite-eyebrow').textContent='PRIVATE HOST CONTROLLER';$('#invite-heading').textContent='Take your hand to a phone';$('#invite-description').textContent='Scan this on your phone, then switch this screen to TV display mode.';}else{$('#invite-eyebrow').textContent='JOIN FROM YOUR PHONE';$('#invite-heading').textContent='Scan to take a seat';$('#invite-description').textContent='Same Wi-Fi, no download. Your hand stays private on your phone.';}
  if(window.QRCode&&inviteLink){const qr=$('#qr-code');if(qr.dataset.url!==inviteLink){qr.innerHTML='';new QRCode(qr,{text:inviteLink,width:82,height:82,colorDark:'#1f4438',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});qr.dataset.url=inviteLink;}}
  const me=state.players.find(p=>p.id===state.you), myTurn=state.players[state.turn]?.id===state.you;
  if(myTurn&&!lastMyTurn&&state.phase==='playing'){navigator.vibrate?.(32);sound('turn');} lastMyTurn=myTurn&&state.phase==='playing';
  if(state.top?.id!==lastTop&&lastTop){sound('play');} lastTop=state.top?.id;
  $('#phase-title').textContent=state.phase==='playing'?'The table is yours':state.phase==='roundover'?'A winner at the table':'Gather around';
  $('#player-list').innerHTML=state.players.map(p=>`<div class="player-chip"><span class="avatar">${p.avatar}</span>${esc(p.name)}<span class="ready-dot ${p.ready?'yes':''}"></span>${p.id===state.host?'<small>host</small>':''}</div>`).join('');
  $('#seats').innerHTML=state.players.map((p,i)=>`<div class="seat-player ${state.turn===i&&state.phase==='playing'?'active':''}"><span class="avatar">${p.avatar}</span>${esc(p.name)} <span class="count">${p.count} cards</span></div>`).join('');
  $('#top-card').className=`card ${state.top?.color||'show-back'}`; $('#top-card').textContent=state.top?faceSymbol(state.top.face):'';
  $('#color-orbit').dataset.color=state.activeColor||'none'; $('#color-name').textContent=({coral:'Coral',ocean:'Ocean',sun:'Sunshine',moss:'Moss'})[state.activeColor]||'—';
  $('#draw-count').textContent=`${state.drawCount} cards`; $('#direction').textContent=state.direction===1?'↻':'↺';
  $('#turn-pill').classList.toggle('hidden',state.phase!=='playing'||!myTurn);
  $('#display-toggle').classList.toggle('hidden',state.host!==state.you);$('#display-toggle').textContent=displayMode?'▣ Return to controller':'▣ TV display';
  $('#display-banner').classList.toggle('hidden',!displayMode);const active=state.players[state.turn];$('#display-turn').textContent=state.phase==='playing'?`${active?.avatar||''} ${active?.name||'Next player'}’s turn`:state.phase==='roundover'?`${state.winner} won the round`:'Waiting for players';
  $('#lobby-panel').classList.toggle('hidden',state.phase!=='lobby'); $('#playing-panel').classList.toggle('hidden',displayMode||state.phase!=='playing'); $('#round-panel').classList.toggle('hidden',state.phase!=='roundover');
  if(state.phase==='lobby'){
    const host=state.host===state.you; $('#ready').classList.toggle('hidden',host); $('#start').classList.toggle('hidden',!host);
    $('#ready-label').textContent=host?'You are the host':me?.ready?'You’re ready':'Tap when you’re ready'; $('#ready').innerHTML=me?.ready?'Ready <span>✓</span>':'I’m ready <span>✓</span>';
    $('#start').disabled=state.players.length<2||state.players.some(p=>!p.ready&&p.id!==state.host); $('#start').style.opacity=$('#start').disabled?'.55':'1';
  }
  if(state.phase==='playing'){
    $('#status-text').textContent=myTurn?(state.pendingPenalty?`Take ${state.pendingPenalty} cards${state.rules.stacking?' or stack a matching draw card':''}`:state.drawnCard?'Play the card you drew or finish your turn':'Your turn — make a move'):'Waiting for your turn…';
    $('#draw').disabled=!myTurn; $('#draw').querySelector('span').textContent=state.pendingPenalty?`Take ${state.pendingPenalty} cards`:state.drawnCard?'Keep card & pass':'Draw a card';
    $('#catch').classList.toggle('hidden',!state.uncalled||state.uncalled===state.you); $('#last').classList.toggle('hidden',(state.hand||[]).length!==1||state.uncalled!==state.you);
    const nowHand=new Set((state.hand||[]).map(c=>c.id));
    $('#hand').innerHTML=(state.hand||[]).map((c,i)=>`<button class="hand-card ${c.color} ${canPlay(c,myTurn)?'':'disabled'} ${lastHandIds.size&&!lastHandIds.has(c.id)?'dealt':''}" data-id="${c.id}" style="--tilt:${(i-(state.hand.length-1)/2)*3}deg" aria-label="${c.color} ${c.face}" title="${c.color} ${c.face}"><span>${faceSymbol(c.face)}</span></button>`).join('');lastHandIds=nowHand;
    $$('.hand-card').forEach(b=>{let sy=0;let tap=0;b.addEventListener('click',()=>{if(b.classList.contains('disabled'))return toast('That card cannot be played right now.');if(Date.now()-tap<420){playCard(b.dataset.id);tap=0;}else{tap=Date.now();b.classList.add('selected');setTimeout(()=>b.classList.remove('selected'),460);}});b.addEventListener('touchstart',e=>sy=e.touches[0].clientY,{passive:true});b.addEventListener('touchend',e=>{if(sy-e.changedTouches[0].clientY>48&&!b.classList.contains('disabled'))playCard(b.dataset.id);},{passive:true});});
  }
  if(state.phase==='roundover'){
    $('#round-number').textContent=state.round; $('#winner-text').textContent=`${state.winner} takes the round!`; $('#round-score').textContent=`${state.winner} earns ${state.roundPoints} points from the cards left at the table.`;
    $('#scoreboard').innerHTML=[...state.scores].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="score-row"><span class="rank">${['01','02','03','04','05','06','07','08'][i]}</span><span>${esc(p.name)}</span><b>${p.score}</b></div>`).join('');
    $('#again').disabled=false;
  }
}
function playCard(id){const c=state.hand.find(x=>x.id===id);if(!c)return;pendingCard=id;if(c.face==='7'&&state.rules.sevenZero){$('#swap-options').innerHTML=state.players.filter(p=>p.id!==state.you).map(p=>`<button class="swap-option" data-id="${p.id}"><span>${p.avatar}</span>${esc(p.name)}</button>`).join('');$$('.swap-option').forEach(b=>b.onclick=()=>{send({type:'play',cardId:id,targetId:b.dataset.id});$('#swap-dialog').close();sound('play');navigator.vibrate?.(20);});$('#swap-dialog').showModal();return;}if(c.color==='wild'){$('#color-dialog').showModal();return;}send({type:'play',cardId:id});sound('play');navigator.vibrate?.(20);}
function sound(kind){if(!soundOn)return;try{audio ||= new AudioContext();const osc=audio.createOscillator(),gain=audio.createGain();osc.type='triangle';osc.frequency.value=kind==='play'?560:420;gain.gain.setValueAtTime(.045,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.12);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+.13);}catch{}}

$('#create').onclick=()=>{displayMode=false;localStorage.setItem('tt-display','0');createRoom=true;$('#room-input').value='';$('.room-code-field').classList.add('hidden');$('#nickname').value=localStorage.getItem('tt-name')||'';$('#join-dialog').showModal();};
$('#enter-code').onclick=()=>{displayMode=false;localStorage.setItem('tt-display','0');createRoom=false;$('.room-code-field').classList.remove('hidden');$('#room-input').value='';$('#nickname').value=localStorage.getItem('tt-name')||'';$('#join-dialog').showModal();};
$('#ready').onclick=()=>send({type:'ready',value:!state.players.find(p=>p.id===state.you)?.ready});
$('#start').onclick=()=>send({type:'start',rules:{stacking:$('#stacking').checked,drawUntilPlayable:$('#draw-until').checked,sevenZero:$('#seven-zero').checked}});
$('#draw').onclick=()=>{if(state.drawnCard){send({type:'pass'});toast('Turn passed.');}else{send({type:'draw'});sound('draw');navigator.vibrate?.(12);}};
$('#last').onclick=()=>{send({type:'call-last'});toast('Last Card called!');navigator.vibrate?.([25,35,25]);};
$('#catch').onclick=()=>{send({type:'catch-last'});toast('Caught! Two cards back in their hand.');};
$('#again').onclick=()=>send({type:'restart'});
$$('.color-options button').forEach(b=>b.onclick=()=>{send({type:'play',cardId:pendingCard,color:b.dataset.color});$('#color-dialog').close();sound('play');navigator.vibrate?.(20);});
$('#copy-link').onclick=async()=>{const link=state?(hostInviteShown&&state.host===state.you?`${state.joinUrl}&seat=${encodeURIComponent(token)}`:state.joinUrl):`${location.origin}/?room=${roomCode}`;try{await navigator.clipboard.writeText(link);toast('Invite link copied.');}catch{toast(link);}};
$('#share').onclick=async()=>{const link=state?(hostInviteShown&&state.host===state.you?`${state.joinUrl}&seat=${encodeURIComponent(token)}`:state.joinUrl):`${location.origin}/?room=${roomCode}`;if(navigator.share)try{await navigator.share({title:'Join my Tabletop Tumble game',text:`Join my table with room code ${roomCode}`,url:link});}catch{}else $('#copy-link').click();};
$('#show-invite').onclick=()=>{hostInviteShown=false;$('#invite-card').classList.toggle('hidden');if(!$('#invite-card').classList.contains('hidden'))render();}; $('#hide-invite').onclick=()=>$('#invite-card').classList.add('hidden');
$('#host-seat').onclick=()=>{hostInviteShown=!hostInviteShown;render();};
$('#display-toggle').onclick=()=>{displayMode=!displayMode;localStorage.setItem('tt-display',displayMode?'1':'0');const previous=ws;if(previous){previous.onclose=()=>{};previous.close();}connect(roomCode,false,localStorage.getItem('tt-name')||'',{display:displayMode});};
$('#sound').onclick=()=>{soundOn=!soundOn;$('#sound').innerHTML=soundOn?'♫ <span>Sound on</span>':'♫ <span>Sound off</span>';toast(soundOn?'Table sounds on':'Table sounds off');};
const avatarEl=$('#avatars');avatarEl.innerHTML=avatars.map((a,i)=>`<button type="button" data-avatar="${a}" class="${i===0?'selected':''}">${a}</button>`).join('');
$$('.avatar-picker button').forEach(b=>b.onclick=()=>{$$('.avatar-picker button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');chosenAvatar=b.dataset.avatar;});
$('#join-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#nickname').value.trim()||'Player';localStorage.setItem('tt-name',name);$('#join-dialog').close();const code=new URLSearchParams(location.search).get('room')||$('#room-input').value.trim().toUpperCase();connect(code,createRoom,name);createRoom=false;});
const linkRoom=urlParams.get('room'), savedRoom=localStorage.getItem('tt-room');
if(linkRoom&&seatToken){displayMode=false;localStorage.setItem('tt-display','0');connect(linkRoom,false,'',{token:seatToken,display:false});}
else if(linkRoom){displayMode=false;createRoom=false;$('.room-code-field').classList.add('hidden');$('#room-input').value=linkRoom;$('#nickname').value=localStorage.getItem('tt-name')||'';$('#join-dialog').showModal();}
else if(savedRoom&&token){connect(savedRoom,false,localStorage.getItem('tt-name')||'');}
