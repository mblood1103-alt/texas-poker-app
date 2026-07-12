
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, collection, addDoc,
  deleteDoc, getDocs, query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBZr2HdwiVG-vE1T12BcKlmWOUCB7QYlMY",
  authDomain: "texas-hold-em-8b398.firebaseapp.com",
  projectId: "texas-hold-em-8b398",
  storageBucket: "texas-hold-em-8b398.firebasestorage.app",
  messagingSenderId: "647906482664",
  appId: "1:647906482664:web:d2f3ddea2a969156072c5d",
  measurementId: "G-V70CTW27T1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const money = n => `$${Number(n || 0).toLocaleString("zh-TW")}`;
const cleanRoom = s => s.trim().toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,24);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

let user = null;
let roomCode = localStorage.getItem("roomCode") || "";
let displayName = localStorage.getItem("displayName") || "";
let unsubscribeRoom = null;
let roomData = null;

function setStatus(text){ $("syncStatus").textContent = text; }
function currentGame(){ return roomData?.games?.find(g => g.id === roomData.currentGameId) || null; }
function buyinTotal(p){ return (p.transactions || []).reduce((s,t)=>s+Number(t.amount||0),0); }

async function ensureRoom(code){
  const ref = doc(db,"rooms",code);
  await setDoc(ref,{
    code,
    updatedAt: serverTimestamp(),
    games: [],
    currentGameId: null
  },{merge:true});
}

async function joinRoom(){
  const name = $("displayName").value.trim();
  const code = cleanRoom($("roomCode").value);
  if(!name || !code) return alert("請輸入名字與群組代碼");
  displayName = name; roomCode = code;
  localStorage.setItem("displayName",name);
  localStorage.setItem("roomCode",code);
  await ensureRoom(code);
  subscribeRoom();
}

function subscribeRoom(){
  if(unsubscribeRoom) unsubscribeRoom();
  setStatus("正在同步…");
  unsubscribeRoom = onSnapshot(doc(db,"rooms",roomCode), snap=>{
    roomData = snap.data() || {games:[],currentGameId:null};
    if(!roomData.currentGameId) createNewGame(true);
    render();
    setStatus("已即時同步");
  }, err=>{
    console.error(err);
    setStatus("同步失敗");
    alert("連線資料庫失敗，請重新整理後再試。");
  });
}

async function saveRoom(partial){
  await updateDoc(doc(db,"rooms",roomCode),{
    ...partial,
    updatedAt:serverTimestamp()
  });
}

async function createNewGame(silent=false){
  const game = {
    id: uid(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    players: []
  };
  const games = [...(roomData?.games || []), game];
  await saveRoom({games,currentGameId:game.id});
  if(!silent) alert("已開新局");
}

async function mutateCurrent(mutator){
  const games = structuredClone(roomData.games || []);
  const idx = games.findIndex(g=>g.id===roomData.currentGameId);
  if(idx<0) return;
  mutator(games[idx]);
  await saveRoom({games});
}

async function addPlayer(){
  const name = $("newPlayerName").value.trim();
  if(!name) return;
  await mutateCurrent(game=>{
    if(game.players.some(p=>p.name===name)) throw new Error("PLAYER_EXISTS");
    game.players.push({id:uid(),name,cashout:0,transactions:[]});
  }).catch(e=>{
    if(e.message==="PLAYER_EXISTS") alert("這位玩家已經存在");
    else throw e;
  });
  $("newPlayerName").value="";
}

async function addBuyin(playerId,amount){
  await mutateCurrent(game=>{
    const p=game.players.find(x=>x.id===playerId);
    p.transactions.push({
      id:uid(),amount:Number(amount),at:new Date().toISOString(),by:displayName
    });
  });
}

async function setCashout(playerId,amount){
  await mutateCurrent(game=>{
    const p=game.players.find(x=>x.id===playerId);
    p.cashout=Number(amount||0);
  });
}

async function removePlayer(playerId){
  if(!confirm("確定刪除這位玩家？")) return;
  await mutateCurrent(game=>{
    game.players=game.players.filter(x=>x.id!==playerId);
  });
}

async function finishGame(){
  const game=currentGame();
  if(!game) return;
  const buyin=game.players.reduce((s,p)=>s+buyinTotal(p),0);
  const cashout=game.players.reduce((s,p)=>s+Number(p.cashout||0),0);
  const diff=cashout-buyin;
  if(diff!==0 && !confirm(`目前差額是 ${money(diff)}，仍要完成本局嗎？`)) return;
  await mutateCurrent(g=>{g.endedAt=new Date().toISOString()});
  alert("本局已完成");
}

function render(){
  const joined=!!roomCode && !!roomData;
  $("joinCard").classList.toggle("hidden",joined);
  $("appArea").classList.toggle("hidden",!joined);
  if(!joined) return;

  $("roomTitle").textContent=`群組：${roomCode}`;
  const game=currentGame();
  $("currentDate").textContent=game ? new Date(game.startedAt).toLocaleString("zh-TW",{hour12:false}) : "";

  const wrap=$("players"); wrap.innerHTML="";
  (game?.players||[]).forEach(p=>{
    const frag=$("playerTemplate").content.cloneNode(true);
    const root=frag.querySelector(".player");
    const buyin=buyinTotal(p);
    const cashout=Number(p.cashout||0);
    const profit=cashout-buyin;
    root.querySelector(".playerName").textContent=p.name;
    root.querySelector(".playerMeta").textContent=`${p.transactions.length} 次買入`;
    root.querySelector(".buyin").textContent=money(buyin);
    root.querySelector(".cashout").textContent=money(cashout);
    const profitEl=root.querySelector(".profit");
    profitEl.textContent=`${profit>=0?"+":""}${money(profit)}`;
    profitEl.classList.add(profit>=0?"positive":"negative");
    root.querySelector(".cashoutInput").value=cashout||"";
    root.querySelectorAll("[data-buyin]").forEach(btn=>{
      btn.addEventListener("click",()=>addBuyin(p.id,Number(btn.dataset.buyin)));
    });
    root.querySelector(".customBuyin").addEventListener("click",()=>{
      const amount=Number(prompt("輸入買入金額"));
      if(amount>0) addBuyin(p.id,amount);
    });
    root.querySelector(".saveCashout").addEventListener("click",()=>{
      setCashout(p.id,root.querySelector(".cashoutInput").value);
    });
    root.querySelector(".removePlayer").addEventListener("click",()=>removePlayer(p.id));
    root.querySelector(".txList").innerHTML=(p.transactions||[]).length
      ? p.transactions.slice().reverse().map(t=>`<li>${new Date(t.at).toLocaleString("zh-TW",{hour12:false})}　${money(t.amount)}（${t.by||"未知"}）</li>`).join("")
      : "<li>尚無買入紀錄</li>";
    wrap.appendChild(frag);
  });

  const buyin=(game?.players||[]).reduce((s,p)=>s+buyinTotal(p),0);
  const cashout=(game?.players||[]).reduce((s,p)=>s+Number(p.cashout||0),0);
  const diff=cashout-buyin;
  $("totalBuyin").textContent=money(buyin);
  $("totalCashout").textContent=money(cashout);
  $("difference").textContent=`${diff>0?"+":""}${money(diff)}`;
  $("difference").className=diff===0?"positive":"warning";
  $("differenceHint").textContent=diff===0
    ?"帳目相符，可以安心結算。"
    : diff>0 ? `目前多出 ${money(diff)}。` : `目前少了 ${money(Math.abs(diff))}。`;
  renderReport();
}

function selectedGames(){
  const range=$("reportRange").value;
  const now=new Date();
  return (roomData?.games||[]).filter(g=>{
    const d=new Date(g.startedAt);
    if(range==="month") return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
    if(range==="year") return d.getFullYear()===now.getFullYear();
    return true;
  });
}

function renderReport(){
  const map=new Map();
  selectedGames().forEach(g=>(g.players||[]).forEach(p=>{
    const row=map.get(p.name)||{name:p.name,games:0,buyin:0,cashout:0};
    row.games++; row.buyin+=buyinTotal(p); row.cashout+=Number(p.cashout||0);
    map.set(p.name,row);
  }));
  const rows=[...map.values()].sort((a,b)=>(b.cashout-b.buyin)-(a.cashout-a.buyin));
  $("report").innerHTML=rows.length?rows.map(r=>{
    const profit=r.cashout-r.buyin;
    return `<div class="reportRow">
      <div><strong>${r.name}</strong><br><small>${r.games} 場</small></div>
      <span class="desktopOnly">投入 ${money(r.buyin)}</span>
      <strong class="${profit>=0?"positive":"negative"}">${profit>=0?"+":""}${money(profit)}</strong>
    </div>`;
  }).join(""):"<p class='muted'>尚無統計資料</p>";
}

function backup(){
  const blob=new Blob([JSON.stringify({roomCode,data:roomData},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`德州帳本-${roomCode}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();URL.revokeObjectURL(url);
}

async function restore(file){
  try{
    const parsed=JSON.parse(await file.text());
    if(!parsed?.data?.games) throw new Error();
    if(!confirm("還原會覆蓋目前群組資料，確定嗎？")) return;
    await setDoc(doc(db,"rooms",roomCode),{
      ...parsed.data,
      code:roomCode,
      updatedAt:serverTimestamp()
    });
    alert("還原完成");
  }catch{
    alert("備份檔格式不正確");
  }
}

$("joinBtn").addEventListener("click",joinRoom);
$("addPlayerBtn").addEventListener("click",addPlayer);
$("finishBtn").addEventListener("click",finishGame);
$("newGameBtn").addEventListener("click",()=>createNewGame(false));
$("reportRange").addEventListener("change",renderReport);
$("backupBtn").addEventListener("click",backup);
$("restoreInput").addEventListener("change",e=>e.target.files[0]&&restore(e.target.files[0]));
$("leaveBtn").addEventListener("click",()=>{
  localStorage.removeItem("roomCode");
  roomCode="";roomData=null;
  if(unsubscribeRoom)unsubscribeRoom();
  render();
});
$("shareBtn").addEventListener("click",async()=>{
  const text=`德州帳本群組代碼：${roomCode||"尚未進入群組"}`;
  if(navigator.share) await navigator.share({title:"德州帳本",text});
  else { await navigator.clipboard.writeText(text); alert("群組代碼已複製"); }
});

onAuthStateChanged(auth,u=>{
  user=u;
  if(!u) return;
  setStatus("已登入");
  $("displayName").value=displayName;
  $("roomCode").value=roomCode;
  if(roomCode&&displayName) subscribeRoom();
});
signInAnonymously(auth).catch(err=>{
  console.error(err);setStatus("登入失敗");alert("匿名登入失敗，請重新整理。");
});

if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
