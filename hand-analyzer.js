
const $ = id => document.getElementById(id);
const HISTORY_KEY = "pokerStrategyHistoryV85";
let lastAnalysis = null;

function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }

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
  if(a===14&&b===11)score+=4; // AJ
  return clamp(score,20,96);
}

function parsePressure(text, bb){
  const t=(text||"").toUpperCase();
  const nums=[...t.matchAll(/(?:到|開|OPEN|RAISE|加注|BET)\s*\$?\s*(\d+(?:\.\d+)?)/g)].map(m=>Number(m[1]));
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

function analyze(){
  const hand=normalizeHand($("saHand").value);
  if(!hand){
    alert("手牌格式請輸入例如 AJo、AKs、77。s＝同花，o＝不同花。");
    return;
  }
  const bb=Number($("saBB").value)||2;
  const stack=Number($("saStack").value)||100;
  const pos=$("saHeroPos").value;
  const tableSize=Number($("saTableSize").value)||9;
  const action=$("saAction").value.trim();
  const p=parsePressure(action,bb);
  let s=handStrength(hand)+positionAdjustment(pos);

  // 9-max UTG ranges are generally tighter than 6-max.
  if(tableSize===9 && /UTG/.test(action.toUpperCase())) s-=5;
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
  raise=clamp(raise,0,90);
  call=clamp(call,0,90-raise);
  fold=100-raise-call;

  // Special correction: offsuit broadways facing early-position open + squeeze/3-bet.
  if(p.level===2 && /^(AJ|AT|KQ|KJ|QJ)o$/.test(hand) && /UTG/.test(action.toUpperCase())){
    const target = hand==="AJo" ? {raise:3,call:7,fold:90} : {raise:2,call:5,fold:93};
    raise=target.raise;call=target.call;fold=target.fold;
  }

  // premium hands
  if(/^(AA|KK)$/.test(hand)){ raise=p.level>=2?88:82; call=100-raise; fold=0; }
  if(hand==="QQ"&&p.level===2){raise=54;call=44;fold=2;}
  if(/^AKs?$/.test(hand)&&p.level===2){raise=58;call=39;fold=3;}

  const total=raise+call+fold;
  raise=Math.round(raise/total*100);
  call=Math.round(call/total*100);
  fold=100-raise-call;

  const best=[["加注",raise],["跟注",call],["棄牌",fold]].sort((a,b)=>b[1]-a[1])[0];
  let reason=`${hand} 在 ${pos}，`;
  if(p.level===2) reason+="面對前位開池後的再加注，繼續範圍需要明顯收緊。";
  else if(p.level===1) reason+="目前主要面對一次開池，可依位置與牌力保留較多跟注或再加注。";
  else if(p.level>=3) reason+="面對 4-bet 等高壓力局面，範圍應非常緊。";
  else reason+="目前沒有辨識到明確加注壓力。";
  if(hand==="AJo"&&p.level===2&&/UTG/.test(action.toUpperCase()))
    reason+=" AJo 不同花在 UTG 開池＋SB 再加注後容易被更強 A-x 與高張牌支配，因此模型高度偏向棄牌。";

  lastAnalysis={
    at:new Date().toISOString(), hand,pos,tableSize,stack,
    blinds:`${$("saSB").value}/${$("saBB").value}`,
    action,raise,call,fold,best:best[0],reason
  };
  renderResult(lastAnalysis);
}

function renderResult(r){
  const box=$("saResult");
  box.innerHTML=`
    <h3>${r.hand}｜${r.pos} 策略參考</h3>
    <div class="strategy-bars">
      ${bar("raise","加注",r.raise)}
      ${bar("call","跟注",r.call)}
      ${bar("fold","棄牌",r.fold)}
    </div>
    <div class="strategy-main"><b>主要建議：${r.best}</b><p>${escapeHtml(r.reason)}</p></div>
    <p class="strategy-warning">⚠️ 這是 App 內建離線策略模型的估算，不是 GTO Wizard、PioSOLVER 等 solver 的即時資料，也不是可驗證的「大數據真實頻率」。不同抽水、下注尺寸、有效籌碼與對手範圍都會改變結果。</p>`;
  box.classList.remove("hidden");
}

function bar(cls,label,val){
  return `<div class="strategy-row ${cls}"><b>${label}</b><div class="strategy-track"><div class="strategy-fill" style="width:${val}%"></div></div><strong>${val}%</strong></div>`;
}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

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
  alert("已儲存這筆分析紀錄");
}
function renderHistory(){
  const box=$("saHistory"); if(!box)return;
  const rows=loadHistory();
  box.innerHTML=rows.length?rows.map(r=>`
    <div class="strategy-history-item">
      <b>${escapeHtml(r.hand)}｜${escapeHtml(r.pos)}｜${escapeHtml(r.blinds)}｜${escapeHtml(r.best)}</b>
      <div>加注 ${r.raise}%・跟注 ${r.call}%・棄牌 ${r.fold}%</div>
      <small>${escapeHtml(r.action||"未填行動")}<br>${new Date(r.at).toLocaleString("zh-TW",{hour12:false})}</small>
    </div>`).join(""):`<p class="strategy-history-empty">尚無分析紀錄。</p>`;
}
function init(){
  if(!$("handAnalyzerCard"))return;
  $("saAnalyzeBtn").addEventListener("click",analyze);
  $("saSaveBtn").addEventListener("click",saveCurrent);
  $("saClearHistory").addEventListener("click",()=>{
    if(confirm("確定清空這台裝置上的牌局分析紀錄嗎？")){
      localStorage.removeItem(HISTORY_KEY);renderHistory();
    }
  });
  renderHistory();
}
init();
