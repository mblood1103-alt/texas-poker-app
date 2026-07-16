import{initializeApp}from"https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import{getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,signInAnonymously,onAuthStateChanged,signOut}from"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import{getFirestore,doc,collection,onSnapshot,runTransaction,serverTimestamp,getDocs,writeBatch}from"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyBZr2HdwiVG-vE1T12BcKlmWOUCB7QYlMY",authDomain:"texas-hold-em-8b398.firebaseapp.com",projectId:"texas-hold-em-8b398",storageBucket:"texas-hold-em-8b398.firebasestorage.app",messagingSenderId:"647906482664",appId:"1:647906482664:web:d2f3ddea2a969156072c5d"};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
const money=n=>`$${Number(n||0).toLocaleString("zh-TW")}`;
const makeId=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
const clean=s=>s.trim().toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,24);
const actorName=()=>user?.displayName||user?.email||"房主";
let user=null,roomData=null,roomCode="",isOwner=false,unsubscribe=null,viewerLogUnsubscribe=null,viewerName="";
let editingGameId=sessionStorage.getItem("editingGameId")||"";
let historyDateFilter="";
let calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let pendingCashoutScrollFrom="";
const expandedSettledPlayers=new Set();

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
      tx.set(ref,{code,ownerEmail:user?.email||"",ownerUid:user?.uid||"",currentGameId:g.id,games:[g],favorites:[],createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      return;
    }
    const d=snap.data();
    if(d.ownerEmail&&d.ownerEmail!==user?.email)throw new Error("這個群組已有其他房主");
    tx.update(ref,{ownerEmail:user?.email||"",ownerUid:user?.uid||"",updatedAt:serverTimestamp()});
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
    roomData=snap.data();isOwner=!!user?.email&&roomData.ownerEmail===user?.email;
    if(editingGameId&&!roomData.games?.some(g=>g.id===editingGameId)){editingGameId="";sessionStorage.removeItem("editingGameId")}
    render();setStatus("已即時同步");
  },e=>{console.error(e);setStatus("同步失敗")});
}
async function mutate(fn){
  if(!isOwner)return alert("只有房主可以修改");
  const ref=doc(db,"rooms",roomCode);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);if(!snap.exists())throw new Error("群組不存在");
    const data=structuredClone(snap.data());if(data.ownerEmail!==user?.email)throw new Error("不是房主");
    fn(data);data.updatedAt=serverTimestamp();tx.set(ref,data);
  });
}

async function addFavorite(){const n=$("favoriteName").value.trim();if(!n)return alert("請輸入常用玩家名稱");try{await mutate(d=>{d.favorites=d.favorites||[];if(d.favorites.includes(n))throw new Error("這位玩家已在常用名單");d.favorites.push(n)});$("favoriteName").value=""}catch(e){alert(e.message)}}
async function removeFavorite(name){if(!confirm(`確定將「${name}」從常用玩家移除嗎？\n\n過去牌局與統計不會被刪除。`))return;await mutate(d=>{d.favorites=(d.favorites||[]).filter(n=>n!==name)})}
function renderFavorites(){const list=$("favoriteList");if(!list)return;const names=[...(roomData?.favorites||[])].sort((a,b)=>a.localeCompare(b,"zh-Hant"));list.innerHTML=names.map(n=>`<div class="favorite-chip"><span>${escapeHtml(n)}</span><button class="danger tiny remove-favorite" data-name="${escapeHtml(n)}">移除</button></div>`).join("")||"<p class='muted'>尚未設定常用玩家</p>";list.querySelectorAll(".remove-favorite").forEach(btn=>btn.onclick=()=>removeFavorite(btn.dataset.name))}

function todayKey(){
  const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
async function recordViewerAccess(){
  const viewerUser=auth.currentUser||user;
  if(!viewerUser?.uid)throw new Error("匿名登入尚未完成");
  if(!roomCode)throw new Error("群組代碼不存在");
  const ref=doc(db,"rooms",roomCode,"viewerLogs",viewerUser.uid);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref),now=new Date().toISOString(),dateKey=todayKey();
    if(snap.exists()){
      const d=snap.data(),sameDay=d.visitDateKey===dateKey;
      const oldTimes=Array.isArray(d.accessTimes)?d.accessTimes.filter(Boolean):[];
      const accessTimes=oldTimes.length?oldTimes:[d.lastSeen].filter(Boolean);
      accessTimes.push(now);
      tx.update(ref,{
        displayName:viewerName,lastSeen:now,visitDateKey:dateKey,
        visitCount:sameDay?Number(d.visitCount||0)+1:1,
        totalCount:Number(d.totalCount||d.visitCount||accessTimes.length-1)+1,
        accessTimes,updatedAt:serverTimestamp()
      });
    }else{
      tx.set(ref,{uid:viewerUser.uid,displayName:viewerName,firstSeen:now,lastSeen:now,visitDateKey:dateKey,visitCount:1,totalCount:1,accessTimes:[now],createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
  });
}
async function deleteViewerLog(logId,displayName){
  if(!isOwner)return alert("只有房主可以刪除查看紀錄");
  if(!confirm(`確定刪除「${displayName||"未填名稱"}」這筆查看紀錄嗎？\n\n這不會影響牌局資料。`))return;
  const batch=writeBatch(db);batch.delete(doc(db,"rooms",roomCode,"viewerLogs",logId));await batch.commit();
}
function subscribeViewerLogs(){
  if(viewerLogUnsubscribe)viewerLogUnsubscribe();
  const box=$("viewerLogList");if(!box||!isOwner)return;
  viewerLogUnsubscribe=onSnapshot(collection(db,"rooms",roomCode,"viewerLogs"),snap=>{
    const currentDay=todayKey();
    const rows=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>new Date(b.lastSeen||0)-new Date(a.lastSeen||0));
    box.innerHTML=rows.map(v=>{
      const short=(v.uid||"").slice(0,8);
      let times=Array.isArray(v.accessTimes)?v.accessTimes.filter(Boolean):[];
      if(!times.length&&v.lastSeen)times=[v.lastSeen];
      times=times.slice().sort((a,b)=>new Date(b)-new Date(a));
      const todayFromTimes=times.filter(t=>{const d=new Date(t),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`===currentDay}).length;
      const todayCount=times.length?todayFromTimes:(v.visitDateKey===currentDay?Number(v.visitCount||0):0);
      const totalCount=Math.max(Number(v.totalCount||0),times.length,Number(v.visitCount||0));
      const details=times.map(t=>`<li>${new Date(t).toLocaleString("zh-TW",{hour12:false})}</li>`).join("")||"<li>尚無時間紀錄</li>";
      return `<div class="viewer-log-row viewer-log-card"><div class="viewer-log-main"><b>${escapeHtml(v.displayName||"未填名稱")}</b><br><small>裝置 ${short}…・今日查看 ${todayCount} 次・總累積 ${totalCount} 次</small><details class="viewer-time-details"><summary>查看明細</summary><ul>${details}</ul></details></div><div class="viewer-log-actions"><button class="danger tiny delete-viewer-log" data-id="${escapeHtml(v.id)}" data-name="${escapeHtml(v.displayName||"未填名稱")}" type="button">刪除</button></div></div>`;
    }).join("")||"<p class='muted'>尚無查看紀錄</p>";
    box.querySelectorAll(".delete-viewer-log").forEach(btn=>btn.onclick=()=>deleteViewerLog(btn.dataset.id,btn.dataset.name).catch(e=>alert(e.message)));
  },e=>{console.error(e);box.innerHTML="<p class='muted'>無法讀取查看紀錄</p>"});
}

async function clearViewerLogs(){if(!isOwner)return alert("只有房主可以清空查看紀錄");if(!confirm("確定清空全部查看紀錄嗎？\n\n這不會影響牌局資料。"))return;const snap=await getDocs(collection(db,"rooms",roomCode,"viewerLogs")),batch=writeBatch(db);snap.forEach(d=>batch.delete(d.ref));await batch.commit()}

async function renamePlayer(oldName){
  if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");
  const proposed=prompt("請輸入新的暱稱或代號",oldName);if(proposed===null)return;
  const newName=proposed.trim();if(!newName)return alert("名稱不能空白");if(newName===oldName)return;
  const applyAll=confirm(`要把「${oldName}」在所有過去牌局、統計與常用玩家中都改成「${newName}」嗎？\n\n按「好」＝全部一起改\n按「取消」＝只改目前牌局`);
  await mutate(d=>{assertEditable(d);const targets=applyAll?(d.games||[]):[(d.games||[]).find(g=>g.id===d.currentGameId)].filter(Boolean);for(const g of targets)for(const p of(g.players||[]))if(p.name===oldName)p.name=newName;if(applyAll){d.favorites=(d.favorites||[]).map(n=>n===oldName?newName:n);d.favorites=[...new Set(d.favorites)]}});
}
async function addPlayer(){
  if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");
  const n=$("playerName").value.trim()||$("favoriteSelect").value;
  if(!n)return alert("請先選擇或輸入玩家名稱");
  const initialAmount=Math.max(0,Number($("initialBuyinAmount").value||0));
  try{
    await mutate(d=>{
      const g=assertEditable(d);
      if(g.players.some(p=>p.name===n))throw new Error("玩家已存在");
      const transactions=initialAmount>0?[{id:makeId(),amount:initialAmount,at:new Date().toISOString(),by:actorName()}]:[];
      g.players.push({id:makeId(),name:n,cashout:0,transactions});
      g.updatedAt=new Date().toISOString();
      d.favorites=d.favorites||[];
      if(!d.favorites.includes(n))d.favorites.push(n);
    });
    $("playerName").value="";
    $("favoriteSelect").value="";
  }catch(e){alert(e.message)}
}
const addBuyin=(pid,a)=>{if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");return mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid);if(!p)throw new Error("找不到玩家");p.transactions.push({id:makeId(),amount:Number(a),at:new Date().toISOString(),by:actorName()});p.cashoutCompleted=false;g.updatedAt=new Date().toISOString()})};
async function subtractBuyin100(pid){
  if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");
  const player=currentGame()?.players?.find(x=>x.id===pid);
  if(!player)return alert("找不到玩家");
  if(buyinTotal(player)<100)return alert("目前投入不足 $100，不能再扣除。");
  try{
    await mutate(d=>{
      const g=assertEditable(d),p=g.players.find(x=>x.id===pid);
      if(!p)throw new Error("找不到玩家");
      let remain=100;
      const tx=[...(p.transactions||[])];
      for(let i=tx.length-1;i>=0&&remain>0;i--){
        const amount=Number(tx[i].amount||0);
        if(amount<=0)continue;
        const used=Math.min(amount,remain);
        tx[i]={...tx[i],amount:amount-used,editedAt:new Date().toISOString(),editedBy:actorName()};
        remain-=used;
      }
      p.transactions=tx.filter(t=>Number(t.amount||0)>0);
      p.cashoutCompleted=false;
      g.updatedAt=new Date().toISOString();
    });
  }catch(e){alert(e.message)}
}

async function saveCashout(pid,a){
  if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");
  if(a===""||a===null||a===undefined)return alert("請先輸入最後拿回金額，沒拿回請輸入 0");
  const amount=Number(a);
  if(!Number.isFinite(amount)||amount<0)return alert("請輸入 0 以上的拿回金額");
  pendingCashoutScrollFrom=pid;
  expandedSettledPlayers.delete(pid);
  try{
    await mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid);if(!p)throw new Error("找不到玩家");p.cashout=amount;p.cashoutCompleted=true;p.cashoutCompletedAt=new Date().toISOString();g.updatedAt=new Date().toISOString()});
  }catch(e){pendingCashoutScrollFrom="";throw e}
}
function expandSettledPlayer(pid){expandedSettledPlayers.add(pid);render();requestAnimationFrame(()=>document.querySelector(`.player[data-player-id="${CSS.escape(pid)}"] .cashInput`)?.focus())}
function deleteBuyin(pid,tid){if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");if(!confirm("確定刪除這筆買入紀錄嗎？\n\n刪除後會重新計算該玩家與本局統計。"))return;mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid);p.transactions=(p.transactions||[]).filter(t=>t.id!==tid);p.cashoutCompleted=false;g.updatedAt=new Date().toISOString()}).catch(e=>alert(e.message))}
function editBuyin(pid,tid,oldAmount){if(!canEditCurrent())return alert("本局已完成，請先按「修改此局」");const v=prompt("請輸入正確的買入金額",String(oldAmount));if(v===null)return;const amount=Number(v);if(!Number.isFinite(amount)||amount<=0)return alert("請輸入大於 0 的金額");mutate(d=>{const g=assertEditable(d),p=g.players.find(x=>x.id===pid),t=(p.transactions||[]).find(x=>x.id===tid);if(!t)throw new Error("找不到這筆買入紀錄");t.amount=amount;t.editedAt=new Date().toISOString();t.editedBy=actorName();p.cashoutCompleted=false;g.updatedAt=new Date().toISOString()}).catch(e=>alert(e.message))}

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
  const auditDate=g?new Date(g.startedAt).toLocaleDateString("zh-TW",{year:"numeric",month:"numeric",day:"numeric"}):"未建立牌局";
  $("auditTitle").textContent=`本局驗帳｜${auditDate}`;
  $("auditStatus").textContent=completed?(isEditing()?"正在修改這一局":"本局已完成並保存"):"目前進行中的牌局";
  $("gameState").className=`game-state ${completed&&!isEditing()?"completed":"active"}`;
  $("gameState").textContent=completed?(isEditing()?"正在修改已完成牌局":"本局已完成，操作已鎖定"):("目前牌局進行中");
  // 觀看者在牌局進行中可即時查看所有玩家的買入金額、次數與明細。
  $("liveBuyinNotice").classList.toggle("hidden",isOwner||completed);
  $("playerAddArea").classList.toggle("hidden",!editable);
  $("favoriteManager").classList.toggle("hidden",!editable);
  $("favoriteSelect").innerHTML='<option value="">常用玩家</option>'+[...(roomData.favorites||[])].sort().map(n=>`<option>${escapeHtml(n)}</option>`).join("");
  renderFavorites();
  const wrap=$("players");wrap.innerHTML="";
  (g?.players||[]).forEach(p=>{
    const f=$("playerTemplate").content.cloneNode(true),root=f.querySelector(".player"),b=buyinTotal(p),c=Number(p.cashout||0),profit=c-b;
    const isSettled=!!p.cashoutCompleted,collapsedSettled=isSettled&&!expandedSettledPlayers.has(p.id)&&editable;
    root.dataset.playerId=p.id;
    root.querySelector(".pname").textContent=p.name;root.querySelector(".pmeta").textContent=isSettled?`✅ 已結算・${p.transactions.length} 次買入・投入 ${money(b)}`:`${p.transactions.length} 次買入・目前投入 ${money(b)}`;
    root.querySelectorAll(".pbuy").forEach(el=>el.textContent=money(b));root.querySelectorAll(".pcash").forEach(el=>el.textContent=money(c));
    root.querySelectorAll(".pprofit").forEach(pe=>{pe.textContent=`${profit>=0?"+":""}${money(profit)}`;pe.classList.add(profit>=0?"pos":"neg")});
    // 未結算時，觀看者只顯示即時買入資訊；完成本局後才顯示拿回與盈虧。
    const viewerLive=!isOwner&&!completed;
    root.querySelector(".cashout-total")?.classList.toggle("hidden",viewerLive);
    root.querySelector(".profit-total")?.classList.toggle("hidden",viewerLive);
    root.classList.toggle("viewer-live",viewerLive);
    root.classList.toggle("locked",!editable);
    root.classList.toggle("settled-collapsed",collapsedSettled);
    root.querySelector(".settled-summary")?.classList.toggle("hidden",!collapsedSettled);
    root.querySelector(".player-full-content")?.classList.toggle("hidden",collapsedSettled);
    root.querySelectorAll(".owner-control").forEach(x=>x.classList.toggle("hidden",!editable));
    root.querySelectorAll("button,input,select").forEach(el=>{if(el.closest(".owner-control"))el.disabled=!editable});
    root.querySelectorAll("[data-buy]").forEach(btn=>btn.onclick=()=>addBuyin(p.id,Number(btn.dataset.buy)));
    root.querySelector(".minus100Btn").onclick=()=>subtractBuyin100(p.id);
    root.querySelector(".customBtn").onclick=()=>{const a=Number(prompt("輸入買入金額"));if(a>0)addBuyin(p.id,a)};
    root.querySelector(".cashInput").value=p.cashout?Number(p.cashout):"";
    root.querySelector(".saveBtn").onclick=()=>saveCashout(p.id,root.querySelector(".cashInput").value).catch(e=>alert(e.message));
    root.querySelector(".editSettlementBtn")?.addEventListener("click",()=>expandSettledPlayer(p.id));
    root.querySelector(".renameBtn").onclick=()=>renamePlayer(p.name);
    root.querySelector(".deleteBtn").onclick=()=>confirm("確定刪除？")&&mutate(d=>{const gg=assertEditable(d);gg.players=gg.players.filter(x=>x.id!==p.id);gg.updatedAt=new Date().toISOString()});
    root.querySelector(".txlist").innerHTML=(p.transactions||[]).slice().reverse().map(t=>`<li class="tx-row"><span>${new Date(t.at).toLocaleString("zh-TW",{hour12:false})}　<b>${money(t.amount)}</b>${t.editedAt?"（已修改）":""}</span>${editable?`<span class="tx-actions"><button class="secondary tiny edit-tx" data-tid="${t.id}" data-amount="${Number(t.amount||0)}">修改</button><button class="danger tiny delete-tx" data-tid="${t.id}">刪除</button></span>`:""}</li>`).join("")||"<li>尚無紀錄</li>";
    root.querySelectorAll(".edit-tx").forEach(btn=>btn.onclick=()=>editBuyin(p.id,btn.dataset.tid,btn.dataset.amount));
    root.querySelectorAll(".delete-tx").forEach(btn=>btn.onclick=()=>deleteBuyin(p.id,btn.dataset.tid));wrap.appendChild(f);
  });
  if(pendingCashoutScrollFrom&&editable){
    const players=g?.players||[],fromIndex=players.findIndex(p=>p.id===pendingCashoutScrollFrom);
    const ordered=[...players.slice(fromIndex+1),...players.slice(0,Math.max(0,fromIndex))];
    const next=ordered.find(p=>!p.cashoutCompleted);
    pendingCashoutScrollFrom="";
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(next){
        const el=wrap.querySelector(`.player[data-player-id="${CSS.escape(next.id)}"]`);
        el?.scrollIntoView({behavior:"smooth",block:"center"});
        setTimeout(()=>el?.querySelector(".cashInput")?.focus({preventScroll:true}),450);
      }
    }));
  }
  const {buy,cash}=gameTotals(g),diff=cash-buy;$("totalBuyin").textContent=money(buy);$("totalCashout").textContent=money(cash);$("difference").textContent=`${diff>0?"+":""}${money(diff)}`;$("differenceHint").textContent=diff===0?"帳目相符，可以安心結算。":diff>0?`目前多出 ${money(diff)}。`:`目前少了 ${money(Math.abs(diff))}。`;
  const auditEntries=(g?.players||[]).map(p=>{const pb=buyinTotal(p),pc=Number(p.cashout||0);return [p.name,{buyin:pb,cashout:pc,count:(p.transactions||[]).length}]});
  const auditRows=buildCompositeRanking(auditEntries);
  $("auditPlayerRanking").innerHTML=auditRows.length?auditRows.map((x,i)=>`<div class="audit-player-row"><div class="audit-rank">${i<3?["🥇","🥈","🥉"][i]:`第 ${i+1} 名`}</div><div class="audit-player-main"><b>${escapeHtml(x.name)}</b><small>${x.r.count} 次買入・投入 ${money(x.buyin)}・拿回 ${money(x.cashout)}・報酬率 ${formatRate(x.roi)}</small><small>綜合分數 ${x.score.toFixed(1)}</small></div><strong class="${x.profit>=0?"pos":"neg"}">${x.profit>=0?"+":""}${money(x.profit)}</strong></div>`).join(""):"<p class='muted'>本局尚未加入玩家</p>";
  $("finishBtn").classList.toggle("hidden",!isOwner||completed);$("finishEditBtn").classList.toggle("hidden",!isOwner||!isEditing());$("editCurrentBtn").classList.toggle("hidden",!isOwner||!completed||isEditing());
  // 「開新局」獨立顯示：只有本局完成、且未在修改時才出現。
  $("newGameCard").classList.toggle("hidden",!isOwner||!completed||isEditing());
  // 只要目前是空白未完成的新局，而且還有上一局，就允許取消。
  // 同時相容舊版已建立、沒有 openedFromGameId 標記的空白新局。
  const allGames=roomData.games||[];
  const currentIndex=g?allGames.findIndex(x=>x.id===g.id):-1;
  const fallbackPrevious=currentIndex>0?allGames[currentIndex-1]:null;
  const previousGame=g?(allGames.find(x=>x.id===g.openedFromGameId)||fallbackPrevious):null;
  const canCancelNewGame=!!(isOwner&&g&&!g.endedAt&&isGameEmpty(g)&&previousGame);
  $("cancelNewGameBtn").classList.toggle("hidden",!canCancelNewGame);
  renderReport();renderGameHistory();
}


function buildCompositeRanking(entries){
  const rows=entries.map(([name,r])=>{
    const buyin=Number(r.buyin??r.buy??0);
    const cashout=Number(r.cashout??r.cash??0);
    const profit=cashout-buyin;
    const roi=buyin>0?(profit/buyin)*100:0;
    return {name,r,buyin,cashout,profit,roi,score:0};
  });
  if(!rows.length)return rows;
  const profits=rows.map(x=>x.profit),rois=rows.map(x=>x.roi);
  const minProfit=Math.min(...profits),maxProfit=Math.max(...profits);
  const minRoi=Math.min(...rois),maxRoi=Math.max(...rois);
  const normalize=(value,min,max)=>max===min?50:((value-min)/(max-min))*100;
  rows.forEach(x=>{
    const profitScore=normalize(x.profit,minProfit,maxProfit);
    const roiScore=normalize(x.roi,minRoi,maxRoi);
    x.score=(profitScore*0.5)+(roiScore*0.5);
  });
  return rows.sort((a,b)=>b.score-a.score||b.profit-a.profit||b.roi-a.roi||b.cashout-a.cashout||a.name.localeCompare(b.name,"zh-Hant"));
}
function formatRate(value){
  const rounded=Math.round(value*10)/10;
  return `${rounded>=0?"+":""}${rounded}%`;
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
function localDateKey(value){
  const d=new Date(value);if(Number.isNaN(d.getTime()))return "";
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function dateFromInput(value){
  const [y,m,d]=String(value||"").split("-").map(Number);
  if(!y||!m||!d)return null;
  return new Date(y,m-1,d);
}
function shiftHistoryDate(days){
  let base=dateFromInput(historyDateFilter)||new Date();
  base.setDate(base.getDate()+days);
  historyDateFilter=localDateKey(base);
  calendarMonth=new Date(base.getFullYear(),base.getMonth(),1);
  $("historyDate").value=historyDateFilter;
  renderGameHistory();
}
function shiftCalendarMonth(months){
  calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+months,1);
  renderGameHistory();
}
function renderHistoryCalendar(allGames){
  const grid=$("historyCalendar"),title=$("calendarMonthTitle");if(!grid||!title)return;
  const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth();
  title.textContent=`${year} 年 ${month+1} 月`;
  const counts=new Map();
  allGames.forEach(g=>{const key=localDateKey(g.startedAt);if(!key)return;counts.set(key,(counts.get(key)||0)+1)});
  const firstDay=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const todayKey=localDateKey(new Date());
  const cells=[];
  for(let i=0;i<firstDay;i++)cells.push('<span class="calendar-empty" aria-hidden="true"></span>');
  for(let day=1;day<=daysInMonth;day++){
    const key=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const count=counts.get(key)||0;
    const selected=key===historyDateFilter,today=key===todayKey;
    const label=count?`${year}年${month+1}月${day}日，有 ${count} 局牌局`:`${year}年${month+1}月${day}日，沒有牌局`;
    cells.push(`<button class="calendar-day${selected?" selected":""}${today?" today":""}${count?" has-game":""}" type="button" data-date="${key}" aria-label="${label}" aria-pressed="${selected}"><span>${day}</span>${count?`<i title="${count} 局">${count>1?count:""}</i>`:""}</button>`);
  }
  grid.innerHTML=cells.join("");
  grid.querySelectorAll(".calendar-day").forEach(btn=>btn.onclick=()=>{historyDateFilter=btn.dataset.date;const d=dateFromInput(historyDateFilter);calendarMonth=new Date(d.getFullYear(),d.getMonth(),1);$("historyDate").value=historyDateFilter;renderGameHistory()});
}
function gameDetailHtml(g){
  const players=(g.players||[]).map(p=>{
    const buy=buyinTotal(p),cash=Number(p.cashout||0),profit=cash-buy;
    const tx=(p.transactions||[]).map(t=>`<li>${new Date(t.at).toLocaleString("zh-TW",{hour12:false})}・${money(t.amount)}</li>`).join("")||"<li>無買入紀錄</li>";
    return `<div class="history-player"><div class="history-player-head"><b>${escapeHtml(p.name)}</b><span class="${profit>=0?"pos":"neg"}">${profit>=0?"+":""}${money(profit)}</span></div><small>投入 ${money(buy)}・拿回 ${money(cash)}</small><details><summary>買入明細</summary><ul>${tx}</ul></details></div>`;
  }).join("")||"<p class='muted'>這局沒有玩家資料</p>";
  return `<div class="game-detail">${players}</div>`;
}
function renderGameHistory(){
  const box=$("gameHistory");if(!box)return;
  const allGames=(roomData.games||[]).filter(g=>!isGameEmpty(g)).slice().sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt));
  renderHistoryCalendar(allGames);
  const games=historyDateFilter?allGames.filter(g=>localDateKey(g.startedAt)===historyDateFilter):allGames;
  const totalBuy=games.reduce((sum,g)=>sum+gameTotals(g).buy,0);
  const completedGames=games.filter(g=>g.endedAt);
  const completed=completedGames.length;
  const label=historyDateFilter?`${historyDateFilter.replaceAll("-","/")}：${games.length} 局（已完成 ${completed} 局）・總投入 ${money(totalBuy)}`:`全部紀錄：${games.length} 局（已完成 ${completed} 局）・總投入 ${money(totalBuy)}`;
  $("historySummary").textContent=label;

  const rankingMap=new Map();
  completedGames.forEach(g=>(g.players||[]).forEach(p=>{
    const r=rankingMap.get(p.name)||{games:0,buyin:0,cashout:0};
    r.games++;r.buyin+=buyinTotal(p);r.cashout+=Number(p.cashout||0);rankingMap.set(p.name,r);
  }));
  const rankingRows=buildCompositeRanking([...rankingMap]);
  const rankingTitle=historyDateFilter?`${historyDateFilter.replaceAll("-","/")} 當日排名`:`全部歷史排名`;
  $("historyRanking").innerHTML=`<h3>${rankingTitle}</h3><p class="hint">綜合排名＝總盈虧 50%＋報酬率 50%（同期間玩家標準化後計算）</p><div class="ranking-list">${rankingRows.map((x,i)=>{
    const {name:n,r,profit,roi,score}=x,medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":`第 ${i+1} 名`;
    return `<div class="ranking-row"><div class="rank-badge">${medal}</div><div class="rank-main"><b>${escapeHtml(n)}</b><small>${r.games} 場・總投入 ${money(r.buyin)}・總拿回 ${money(r.cashout)}</small><small>報酬率 ${formatRate(roi)}・綜合分數 ${score.toFixed(1)}</small></div><b class="rank-profit ${profit>=0?"pos":"neg"}">${profit>=0?"+":""}${money(profit)}</b></div>`;
  }).join("")||"<p class='muted'>這個日期尚無已完成牌局可排名</p>"}</div>`;

  box.innerHTML=games.map(g=>{const {buy,cash}=gameTotals(g),diff=cash-buy,isCurrent=g.id===roomData.currentGameId,state=g.endedAt?"已完成":"進行中";return `<article class="game-history-item"><div class="game-row"><div><b>${new Date(g.startedAt).toLocaleString("zh-TW",{hour12:false})}</b><br><small>${g.players?.length||0} 位玩家・投入 ${money(buy)}・拿回 ${money(cash)}・差額 ${diff>=0?"+":""}${money(diff)}・${state}${isCurrent?"・目前顯示":""}</small></div><div class="game-actions"><button class="secondary small view-game" data-game-id="${g.id}" type="button">查看明細</button>${isOwner&&g.endedAt?`<button class="secondary small edit-game" data-game-id="${g.id}">修改此局</button>`:""}${isOwner?`<button class="danger small delete-game" data-game-id="${g.id}">刪除此局</button>`:""}</div></div><div id="detail-${g.id}" class="hidden">${gameDetailHtml(g)}</div></article>`}).join("")||`<p class='muted'>${historyDateFilter?"這一天沒有牌局紀錄":"尚無牌局紀錄"}</p>`;
  box.querySelectorAll(".view-game").forEach(btn=>btn.onclick=()=>{const detail=document.getElementById(`detail-${btn.dataset.gameId}`);const opening=detail.classList.contains("hidden");detail.classList.toggle("hidden",!opening);btn.textContent=opening?"收起明細":"查看明細"});
  box.querySelectorAll(".edit-game").forEach(btn=>btn.onclick=()=>editGame(btn.dataset.gameId));box.querySelectorAll(".delete-game").forEach(btn=>btn.onclick=()=>deleteGame(btn.dataset.gameId));
}
function renderReport(){
  const range=$("range").value,now=new Date(),map=new Map();
  const periodGames=(roomData.games||[]).filter(g=>g.endedAt&&gameMatchesRange(g,range,now)&&!isGameEmpty(g));
  const totalGames=periodGames.length;
  $("reportPeriod").textContent=`${rangeLabel(range,now)}｜共 ${totalGames} 局已完成牌局`;

  periodGames.forEach(g=>{
    const seenInGame=new Set();
    (g.players||[]).forEach(p=>{
      const name=String(p.name||"").trim();if(!name)return;
      const r=map.get(name)||{games:0,buyin:0,cashout:0};
      if(!seenInGame.has(name)){r.games++;seenInGame.add(name)}
      r.buyin+=buyinTotal(p);r.cashout+=Number(p.cashout||0);map.set(name,r);
    });
  });

  const profitRows=buildCompositeRanking([...map]);
  $("report").innerHTML=profitRows.map((x,i)=>{
    const {name:n,r,profit,roi,score}=x,attendance=totalGames?Math.round(r.games/totalGames*100):0,medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":`第 ${i+1} 名`;
    return `<div class="ranking-row"><div class="rank-badge">${medal}</div><div class="rank-main"><b>${escapeHtml(n)}</b><small>${r.games} 場・總投入 ${money(r.buyin)}・總拿回 ${money(r.cashout)}</small><small>報酬率 ${formatRate(roi)}・綜合分數 ${score.toFixed(1)}</small><small class="attendance-meta">出勤 ${r.games}/${totalGames} 局・${attendance}%</small></div><b class="rank-profit ${profit>=0?"pos":"neg"}">${profit>=0?"+":""}${money(profit)}</b></div>`;
  }).join("")||"<p class='muted'>這個期間尚無已完成牌局</p>";

  const attendanceRows=[...map].sort((a,b)=>{
    const rateB=totalGames?b[1].games/totalGames:0,rateA=totalGames?a[1].games/totalGames:0;
    const profitB=b[1].cashout-b[1].buyin,profitA=a[1].cashout-a[1].buyin;
    return rateB-rateA||b[1].games-a[1].games||profitB-profitA||a[0].localeCompare(b[0],"zh-Hant");
  });
  $("attendanceReport").innerHTML=attendanceRows.map(([n,r],i)=>{
    const attendance=totalGames?Math.round(r.games/totalGames*100):0,profit=r.cashout-r.buyin,medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":`第 ${i+1} 名`;
    return `<div class="ranking-row attendance-row"><div class="rank-badge">${medal}</div><div class="rank-main"><b>${escapeHtml(n)}</b><small>出勤 ${r.games}/${totalGames} 局・該期間盈虧 ${profit>=0?"+":""}${money(profit)}</small></div><b class="attendance-rate">${attendance}%</b></div>`;
  }).join("")||"<p class='muted'>這個期間尚無已完成牌局</p>";
}

$("googleBtn").onclick=async()=>{const provider=new GoogleAuthProvider();try{const r=await signInWithPopup(auth,provider),c=prompt("請輸入妳要管理的群組代碼");if(c)await enterOwnerRoom(c)}catch(e){if(e.code?.includes("popup"))await signInWithRedirect(auth,provider);else alert(e.message)}};
$("viewerBtn").onclick=async()=>{try{
  if(!auth.currentUser){const credential=await signInAnonymously(auth);user=credential.user}else user=auth.currentUser;
  await enterViewerRoom($("roomCode").value,$("viewerName").value)
}catch(e){console.error(e);alert(`無法觀看帳目：${e.message||"請稍後再試"}`)}};
function setInitialBuyin(amount){
  const value=Math.max(0,Number(amount||0));
  $("initialBuyinAmount").value=String(value);
  document.querySelectorAll(".initial-buyin-btn").forEach(btn=>{
    const selected=Number(btn.dataset.amount)===value;
    btn.classList.toggle("selected",selected);
    btn.classList.toggle("secondary",!selected);
  });
  $("initialBuyinHint").textContent=value>0?`新增玩家時會直接記錄第 1 次買入 ${money(value)}`:"只新增玩家，暫時不記錄買入";
  $("addPlayerBtn").textContent=value>0?`新增玩家＋買入 ${money(value)}`:"只新增玩家";
}
document.querySelectorAll(".initial-buyin-btn").forEach(btn=>btn.onclick=()=>setInitialBuyin(btn.dataset.amount));
const initialBuyinCustomBtn=$("initialBuyinCustomBtn");
if(initialBuyinCustomBtn)initialBuyinCustomBtn.onclick=()=>{const amount=Number(prompt("輸入初始買入金額"));if(amount>0)setInitialBuyin(amount)};
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
$("newGameBtn").onclick=()=>{if(!isOwner)return;const g=currentGame();if(g&&!g.endedAt&&isGameEmpty(g))return alert("目前已經是空白新局，不需要再開一局。");clearEditingMode();mutate(d=>{const previousId=d.currentGameId||null;const ng={id:makeId(),startedAt:new Date().toISOString(),endedAt:null,players:[],openedFromGameId:previousId};d.games=d.games||[];d.games.push(ng);d.currentGameId=ng.id})};
$("cancelNewGameBtn").onclick=async()=>{
  if(!isOwner)return;
  const g=currentGame();
  if(!g||g.endedAt||!isGameEmpty(g)||!g.openedFromGameId)return alert("這局已經加入玩家或記帳，不能取消開新局。");
  if(!confirm("確定取消這個空白新局，回到上一局嗎？"))return;
  try{
    clearEditingMode();
    await mutate(d=>{
      const games=d.games||[];
      const currentIndex=games.findIndex(x=>x.id===d.currentGameId);
      const current=currentIndex>=0?games[currentIndex]:null;
      if(!current||current.endedAt||!isGameEmpty(current))throw new Error("這局已經有資料，不能取消");
      const previous=games.find(x=>x.id===current.openedFromGameId)||(currentIndex>0?games[currentIndex-1]:null);
      if(!previous)throw new Error("找不到上一局");
      d.games=games.filter(x=>x.id!==current.id);
      d.currentGameId=previous.id;
    });
    window.scrollTo({top:0,behavior:"smooth"});
  }catch(e){alert(`取消開新局失敗：${e.message}`)}
};
$("range").onchange=()=>{renderReport();renderGameHistory()};
$("historyPrevBtn").onclick=()=>shiftHistoryDate(-1);
$("historyTodayBtn").onclick=()=>{const now=new Date();historyDateFilter=localDateKey(now);calendarMonth=new Date(now.getFullYear(),now.getMonth(),1);$("historyDate").value=historyDateFilter;renderGameHistory()};
$("historyNextBtn").onclick=()=>shiftHistoryDate(1);
$("historyAllBtn").onclick=()=>{historyDateFilter="";$("historyDate").value="";renderGameHistory()};
$("calendarPrevMonthBtn").onclick=()=>shiftCalendarMonth(-1);
$("calendarNextMonthBtn").onclick=()=>shiftCalendarMonth(1);
$("favoriteSelect").onchange=()=>$("playerName").value=$("favoriteSelect").value;
$("switchBtn").onclick=()=>{localStorage.removeItem("ownerRoom");localStorage.removeItem("viewerRoom");sessionStorage.removeItem("editingGameId");location.reload()};$("logoutBtn").onclick=()=>signOut(auth).then(()=>location.reload());

onAuthStateChanged(auth,u=>{user=u;if(!u){setStatus("請登入");return}setStatus("已登入");const ownerRoom=localStorage.getItem("ownerRoom"),viewRoom=localStorage.getItem("viewerRoom"),vname=localStorage.getItem("viewerName")||"";if(u.email&&ownerRoom)enterOwnerRoom(ownerRoom).catch(e=>alert(e.message));else if(!u.email&&viewRoom)enterViewerRoom(viewRoom,vname)});
getRedirectResult(auth).then(r=>{if(r?.user){user=r.user;const c=prompt("請輸入妳要管理的群組代碼");if(c)enterOwnerRoom(c)}});
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js?v=28",{updateViaCache:"none"});
window.addEventListener("error",e=>{const el=document.getElementById("status");if(el)el.textContent="程式載入失敗";console.error(e.error||e.message)});
window.addEventListener("unhandledrejection",e=>console.error(e.reason));
