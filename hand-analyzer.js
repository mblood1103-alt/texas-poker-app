
const $ = id => document.getElementById(id);
const HISTORY_KEY = "pokerStrategyHistoryV86";
let lastAnalysis = null;

const POSITIONS_BY_SIZE = {
  4:["BTN","SB","BB","UTG"],
  5:["BTN","SB","BB","UTG","CO"],
  6:["BTN","SB","BB","UTG","HJ","CO"],
  7:["BTN","SB","BB","UTG","MP","HJ","CO"],
  8:["BTN","SB","BB","UTG","UTG+1","MP","HJ","CO"]
};

function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function renderSeats(){
  const size=Number($("saTableSize").value);
  const positions=POSITIONS_BY_SIZE[size] || POSITIONS_BY_SIZE[6];
  const table=$("saPokerTable");
  const current=$("saHeroPos").value;
  table.innerHTML="";
  const n=positions.length;

  positions.forEach((pos,i)=>{
    // Place BTN near bottom, then continue clockwise around the table.
    const angle = (90 + i*(360/n)) * Math.PI/180;
    const rx=43, ry=42;
    const x=50 + rx*Math.cos(angle);
    const y=50 + ry*Math.sin(angle);
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="seat-btn"+(pos===current?" selected":"");
    btn.style.left=x+"%";
    btn.style.top=y+"%";
    btn.dataset.pos=pos;
    btn.innerHTML=`<strong>${pos}</strong><small>${positionName(pos)}</small>`;
    btn.addEventListener("click",()=>selectPosition(pos));
    table.appendChild(btn);
  });

  if(current && !positions.includes(current)){
    $("saHeroPos").value="";
    $("saHeroPosBadge").textContent="尚未選位";
  }
}

function positionName(pos){
  return ({
    "BTN":"莊家位","SB":"小盲","BB":"大盲","UTG":"槍口",
    "UTG+1":"槍口+1","MP":"中位","HJ":"劫持位","CO":"關煞位"
  })[pos]||pos;
}

function selectPosition(pos){
  $("saHeroPos").value=pos;
  $("saHeroPosBadge").textContent=`${pos}｜${positionName(pos)}`;
  document.querySelectorAll(".seat-btn").forEach(b=>b.classList.toggle("selected",b.dataset.pos===pos));
  $("saPositionHelp").textContent=`你選的是 ${pos}（${positionName(pos)}）。BTN 後面依序是 SB、BB，再進入前位。`;
}

function normalizeHand(raw){
  let s=(raw||"").trim().toUpperCase().replace(/\s+/g,"");
  s=s.replace("同花","S").replace("不同花","O");
  const m=s.match(/^([2-9TJQKA])([2-9TJQKA])([SO])?$/);
  if(!m) return null;
  const order="23456789TJQKA";
  let a=m[1], b=m[2], suited=m[3]||"";
  if(order.indexOf(a)<order.indexOf(b)) [a,b]=[b,a];
  if(a===b) suited="";
  return a+b+suited.toLowerCase();
}

function handStrength(hand){
  const order="23456789TJQKA";
  const a=order.indexOf(hand[0])+2, b=order.indexOf(hand[1])+2;
  const pair=a===b, suited=hand.endsWith("s"), gap=Math.abs(a-b);
  if(pair){
    if(a>=12)return 97;
    if(a>=10)return 88;
    if(a>=7)return 73;
    return 58 + a;
  }
  let score=(a+b)*2.15;
  if(a===14)score+=13;
  if(a>=13&&b>=10)score+=10;
  if(suited)score+=6;
  if(gap===1)score+=4; else if(gap===2)score+=2; else if(gap>=4)score-=5;
  if(a===14&&b===11)score+=4;
  return clamp(score,20,96);
}

function parsePressure(text, bb){
  const t=(text||"").toUpperCase();
  const nums=[...t.matchAll(/(?:到|開|OPEN|RAISE|加注|BET|下注|全下)\s*\$?\s*(\d+(?:\.\d+)?)/g)].map(m=>Number(m[1]));
  const hasRaise=/加注|3BET|3-BET|再加|RERAISE/.test(t);
  const hasOpen=/開|OPEN/.test(t);
  let level=0;
  if(hasOpen)level=1;
  if(hasRaise)level=2;
  const maxBet=nums.length?Math.max(...nums):0;
  const sizeBB=bb>0?maxBet/bb:0;
  if(level===0&&maxBet>bb)level=1;
  if(sizeBB>=4.5&&level>=1)level=Math.max(level,2);
  if(/4BET|4-BET|四次加注/.test(t))level=3;
  return {level,maxBet,sizeBB};
}

function positionAdjustment(pos){
  return ({UTG:-10,"UTG+1":-8,MP:-5,HJ:-2,CO:2,BTN:6,SB:-3,BB:0})[pos]||0;
}

function activeStreet(){
  if(($("saRiverAction").value||"").trim() || ($("saRiverCard").value||"").trim()) return "河牌";
  if(($("saTurnAction").value||"").trim() || ($("saTurnCard").value||"").trim()) return "轉牌";
  if(($("saFlopAction").value||"").trim() || ($("saFlopCards").value||"").trim()) return "翻牌";
  return "翻牌前";
}

function postflopNote(street, flop, turn, river, actions){
  if(street==="翻牌前") return "";
  const board=[flop,turn,river].filter(Boolean).join(" ");
  let note=`目前已記錄到${street}`;
  if(board) note+=`，牌面為 ${board}`;
  note+="。";
  if(/全下|ALL.?IN/i.test(actions)) note+=" 行動中出現全下，實戰上應特別注意底池賠率與有效籌碼。";
  else if(/加注|RAISE/i.test(actions)) note+=" 行動中有再加注，範圍通常會比單純下注或跟注更集中。";
  return note;
}

function analyze(){
  const hand=normalizeHand($("saHand").value);
  if(!hand){
    alert("手牌格式請輸入例如 AJo、AKs、77。s＝同花，o＝不同花。");
    return;
  }
  const pos=$("saHeroPos").value;
  if(!pos){
    alert("請先直接點牌桌上的座位，選擇你的位置。");
    return;
  }

  const bb=Number($("saBB").value)||2;
  const stack=Number($("saStack").value)||100;
  const tableSize=Number($("saTableSize").value)||6;
  const preflop=$("saAction").value.trim();
  const flopCards=$("saFlopCards").value.trim();
  const flopAction=$("saFlopAction").value.trim();
  const turnCard=$("saTurnCard").value.trim();
  const turnAction=$("saTurnAction").value.trim();
  const riverCard=$("saRiverCard").value.trim();
  const riverAction=$("saRiverAction").value.trim();
  const allPost=[flopAction,turnAction,riverAction].filter(Boolean).join("；");
  const street=activeStreet();

  const p=parsePressure(preflop,bb);
  let s=handStrength(hand)+positionAdjustment(pos);
  if(tableSize>=7 && /UTG/.test(preflop.toUpperCase())) s-=4;
  if(tableSize<=5) s+=3;
  if(stack<40) s+=3;
  if(stack>150) s-=2;

  let raise=0, call=0, fold=0;
  if(p.level>=3){
    raise=clamp((s-82)*1.5,0,32);
    call=clamp((s-70)*1.2,0,35);
  }else if(p.level===2){
    raise=clamp((s-76)*1.3,0,42);
    call=clamp((s-55)*1.25,0,55);
    if(pos==="BB") call+=4;
  }else if(p.level===1){
    raise=clamp((s-58)*1.45,2,68);
    call=clamp(72-Math.abs(s-60)*1.15,4,58);
    if(pos==="BB") call+=8;
  }else{
    raise=clamp((s-45)*1.5,8,78);
    call=clamp(55-Math.abs(s-52),5,45);
  }

  if(p.level===2 && /^(AJ|AT|KQ|KJ|QJ)o$/.test(hand) && /UTG/.test(preflop.toUpperCase())){
    const target = hand==="AJo" ? {raise:3,call:7,fold:90} : {raise:2,call:5,fold:93};
    raise=target.raise;call=target.call;fold=target.fold;
  }
  if(/^(AA|KK)$/.test(hand)){ raise=p.level>=2?88:82; call=100-raise; fold=0; }
  if(hand==="QQ"&&p.level===2){raise=54;call=44;fold=2;}
  if(/^AKs?$/.test(hand)&&p.level===2){raise=58;call=39;fold=3;}

  raise=clamp(raise,0,90);
  call=clamp(call,0,90-raise);
  fold=100-raise-call;

  const total=raise+call+fold;
  raise=Math.round(raise/total*100);
  call=Math.round(call/total*100);
  fold=100-raise-call;

  const best=[["加注",raise],["跟注",call],["棄牌",fold]].sort((a,b)=>b[1]-a[1])[0];
  let reason=`${hand} 在 ${pos}（${positionName(pos)}），`;
  if(p.level===2) reason+="面對前位開池後的再加注，翻牌前繼續範圍需要明顯收緊。";
  else if(p.level===1) reason+="目前主要面對一次開池，可依位置與牌力保留較多跟注或再加注。";
  else if(p.level>=3) reason+="面對 4-bet 等高壓力局面，範圍應非常緊。";
  else reason+="目前沒有辨識到明確加注壓力。";

  if(hand==="AJo"&&p.level===2&&/UTG/.test(preflop.toUpperCase()))
    reason+=" AJo 不同花在 UTG 開池＋SB 再加注後容易被更強 A-x 與高張牌支配，因此模型高度偏向棄牌。";

  reason += " " + postflopNote(street,flopCards,turnCard,riverCard,allPost);

  lastAnalysis={
    at:new Date().toISOString(), hand,pos,tableSize,stack,
    blinds:`${$("saSB").value}/${$("saBB").value}`,
    preflop,flopCards,flopAction,turnCard,turnAction,riverCard,riverAction,
    street,raise,call,fold,best:best[0],reason
  };
  renderResult(lastAnalysis);
}

function renderResult(r){
  const box=$("saResult");
  box.innerHTML=`
    <h3>${r.hand}｜${r.pos}｜目前到 ${r.street}</h3>
    <div class="strategy-bars">
      ${bar("raise","加注",r.raise)}
      ${bar("call","跟注",r.call)}
      ${bar("fold","棄牌",r.fold)}
    </div>
    <div class="strategy-main"><b>主要建議：${r.best}</b><p>${escapeHtml(r.reason)}</p>
      <div class="street-summary">
        <div><b>翻牌前：</b>${escapeHtml(r.preflop||"未填")}</div>
        <div><b>翻牌：</b>${escapeHtml((r.flopCards||"未填牌面")+(r.flopAction?"｜"+r.flopAction:""))}</div>
        <div><b>轉牌：</b>${escapeHtml((r.turnCard||"未填")+(r.turnAction?"｜"+r.turnAction:""))}</div>
        <div><b>河牌：</b>${escapeHtml((r.riverCard||"未填")+(r.riverAction?"｜"+r.riverAction:""))}</div>
      </div>
    </div>
    <p class="strategy-warning">⚠️ 目前百分比仍是 App 內建離線策略模型的估算。翻牌後欄位現階段主要用於完整紀錄與文字分析，尚未連接真正 GTO Solver，因此不能視為精準 solver 頻率。</p>`;
  box.classList.remove("hidden");
}

function bar(cls,label,val){
  return `<div class="strategy-row ${cls}"><b>${label}</b><div class="strategy-track"><div class="strategy-fill" style="width:${val}%"></div></div><strong>${val}%</strong></div>`;
}

function loadHistory(){
  try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]")}catch{return []}
}

function saveCurrent(){
  if(!lastAnalysis) analyze();
  if(!lastAnalysis) return;
  const rows=loadHistory();
  rows.unshift(lastAnalysis);
  localStorage.setItem(HISTORY_KEY,JSON.stringify(rows.slice(0,100)));
  renderHistory();
  alert("已儲存這筆完整牌局分析紀錄");
}

function renderHistory(){
  const box=$("saHistory"); if(!box)return;
  const rows=loadHistory();
  box.innerHTML=rows.length?rows.map(r=>`
    <div class="strategy-history-item">
      <b>${escapeHtml(r.hand)}｜${escapeHtml(r.pos)}｜${escapeHtml(r.blinds)}｜${escapeHtml(r.best)}</b>
      <div>加注 ${r.raise}%・跟注 ${r.call}%・棄牌 ${r.fold}%</div>
      <div class="history-streets">
        <small>翻牌前：${escapeHtml(r.preflop||"未填")}</small>
        ${r.flopCards||r.flopAction?`<small>翻牌：${escapeHtml((r.flopCards||"")+(r.flopAction?"｜"+r.flopAction:""))}</small>`:""}
        ${r.turnCard||r.turnAction?`<small>轉牌：${escapeHtml((r.turnCard||"")+(r.turnAction?"｜"+r.turnAction:""))}</small>`:""}
        ${r.riverCard||r.riverAction?`<small>河牌：${escapeHtml((r.riverCard||"")+(r.riverAction?"｜"+r.riverAction:""))}</small>`:""}
      </div>
      <small>${new Date(r.at).toLocaleString("zh-TW",{hour12:false})}</small>
    </div>`).join(""):`<p class="strategy-history-empty">尚無分析紀錄。</p>`;
}

function initStreetTabs(){
  document.querySelectorAll(".street-tab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const street=btn.dataset.street;
      document.querySelectorAll(".street-tab").forEach(b=>b.classList.toggle("active",b===btn));
      document.querySelectorAll(".street-panel").forEach(p=>p.classList.toggle("active",p.dataset.panel===street));
    });
  });
}

function init(){
  if(!$("handAnalyzerCard"))return;
  $("saTableSize").addEventListener("change",renderSeats);
  $("saAnalyzeBtn").addEventListener("click",analyze);
  $("saSaveBtn").addEventListener("click",saveCurrent);
  $("saClearHistory").addEventListener("click",()=>{
    if(confirm("確定清空這台裝置上的牌局分析紀錄嗎？")){
      localStorage.removeItem(HISTORY_KEY);renderHistory();
    }
  });
  initStreetTabs();
  renderSeats();
  renderHistory();
}
init();
