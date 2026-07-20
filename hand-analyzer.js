
const $ = id => document.getElementById(id);
const HISTORY_KEY = "pokerStrategyHistoryV87";
let lastAnalysis = null;
const analysisByStreet = {
  "翻牌前": null,
  "翻牌": null,
  "轉牌": null,
  "河牌": null
};
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

function actionOrderForStreet(street){
  const positions=canonicalSeatOrder();
  const anchor=street==="preflop" ? "BB" : "BTN";
  const idx=positions.indexOf(anchor);
  if(idx<0)return positions.slice();
  return positions.slice(idx+1).concat(positions.slice(0,idx+1));
}


const reentryPendingV114 = {
  preflop: [],
  flop: [],
  turn: [],
  river: []
};

function addReentryPendingV114(street,pos){
  if(!pos)return;
  const list=reentryPendingV114[street]||[];
  if(!list.includes(pos)) list.push(pos);
  reentryPendingV114[street]=list;
}

function removeReentryPendingV114(street,pos){
  reentryPendingV114[street]=(reentryPendingV114[street]||[]).filter(p=>p!==pos);
}

function clearReentryPendingV114(street=null){
  const streets=street?[street]:Object.keys(reentryPendingV114);
  streets.forEach(s=>reentryPendingV114[s]=[]);
  document.querySelectorAll(".reentry-hint-v113,.reentry-hint-v114").forEach(el=>el.remove());
  document.querySelectorAll(".action-actor").forEach(el=>el.classList.remove("needs-reentry-v113","needs-reentry-v114"));
}

function normalizedActorPosV114(a){
  if(!a)return "";
  return actualActorPosition(a.actor) || (a.actor==="我" ? $("saHeroPos").value : a.actor);
}

function actedThisBettingRoundV114(street){
  const actions=actionState[street]||[];
  const aggressiveActions=["開池","下注","加注","加註","全下"];

  let lastAggressive=-1;
  actions.forEach((a,i)=>{
    if(aggressiveActions.includes(a.action)) lastAggressive=i;
  });

  const acted=new Set();

  if(lastAggressive>=0){
    // 新的下注/加注會重開行動；加注者本身已完成，之後已回應者也完成。
    acted.add(normalizedActorPosV114(actions[lastAggressive]));
    actions.slice(lastAggressive+1).forEach(a=>acted.add(normalizedActorPosV114(a)));
  }else{
    // 尚無下注/加注時，這一輪已經操作過的人先灰掉。
    actions.forEach(a=>acted.add(normalizedActorPosV114(a)));
  }

  return acted;
}

function renderReentryHintV114(street,builder){
  if(!builder)return;
  builder.querySelector(".reentry-hint-v113")?.remove();
  builder.querySelector(".reentry-hint-v114")?.remove();

  const pending=(reentryPendingV114[street]||[]);
  if(!pending.length)return;

  const hint=document.createElement("div");
  hint.className="reentry-hint-v114";
  const hero=$("saHeroPos").value;
  const labels=pending.map(p=>`${p}｜${positionName(p)}${p===hero?"（我）":""}`);
  hint.textContent=`↩️ 待重新補登：${labels.join("、")}`;
  const addBtn=builder.querySelector(".add-action-btn");
  if(addBtn) builder.insertBefore(hint,addBtn);
}

function populateActors(){
  const hero=$("saHeroPos").value;

  document.querySelectorAll(".action-builder").forEach(builder=>{
    const sel=builder.querySelector(".action-actor");
    if(!sel)return;

    const street=streetKeyFromBuilder(builder);
    const positions=actionOrderForStreet(street);
    const folded=getFoldedBeforeStreet(street);
    const acted=actedThisBettingRoundV114(street);
    const pending=new Set(reentryPendingV114[street]||[]);

    // 保留目前實際座位
    const currentActual=sel.value==="我"?hero:sel.value;

    sel.disabled=false;
    sel.innerHTML="";

    positions.forEach(p=>{
      const opt=document.createElement("option");
      const isHero=p===hero;
      const isFolded=folded.has(p);
      const alreadyActed=acted.has(p);
      const needsReentry=pending.has(p);

      opt.value=isHero?"我":p;

      // 已棄牌永遠不能選。
      // 本輪已行動者變灰不可再選；但如果該筆動作被刪除，重新開放讓你補登。
      opt.disabled=isFolded || (alreadyActed && !needsReentry);

      let suffix="";
      if(isHero)suffix+="（我）";
      if(isFolded)suffix+="（已棄牌）";
      else if(alreadyActed && !needsReentry)suffix+="（已行動）";
      else if(needsReentry)suffix+="（待補登）";

      opt.textContent=`${p}｜${positionName(p)}${suffix}`;
      sel.appendChild(opt);
    });

    // 優先選「待補登」中依牌桌順序最前面的那位
    const firstPending=positions.find(p=>pending.has(p) && !folded.has(p));
    if(firstPending){
      const value=firstPending===hero?"我":firstPending;
      if([...sel.options].some(o=>o.value===value&&!o.disabled)){
        sel.value=value;
        sel.classList.add("needs-reentry-v114");
      }
    }else{
      sel.classList.remove("needs-reentry-v114","needs-reentry-v113");
      const wantedValue=currentActual===hero?"我":currentActual;
      const wanted=[...sel.options].find(o=>o.value===wantedValue&&!o.disabled);
      if(wanted){
        sel.value=wanted.value;
      }else{
        const first=[...sel.options].find(o=>!o.disabled);
        if(first)sel.value=first.value;
      }
    }

    // 完成本輪時維持鎖定；否則保持可編輯
    const addBtn=builder.querySelector(".add-action-btn");
    const typeSel=builder.querySelector(".action-type");
    const roundDone=addBtn?.dataset.roundComplete==="1";
    if(roundDone && !pending.size){
      sel.disabled=true;
      if(typeSel)typeSel.disabled=true;
    }else{
      sel.disabled=false;
      if(typeSel)typeSel.disabled=false;
      if(addBtn){
        addBtn.disabled=false;
        if(addBtn.dataset.roundComplete==="1" && pending.size){
          delete addBtn.dataset.roundComplete;
          addBtn.textContent="＋加入這個行動";
        }
      }
    }

    renderReentryHintV114(street,builder);
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
    const justSelectedSlot=activeCardSlot;
    selectedCards[justSelectedSlot]=btn.dataset.card;
    renderSelectedCards();

    // v116：翻牌三張連續選牌。
    // 第 1 張選完自動開第 2 張，第 2 張選完自動開第 3 張。
    // 若下一張本來已有牌，視為「換牌」，就不強制跳過去。
    const nextAutoSlot={
      hero0:"hero1",
      flop0:"flop1",
      flop1:"flop2"
    }[justSelectedSlot];

    // v122：首次選手牌時，第 1 張選完直接接著選第 2 張；
    // 若第 2 張原本已有牌，代表只是單獨換第 1 張，不強制跳轉。
    if(nextAutoSlot && !selectedCards[nextAutoSlot]){
      activeCardSlot=nextAutoSlot;
      renderDeck();
      // overlay 保持開啟，直接讓使用者繼續選下一張
    }else{
      closeCardPicker();
    }

    // v119：牌面變更後，等 DOM/hidden 欄位同步完成再重新分析。
    // 翻牌必須三張都選完才更新翻牌分析，避免第 1/2 張的暫存結果覆蓋完整三張。
    if(lastAnalysis){
      clearTimeout(window.__pokerReanalyzeTimer);
      window.__pokerReanalyzeTimer=setTimeout(()=>{
        updateHiddenCards();
        const st=activeStreet();
        const board=boardCardsForStreetV118(st);
        const need=st==="翻牌"?3:st==="轉牌"?4:st==="河牌"?5:0;
        if(board.length>=need) analyze();
      },80);
    }
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


function highestCommittedOnStreet(street){
  const commits=initialStreetCommitments(street);
  const actions=actionState[street]||[];
  for(const a of actions){
    const pos=actualActorPosition(a.actor);
    if(!pos) continue;
    if(!(pos in commits)) commits[pos]=0;
    const current=Number(commits[pos])||0;
    const high=Math.max(0,...Object.values(commits).map(Number));

    if(a.action==="跟注"){
      commits[pos]=Math.max(current,high);
    }else if(["開池","下注","加注","全下"].includes(a.action)){
      const target=Number(a.amount)||0;
      if(target>0) commits[pos]=Math.max(current,target);
    }
  }
  return Math.max(0,...Object.values(commits).map(Number));
}

function hasAggressiveBetOnStreet(street){
  return (actionState[street]||[]).some(a=>["開池","下注","加注","全下"].includes(a.action));
}

function allowedActionsForCurrentState(street, actorValue){
  const hasBet=hasAggressiveBetOnStreet(street);

  // 翻牌前尚未有人開池：可以開池、跟注（limp）、棄牌、全下。
  // 一旦有人開池或加注：後面只能跟注、加注、棄牌、全下，不能再「開池」。
  if(street==="preflop"){
    return hasBet
      ? ["跟注","加注","棄牌","全下"]
      : ["開池","跟注","棄牌","全下"];
  }

  // 翻牌後尚未有人下注：過牌、下注、棄牌、全下。
  // 已有人下注後：跟注、加注、棄牌、全下。
  return hasBet
    ? ["跟注","加注","棄牌","全下"]
    : ["過牌","下注","棄牌","全下"];
}

function refreshActionTypeOptions(builder){
  const street=builder.dataset.builder;
  const actor=builder.querySelector(".action-actor");
  const type=builder.querySelector(".action-type");
  if(!actor||!type)return;

  const old=type.value;
  const allowed=allowedActionsForCurrentState(street,actor.value);

  type.innerHTML=allowed.map(a=>`<option value="${a}">${a}</option>`).join("");
  if(allowed.includes(old)) type.value=old;

  refreshActionAmountUI(builder);
}


function clearReentryHintV113(builder){
  if(!builder)return;
  const actorSel=builder.querySelector(".action-actor");
  actorSel?.classList.remove("needs-reentry-v113");
  builder.querySelector(".reentry-hint-v113")?.remove();
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
    actor.addEventListener("change",()=>{
      actor.classList.remove("needs-reentry-v113");
      refreshActionTypeOptions(builder);
    });
    refreshActionTypeOptions(builder);

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
      removeReentryPendingV114(street,actualPos);
      renderReentryHintV114(street,builder);
      amount.value="";
      amount.readOnly=false;
      renderActionSequence(street);

      // 記住本次行動座位，刷新後自動跳到牌桌順序的下一位（略過已棄牌）。
      // v107：若本街所有仍在牌局的玩家都已完成回應，就停止循環跳位。
      const streetActions = actionState[street] || [];
      const foldedNow = getFoldedBeforeStreet(street);
      const livePositions = actionOrderForStreet(street).filter(p => !foldedNow.has(p));
      const heroPosNow = $("saHeroPos").value;

      const normalizedActor = a => {
        const p = actualActorPosition(a.actor);
        return p || (a.actor === "我" ? heroPosNow : a.actor);
      };

      // 最後一次開池／下注／加註／全下後，所有仍在局中的玩家都必須完成回應。
      let lastAggressive = -1;
      streetActions.forEach((a, i) => {
        if (["開池", "下注", "加注", "加註", "全下"].includes(a.action)) lastAggressive = i;
      });

      // v108：下注輪完成不能要求「最後一次進攻者自己再回應一次」。
      // 開池／加註者的動作本身已經算完成；只需要檢查其後所有仍在局玩家
      // 是否都已經回應（跟注／棄牌／全下，或有人再次加註則重新起算）。
      const responseStart = lastAggressive >= 0 ? lastAggressive + 1 : 0;
      const responseActions = streetActions.slice(responseStart);
      const responded = new Set(responseActions.map(normalizedActor));

      let roundComplete = false;
      if (lastAggressive >= 0) {
        const aggressor = normalizedActor(streetActions[lastAggressive]);
        const needResponse = livePositions.filter(p => p !== aggressor);
        roundComplete =
          needResponse.length === 0 ||
          needResponse.every(p => responded.has(p));
      } else {
        // 沒有開池／加註時，所有仍在局玩家各完成一次行動即結束。
        roundComplete =
          livePositions.length > 0 &&
          livePositions.every(p => responded.has(p));
      }

      if (roundComplete) {
        // v110：本輪完成後不要把編輯功能鎖死。
        // 顯示完成狀態；只要使用者刪除下面任一行動，renderActions()
        // 會重新計算下一位並恢復正常的「＋加入這個行動」。
        const actorSel = builder.querySelector(".action-actor");
        const typeSel = builder.querySelector(".action-type");
        const addBtn = builder.querySelector(".add-action-btn");

        if (actorSel) {
          actorSel.disabled = true;
        }
        if (typeSel) {
          typeSel.disabled = true;
        }
        if (addBtn) {
          addBtn.disabled = true;
          addBtn.textContent = "✅ 完成本輪";
          addBtn.dataset.roundComplete = "1";
        }
        return;
      }

      const positions=actionOrderForStreet(street);
      const actedIndex=positions.indexOf(actualPos);

      populateActors();

      if(actedIndex>=0){
        const foldedNow=getFoldedBeforeStreet(street);
        for(let step=1;step<=positions.length;step++){
          const nextPos=positions[(actedIndex+step)%positions.length];
          if(foldedNow.has(nextPos)) continue;
          const nextValue=nextPos===$("saHeroPos").value?"我":nextPos;
          const nextOpt=[...actor.options].find(o=>o.value===nextValue&&!o.disabled);
          if(nextOpt){ actor.value=nextValue; break; }
        }
      }

      updateHeroChipDisplays();
      document.querySelectorAll(".action-builder").forEach(b=>{
        refreshActionTypeOptions(b);
        refreshActionAmountUI(b);
      });
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
    const removeIndex=Number(btn.dataset.remove);
    const removedAction=actionState[street][removeIndex];
    const removedPos=normalizedActorPosV114(removedAction);

    actionState[street].splice(removeIndex,1);
    addReentryPendingV114(street,removedPos);

    const builder=document.querySelector(`.action-builder[data-builder="${street}"]`);
    if(builder){
      const actorSel=builder.querySelector(".action-actor");
      const typeSel=builder.querySelector(".action-type");
      const addBtn=builder.querySelector(".add-action-btn");

      if(actorSel)actorSel.disabled=false;
      if(typeSel)typeSel.disabled=false;
      if(addBtn){
        addBtn.disabled=false;
        addBtn.textContent="＋加入這個行動";
        delete addBtn.dataset.roundComplete;
      }
    }

    renderActionSequence(street);
    populateActors();
  }));
  syncActionHidden(street);
  populateActors();
  updateHeroChipDisplays();
  document.querySelectorAll(".action-builder").forEach(b=>{
    refreshActionTypeOptions(b);
    refreshActionAmountUI(b);
  });
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
  const activeTab=[...document.querySelectorAll(".street-tab")].find(b=>b.classList.contains("active"));
  const visiblePanel=[...document.querySelectorAll(".street-panel")].find(p=>p.classList.contains("active"));
  const key=activeTab?.dataset?.street || visiblePanel?.dataset?.panel || "preflop";
  return ({preflop:"翻牌前",flop:"翻牌",turn:"轉牌",river:"河牌"})[key] || "翻牌前";
}
function boardCardsForStreetV118(street){
  if(street==="翻牌前") return [];
  const cards=[selectedCards.flop0,selectedCards.flop1,selectedCards.flop2].filter(Boolean);
  if(street==="轉牌"||street==="河牌") if(selectedCards.turn) cards.push(selectedCards.turn);
  if(street==="河牌"&&selectedCards.river) cards.push(selectedCards.river);
  return cards;
}
function actionTextForStreetV118(street){
  const key=({"翻牌前":"preflop","翻牌":"flop","轉牌":"turn","河牌":"river"})[street];
  return key ? actionState[key].map(a=>`${a.actor} ${a.action}${a.amount?`到 ${a.amount}`:""}`).join("，") : "";
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


function getBoardSnapshotForStreet(street){
  const cards=[
    selectedCards.flop0,
    selectedCards.flop1,
    selectedCards.flop2,
    selectedCards.turn,
    selectedCards.river
  ].filter(Boolean);
  const count={preflop:0,flop:3,turn:4,river:5}[street];
  return cards.slice(0, count == null ? cards.length : count);
}



function formatCardListV121(value){
  if(!value) return "";
  const cards=Array.isArray(value) ? value : String(value).trim().split(/\s+/).filter(Boolean);
  return cards.map(c=>prettyCard(c)).join("、");
}

function getFlushRiskV121(heroCards, boardCards, madeHand){
  if(!madeHand || madeHand.category!==5) return null;

  const all=[...heroCards,...boardCards];
  const suitCounts={};
  all.forEach(c=>{
    const s=c.slice(-1);
    suitCounts[s]=(suitCounts[s]||0)+1;
  });
  const flushSuit=Object.entries(suitCounts).find(([,n])=>n>=5)?.[0];
  if(!flushSuit) return null;

  const rankValue={"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};
  const rankName={14:"A",13:"K",12:"Q",11:"J",10:"10",9:"9",8:"8",7:"7",6:"6",5:"5",4:"4",3:"3",2:"2"};
  const suitSymbol={s:"♠",h:"♥",d:"♦",c:"♣"}[flushSuit] || flushSuit;
  const used=new Set(all);

  const heroFlush=all
    .filter(c=>c.endsWith(flushSuit))
    .map(c=>rankValue[c.slice(0,-1)])
    .sort((a,b)=>b-a)
    .slice(0,5);

  if(heroFlush.length<5) return null;

  const danger=[];
  for(let v=14;v>=2;v--){
    const code=`${rankName[v]}${flushSuit}`;
    if(used.has(code)) continue;

    // 模擬對手持有這張同花牌，再搭配一張很低的同花牌，
    // 若仍能形成比玩家更大的同花，就列為關鍵危險牌。
    const availableLow=[];
    for(let x=2;x<=14;x++){
      const lowCode=`${rankName[x]}${flushSuit}`;
      if(lowCode!==code && !used.has(lowCode)) availableLow.push(lowCode);
    }

    let beats=false;
    for(const second of availableLow){
      const oppBest=evaluateBestHand([...boardCards, code, second]);
      if(oppBest && compareScores(oppBest.score,madeHand.score)>0){
        beats=true;
        break;
      }
    }
    if(beats) danger.push(`${rankName[v]}${suitSymbol}`);
  }

  if(!danger.length) return null;

  return {
    cards: danger,
    text:`⚠️ 同花風險：你目前是「${madeHand.name}」。對手若持有 ${danger.join("、")} 等較高${suitSymbol}，再搭配另一張${suitSymbol}，可能組成比你更大的同花。`
  };
}

function getDrawInfoV120(holeCards, boardCards){
  if(!holeCards || holeCards.length!==2 || !boardCards || boardCards.length<3 || boardCards.length>=5){
    return null;
  }

  const all=[...holeCards,...boardCards].filter(Boolean);
  const used=new Set(all);
  const rankMap={"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};
  const rankName={14:"A",13:"K",12:"Q",11:"J",10:"10",9:"9",8:"8",7:"7",6:"6",5:"5",4:"4",3:"3",2:"2"};
  const suits=["s","h","d","c"];
  const ranks=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

  const rankVals=all.map(c=>rankMap[c.slice(0,-1)]);
  const unique=new Set(rankVals);
  if(unique.has(14)) unique.add(1);

  const straightOutRanks=new Set();
  // 所有可能 5 張連號窗口：A2345 到 TJQKA
  for(let start=1;start<=10;start++){
    const seq=[start,start+1,start+2,start+3,start+4];
    const missing=seq.filter(v=>!unique.has(v));
    if(missing.length===1){
      let m=missing[0];
      if(m===1)m=14;
      straightOutRanks.add(m);
    }
  }

  const availableStraightCards=[];
  for(const rv of straightOutRanks){
    const r=rankName[rv];
    for(const s of suits){
      const c=`${r}${s}`;
      if(!used.has(c)) availableStraightCards.push(c);
    }
  }

  const suitCounts={};
  all.forEach(c=>{
    const s=c.slice(-1);
    suitCounts[s]=(suitCounts[s]||0)+1;
  });
  const flushSuit=Object.entries(suitCounts).find(([,n])=>n===4)?.[0] || null;
  const flushCards=flushSuit
    ? ranks.map(r=>`${r}${flushSuit}`).filter(c=>!used.has(c))
    : [];

  // 用真正牌型評估找「下一張會讓牌型升級」的牌，避免只看順子/同花
  const currentBest=evaluateBestHand(all);
  const improvementCards=[];
  if(currentBest){
    for(const r of ranks){
      for(const s of suits){
        const c=`${r}${s}`;
        if(used.has(c))continue;
        const nextBest=evaluateBestHand([...all,c]);
        if(nextBest && compareScores(nextBest.score,currentBest.score)>0){
          improvementCards.push({card:c,name:nextBest.name});
        }
      }
    }
  }

  const drawParts=[];
  if(availableStraightCards.length){
    const ranksText=[...straightOutRanks].sort((a,b)=>a-b).map(v=>rankName[v]).join("、");
    drawParts.push(`順子聽牌：${ranksText} 可完成順子，共 ${availableStraightCards.length} 張未開牌`);
  }
  if(flushCards.length){
    const suitText=({s:"黑桃",h:"紅心",d:"方塊",c:"梅花"})[flushSuit] || flushSuit;
    drawParts.push(`${suitText}同花聽牌：還有 ${flushCards.length} 張可完成同花`);
  }

  const uniqueImprovement=[...new Set(improvementCards.map(x=>x.card))];
  const totalUnknown=52-used.size;
  const nextPct=totalUnknown>0 ? Math.round(uniqueImprovement.length/totalUnknown*100) : 0;

  if(!drawParts.length && !uniqueImprovement.length)return null;

  return {
    straightOuts: availableStraightCards,
    flushOuts: flushCards,
    improvementOuts: uniqueImprovement,
    nextPercent: nextPct,
    text: drawParts.length
      ? `💡 聽牌提醒：${drawParts.join("；")}。`
      : `💡 改善提醒：下一張約有 ${uniqueImprovement.length} 張牌能讓目前牌型提升（約 ${nextPct}%）。`
  };
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
    summary+=" 目前公共牌還沒發完，後續轉牌／河牌也可能讓你或對手的牌型再次改變。";
    const drawInfo=getDrawInfoV120(hero,board);
    if(drawInfo) summary+=" "+drawInfo.text;
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

function evaluateMadeHand(street=activeStreet()){
  const cards=[selectedCards.hero0,selectedCards.hero1,...boardCardsForStreetV118(street)].filter(Boolean);
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

  ["preflop","flop","turn","river"].forEach(syncActionHidden);
  renderSelectedCards();

  const bb=Number($("saBB").value)||2;
  const remainingChips=Number($("saStack").value)||0;
  const stack=bb>0?remainingChips/bb:0;
  const tableSize=Number($("saTableSize").value)||6;
  const street=activeStreet();

  const preflop=actionTextForStreetV118("翻牌前") || $("saAction").value || "";
  const flopBoard=boardCardsForStreetV118("翻牌");
  const turnBoard=boardCardsForStreetV118("轉牌");
  const riverBoard=boardCardsForStreetV118("河牌");

  const flopCards=flopBoard.join(" ");
  const flopAction=actionTextForStreetV118("翻牌") || "";
  const turnCard=selectedCards.turn || "";
  const turnAction=actionTextForStreetV118("轉牌") || "";
  const riverCard=selectedCards.river || "";
  const riverAction=actionTextForStreetV118("河牌") || "";

  const heroCards=[selectedCards.hero0,selectedCards.hero1].filter(Boolean);
  const heroNames=heroCards.map(c=>cardDisplay(c)?.name).join("、");
  const boardNow=boardCardsForStreetV118(street);
  const actionNow=actionTextForStreetV118(street);
  const p=parsePressure(preflop,bb);

  // GTO 模式保留原本翻牌前資料；翻牌後沒有正式 solver 資料時明確提示
  if(analysisMode==="gto"){
    const gto=getGTOResult({tableSize,stack,pos,hand,preflop});
    const result={
      at:new Date().toISOString(),hand,heroNames,pos,tableSize,stack,remainingChips,
      blinds:`${$("saSB").value}/${$("saBB").value}`,
      preflop,flopCards,flopAction,turnCard,turnAction,riverCard,riverAction,
      boardSnapshot:[...boardNow],actionSnapshot:actionNow,street,mode:"GTO"
    };
    if(!gto || street!=="翻牌前"){
      Object.assign(result,{
        unsupported:true,raise:null,call:null,fold:null,best:"目前無正式 GTO 資料",
        reason:street==="翻牌前"
          ?"這個翻牌前局面目前沒有收錄正式 GTO 策略資料。"
          :"目前 App 沒有即時 Postflop GTO Solver，翻牌後請切回一般分析查看牌型、聽牌與風險。"
      });
    }else{
      Object.assign(result,{
        unsupported:false,raise:gto.raise,call:gto.call,fold:gto.fold,
        best:[["加注",gto.raise],["跟注",gto.call],["棄牌",gto.fold]].sort((a,b)=>b[1]-a[1])[0][0],
        reason:`此結果來自 App 內已收錄的 GTO 參考資料。${gto.note||""}`
      });
    }
    analysisByStreet[street]=result;
    lastAnalysis=result;
    renderResult(result);
    return;
  }

  let raise=0,call=0,fold=0,bestAction="";

  // -------- 翻牌前：只用翻牌前模型 --------
  if(street==="翻牌前"){
    let s=handStrength(hand)+positionAdjustment(pos);
    if(tableSize>=7&&/UTG/.test(preflop))s-=4;
    if(tableSize<=5)s+=3;
    if(stack<40)s+=3;
    if(stack>150)s-=2;

    if(p.level>=3){raise=clamp((s-82)*1.5,0,32);call=clamp((s-70)*1.2,0,35);}
    else if(p.level===2){raise=clamp((s-76)*1.3,0,42);call=clamp((s-55)*1.25,0,55);if(pos==="BB")call+=4;}
    else if(p.level===1){raise=clamp((s-58)*1.45,2,68);call=clamp(72-Math.abs(s-60)*1.15,4,58);if(pos==="BB")call+=8;}
    else{raise=clamp((s-45)*1.5,8,78);call=clamp(55-Math.abs(s-52),5,45);}

    if(p.level===2&&/^(AJ|AT|KQ|KJ|QJ)o$/.test(hand)&&/UTG/.test(preflop)){
      const target=hand==="AJo"?{raise:3,call:7,fold:90}:{raise:2,call:5,fold:93};
      raise=target.raise;call=target.call;fold=target.fold;
    }
    if(/^(AA|KK)$/.test(hand)){raise=p.level>=2?88:82;call=100-raise;fold=0;}
    if(hand==="QQ"&&p.level===2){raise=54;call=44;fold=2;}
    if(/^AKs?$/.test(hand)&&p.level===2){raise=58;call=39;fold=3;}

    raise=clamp(raise,0,90);call=clamp(call,0,90-raise);fold=100-raise-call;
    const total=raise+call+fold;
    raise=Math.round(raise/total*100);call=Math.round(call/total*100);fold=100-raise-call;
    bestAction=[["加注",raise],["跟注",call],["棄牌",fold]].sort((a,b)=>b[1]-a[1])[0][0];

    let reason=`你的手牌是 ${heroNames}，位置在 ${pos}（${positionName(pos)}）。`;
    if(p.level===2)reason+=" 面對前面開池後又有人加注，翻牌前繼續範圍需要明顯收緊。";
    else if(p.level===1)reason+=" 目前主要面對一次開池，可以依位置與牌力考慮跟注或再加注。";
    else if(p.level>=3)reason+=" 目前是高壓力再加注局面，範圍要非常緊。";
    else reason+=" 目前沒有偵測到明確的翻牌前加注壓力。";

    const result={
      at:new Date().toISOString(),hand,heroNames,pos,tableSize,stack,remainingChips,mode:"一般分析",
      blinds:`${$("saSB").value}/${$("saBB").value}`,
      preflop,flopCards:"",flopAction:"",turnCard:"",turnAction:"",riverCard:"",riverAction:"",
      boardSnapshot:[],actionSnapshot:preflop,street,
      raise,call,fold,best:bestAction,reason,riskSummary:"",madeHandName:""
    };
    analysisByStreet[street]=result;
    lastAnalysis=result;
    renderResult(result);
    return;
  }

  // -------- 翻牌後：完全不用翻牌前百分比，依當下牌型/聽牌重新計算 --------
  if(boardNow.length<3){
    alert("請先選完整的翻牌三張牌。");
    return;
  }

  const madeHand=evaluateBestHand([...heroCards,...boardNow]);
  const risk=analyzeOpponentRiskForStreetV120(heroCards,boardNow);
  const drawInfo=getDrawInfoV120(heroCards,boardNow);
  const flushRisk=getFlushRiskV121(heroCards,boardNow,madeHand);
  const category=madeHand?.category ?? 0;

  // 基礎策略按實際成牌強度
  if(risk?.isNuts){raise=74;call=26;fold=0;}
  else if(category>=7){raise=68;call=31;fold=1;}
  else if(category===6){raise=62;call=36;fold=2;}
  else if(category===5){raise=55;call=40;fold=5;}
  else if(category===4){raise=48;call=45;fold=7;}
  else if(category===3){raise=38;call=50;fold=12;}
  else if(category===2){raise=25;call=52;fold=23;}
  else if(category===1){raise=14;call=46;fold=40;}
  else {raise=8;call=30;fold=62;}

  // 有強聽牌時，提高繼續遊戲比例，不再把順子聽牌當純空氣
  if(drawInfo?.straightOuts?.length>=8){
    raise=Math.max(raise,24);
    call=Math.max(call,52);
    fold=Math.max(0,100-raise-call);
  }else if(drawInfo?.straightOuts?.length>=4 || drawInfo?.flushOuts?.length>=9){
    raise=Math.max(raise,18);
    call=Math.max(call,48);
    fold=Math.max(0,100-raise-call);
  }

  // 正規化到 100
  const total2=raise+call+fold || 100;
  raise=Math.round(raise/total2*100);
  call=Math.round(call/total2*100);
  fold=100-raise-call;
  bestAction=[["加注",raise],["跟注",call],["棄牌",fold]].sort((a,b)=>b[1]-a[1])[0][0];

  let reason=`你目前在${street}的實際牌型是「${madeHand?.name||"尚未成牌"}」。`;
  if(drawInfo) reason+=` ${drawInfo.text}`;
  if(flushRisk) reason+=` ${flushRisk.text}`;
  if(risk?.summary) reason+=` ${risk.summary}`;
  if(actionNow) reason+=`\n\n${street}行動：${actionNow}。`;
  else reason+=`\n\n${street}行動：尚未加入行動。`;
  reason+=" 百分比是依目前這一街的實際牌面重新估算，不會沿用翻牌前分析。";

  const result={
    at:new Date().toISOString(),hand,heroNames,pos,tableSize,stack,remainingChips,mode:"一般分析",
    blinds:`${$("saSB").value}/${$("saBB").value}`,
    preflop,
    flopCards:street==="翻牌"?boardNow.join(" "):flopBoard.join(" "),
    flopAction,
    turnCard:street==="轉牌"||street==="河牌" ? (selectedCards.turn||"") : "",
    turnAction,
    riverCard:street==="河牌" ? (selectedCards.river||"") : "",
    riverAction,
    boardSnapshot:[...boardNow],actionSnapshot:actionNow,street,
    raise,call,fold,best:bestAction,reason,
    riskSummary:risk?.summary||"",madeHandName:madeHand?.name||"",
    drawInfo:drawInfo||null,
    flushRisk:flushRisk||null
  };

  analysisByStreet[street]=result;
  lastAnalysis=result;
  renderResult(result);
}

function analyzeOpponentRiskForStreetV120(hero,board){
  if(hero.length!==2 || board.length<3)return null;
  const heroBest=evaluateBestHand([...hero,...board]);
  if(!heroBest)return null;

  const used=new Set([...hero,...board]);
  const available=fullDeck().filter(c=>!used.has(c));
  let betterCount=0,tieCount=0;
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
        if(examples.length<5)examples.push(`${prettyCard(opp[0])}＋${prettyCard(opp[1])} → ${oppBest.name}`);
      }else if(cmp===0)tieCount++;
    }
  }

  const categoryList=[...categories.entries()].sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
  let summary=betterCount===0
    ? `以目前${board.length}張公共牌來看，你現在是堅果牌（Nuts）。`
    : `目前仍有 ${betterCount} 種對手兩張手牌組合可以擊敗你，主要更大牌型包含：${categoryList.slice(0,4).map(x=>x.name).join("、")||"更大的牌型"}。`;

  if(examples.length)summary+=` 例如：${examples.join("；")}。`;
  return {heroBest,betterCount,tieCount,categories:categoryList,examples,isNuts:betterCount===0,summary};
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
        <div><b>翻牌：</b>${escapeHtml((r.flopCards?formatCardListV121(r.flopCards):"未選牌面")+(r.flopAction?"｜"+r.flopAction:""))}</div>
        <div><b>轉牌：</b>${escapeHtml((r.turnCard?formatCardListV121(r.turnCard):"未選")+(r.turnAction?"｜"+r.turnAction:""))}</div>
        <div><b>河牌：</b>${escapeHtml((r.riverCard?formatCardListV121(r.riverCard):"未選")+(r.riverAction?"｜"+r.riverAction:""))}</div>
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
    <div class="strategy-main"><b>主要建議：${r.best}</b>${r.drawInfo?.text?`<div class="draw-alert-v120">${escapeHtml(r.drawInfo.text)}</div>`:""}${r.flushRisk?.text?`<div class="draw-alert-v120">${escapeHtml(r.flushRisk.text)}</div>`:""}<p>${escapeHtml(r.reason)}</p>${r.street!=="翻牌前"?`<div class="street-action-note"><b>${escapeHtml(r.street)}行動：</b>${escapeHtml((r.street==="翻牌"?r.flopAction:r.street==="轉牌"?r.turnAction:r.riverAction)||"尚未加入行動")}</div>`:""}
      <div class="street-summary">
        <div><b>翻牌前：</b>${escapeHtml(r.preflop||"尚未加入行動")}</div>
        <div><b>翻牌：</b>${escapeHtml((r.flopCards?formatCardListV121(r.flopCards):"未選牌面")+(r.flopAction?"｜"+r.flopAction:""))}</div>
        <div><b>轉牌：</b>${escapeHtml((r.turnCard?formatCardListV121(r.turnCard):"未選")+(r.turnAction?"｜"+r.turnAction:""))}</div>
        <div><b>河牌：</b>${escapeHtml((r.riverCard?formatCardListV121(r.riverCard):"未選")+(r.riverAction?"｜"+r.riverAction:""))}</div>
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
  clearReentryPendingV114();
  Object.keys(selectedCards).forEach(k=>selectedCards[k]="");
  Object.keys(actionState).forEach(k=>actionState[k]=[]);
  renderSelectedCards();
  Object.keys(actionState).forEach(renderActionSequence);
  updateHeroChipDisplays();
  $("saResult").classList.add("hidden");
  $("saResult").innerHTML="";
  lastAnalysis=null;
  Object.keys(analysisByStreet).forEach(k=>analysisByStreet[k]=null);
  document.querySelectorAll(".street-tab").forEach((b,i)=>b.classList.toggle("active",i===0));
  document.querySelectorAll(".street-panel").forEach(p=>p.classList.toggle("active",p.dataset.panel==="preflop"));

  // v115：一鍵清除後，完整恢復所有街道的操作功能
  document.querySelectorAll(".action-builder").forEach(builder=>{
    const actorSel=builder.querySelector(".action-actor");
    const typeSel=builder.querySelector(".action-type");
    const addBtn=builder.querySelector(".add-action-btn");

    if(actorSel){
      actorSel.disabled=false;
      actorSel.classList.remove("needs-reentry-v113","needs-reentry-v114");
    }
    if(typeSel) typeSel.disabled=false;
    if(addBtn){
      addBtn.disabled=false;
      addBtn.textContent="＋加入這個行動";
      delete addBtn.dataset.roundComplete;
    }

    Object.keys(builder.dataset).forEach(key=>{
      if(key.startsWith("roundCompleteCount")) delete builder.dataset[key];
    });

    builder.querySelectorAll(".reentry-hint-v113,.reentry-hint-v114").forEach(el=>el.remove());
  });

  // 清除後重新建立各街正確的第一位行動者與合法動作
  populateActors();
  document.querySelectorAll(".action-builder").forEach(builder=>{
    if(typeof refreshActionTypeOptions==="function") refreshActionTypeOptions(builder);
    if(typeof refreshActionAmountUI==="function") refreshActionAmountUI(builder);
  });
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
    // v120：每一街分析獨立保存。切換街道只顯示該街既有分析，不改寫其他街。
    const streetZh=activeStreet();
    const saved=analysisByStreet[streetZh];
    if(saved){
      lastAnalysis=saved;
      renderResult(saved);
    }else{
      $("saResult").classList.add("hidden");
      $("saResult").innerHTML="";
      lastAnalysis=null;
    }
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
  document.querySelectorAll(".action-builder").forEach(refreshActionTypeOptions);
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


// v117：計算下一張牌可帶來的明顯牌型改善（順子、同花、三條、兩對等）。
function getImprovementDraws(holeCards, boardCards){
  if(!holeCards || holeCards.length!==2 || !boardCards || boardCards.length<3 || boardCards.length>=5) return null;

  const used=new Set([...holeCards,...boardCards]);
  const ranks=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const suits=["s","h","d","c"];
  const deck=[];
  for(const r of ranks) for(const s of suits){
    const c=r+s;
    if(!used.has(c)) deck.push(c);
  }

  function parse(c){
    const suit=c.slice(-1);
    const rank=c.slice(0,-1);
    return {rank,suit,v:({"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14})[rank]};
  }
  function strength(cards){
    const ps=cards.map(parse);
    const counts={};
    ps.forEach(x=>counts[x.v]=(counts[x.v]||0)+1);
    const vals=Object.keys(counts).map(Number);
    const groups=Object.values(counts).sort((a,b)=>b-a);
    const suitCounts={};
    ps.forEach(x=>suitCounts[x.suit]=(suitCounts[x.suit]||0)+1);
    const flush=Object.values(suitCounts).some(n=>n>=5);
    let uniq=[...new Set(vals)].sort((a,b)=>a-b);
    if(uniq.includes(14)) uniq=[1,...uniq];
    let straight=false;
    for(let i=0;i<=uniq.length-5;i++){
      if(uniq[i+4]-uniq[i]===4) straight=true;
    }
    if(flush && straight) return 8;
    if(groups[0]>=4) return 7;
    if(groups[0]>=3 && groups[1]>=2) return 6;
    if(flush) return 5;
    if(straight) return 4;
    if(groups[0]>=3) return 3;
    if(groups[0]>=2 && groups[1]>=2) return 2;
    if(groups[0]>=2) return 1;
    return 0;
  }
  function label(n){
    return ["高牌","一對","兩對","三條","順子","同花","葫蘆","四條","同花順"][n]||"更強牌型";
  }

  const now=strength([...holeCards,...boardCards]);
  const improved=deck.map(c=>({card:c,s:strength([...holeCards,...boardCards,c])}))
                     .filter(x=>x.s>now);
  if(!improved.length) return null;

  const byType={};
  improved.forEach(x=>{
    const k=label(x.s);
    (byType[k] ||= []).push(x.card);
  });
  const total=deck.length;
  const pct=Math.round(improved.length/total*100);
  const details=Object.entries(byType).map(([k,v])=>`${k} ${v.length} 張`).join("、");
  return {
    outs: improved.length,
    total,
    percent:pct,
    details,
    text:`💡 改善提醒：下一張約有 ${improved.length} 張牌可讓目前牌型提升（約 ${pct}%）：${details}。`
  };
}
