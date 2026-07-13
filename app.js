import{initializeApp}from"https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import{getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,signInAnonymously,onAuthStateChanged,signOut}from"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import{getFirestore,doc,collection,onSnapshot,runTransaction,serverTimestamp,getDocs,writeBatch}from"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyBZr2HdwiVG-vE1T12BcKlmWOUCB7QYlMY",authDomain:"texas-hold-em-8b398.firebaseapp.com",projectId:"texas-hold-em-8b398",storageBucket:"texas-hold-em-8b398.firebasestorage.app",messagingSenderId:"647906482664",appId:"1:647906482664:web:d2f3ddea2a969156072c5d"};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
const money=n=>`$${Number(n||0).toLocaleString("zh-TW")}`;
const makeId=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
const clean=s=>s.trim().toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,24);
let user=null,roomData=null,roomCode="",isOwner=false,unsubscribe=null,viewerLogUnsubscribe=null,viewerName="";
let editingGameId=sessionStorage.getItem("editingGameId")||"";

const buyinTotal=p=>(p.transactions||[]).reduce((s,t)=>s+Number(t.amount||0),0);
const gameTotals=g=>({
  buy:(g?.players||[]).reduce((s,p)=>s+buyinTotal(p),0),
  cash:(g?.players||[]).reduce((s,p)=>s+Number(p.cashout||0),0)
});
const currentGame=()=>roomData?.games?.find(g=>g.id===roomData.currentGameId)||null;
const isGameEmpty=g=>!g||(!(g.players||[]).length&&gameTotals(g).buy===0&&gameTotals(g).cash===0);
const isEditing=()=>!!editingGameId&&editingGameId===roomData?.currentGameId;
const canEditCurrent=()=>isOwner&&!!currentGame()&&(!currentGame().endedAt||isEditing());
function clearEditingMode(){editingGameId="";sessionStorage.removeItem("editingGameId");}
function setStatus(t){$("status").textContent=t}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
function assertEditable(d){
  const g=(d.games||[]).find(x=>x.id===d.currentGameId);
  if(!g)throw new Error("找不到目前牌局");
  if(g.endedAt&&editingGameId!==g.id)throw new Error("本局已完成，請先按「修改此局」才能變更內容");
  return g;
}

async function createOrOpenOwnerRoom(code){
  const ref=doc(db,"rooms",code);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists()){
      const g={id:makeId(),startedAt:new Date().toISOString(),endedAt:null,players:[]};
      tx.set(ref,{code,ownerEmail:user.email,ownerUid:user.uid,currentGameId:g.id,games:[g],favorites:[],createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      return;
    }
    const d=snap.data();
    if(d.ownerEmail&&d.ownerEmail!==user.email)throw new Error("這個群組已有其他房主");
    tx.update(ref,{ownerEmail:user.email,ownerUid:user.uid,updatedAt:serverTimestamp()});
  });
}
async function enterOwnerRoom(code){roomCode=clean(code);if(!roomCode)return alert("請輸入群組代碼");await createOrOpenOwnerRoom(roomCode);localStorage.setItem("ownerRoom",roomCode);subscribe()}
async function enterViewerRoom(code,name){
  roomCode=clean(code);viewerName=name.trim();
  if(!roomCode||!viewerName)return alert("請輸入名稱與群組代碼");
  localStorage.setItem("viewerRoom",roomCode);localStorage.setItem("viewerName",viewerName);
  subscribe();
  try{await recordViewerAccess()}catch(e){console.warn("查看紀錄寫入失敗，但不影響觀看帳目：",e)}
}
function subscribe(){
  if(unsubscribe)unsubscribe();setStatus("正在同步…");
  unsubscribe=onSnapshot(doc(db,"rooms",roomCode),snap=>{
    if(!snap.exists()){alert("找不到這個群組");return}
    roomData=snap.data();isOwner=!!user?.email&&roomData.ownerEmail===user.email;
    if(editingGameId&&!roomData.games?.some(g=>g.id===editingGameId)){editingGameId="";sessionStorage.removeItem("editingGameId")}
    render();setStatus("已即時同步");
  },e=>{console.error(e);setStatus("同步失敗")});
}
async function mutate(fn){
  if(!isOwner)return alert("只有房主可以修改");
  const ref=doc(db,"rooms",roomCode);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);if(!snap.exists())throw new Error("群組不存在");
    const data=structuredClone(snap.data());if(data.ownerEmail!==user.email)throw new Error("不是房主");
    fn(data);data.updatedAt=serverTimestamp();tx.set(ref,data);
  });
}

async function addFavorite(){const n=$("favoriteName").value.trim();if(!n)return alert("請輸入常用玩家名稱");try{await mutate(d=>{d.favorites=d.favorites||[];if(d.favorites.includes(n))throw new Error("這位玩家已在常用名單");d.favorites.push(n)});$("favoriteName").value=""}catch(e){alert(e.message)}}
async function removeFavorite(name){if(!confirm(`確定將「${name}」從常用玩家移除嗎？\n\n過去牌局與統計不會被刪除。`))return;await mutate(d=>{d.favorites=(d.favorites||[]).filter(n=>n!==name)})}
function renderFavorites(){const list=$("favoriteList");if(!list)return;const names=[...(roomData?.favorites||[])].sort((a,b)=>a.localeCompare(b,"zh-Hant"));list.innerHTML=names.map(n=>`<div class="favorite-chip"><span>${escapeHtml(n)}</span><button class="danger tiny remove-favorite" data-name="${escapeHtml(n)}">移除</button></div>`).join("")||"<p class='muted'>尚未設定常用玩家</p>";list.querySelectorAll(".remove-favorite").forEach(btn=>btn.onclick=()=>removeFavorite(btn.dataset.name))}

async function recordViewerAccess(){
  const viewerUser=auth.currentUser||user;
  if(!viewerUser?.uid)throw new Error("匿名登入尚未完成");
  if(!roomCode)throw new Error("群組代碼不存在");
  const ref=doc(db,"rooms",roomCode,"viewerLogs",viewerUser.uid);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref),now=new Date().toISOString();
    if(snap.exists()){
      const d=snap.data();
      tx.update(ref,{displayName:viewerName,lastSeen:now,visitCount:Number(d.visitCount||0)+1,updatedAt:serverTimestamp()});
    }else{
      tx.set(ref,{uid:viewerUser.uid,displayName:viewerName,firstSeen:now,lastSeen:now,visitCount:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
  });
}
function subscribeViewerLogs(){if(viewerLogUnsubscribe)viewerLogUnsubscribe();const box=$("viewerLogList");if(!box||!isOwner)return;viewerLogUnsubscribe=onSnapshot(collection(db,"rooms",roomCode,"viewerLogs"),snap=>{const rows=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.lastSeen||0)-new Date(a.lastSeen||0));box.innerHTML=rows.map(v=>{const seen=v.lastSeen?new Date(v.lastSeen).toLocaleString("zh-TW",{hour12:false}):"—",short=(v.uid||"").slice(0,8);return `<div class="viewer-log-row"><div><b>${escapeHtml(v.displayName||"未填名稱")}</b><br><small>裝置 ${short}…・查看 ${Number(v.visitCount||1)} 次</small></div><small>${seen}</small></div>`}).join("")||"<p class='muted'>尚無查看紀錄</p>"},e=>{console.error(e);box.innerHTML="<p class='muted'>無法讀取查看紀錄</p>"})}
async function clearViewerLogs(){if(!isOwner)return alert("只有房主可以清空查看紀錄");if(!confirm("確定清空全部查看紀錄嗎？\n\n這不會影響牌局資料。"))return;const snap=await getDocs(collection(db,"rooms",roomCode,"viewerLogs")),batch=writeBatch(db);snap.forEach(d=>batch.delete(d.ref));await batch.commit()}

async function renamePlayer(oldName){
  if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");
  const proposed=prompt("請輸入新的暱稱或代號",oldName);if(proposed===null)return;
  const newName=proposed.trim();if(!newName)return alert("名稱不能空白");if(newName===oldName)return;
  const applyAll=confirm(`要把「${oldName}」在所有過去牌局、統計與常用玩家中都改成「${newName}」嗎？\n\n按「好」＝全部一起改\n按「取消」＝只改目前牌局`);
  await mutate(d=>{assertEditable(d);const targets=applyAll?(d.games||[]):[(d.games||[]).find(g=>g.id===d.currentGameId)].filter(Boolean);for(const g of targets)for(const p of(g.players||[]))if(p.name===oldName)p.name=newName;if(applyAll){d.favorites=(d.favorites||[]).map(n=>n===oldName?newName:n);d.favorites=[...new Set(d.favorites)]}});
}
async function addPlayer(){if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");const n=$("playerName").value.trim()||$("favoriteSelect").value;if(!n)return;try{await mutate(d=>{const g=assertEditable(d);if(g.players.some(p=>p.name===n))throw new Error("玩家已存在");g.players.push({id:makeId(),name:n,cashout:0,transactions:[]});g.updatedAt=new Date().toISOString();d.favorites=d.favorites||[];if(!d.favorites.includes(n))d.favorites.push(n)});$("playerName").value=""}catch(e){alert(e.message)}}
const addBuyin=(pid,a)=>{if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");return mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid);if(!p)throw new Error("找不到玩家");p.transactions.push({id:makeId(),amount:Number(a),at:new Date().toISOString(),by:user.displayName||user.email});g.updatedAt=new Date().toISOString()})};
const saveCashout=(pid,a)=>{if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");return mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid);if(!p)throw new Error("找不到玩家");p.cashout=Number(a||0);g.updatedAt=new Date().toISOString()})};
function deleteBuyin(pid,tid){if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");if(!confirm("確定刪除這筆買入紀錄嗎？\n\n刪除後會重新計算該玩家與本局統計。"))return;mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid);p.transactions=(p.transactions||[]).filter(t=>t.id!==tid);g.updatedAt=new Date().toISOString()}).catch(e=>alert(e.message))}
function editBuyin(pid,tid,oldAmount){if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");const v=prompt("請輸入正確的買入金額",String(oldAmount));if(v===null)return;const amount=Number(v);if(!Number.isFinite(amount)||amount<=0)return alert("請輸入大於 0 的金額");mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid),t=(p.transactions||[]).find(x=>x.id===tid);if(!t)throw new Error("找不到這筆買入紀錄");t.amount=amount;t.editedAt=new Date().toISOString();t.editedBy=user.displayName||user.email;g.updatedAt=new Date().toISOString()}).catch(e=>alert(e.message))}

function render(){
  if(!roomData)return;
  $("loginCard").classList.add("hidden");$("appArea").classList.remove("hidden");$("logoutBtn").classList.remove("hidden");
  $("roleBanner").className=`role ${isOwner?"ownerrole":"viewerrole"}`;$("roleBanner").textContent=isOwner?"房主模式：妳可以編輯帳目":"觀看模式：只能查看帳目";
  document.querySelectorAll(".owner-only").forEach(x=>x.classList.toggle("hidden",!isOwner));if(isOwner)subscribeViewerLogs();
  $("roomTitle").textContent=`群組：${roomCode}`;
  const g=currentGame(),completed=!!g?.endedAt,editable=canEditCurrent();
  // 已完成且未進入修改模式時，整個玩家操作版面收起，避免誤觸。
  $("currentGameCard").classList.toggle("hidden",completed&&!isEditing());
  $("gameDate").textContent=g?new Date(g.startedAt).toLocaleString("zh-TW",{hour12:false}):"";
  $("gameState").className=`game-state ${completed&&!isEditing()?"completed":"active"}`;
  $("gameState").textContent=completed?(isEditing()?"正在修改已完成牌局":"本局已完成，操作已鎖定"):("目前牌局進行中");
  $("playerAddArea").classList.toggle("hidden",!editable);
  $("favoriteManager").classList.toggle("hidden",!editable);
  $("favoriteSelect").innerHTML='<option value="">常用玩家</option>'+[...(roomData.favorites||[])].sort().map(n=>`<option>${escapeHtml(n)}</option>`).join("");
  renderFavorites();
  const wrap=$("players");wrap.innerHTML="";
  (g?.players||[]).forEach(p=>{
    const f=$("playerTemplate").content.cloneNode(true),root=f.querySelector(".player"),b=buyinTotal(p),c=Number(p.cashout||0),profit=c-b;
    root.querySelector(".pname").textContent=p.name;root.querySelector(".pmeta").textContent=`${p.transactions.length} 次買入`;root.querySelector(".pbuy").textContent=money(b);root.querySelector(".pcash").textContent=money(c);
    const pe=root.querySelector(".pprofit");pe.textContent=`${profit>=0?"+":""}${money(profit)}`;pe.classList.add(profit>=0?"pos":"neg");
    root.classList.toggle("locked",!editable);
    root.querySelectorAll(".owner-control").forEach(x=>x.classList.toggle("hidden",!editable));
    root.querySelectorAll("button,input,select").forEach(el=>{if(el.closest(".owner-control"))el.disabled=!editable});
    root.querySelectorAll("[data-buy]").forEach(btn=>btn.onclick=()=>addBuyin(p.id,Number(btn.dataset.buy)));
    root.querySelector(".customBtn").onclick=()=>{const a=Number(prompt("輸入買入金額"));if(a>0)addBuyin(p.id,a)};
    root.querySelector(".cashInput").value=p.cashout?Number(p.cashout):"";
    root.querySelector(".saveBtn").onclick=()=>saveCashout(p.id,root.querySelector(".cashInput").value);
    root.querySelector(".renameBtn").onclick=()=>renamePlayer(p.name);
    root.querySelector(".deleteBtn").onclick=()=>confirm("確定刪除？")&&mutate(d=>{const gg=assertEditable(d);gg.players=gg.players.filter(x=>x.id!==p.id);gg.updatedAt=new Date().toISOString()});
    root.querySelector(".txlist").innerHTML=(p.transactions||[]).slice().reverse().map(t=>`<li class="tx-row"><span>${new Date(t.at).toLocaleString("zh-TW",{hour12:false})}　<b>${money(t.amount)}</b>${t.editedAt?"（已修改）":""}</span>${editable?`<span class="tx-actions"><button class="secondary tiny edit-tx" data-tid="${t.id}" data-amount="${Number(t.amount||0)}">修改</button><button class="danger tiny delete-tx" data-tid="${t.id}">刪除</button></span>`:""}</li>`).join("")||"<li>尚無紀錄</li>";
    root.querySelectorAll(".edit-tx").forEach(btn=>btn.onclick=()=>editBuyin(p.id,btn.dataset.tid,btn.dataset.amount));
    root.querySelectorAll(".delete-tx").forEach(btn=>btn.onclick=()=>deleteBuyin(p.id,btn.dataset.tid));wrap.appendChild(f);
  });
  const {buy,cash}=gameTotals(g),diff=cash-buy;$("totalBuyin").textContent=money(buy);$("totalCashout").textContent=money(cash);$("difference").textContent=`${diff>0?"+":""}${money(diff)}`;$("differenceHint").textContent=diff===0?"帳目相符，可以安心結算。":diff>0?`目前多出 ${money(diff)}。`:`目前少了 ${money(Math.abs(diff))}。`;
  $("finishBtn").classList.toggle("hidden",!isOwner||completed);$("finishEditBtn").classList.toggle("hidden",!isOwner||!isEditing());$("editCurrentBtn").classList.toggle("hidden",!isOwner||!completed||isEditing());
  renderReport();renderGameHistory();
}

function startOfWeek(date){
  const d=new Date(date);
  d.setHours(0,0,0,0);
  const day=d.getDay();
  const daysFromMonday=day===0?6:day-1;
  d.setDate(d.getDate()-daysFromMonday);
  return d;
}
function gameMatchesRange(g,range,now){
  const d=new Date(g.startedAt);
  if(Number.isNaN(d.getTime()))return false;
  if(range==="day")return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();
  if(range==="week"){
    const start=startOfWeek(now),end=new Date(start);
    end.setDate(end.getDate()+7);
    return d>=start&&d<end;
  }
  if(range==="month")return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();
  if(range==="year")return d.getFullYear()===now.getFullYear();
  return true;
}
function rangeLabel(range,now){
  if(range==="day")return `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} 日排行榜`;
  if(range==="week"){
    const start=startOfWeek(now),end=new Date(start);
    end.setDate(end.getDate()+6);
    return `${start.getFullYear()}/${start.getMonth()+1}/${start.getDate()}－${end.getFullYear()}/${end.getMonth()+1}/${end.getDate()} 週排行榜`;
  }
  if(range==="month")return `${now.getFullYear()} 年 ${now.getMonth()+1} 月排行榜`;
  return `${now.getFullYear()} 年排行榜`;
}
async function editGame(gameId){if(!isOwner)return alert("只有房主可以修改牌局");const target=(roomData.games||[]).find(g=>g.id===gameId);if(!target)return alert("找不到這一局");editingGameId=gameId;sessionStorage.setItem("editingGameId",gameId);await mutate(d=>{d.currentGameId=gameId});window.scrollTo({top:0,behavior:"smooth"})}
function finishEditing(){editingGameId="";sessionStorage.removeItem("editingGameId");render();alert("修改已完成，這一局已重新鎖定。")}
function deleteGame(gameId){if(!isOwner)return alert("只有房主可以刪除牌局");const target=(roomData.games||[]).find(g=>g.id===gameId);if(!target)return;const when=new Date(target.startedAt).toLocaleString("zh-TW",{hour12:false});if(!confirm(`確定永久刪除 ${when} 的牌局嗎？\n\n刪除後無法復原，該局也會從日／週／月／年排行榜移除。`))return;mutate(d=>{d.games=(d.games||[]).filter(g=>g.id!==gameId);if(editingGameId===gameId){editingGameId="";sessionStorage.removeItem("editingGameId")}if(d.currentGameId===gameId){const remaining=d.games||[];if(remaining.length)d.currentGameId=remaining[remaining.length-1].id;else{const g={id:makeId(),startedAt:new Date().toISOString(),endedAt:null,players:[]};d.games=[g];d.currentGameId=g.id}}}).catch(e=>alert(e.message))}
function renderGameHistory(){
  const box=$("gameHistory");if(!box)return;
  const games=(roomData.games||[]).filter(g=>!isGameEmpty(g)).slice().sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt));
  box.innerHTML=games.map(g=>{const {buy,cash}=gameTotals(g),diff=cash-buy,isCurrent=g.id===roomData.currentGameId,state=g.endedAt?"已完成":"進行中";return `<div class="game-row"><div><b>${new Date(g.startedAt).toLocaleString("zh-TW",{hour12:false})}</b><br><small>${g.players?.length||0} 位玩家・投入 ${money(buy)}・差額 ${diff>=0?"+":""}${money(diff)}・${state}${isCurrent?"・目前顯示":""}</small></div>${isOwner?`<div class="game-actions">${g.endedAt?`<button class="secondary small edit-game" data-game-id="${g.id}">修改此局</button>`:""}<button class="danger small delete-game" data-game-id="${g.id}">刪除此局</button></div>`:""}</div>`}).join("")||"<p class='muted'>尚無牌局紀錄</p>";
  box.querySelectorAll(".edit-game").forEach(btn=>btn.onclick=()=>editGame(btn.dataset.gameId));box.querySelectorAll(".delete-game").forEach(btn=>btn.onclick=()=>deleteGame(btn.dataset.gameId));
}
function renderReport(){
  const range=$("range").value,now=new Date(),map=new Map();
  $("reportPeriod").textContent=`${rangeLabel(range,now)}｜依總盈虧由高到低排序`;
  (roomData.games||[]).filter(g=>g.endedAt&&gameMatchesRange(g,range,now)&&!isGameEmpty(g)).forEach(g=>(g.players||[]).forEach(p=>{
    const r=map.get(p.name)||{games:0,buyin:0,cashout:0};
    r.games++;r.buyin+=buyinTotal(p);r.cashout+=Number(p.cashout||0);map.set(p.name,r);
  }));
  const rows=[...map].sort((a,b)=>{
    const pa=b[1].cashout-b[1].buyin,pb=a[1].cashout-a[1].buyin;
    return pa-pb||b[1].cashout-a[1].cashout||a[0].localeCompare(b[0],"zh-Hant");
  });
  $("report").innerHTML=rows.map(([n,r],i)=>{
    const profit=r.cashout-r.buyin,medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":`第 ${i+1} 名`;
    return `<div class="ranking-row"><div class="rank-badge">${medal}</div><div class="rank-main"><b>${escapeHtml(n)}</b><small>${r.games} 場・總投入 ${money(r.buyin)}・總拿回 ${money(r.cashout)}</small></div><b class="rank-profit ${profit>=0?"pos":"neg"}">${profit>=0?"+":""}${money(profit)}</b></div>`;
  }).join("")||"<p class='muted'>這個期間尚無已完成牌局</p>";
}

$("googleBtn").onclick=async()=>{const provider=new GoogleAuthProvider();try{const r=await signInWithPopup(auth,provider),c=prompt("請輸入妳要管理的群組代碼");if(c)await enterOwnerRoom(c)}catch(e){if(e.code?.includes("popup"))await signInWithRedirect(auth,provider);else alert(e.message)}};
$("viewerBtn").onclick=async()=>{try{
  if(!auth.currentUser){const credential=await signInAnonymously(auth);user=credential.user}else user=auth.currentUser;
  await enterViewerRoom($("roomCode").value,$("viewerName").value)
}catch(e){console.error(e);alert(`無法觀看帳目：${e.message||"請稍後再試"}`)}};
$("addPlayerBtn").onclick=addPlayer;$("addFavoriteBtn").onclick=addFavorite;$("clearViewerLogsBtn").onclick=()=>clearViewerLogs().catch(e=>alert(e.message));
$("finishBtn").onclick=async()=>{
  if(!canEditCurrent())return;
  const g=currentGame();
  if(isGameEmpty(g))return alert("目前沒有玩家或金額，不需要完成空白牌局。");
  if(!confirm("確定完成本局？完成後操作會立即鎖定，之後仍可按「修改本局」。"))return;
  const endedAt=new Date().toISOString();
  try{
    await mutate(d=>{const gg=assertEditable(d);gg.endedAt=endedAt;gg.updatedAt=endedAt});
    clearEditingMode();
    const local=currentGame();if(local){local.endedAt=endedAt;local.updatedAt=endedAt}
    render();
    alert("本局已完成，操作已鎖定。");
  }catch(e){alert(`完成本局失敗：${e.message}`)}
};
$("editCurrentBtn").onclick=()=>currentGame()&&editGame(currentGame().id);$("finishEditBtn").onclick=finishEditing;
$("newGameBtn").onclick=()=>{if(!isOwner)return;const g=currentGame();if(g&&!g.endedAt&&!isGameEmpty(g)&&!confirm("目前這局尚未完成，仍要直接開新局嗎？舊資料會保留。"))return;if(g&&!g.endedAt&&isGameEmpty(g))return alert("目前已經是空白新局，不需要再開一局。");if(!confirm("確定開新局？只有按下這個按鈕才會建立新的牌局時間。"))return;clearEditingMode();mutate(d=>{const ng={id:makeId(),startedAt:new Date().toISOString(),endedAt:null,players:[]};d.games=d.games||[];d.games.push(ng);d.currentGameId=ng.id})};
$("range").onchange=()=>{renderReport();renderGameHistory()};$("favoriteSelect").onchange=()=>$("playerName").value=$("favoriteSelect").value;
$("switchBtn").onclick=()=>{localStorage.removeItem("ownerRoom");localStorage.removeItem("viewerRoom");sessionStorage.removeItem("editingGameId");location.reload()};$("logoutBtn").onclick=()=>signOut(auth).then(()=>location.reload());

onAuthStateChanged(auth,u=>{user=u;if(!u){setStatus("請登入");return}setStatus("已登入");const ownerRoom=localStorage.getItem("ownerRoom"),viewRoom=localStorage.getItem("viewerRoom"),vname=localStorage.getItem("viewerName")||"";if(u.email&&ownerRoom)enterOwnerRoom(ownerRoom).catch(e=>alert(e.message));else if(!u.email&&viewRoom)enterViewerRoom(viewRoom,vname)});
getRedirectResult(auth).then(r=>{if(r?.user){user=r.user;const c=prompt("請輸入妳要管理的群組代碼");if(c)enterOwnerRoom(c)}});
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js?v=14",{updateViaCache:"none"});
window.addEventListener("error",e=>{const el=document.getElementById("status");if(el)el.textContent="程式載入失敗";console.error(e.error||e.message)});
window.addEventListener("unhandledrejection",e=>console.error(e.reason));
