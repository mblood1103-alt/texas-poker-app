const SUITS=[
  {key:"S",symbol:"♠",name:"黑桃",red:false},
  {key:"H",symbol:"♥",name:"紅心",red:true},
  {key:"D",symbol:"♦",name:"方塊",red:true},
  {key:"C",symbol:"♣",name:"梅花",red:false}
];
const RANKS=["A","K","Q","J","10","9","8","7","6","5","4","3","2"];
const VALUE={"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,J:11,Q:12,K:13,A:14};
const RANK_NAME={14:"A",13:"K",12:"Q",11:"J",10:"10",9:"9",8:"8",7:"7",6:"6",5:"5",4:"4",3:"3",2:"2"};
const TYPE_NAMES=["高牌","一對","兩對","三條","順子","同花","葫蘆","四條","同花順"];
let state={board:Array(5).fill(null),players:[],active:{kind:"board",index:0}};
let nextPlayerId=1;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cardKey=c=>c?`${c.rank}${c.suit}`:"";
const suitInfo=k=>SUITS.find(s=>s.key===k);
const cardText=c=>c?`${c.rank}${suitInfo(c.suit).symbol}`:"";
function selectedKeys(){
  const set=new Set(state.board.filter(Boolean).map(cardKey));
  state.players.forEach(p=>p.cards.filter(Boolean).forEach(c=>set.add(cardKey(c))));
  return set;
}
function newPlayer(name="") {return {id:nextPlayerId++,name,cards:[null,null]};}
function ensurePlayers(){if(!state.players.length)state.players=[newPlayer("玩家 1"),newPlayer("玩家 2")];}
function slotLabel(kind,index,player){
  if(kind==="board")return `公牌第 ${index+1} 張`;
  return `${player?.name||"玩家"}第 ${index+1} 張手牌`;
}
function setActive(kind,index,playerId=null){
  state.active={kind,index,playerId};
  renderAll();
  openPicker();
}
function openPicker(){
  const modal=$("pokerPickerModal");
  if(!modal)return;
  modal.classList.remove("hidden");
  document.body.classList.add("picker-open");
}
function closePicker(){
  const modal=$("pokerPickerModal");
  if(!modal)return;
  modal.classList.add("hidden");
  document.body.classList.remove("picker-open");
}
function assignCard(card){
  const a=state.active;if(!a)return;
  const used=selectedKeys();
  if(used.has(cardKey(card)))return;
  if(a.kind==="board")state.board[a.index]=card;
  else{const p=state.players.find(x=>x.id===a.playerId);if(p)p.cards[a.index]=card;}
  advanceActive();renderAll();
  closePicker();
}
function advanceActive(){
  const emptyBoard=state.board.findIndex(c=>!c);if(emptyBoard>=0){state.active={kind:"board",index:emptyBoard};return;}
  for(const p of state.players){const i=p.cards.findIndex(c=>!c);if(i>=0){state.active={kind:"player",playerId:p.id,index:i};return;}}
  state.active=null;
}
function clearSlot(kind,index,playerId=null){
  if(kind==="board")state.board[index]=null;
  else{const p=state.players.find(x=>x.id===playerId);if(p)p.cards[index]=null;}
  state.active={kind,index,playerId};renderAll();
}
function renderSlot(card,kind,index,playerId=null){
  const active=state.active&&state.active.kind===kind&&state.active.index===index&&(kind==="board"||state.active.playerId===playerId);
  const suit=card?suitInfo(card.suit):null;
  return `<button type="button" class="playing-card-slot${card?" filled":""}${suit?.red?" red":""}${active?" active":""}" data-kind="${kind}" data-index="${index}" ${playerId?`data-player-id="${playerId}"`:""}>${card?`<span>${esc(card.rank)}</span><b>${suit.symbol}</b><i>×</i>`:`<span class="slot-plus">＋</span><small>${kind==="board"?"公牌":"手牌"}</small>`}</button>`;
}
function renderBoard(){
  $("boardSlots").innerHTML=state.board.map((c,i)=>renderSlot(c,"board",i)).join("");
  bindSlots($("boardSlots"));
}
function renderPlayers(){
  const box=$("judgePlayers");
  box.innerHTML=state.players.map((p,idx)=>`<article class="judge-player" data-player-id="${p.id}"><div class="judge-player-head"><input class="judge-name" value="${esc(p.name)}" aria-label="玩家名稱"><button class="danger tiny remove-judge-player" type="button">移除</button></div><div class="card-slots player-card-slots">${p.cards.map((c,i)=>renderSlot(c,"player",i,p.id)).join("")}</div></article>`).join("");
  box.querySelectorAll(".judge-player").forEach(el=>{
    const id=Number(el.dataset.playerId),p=state.players.find(x=>x.id===id);
    el.querySelector(".judge-name").oninput=e=>{p.name=e.target.value;renderActiveHint();};
    el.querySelector(".remove-judge-player").onclick=()=>{state.players=state.players.filter(x=>x.id!==id);if(state.active?.playerId===id)advanceActive();renderAll();};
  });
  bindSlots(box);
}
function bindSlots(root){
  root.querySelectorAll(".playing-card-slot").forEach(btn=>btn.onclick=e=>{
    const kind=btn.dataset.kind,index=Number(btn.dataset.index),pid=btn.dataset.playerId?Number(btn.dataset.playerId):null;
    const card=kind==="board"?state.board[index]:state.players.find(x=>x.id===pid)?.cards[index];
    if(card&&e.target.tagName==="I")clearSlot(kind,index,pid);else setActive(kind,index,pid);
  });
}
function renderDeck(){
  const used=selectedKeys(),deck=$("pokerDeck");
  deck.innerHTML=SUITS.map(s=>`<section class="suit-row"><h4 class="${s.red?"red":""}">${s.symbol} ${s.name}</h4><div class="rank-buttons">${RANKS.map(r=>{const key=`${r}${s.key}`,disabled=used.has(key);return `<button type="button" class="deck-card ${s.red?"red":""}" data-rank="${r}" data-suit="${s.key}" ${disabled?"disabled":""}><span>${r}</span><b>${s.symbol}</b></button>`}).join("")}</div></section>`).join("");
  deck.querySelectorAll(".deck-card:not(:disabled)").forEach(btn=>btn.onclick=()=>{
    if(!state.active)return alert("請先點一個空白牌位");
    assignCard({rank:btn.dataset.rank,suit:btn.dataset.suit});
  });
}
function renderActiveHint(){
  const a=state.active,h=$("activeSlotHint");
  if(!a){h.textContent="牌已選滿。要換牌可點牌位，再點牌面右上角 × 清除。";return;}
  const p=a.kind==="player"?state.players.find(x=>x.id===a.playerId):null;
  h.textContent=`目前選擇：${slotLabel(a.kind,a.index,p)}。`;
}
function renderAll(){renderBoard();renderPlayers();renderDeck();renderActiveHint();$("judgeResult").classList.add("hidden");}
function combinations(arr,k){
  const out=[];function go(start,pick){if(pick.length===k){out.push(pick.slice());return;}for(let i=start;i<=arr.length-(k-pick.length);i++){pick.push(arr[i]);go(i+1,pick);pick.pop();}}go(0,[]);return out;
}
function compareScore(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d;}return 0;}
function evaluate5(cards){
  const vals=cards.map(c=>VALUE[c.rank]).sort((a,b)=>b-a),flush=cards.every(c=>c.suit===cards[0].suit);
  const unique=[...new Set(vals)];let straightHigh=0;
  if(unique.length===5){if(unique[0]-unique[4]===4)straightHigh=unique[0];else if(unique.join(",")==="14,5,4,3,2")straightHigh=5;}
  const counts=new Map();vals.forEach(v=>counts.set(v,(counts.get(v)||0)+1));
  const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  let score,type;
  if(flush&&straightHigh){type=8;score=[type,straightHigh];}
  else if(groups[0][1]===4){type=7;score=[type,groups[0][0],groups[1][0]];}
  else if(groups[0][1]===3&&groups[1][1]===2){type=6;score=[type,groups[0][0],groups[1][0]];}
  else if(flush){type=5;score=[type,...vals];}
  else if(straightHigh){type=4;score=[type,straightHigh];}
  else if(groups[0][1]===3){const kick=groups.filter(g=>g[1]===1).map(g=>g[0]).sort((a,b)=>b-a);type=3;score=[type,groups[0][0],...kick];}
  else if(groups[0][1]===2&&groups[1][1]===2){const pairs=groups.filter(g=>g[1]===2).map(g=>g[0]).sort((a,b)=>b-a),kick=groups.find(g=>g[1]===1)[0];type=2;score=[type,...pairs,kick];}
  else if(groups[0][1]===2){const pair=groups[0][0],kick=groups.filter(g=>g[1]===1).map(g=>g[0]).sort((a,b)=>b-a);type=1;score=[type,pair,...kick];}
  else{type=0;score=[type,...vals];}
  return {type,score,cards:sortDisplay(cards,type,straightHigh),name:TYPE_NAMES[type],detail:detailText(type,score)};
}
function sortDisplay(cards,type,straightHigh){
  if((type===4||type===8)&&straightHigh===5)return cards.slice().sort((a,b)=>{const va=VALUE[a.rank]===14?1:VALUE[a.rank],vb=VALUE[b.rank]===14?1:VALUE[b.rank];return vb-va;});
  const count={};cards.forEach(c=>count[VALUE[c.rank]]=(count[VALUE[c.rank]]||0)+1);
  return cards.slice().sort((a,b)=>count[VALUE[b.rank]]-count[VALUE[a.rank]]||VALUE[b.rank]-VALUE[a.rank]);
}
function detailText(type,s){
  if(type===8)return `${RANK_NAME[s[1]]} 高同花順`;
  if(type===7)return `${RANK_NAME[s[1]]} 四條，踢腳 ${RANK_NAME[s[2]]}`;
  if(type===6)return `${RANK_NAME[s[1]]} 葫蘆 ${RANK_NAME[s[2]]}`;
  if(type===5)return `${s.slice(1).map(v=>RANK_NAME[v]).join("、")} 同花`;
  if(type===4)return `${RANK_NAME[s[1]]} 高順子`;
  if(type===3)return `${RANK_NAME[s[1]]} 三條，踢腳 ${s.slice(2).map(v=>RANK_NAME[v]).join("、")}`;
  if(type===2)return `${RANK_NAME[s[1]]}、${RANK_NAME[s[2]]} 兩對，踢腳 ${RANK_NAME[s[3]]}`;
  if(type===1)return `${RANK_NAME[s[1]]} 一對，踢腳 ${s.slice(2).map(v=>RANK_NAME[v]).join("、")}`;
  return `${s.slice(1).map(v=>RANK_NAME[v]).join("、")} 高牌`;
}
function bestOf7(cards){
  let best=null;for(const five of combinations(cards,5)){const e=evaluate5(five);if(!best||compareScore(e.score,best.score)>0)best=e;}return best;
}
function cardHtml(c){const s=suitInfo(c.suit);return `<span class="result-card ${s.red?"red":""}">${esc(c.rank)}${s.symbol}</span>`;}
function judge(){
  if(state.board.some(c=>!c))return alert("請先選滿 5 張公牌");
  const ready=state.players.filter(p=>p.name.trim()&&p.cards.every(Boolean));
  if(ready.length<2)return alert("至少需要 2 位已填名稱且選滿 2 張手牌的玩家");
  const results=ready.map(p=>({p,best:bestOf7([...state.board,...p.cards])}));
  results.sort((a,b)=>compareScore(b.best.score,a.best.score));
  const top=results[0].best.score,winners=results.filter(r=>compareScore(r.best.score,top)===0);
  const title=winners.length>1?`🤝 平手：${winners.map(w=>esc(w.p.name)).join("、")}，底池平均分配`:`🏆 ${esc(winners[0].p.name)} 獲勝`;
  const box=$("judgeResult");
  box.innerHTML=`<h3>${title}</h3><p class="judge-board-line"><b>公牌：</b>${state.board.map(cardHtml).join("")}</p><div class="judge-result-list">${results.map((r,i)=>`<div class="judge-result-row ${winners.includes(r)?"winner":""}"><div><b>${winners.includes(r)?"🏆 ":""}${esc(r.p.name)}</b><div class="result-hole">手牌 ${r.p.cards.map(cardHtml).join("")}</div></div><div><strong>${r.best.name}</strong><small>${esc(r.best.detail)}</small><div class="best-five">最佳五張 ${r.best.cards.map(cardHtml).join("")}</div></div></div>`).join("")}</div><p class="hint judge-rule-note">系統只比較每人的最佳 5 張牌；最佳 5 張完全相同即平分。</p>`;
  box.classList.remove("hidden");box.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function resetAll(){state={board:Array(5).fill(null),players:[newPlayer("玩家 1"),newPlayer("玩家 2")],active:{kind:"board",index:0}};renderAll();}
function init(){
  if(!$("pokerJudgeCard"))return;
  ensurePlayers();
  $("addJudgePlayerBtn").onclick=()=>{state.players.push(newPlayer(`玩家 ${state.players.length+1}`));advanceActive();renderAll();};
  $("resetPokerJudgeBtn").onclick=()=>{if(confirm("確定清除所有公牌與玩家手牌？"))resetAll();};
  $("judgeWinnerBtn").onclick=judge;
  $("closePokerPickerBtn").onclick=closePicker;
  $("pokerPickerBackdrop").onclick=closePicker;
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closePicker();});
  renderAll();
}
init();
