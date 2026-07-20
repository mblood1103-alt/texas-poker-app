
const $ = id => document.getElementById(id);
const HISTORY_KEY = "pokerStrategyHistoryV87";
let lastAnalysis = null;
let activeCardSlot = null;
const selectedCards = {hero0:"",hero1:"",flop0:"",flop1:"",flop2:"",turn:"",river:""};
const actionState = {preflop:[],flop:[],turn:[],river:[]};

/*
  v92 GTO mode
  IMPORTANT:
  This table intentionally contains only verified/curated entries.
  Unsupported spots return "no data" instead of inventing percentages.
  Add future verified entries to GTO_REFERENCE with exact keys.
*/
const GTO_REFERENCE = Object.freeze({
  // Example schema:
  // "6|100|BB|AJo|UTG_OPEN_2|SB_3BET_5": {raise:0,call:0,fold:100,source:"..."}
});

let analysisMode = "general";

function setAnalysisMode(mode){
  analysisMode = mode === "gto" ? "gto" : "general";
  $("saAnalysisMode").value = analysisMode;
  document.querySelectorAll(".analysis-mode-btn").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.analysisMode === analysisMode);
  });
  const hint = $("analysisModeHint");
  if(hint){
    hint.textContent = analysisMode === "gto"
      ? "GTO 模式只顯示已收錄的正式策略資料。這個局面沒有資料時，不會用估算百分比假裝成 GTO。"
      : "一般分析使用 App 內建離線策略模型，適合快速參考，但不是正式 GTO Solver。";
  }
}

function buildGTOKey({tableSize,stack,pos,hand,preflop}){
  // The current release keeps exact-match support only.
  // Future verified strategy packs can extend this normalizer.
  const p = parsePressure(preflop, Number($("saBB").value)||2);
  const roundedStack = Math.round(Number(stack)||0);
  return `${tableSize}|${roundedStack}|${pos}|${hand}|P${p.level}`;
}

function getGTOResult(context){
  const key = buildGTOKey(context);
  return GTO_REFERENCE[key] || null;
}


const POSITIONS_BY_SIZE = {
  4:["BTN","SB","BB","UTG"],
  5:["BTN","SB","BB","UTG","CO"],
  6:["BTN","SB","BB","UTG","HJ","CO"],
  7:["BTN","SB","BB","UTG","MP","HJ","CO"],
  8:["BTN","SB","BB","UTG","UTG+1","MP","HJ","CO"],
  9:["BTN","SB","BB","UTG","UTG+1","MP","MP+1","HJ","CO"],
  10:["BTN","SB","BB","UTG","UTG+1","UTG+2","MP","MP+1","HJ","CO"]
};
const SUITS = [
  {k:"s",symbol:"♠",name:"黑桃",red:false},
  {k:"h",symbol:"♥",name:"紅心",red:true},
  {k:"d",symbol:"♦",name:"方塊",red:true},
  {k:"c",symbol:"♣",name:"梅花",red:false}
];
const RANKS = ["A","K","Q","J","10","9","8","7","6","5","4","3","2"];

function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function positionName(pos){
  return ({"BTN":"莊家位","SB":"小盲","BB":"大盲","UTG":"槍口","UTG+1":"槍口+1","UTG+2":"槍口+2","MP":"中位","MP+1":"中位+1","HJ":"劫持位","CO":"關煞位","我":"我"})[pos]||pos;
}


function canonicalSeatOrder(){
  const size=Number($("saTableSize").value)||6;
  const map={
    4:["BTN","SB","BB","UTG"],
    5:["BTN","SB","BB","UTG","CO"],
    6:["BTN","SB","BB","UTG","HJ","CO"],
    7:["BTN","SB","BB","UTG","MP","HJ","CO"],
    8:["BTN","SB","BB","UTG","UTG+1","MP","HJ","CO"],
    9:["BTN","SB","BB","UTG","UTG+1","MP","MP+1","HJ","CO"],
    10:["BTN","SB","BB","UTG","UTG+1","UTG+2","MP","MP+1","HJ","CO"]
  };
  return map[size]||map[6];
}

function renderSeats(){
  const size=Number($("saTableSize").value);
  const positions=canonicalSeatOrder();
  const table=$("saPokerTable");
  const current=$("saHeroPos").value;
  table.innerHTML="";
  positions.forEach((pos,i)=>{
    const angle=(90+i*(360/positions.length))*Math.PI/180;
    const x=50+43*Math.cos(angle), y=50+42*Math.sin(angle);
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="seat-btn"+(pos===current?" selected":"");
    btn.style.left=x+"%"; btn.style.top=y+"%"; btn.dataset.pos=pos;
    const me = pos===current ? "（我）" : "";
    btn.innerHTML=`<strong>${pos}${me}</strong><small>${positionName(pos)}</small>`;
    btn.addEventListener("click",()=>selectPosition(pos));
    table.appendChild(btn);
  });
  if(current&&!positions.includes(current)){
    $("saHeroPos").value="";
    $("saHeroPosBadge").textContent="尚未選位";
  }
  populateActors();
}

function selectPosition(pos){
  $("saHeroPos").value=pos;
  $("saHeroPosBadge").textContent=`${pos}｜${positionName(pos)}（我）`;
  $("saPositionHelp").textContent=`你的位置是 ${pos}（${positionName(pos)}）。牌桌上會直接標示「我」。`;
  renderSeats();
  updateHeroChipDisplays();
}

function streetKeyFromBuilder(builder){
  return builder?.dataset?.builder || "preflop";
}
function actorToPosition(actor){
  return actor==="我" ? ($("saHeroPos").value||"") : actor;
}
function getFoldedBeforeStreet(street){
  const order=["preflop","flop","turn","river"];
  const idx=order.indexOf(street);
  const folded=new Set();

  // 包含目前這一街：一按「加入棄牌」後就立刻鎖定，不用等分析。
  for(let i=0;i<=idx;i++){
    (actionState[order[i]]||[]).forEach(a=>{
      if(a.action==="棄牌"){
        const p=actorToPosition(a.actor);
        if(p) folded.add(p);
      }
    });
  }
  return folded;
}
function populateActors(){
  const positions=canonicalSeatOrder();
  const hero=$("saHeroPos").value;

  document.querySelectorAll(".action-builder").forEach(builder=>{
    const sel=builder.querySelector(".action-actor");
    if(!sel)return;

    const street=streetKeyFromBuilder(builder);
    const folded=getFoldedBeforeStreet(street);

    // 記住目前選中的實際座位，不讓「我」這個 value 影響排序。
    const currentActual = sel.value==="我" ? hero : sel.value;

    sel.innerHTML="";

    // 依固定牌桌順序逐一建立，絕不把「我」移到第一個。
    positions.forEach(p=>{
      const opt=document.createElement("option");
      const isHero=p===hero;
      const isFolded=folded.has(p);

      opt.value=isHero?"我":p;
      opt.disabled=isFolded;
      opt.textContent=`${p}｜${positionName(p)}${isHero?"（我）":""}${isFolded?"（已棄牌）":""}`;

      sel.appendChild(opt);
    });

    // 恢復原本選擇；沒有才選第一個可用座位。
    const wantedValue=currentActual===hero?"我":currentActual;
    const wanted=[...sel.options].find(o=>o.value===wantedValue&&!o.disabled);
    if(wanted){
      sel.value=wanted.value;
    }else{
      const first=[...sel.options].find(o=>!o.disabled);
      if(first)sel.value=first.value;
    }
  });

  if(typeof renderStillInHandReminderV94==="function") renderStillInHandReminderV94();
}
function cardDisplay(code){
  if(!code)return null;
  const m=code.match(/^(10|[2-9AJQK])([shdc])$/);
  if(!m)return null;
  const suit=SUITS.find(s=>s.k===m[2]);
  return {rank:m[1],suit:suit.symbol,red:suit.red,name:`${suit.name}${m[1]}`};
}

function openCardPicker(slot){
  activeCardSlot=slot;
  renderDeck();
  $("cardPickerOverlay").classList.remove("hidden");
  $("cardPickerOverlay").setAttribute("aria-hidden","false");
}
function closeCardPicker(){
  $("cardPickerOverlay").classList.add("hidden");
  $("cardPickerOverlay").setAttribute("aria-hidden","true");
  activeCardSlot=null;
}
function renderDeck(){
  const used=new Set(Object.entries(selectedCards).filter(([k,v])=>v&&k!==activeCardSlot).map(([,v])=>v));
  $("cardDeckGrid").innerHTML=RANKS.flatMap(rank=>SUITS.map(s=>{
    const code=rank+s.k;
    return `<button type="button" class="deck-card ${s.red?"red-card":""} ${used.has(code)?"used":""}" data-card="${code}">${rank}${s.symbol}</button>`;
  })).join("");
  document.querySelectorAll(".deck-card:not(.used)").forEach(btn=>btn.addEventListener("click",()=>{
    selectedCards[activeCardSlot]=btn.dataset.card;
    renderSelectedCards(); closeCardPicker();
  }));
}
function renderSelectedCards(){
  document.querySelectorAll(".card-slot").forEach(btn=>{
    const slot=btn.dataset.cardSlot, code=selectedCards[slot], c=cardDisplay(code);
    btn.classList.toggle("filled",!!c);
    btn.classList.toggle("red-card",!!c&&c.red);
    if(c) btn.innerHTML=`<span class="rank">${c.rank}</span><span class="suit">${c.suit}</span>`;
    else {
      const label=slot.startsWith("hero")?(slot==="hero0"?"第 1 張":"第 2 張"):slot.startsWith("flop")?`第 ${Number(slot.slice(-1))+1} 張`:slot==="turn"?"轉牌":"河牌";
      btn.innerHTML=`＋<small>${label}</small>`;
    }
  });
  updateHiddenCards();
  if(window.renderPersistentBoardV91) window.renderPersistentBoardV91();
}
function updateHiddenCards(){
  const hero=[selectedCards.hero0,selectedCards.hero1];
  $("saHand").value=heroToNotation(hero);
  $("saFlopCards").value=[selectedCards.flop0,selectedCards.flop1,selectedCards.flop2].filter(Boolean).join(" ");
  $("saTurnCard").value=selectedCards.turn;
  $("saRiverCard").value=selectedCards.river;
  if(hero.every(Boolean)){
    const a=cardDisplay(hero[0]),b=cardDisplay(hero[1]);
    $("saHandReadable").textContent=`你的手牌：${a.name} ＋ ${b.name}`;
  }else $("saHandReadable").textContent="尚未選擇完整兩張手牌";
}
function heroToNotation(cards){
  if(!cards[0]||!cards[1])return "";
  const order="23456789TJQKA";
  const normRank=r=>r==="10"?"T":r;
  let a=normRank(cards[0].slice(0,-1)), b=normRank(cards[1].slice(0,-1));
  const sa=cards[0].slice(-1), sb=cards[1].slice(-1);
  if(order.indexOf(a)<order.indexOf(b)) [a,b]=[b,a];
  if(a===b)return a+b;
  return a+b+(sa===sb?"s":"o");
}

function initCardSlots(){
  document.querySelectorAll(".card-slot").forEach(btn=>btn.addEventListener("click",()=>openCardPicker(btn.dataset.cardSlot)));
  $("closeCardPicker").addEventListener("click",closeCardPicker);
  $("cardPickerOverlay").addEventListener("click",e=>{if(e.target===$("cardPickerOverlay"))closeCardPicker();});
}

function actionNeedsAmount(type){ return ["開池","下注","加注","全下"].includes(type); }


function streetOrder(){
  return ["preflop","flop","turn","river"];
}

function isHeroActor(actor){
  return actor==="我" || actor===($("saHeroPos").value||"");
}

function actualActorPosition(actor){
  return actor==="我" ? ($("saHeroPos").value||"") : actor;
}

function initialStreetCommitments(street){
  const map={};
  canonicalSeatOrder().forEach(p=>map[p]=0);

  if(street==="preflop"){
    const sb=Number($("saSB").value)||0;
    const bb=Number($("saBB").value)||0;
    if("SB" in map) map.SB=sb;
    if("BB" in map) map.BB=bb;
  }
  return map;
}

function simulateHeroChips(stopStreet=null, includeAllActionsInStop=true){
  const start=Math.max(0,Number($("saStack").value)||0);
  const hero=$("saHeroPos").value||"";
  let remaining=start;
  const result={remaining,start,streets:{}};

  for(const street of streetOrder()){
    const commits=initialStreetCommitments(street);

    // 若 Hero 是盲注位，起手籌碼先扣掉已放入的盲注。
    if(street==="preflop" && hero && commits[hero]>0){
      remaining=Math.max(0,remaining-commits[hero]);
    }

    const actions=actionState[street]||[];
    const limit=(stopStreet===street && !includeAllActionsInStop)?0:actions.length;

    for(let i=0;i<limit;i++){
      const a=actions[i];
      const pos=actualActorPosition(a.actor);
      if(!pos) continue;
      if(!(pos in commits)) commits[pos]=0;

      const action=a.action;
      const current=Number(commits[pos])||0;
      const tableHigh=Math.max(0,...Object.values(commits).map(Number));

      let add=0;
      let newCommit=current;

      if(action==="跟注"){
        newCommit=Math.max(current,tableHigh);
        add=newCommit-current;
      }else if(["開池","下注","加注"].includes(action)){
        const target=Math.max(0,Number(a.amount)||0);
        newCommit=Math.max(current,target);
        add=newCommit-current;
      }else if(action==="全下"){
        if(pos===hero){
          add=remaining;
          newCommit=current+remaining;
        }else{
          const target=Math.max(0,Number(a.amount)||0);
          if(target>0){
            newCommit=Math.max(current,target);
            add=newCommit-current;
          }
        }
      }

      commits[pos]=newCommit;
      if(pos===hero){
        remaining=Math.max(0,remaining-add);
      }
    }

    result.streets[street]={remaining,commits:{...commits}};

    if(stopStreet===street) break;
  }

  result.remaining=remaining;
  return result;
}

function heroRemainingAtEndOf(street){
  return simulateHeroChips(street,true).remaining;
}

function heroSnapshotBeforeNextAction(street){
  const sim=simulateHeroChips(street,true);
  const hero=$("saHeroPos").value||"";
  const commits=sim.streets[street]?.commits||initialStreetCommitments(street);
  return {
    remaining:sim.remaining,
    committed:Number(commits[hero])||0
  };
}

function updateHeroChipDisplays(){
  document.querySelectorAll(".action-builder").forEach(builder=>{
    const street=builder.dataset.builder;
    let box=builder.querySelector(".hero-chip-status-v100");
    if(!box){
      box=document.createElement("div");
      box.className="hero-chip-status-v100";
      const heading=builder.querySelector("h3");
      if(heading) heading.insertAdjacentElement("afterend",box);
      else builder.prepend(box);
    }

    const sim=simulateHeroChips(street,true);
    const hero=$("saHeroPos").value;
    box.innerHTML=hero
      ? `💰 你目前剩餘籌碼：<strong>${sim.remaining.toLocaleString("zh-TW")}</strong>`
      : `💰 選擇你的座位後，系統會自動計算剩餘籌碼`;
  });
}

function refreshActionAmountUI(builder){
  const street=builder.dataset.builder;
  const actor=builder.querySelector(".action-actor");
  const type=builder.querySelector(".action-type");
  const amount=builder.querySelector(".action-amount");
  const label=builder.querySelector(".amount-label");
  if(!actor||!type||!amount||!label) return;

  const needs=actionNeedsAmount(type.value);
  label.style.display=needs?"grid":"none";

  if(type.value==="全下" && isHeroActor(actor.value)){
    const snap=heroSnapshotBeforeNextAction(street);
    const allInTarget=snap.committed+snap.remaining;
    amount.value=String(allInTarget);
    amount.readOnly=true;
    amount.placeholder=`自動全下，剩餘 ${snap.remaining}`;
  }else{
    amount.readOnly=false;
    if(!needs) amount.value="";
  }
}

function initActionBuilders(){
  document.querySelectorAll(".action-builder").forEach(builder=>{
    const street=builder.dataset.builder;
    const type=builder.querySelector(".action-type");
    const actor=builder.querySelector(".action-actor");
    const amount=builder.querySelector(".action-amount");
    const addBtn=builder.querySelector(".add-action-btn");

    const refresh=()=>refreshActionAmountUI(builder);
    type.addEventListener("change",refresh);
    actor.addEventListener("change",refresh);
    refresh();

    addBtn.addEventListener("click",()=>{
      const selectedActor=actor.value;
      const actualPos=actualActorPosition(selectedActor);
      const folded=getFoldedBeforeStreet(street);

      if(folded.has(actualPos)){
        alert(`${actualPos} 已經棄牌，不能再加入任何動作。`);
        populateActors();
        return;
      }

      const action=type.value;

      // Hero 選全下時，自動抓目前剩餘籌碼，不用自己算。
      if(action==="全下" && isHeroActor(selectedActor)){
        const snap=heroSnapshotBeforeNextAction(street);
        amount.value=String(snap.committed+snap.remaining);
      }

      const amt=amount.value.trim();
      if(actionNeedsAmount(action)&&!amt){
        alert("這個動作請輸入金額。");
        return;
      }

      actionState[street].push({
        actor:selectedActor,
        action,
        amount:actionNeedsAmount(action)?amt:""
      });

      amount.value="";
      amount.readOnly=false;
      renderActionSequence(street);

      // 棄牌後立即刷新選單；籌碼也立即刷新。
      populateActors();
      updateHeroChipDisplays();
      document.querySelectorAll(".action-builder").forEach(refreshActionAmountUI);
    });
  });
}
function renderActionSequence(street){
  const box=document.querySelector(`[data-sequence="${street}"]`);
  box.innerHTML=actionState[street].length?actionState[street].map((a,i)=>`
    <span class="action-chip">${escapeHtml(a.actor)} ${escapeHtml(a.action)}${a.amount?` ${escapeHtml(a.amount)}`:""}
      <button type="button" data-remove="${i}" aria-label="刪除">×</button>
    </span>`).join(""):`<span class="position-help">尚未加入行動</span>`;
  box.querySelectorAll("[data-remove]").forEach(btn=>btn.addEventListener("click",()=>{
    actionState[street].splice(Number(btn.dataset.remove),1);
    renderActionSequence(street);
    populateActors();
  }));
  syncActionHidden(street);
  populateActors();
  updateHeroChipDisplays();
  document.querySelectorAll(".action-builder").forEach(refreshActionAmountUI);
}
function syncActionHidden(street){
  const text=actionState[street].map(a=>`${a.actor} ${a.action}${a.amount?`到 ${a.amount}`:""}`).join("，");
  const map={preflop:"saAction",flop:"saFlopAction",turn:"saTurnAction",river:"saRiverAction"};
  $(map[street]).value=text;
}

function normalizeHand(raw){ return raw||null; }

function handStrength(hand){
  const order="23456789TJQKA";
  const a=order.indexOf(hand[0])+2,b=order.indexOf(hand[1])+2;
  const pair=a===b,suited=hand.endsWith("s"),gap=Math.abs(a-b);
  if(pair){if(a>=12)return 97;if(a>=10)return 88;if(a>=7)return 73;return 58+a;}
  let score=(a+b)*2.15;
  if(a===14)score+=13;if(a>=13&&b>=10)score+=10;if(suited)score+=6;
  if(gap===1)score+=4;else if(gap===2)score+=2;else if(gap>=4)score-=5;
  if(a===14&&b===11)score+=4;
  return clamp(score,20,96);
}

function parsePressure(text,bb){
  const t=(text||"").toUpperCase();
  const nums=[...t.matchAll(/(?:到|開池|下注|加注|全下)\s*(\d+(?:\.\d+)?)/g)].map(m=>Number(m[1]));
  let level=0;
  if(/開池/.test(t))level=1;
  const raises=(t.match(/加注/g)||[]).length;
  if(raises>=1)level=2;if(raises>=2)level=3;
  const maxBet=nums.length?Math.max(...nums):0;
  if(level===0&&maxBet>bb)level=1;
  return {level,maxBet,sizeBB:bb?maxBet/bb:0};
}
function positionAdjustment(pos){return ({UTG:-10,"UTG+1":-8,MP:-5,HJ:-2,CO:2,BTN:6,SB:-3,BB:0})[pos]||0;}

function activeStreet(){
  if(actionState.river.length||selectedCards.river)return "河牌";
  if(actionState.turn.length||selectedCards.turn)return "轉牌";
  if(actionState.flop.length||selectedCards.flop0)return "翻牌";
  return "翻牌前";
}


function rankValueFromCode(code){
  const r=String(code||"").slice(0,-1);
  return r==="A"?14:r==="K"?13:r==="Q"?12:r==="J"?11:r==="10"?10:Number(r);
}

function rankLabel(v){
  return ({14:"A",13:"K",12:"Q",11:"J",10:"10"})[v]||String(v);
}

function evaluateFiveCards(cards){
  const ranks=cards.map(rankValueFromCode).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.slice(-1));

  const counts={};
  ranks.forEach(r=>counts[r]=(counts[r]||0)+1);
  const groups=Object.entries(counts)
    .map(([r,c])=>({r:Number(r),c}))
    .sort((a,b)=>b.c-a.c||b.r-a.r);

  const flush=suits.every(s=>s===suits[0]);

  const unique=[...new Set(ranks)].sort((a,b)=>b-a);
  if(unique.includes(14)) unique.push(1);
  let straightHigh=0;
  for(let i=0;i<=unique.length-5;i++){
    const seq=unique.slice(i,i+5);
    if(seq.every((v,j)=>j===0||seq[j-1]-v===1)){
      straightHigh=Math.max(straightHigh,seq[0]===5?5:seq[0]);
    }
  }

  if(flush && straightHigh){
    return {score:[8,straightHigh],category:8,name:`${rankLabel(straightHigh)}高同花順`};
  }

  if(groups[0]?.c===4){
    const quad=groups[0].r;
    const kicker=Math.max(...ranks.filter(r=>r!==quad));
    return {score:[7,quad,kicker],category:7,name:`${rankLabel(quad)}鐵支`};
  }

  const trips=groups.filter(g=>g.c===3).map(g=>g.r).sort((a,b)=>b-a);
  const pairs=groups.filter(g=>g.c>=2).map(g=>g.r).sort((a,b)=>b-a);

  if(trips.length){
    const trip=trips[0];
    const pair=pairs.find(r=>r!==trip);
    if(pair){
      return {score:[6,trip,pair],category:6,name:`${rankLabel(trip)}帶${rankLabel(pair)}葫蘆`};
    }
  }

  if(flush){
    return {score:[5,...ranks],category:5,name:`${rankLabel(ranks[0])}高同花`};
  }

  if(straightHigh){
    return {score:[4,straightHigh],category:4,name:`${rankLabel(straightHigh)}高順子`};
  }

  if(trips.length){
    const trip=trips[0];
    const kickers=ranks.filter(r=>r!==trip).slice(0,2);
    return {score:[3,trip,...kickers],category:3,name:`${rankLabel(trip)}三條`};
  }

  const pairRanks=groups.filter(g=>g.c===2).map(g=>g.r).sort((a,b)=>b-a);
  if(pairRanks.length>=2){
    const hi=pairRanks[0],lo=pairRanks[1];
    const kicker=Math.max(...ranks.filter(r=>r!==hi&&r!==lo));
    return {score:[2,hi,lo,kicker],category:2,name:`${rankLabel(hi)}、${rankLabel(lo)}兩對`};
  }

  if(pairRanks.length===1){
    const pair=pairRanks[0];
    const kickers=ranks.filter(r=>r!==pair).slice(0,3);
    return {score:[1,pair,...kickers],category:1,name:`${rankLabel(pair)}一對`};
  }

  return {score:[0,...ranks],category:0,name:`${rankLabel(ranks[0])}高牌`};
}

function compareScores(a,b){
  const n=Math.max(a.length,b.length);
  for(let i=0;i<n;i++){
    const av=a[i]||0,bv=b[i]||0;
    if(av>bv)return 1;
    if(av<bv)return -1;
  }
  return 0;
}

function combinations(arr,k){
  const out=[];
  function rec(start,picked){
    if(picked.length===k){out.push([...picked]);return;}
    for(let i=start;i<=arr.length-(k-picked.length);i++){
      picked.push(arr[i]);
      rec(i+1,picked);
      picked.pop();
    }
  }
  rec(0,[]);
  return out;
}

function evaluateBestHand(cards){
  if(cards.length<5)return null;
  let best=null;
  for(const combo of combinations(cards,5)){
    const value=evaluateFiveCards(combo);
    if(!best||compareScores(value.score,best.score)>0){
      best={...value,cards:combo};
    }
  }
  return best;
}

function fullDeck(){
  const deck=[];
  for(const r of RANKS){
    for(const s of SUITS){
      deck.push(`${r}${s.k}`);
    }
  }
  return deck;
}

function prettyCard(code){
  const c=cardDisplay(code);
  return c?`${c.rank}${c.suit}`:code;
}

function analyzeOpponentRisk(){
  const hero=[selectedCards.hero0,selectedCards.hero1].filter(Boolean);
  const board=[
    selectedCards.flop0,selectedCards.flop1,selectedCards.flop2,
    selectedCards.turn,selectedCards.river
  ].filter(Boolean);

  if(hero.length!==2 || board.length<3) return null;

  const heroBest=evaluateBestHand([...hero,...board]);
  if(!heroBest)return null;

  const used=new Set([...hero,...board]);
  const available=fullDeck().filter(c=>!used.has(c));

  let betterCount=0;
  let tieCount=0;
  const categories=new Map();
  const examples=[];

  for(let i=0;i<available.length;i++){
    for(let j=i+1;j<available.length;j++){
      const opp=[available[i],available[j]];
      const oppBest=evaluateBestHand([...opp,...board]);
      const cmp=compareScores(oppBest.score,heroBest.score);

      if(cmp>0){
        betterCount++;
        categories.set(oppBest.name,(categories.get(oppBest.name)||0)+1);
        if(examples.length<6){
          examples.push(`${prettyCard(opp[0])}＋${prettyCard(opp[1])} → ${oppBest.name}`);
        }
      }else if(cmp===0){
        tieCount++;
      }
    }
  }

  const total=available.length*(available.length-1)/2;
  const categoryList=[...categories.entries()]
    .sort((a,b)=>b[1]-a[1])
    .map(([name,count])=>({name,count}));

  let summary="";
  if(betterCount===0){
    summary=`你目前是「${heroBest.name}」，以現在已發出的公共牌來看，沒有任何合法的對手兩張手牌可以擊敗你，現在是堅果牌（Nuts）。`;
  }else{
    const top=categoryList.slice(0,5).map(x=>x.name).join("、");
    summary=`你目前是「${heroBest.name}」，但現在仍有 ${betterCount} 種對手兩張手牌組合可以擊敗你。主要更大牌型包含：${top||"更大的同類牌型"}。`;
    if(examples.length){
      summary+=` 例如：${examples.join("；")}。`;
    }
  }

  if(board.length<5){
    summary+=` 目前公共牌還沒發完，後續轉牌／河牌也可能讓你或對手的牌型再次改變。`;
  }

  return {
    heroBest,
    betterCount,
    tieCount,
    total,
    categories:categoryList,
    examples,
    isNuts:betterCount===0,
    summary
  };
}

function evaluateMadeHand(){
  const cards=[
    selectedCards.hero0,selectedCards.hero1,
    selectedCards.flop0,selectedCards.flop1,selectedCards.flop2,
    selectedCards.turn,selectedCards.river
  ].filter(Boolean);
  const best=evaluateBestHand(cards);
  if(!best)return null;
  return {
    category:best.category,
    name:best.name,
    score:best.score
  };
}

function analyze(){
  const hand=normalizeHand($("saHand").value);
  if(!hand){alert("請先點選你的兩張手牌。");return;}
  const pos=$("saHeroPos").value;
  if(!pos){alert("請先直接點牌桌上的座位，選擇你的位置。");return;}

  const bb=Number($("saBB").value)||2,remainingChips=Number($("saStack").value)||0,stack=bb>0?remainingChips/bb:0,tableSize=Number($("saTableSize").value)||6;
  const preflop=$("saAction").value,flopCards=$("saFlopCards").value,flopAction=$("saFlopAction").value;
  const turnCard=$("saTurnCard").value,turnAction=$("saTurnAction").value,riverCard=$("saRiverCard").value,riverAction=$("saRiverAction").value;
  const street=activeStreet(),p=parsePressure(preflop,bb);

  if(analysisMode === "gto"){
    const gto = getGTOResult({tableSize,stack,pos,hand,preflop});
    if(!gto){
      lastAnalysis={
        at:new Date().toISOString(),hand,heroNames,pos,tableSize,stack,remainingChips,
        blinds:`${$("saSB").value}/${$("saBB").value}`,
        preflop,flopCards,flopAction,turnCard,turnAction,riverCard,riverAction,
        street,mode:"GTO",unsupported:true,
        raise:null,call:null,fold:null,best:"目前無 GTO 資料",
        reason:"這個局面目前沒有收錄正式 GTO 策略資料，所以 App 不會顯示猜測百分比。你可以切回「一般分析」取得離線模型參考。"
      };
      renderResult(lastAnalysis);
      if(window.recordPokerAnalysisUse){
        window.recordPokerAnalysisUse({hand,heroNames,position:pos,street}).catch(e=>console.warn("分析使用紀錄寫入失敗",e));
      }
      return;
    }

    lastAnalysis={
      at:new Date().toISOString(),hand,heroNames,pos,tableSize,stack,remainingChips,
      blinds:`${$("saSB").value}/${$("saBB").value}`,
      preflop,flopCards,flopAction,turnCard,turnAction,riverCard,riverAction,
      street,mode:"GTO",unsupported:false,
      raise:gto.raise,call:gto.call,fold:gto.fold,
      best:[["加注",gto.raise],["跟注",gto.call],["棄牌",gto.fold]].sort((a,b)=>b[1]-a[1])[0][0],
      reason:`此結果來自 App 內已收錄的 GTO 參考資料。${gto.note||""}`
    };
    renderResult(lastAnalysis);
    if(window.recordPokerAnalysisUse){
      window.recordPokerAnalysisUse({hand,heroNames,position:pos,street}).catch(e=>console.warn("分析使用紀錄寫入失敗",e));
    }
    return;
  }
  let s=handStrength(hand)+positionAdjustment(pos);
  if(tableSize>=7&&/UTG/.test(preflop))s-=4;if(tableSize<=5)s+=3;if(stack<40)s+=3;if(stack>150)s-=2;

  let raise=0,call=0,fold=0;
  if(p.level>=3){raise=clamp((s-82)*1.5,0,32);call=clamp((s-70)*1.2,0,35);}
  else if(p.level===2){raise=clamp((s-76)*1.3,0,42);call=clamp((s-55)*1.25,0,55);if(pos==="BB")call+=4;}
  else if(p.level===1){raise=clamp((s-58)*1.45,2,68);call=clamp(72-Math.abs(s-60)*1.15,4,58);if(pos==="BB")call+=8;}
  else{raise=clamp((s-45)*1.5,8,78);call=clamp(55-Math.abs(s-52),5,45);}

  if(p.level===2&&/^(AJ|AT|KQ|KJ|QJ)o$/.test(hand)&&/UTG/.test(preflop)){
    const target=hand==="AJo"?{raise:3,call:7,fold:90}:{raise:2,call:5,fold:93};raise=target.raise;call=target.call;fold=target.fold;
  }
  if(/^(AA|KK)$/.test(hand)){raise=p.level>=2?88:82;call=100-raise;fold=0;}
  if(hand==="QQ"&&p.level===2){raise=54;call=44;fold=2;}
  if(/^AKs?$/.test(hand)&&p.level===2){raise=58;call=39;fold=3;}

  raise=clamp(raise,0,90);call=clamp(call,0,90-raise);fold=100-raise-call;
  const total=raise+call+fold;raise=Math.round(raise/total*100);call=Math.round(call/total*100);fold=100-raise-call;
  const best=[["加注",raise],["跟注",call],["棄牌",fold]].sort((a,b)=>b[1]-a[1])[0];

  const heroNames=[selectedCards.hero0,selectedCards.hero1].map(c=>cardDisplay(c)?.name).join("、");
  let reason=`你的手牌是 ${heroNames}，位置在 ${pos}（${positionName(pos)}）。`;
  if(p.level===2)reason+="面對前面開池後又有人加注，翻牌前繼續範圍需要明顯收緊。";
  else if(p.level===1)reason+="目前主要面對一次開池，可以依位置與牌力考慮跟注或再加注。";
  else if(p.level>=3)reason+="目前是高壓力再加注局面，範圍要非常緊。";
  else reason+="目前沒有偵測到明確的翻牌前加注壓力。";

  const madeHand=evaluateMadeHand();
  const risk=street!=="翻牌前" ? analyzeOpponentRisk() : null;

  if(street!=="翻牌前" && madeHand){
    // 翻牌後不再只拿翻牌前起手牌模型硬算。
    if(risk?.isNuts){
      raise=72;call=28;fold=0;best[0]="加注";best[1]=72;
    }else if(madeHand.category>=7){
      raise=68;call=31;fold=1;best[0]="加注";best[1]=68;
    }else if(madeHand.category===6){
      raise=62;call=36;fold=2;best[0]="加注";best[1]=62;
    }else if(madeHand.category===5 || madeHand.category===4){
      raise=48;call=45;fold=7;best[0]="加注";best[1]=48;
    }else if(madeHand.category===3){
      raise=38;call=50;fold=12;best[0]="跟注";best[1]=50;
    }else if(madeHand.category===2){
      raise=24;call=52;fold=24;best[0]="跟注";best[1]=52;
    }else if(madeHand.category===1){
      raise=14;call=43;fold=43;best[0]="跟注";best[1]=43;
    }

    reason=`你目前實際牌型是「${madeHand.name}」。`;
    if(risk){
      reason+=` ${risk.summary}`;
    }
    reason+=` 百分比仍是 App 內建一般策略參考，真正決策還需要看下注大小、底池賠率與對手範圍。`;
  }

  lastAnalysis={at:new Date().toISOString(),hand,heroNames,pos,tableSize,stack,remainingChips,mode:"一般分析",blinds:`${$("saSB").value}/${$("saBB").value}`,
    preflop,flopCards,flopAction,turnCard,turnAction,riverCard,riverAction,street,raise,call,fold,best:best[0],reason,
    riskSummary:risk?.summary||"",madeHandName:madeHand?.name||""};
  renderResult(lastAnalysis);
  if(window.recordPokerAnalysisUse){
    window.recordPokerAnalysisUse({hand,heroNames,position:pos,street}).catch(e=>console.warn("分析使用紀錄寫入失敗",e));
  }
}

function bar(cls,label,val){return `<div class="strategy-row ${cls}"><b>${label}</b><div class="strategy-track"><div class="strategy-fill" style="width:${val}%"></div></div><strong>${val}%</strong></div>`;}
function renderResult(r){
  const box=$("saResult");
  if(r.unsupported){
    box.innerHTML=`
      <h3>${escapeHtml(r.heroNames||r.hand)}｜${r.pos}｜GTO 模式</h3>
      <div class="gto-unavailable">
        <strong>此局面目前沒有正式 GTO 資料</strong>
        <p>${escapeHtml(r.reason)}</p>
        <button type="button" id="switchToGeneralBtn" class="secondary">切換成一般分析</button>
      </div>
      <div class="street-summary">
        <div><b>翻牌前：</b>${escapeHtml(r.preflop||"尚未加入行動")}</div>
        <div><b>翻牌：</b>${escapeHtml((r.flopCards||"未選牌面")+(r.flopAction?"｜"+r.flopAction:""))}</div>
        <div><b>轉牌：</b>${escapeHtml((r.turnCard||"未選")+(r.turnAction?"｜"+r.turnAction:""))}</div>
        <div><b>河牌：</b>${escapeHtml((r.riverCard||"未選")+(r.riverAction?"｜"+r.riverAction:""))}</div>
      </div>`;
    box.classList.remove("hidden");
    $("switchToGeneralBtn")?.addEventListener("click",()=>{
      setAnalysisMode("general");
      analyze();
    });
    return;
  }

  const modeLabel = r.mode || "一般分析";
  box.innerHTML=`<h3>${escapeHtml(r.heroNames||r.hand)}｜${r.pos}｜${escapeHtml(modeLabel)}｜目前到 ${r.street}</h3>
    <div class="strategy-bars">${bar("raise","加注",r.raise)}${bar("call","跟注",r.call)}${bar("fold","棄牌",r.fold)}</div>
    <div class="strategy-main"><b>主要建議：${r.best}</b><p>${escapeHtml(r.reason)}</p>
      <div class="street-summary">
        <div><b>翻牌前：</b>${escapeHtml(r.preflop||"尚未加入行動")}</div>
        <div><b>翻牌：</b>${escapeHtml((r.flopCards||"未選牌面")+(r.flopAction?"｜"+r.flopAction:""))}</div>
        <div><b>轉牌：</b>${escapeHtml((r.turnCard||"未選")+(r.turnAction?"｜"+r.turnAction:""))}</div>
        <div><b>河牌：</b>${escapeHtml((r.riverCard||"未選")+(r.riverAction?"｜"+r.riverAction:""))}</div>
      </div>
    </div>
    <p class="strategy-warning">${modeLabel==="GTO"?"✅ 這筆結果來自已收錄的 GTO 參考資料。":"⚠️ 一般分析使用 App 內建離線策略模型估算，不是即時 GTO Solver。"}</p>`;
  box.classList.remove("hidden");
}

function loadHistory(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]")}catch{return []}}
function saveCurrent(){
  if(!lastAnalysis)analyze();
  if(!lastAnalysis)return;
  const rows=loadHistory();
  rows.unshift({...lastAnalysis,historyId:lastAnalysis.historyId||`${Date.now()}-${Math.random()}`});
  localStorage.setItem(HISTORY_KEY,JSON.stringify(rows.slice(0,100)));
  renderHistory();
  alert("已儲存這筆分析紀錄");
}
function deleteHistoryItem(historyId){
  if(!confirm("確定要刪除這筆分析紀錄嗎？"))return;
  const rows=loadHistory().filter(r=>String(r.historyId||r.at)!==String(historyId));
  localStorage.setItem(HISTORY_KEY,JSON.stringify(rows));
  renderHistory();
}
function renderHistory(){
  const box=$("saHistory");if(!box)return;
  const rows=loadHistory();
  box.innerHTML=rows.length?rows.map((r,i)=>{
    const id=escapeHtml(String(r.historyId||r.at||i));
    return `<div class="strategy-history-item history-row-v91">
      <div class="history-row-main">
        <b>${escapeHtml(r.heroNames||r.hand)}｜${escapeHtml(r.pos)}｜${escapeHtml(r.mode||"一般分析")}｜${escapeHtml(r.best)}</b>
        <div>加注 ${r.raise}%・跟注 ${r.call}%・棄牌 ${r.fold}%</div>
        <small>${escapeHtml(r.preflop||"尚無翻牌前行動")}<br>${new Date(r.at).toLocaleString("zh-TW",{hour12:false})}</small>
      </div>
      <button type="button" class="delete-history-v91" data-history-id="${id}">刪除</button>
    </div>`;
  }).join(""):`<p class="strategy-history-empty">尚無分析紀錄。</p>`;
  box.querySelectorAll(".delete-history-v91").forEach(btn=>btn.addEventListener("click",()=>deleteHistoryItem(btn.dataset.historyId)));
}

function clearCurrentHand(){
  Object.keys(selectedCards).forEach(k=>selectedCards[k]="");
  Object.keys(actionState).forEach(k=>actionState[k]=[]);
  renderSelectedCards();
  Object.keys(actionState).forEach(renderActionSequence);
  updateHeroChipDisplays();
  $("saResult").classList.add("hidden");
  $("saResult").innerHTML="";
  lastAnalysis=null;
  document.querySelectorAll(".street-tab").forEach((b,i)=>b.classList.toggle("active",i===0));
  document.querySelectorAll(".street-panel").forEach(p=>p.classList.toggle("active",p.dataset.panel==="preflop"));
}

let stopUsageLog=null;
function refreshUsageLogVisibility(){
  const section=$("saUsageLogSection");
  if(!section)return;
  const ctx=window.getPokerAppContext?window.getPokerAppContext():null;
  const owner=!!ctx?.isOwner;
  section.classList.toggle("hidden",!owner);
  if(stopUsageLog){stopUsageLog();stopUsageLog=null}
  if(owner&&window.subscribePokerAnalysisLogs){
    stopUsageLog=window.subscribePokerAnalysisLogs(rows=>{
      const box=$("saUsageLog");
      if(!box)return;
      box.innerHTML=rows.length?rows.slice(0,100).map(r=>`
        <div class="usage-log-item usage-row-v91">
          <div>
            <b>${escapeHtml(r.displayName||"未命名")}｜${escapeHtml(r.mode||"")}</b>
            <div>${escapeHtml(r.heroNames||r.hand||"未選牌")}・${escapeHtml(r.position||"")}・${escapeHtml(r.street||"翻牌前")}</div>
            <small>${r.usedAt?new Date(r.usedAt).toLocaleString("zh-TW",{hour12:false}):""}</small>
          </div>
          <button type="button" class="delete-usage-v91" data-log-id="${escapeHtml(r.id||"")}">刪除</button>
        </div>`).join(""):`<p class="strategy-history-empty">還沒有人使用過牌局分析。</p>`;
      box.querySelectorAll(".delete-usage-v91").forEach(btn=>btn.addEventListener("click",async()=>{
        if(!confirm("確定要刪除這筆使用紀錄嗎？"))return;
        try{await window.deletePokerAnalysisLog(btn.dataset.logId)}
        catch(e){alert(e.message||"刪除失敗")}
      }));
    });
  }
}

function initStreetTabs(){
  document.querySelectorAll(".street-tab").forEach(btn=>btn.addEventListener("click",()=>{
    const street=btn.dataset.street;
    document.querySelectorAll(".street-tab").forEach(b=>b.classList.toggle("active",b===btn));
    document.querySelectorAll(".street-panel").forEach(p=>p.classList.toggle("active",p.dataset.panel===street));
    populateActors();
    renderStillInHandReminderV94();
  }));
}
function init(){
  if(!$("handAnalyzerCard"))return;
  document.querySelectorAll(".analysis-mode-btn").forEach(btn=>btn.addEventListener("click",()=>setAnalysisMode(btn.dataset.analysisMode)));
  setAnalysisMode("general");
  $("saTableSize").addEventListener("change",()=>{renderSeats();updateHeroChipDisplays();});
  ["saSB","saBB","saStack"].forEach(id=>$(id)?.addEventListener("input",()=>{
    updateHeroChipDisplays();
    document.querySelectorAll(".action-builder").forEach(refreshActionAmountUI);
  }));
  $("saAnalyzeBtn").addEventListener("click",analyze);
  $("saSaveBtn").addEventListener("click",saveCurrent);
  $("saClearHandBtn").addEventListener("click",clearCurrentHand);
  $("saClearHistory").addEventListener("click",()=>{if(confirm("確定清空這台裝置上的牌局分析紀錄嗎？")){localStorage.removeItem(HISTORY_KEY);renderHistory();}});
  initStreetTabs();initCardSlots();initActionBuilders();
  renderSeats();renderSelectedCards();
  Object.keys(actionState).forEach(renderActionSequence);
  renderHistory();
  updateHeroChipDisplays();
  refreshUsageLogVisibility();
  window.addEventListener("pokerappcontextchange",refreshUsageLogVisibility);
}
init();

/* v91 persistent five-card board: directly synced to selectedCards */
function boardCardCodesV91(){
  return [
    selectedCards.flop0||"",
    selectedCards.flop1||"",
    selectedCards.flop2||"",
    selectedCards.turn||"",
    selectedCards.river||""
  ];
}
function boardSlotHtmlV91(code){
  if(!code)return '<span class="slot-placeholder">＋</span>';
  const c=cardDisplay(code);
  if(!c)return '<span class="slot-placeholder">＋</span>';
  return `<span class="persistent-mini-card ${c.red?"red":"black"}"><span>${c.rank}</span><span>${c.suit}</span></span>`;
}
window.renderPersistentBoardV91=function(){
  const wrap=document.getElementById("persistentBoardSlots");
  if(!wrap)return;
  const cards=boardCardCodesV91();
  wrap.querySelectorAll("[data-board-slot]").forEach((slot,i)=>{
    slot.innerHTML=boardSlotHtmlV91(cards[i]);
    slot.classList.toggle("filled",!!cards[i]);
  });
};
document.addEventListener("click",e=>{
  const slot=e.target.closest?.("[data-board-slot]");
  if(!slot)return;
  const i=Number(slot.dataset.boardSlot);
  const target=i<3?`flop${i}`:i===3?"turn":"river";
  openCardPicker(target);
});
window.renderPersistentBoardV91();

/* v94：自動提醒在局玩家、已棄牌狀態 */
function currentStreetKeyV94(){
  const active=document.querySelector(".street-tab.active");
  return active?.dataset?.street || "preflop";
}
function getPlayersStillInHandV94(targetStreet){
  const positions=POSITIONS_BY_SIZE[Number($("saTableSize")?.value)||6]||POSITIONS_BY_SIZE[6];
  const folded=getFoldedBeforeStreet(targetStreet);
  return positions.filter(p=>!folded.has(p));
}
function renderStillInHandReminderV94(){
  const street=currentStreetKeyV94();
  document.querySelectorAll(".still-in-hand-v94").forEach(el=>el.remove());
  if(street==="preflop")return;

  const builder=document.querySelector(`.action-builder[data-builder="${street}"]`);
  if(!builder)return;
  const hero=$("saHeroPos").value;
  const positions=POSITIONS_BY_SIZE[Number($("saTableSize")?.value)||6]||POSITIONS_BY_SIZE[6];
  const folded=getFoldedBeforeStreet(street);
  const active=positions.filter(p=>!folded.has(p));

  const box=document.createElement("div");
  box.className="still-in-hand-v94";
  box.innerHTML=`
    <b>🎯 目前還在牌局</b>
    <div class="player-status-v94">
      ${active.map(p=>`<span class="alive">${escapeHtml(p)}${p===hero?"（我）":""}</span>`).join("")}
      ${[...folded].map(p=>`<span class="folded">${escapeHtml(p)}${p===hero?"（我）":""}（已棄牌）</span>`).join("")}
    </div>`;
  builder.prepend(box);
}
document.addEventListener("click",()=>setTimeout(()=>{populateActors();renderStillInHandReminderV94();},0));
document.addEventListener("change",()=>setTimeout(()=>{populateActors();renderStillInHandReminderV94();},0));
setTimeout(()=>{populateActors();renderStillInHandReminderV94();},300);
