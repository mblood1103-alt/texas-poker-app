
/* v95 UX/rules enhancements */
(function () {
  const FOLD_WORDS = ['棄牌','fold'];
  const ALLIN_WORDS = ['全下','all-in','all in','allin'];

  function textOfAction(a){ return String(a?.action || a?.type || a?.move || ''); }
  function actorOf(a){ return String(a?.player || a?.actor || a?.position || a?.who || ''); }
  function isFold(a){ return FOLD_WORDS.some(w => textOfAction(a).toLowerCase().includes(w.toLowerCase())); }

  // Generic helper exposed for the app's existing analyzer.
  window.V95PokerRules = {
    foldedPlayers(actionsByStreet, streetIndex) {
      const streets = ['preflop','flop','turn','river'];
      const folded = new Set();
      streets.slice(0, streetIndex + 1).forEach(s => {
        const arr = actionsByStreet?.[s] || [];
        arr.forEach(a => { if (isFold(a)) folded.add(actorOf(a)); });
      });
      return folded;
    },
    remainingStack(startingStack, actions, heroNames=['我']) {
      let left = Number(startingStack) || 0;
      (actions || []).forEach(a => {
        if (!heroNames.includes(actorOf(a))) return;
        const act = textOfAction(a);
        if (ALLIN_WORDS.some(w => act.toLowerCase().includes(w))) {
          left = 0;
          return;
        }
        const amount = Number(a?.amount ?? a?.bet ?? a?.chips ?? 0) || 0;
        if (amount > 0) left = Math.max(0, left - amount);
      });
      return left;
    },
    allInAmount(startingStack, actions, heroNames=['我']) {
      return this.remainingStack(startingStack, actions, heroNames);
    },
    fourOfAKindRisk(holeCards, boardCards) {
      const cards = [...(holeCards||[]), ...(boardCards||[])];
      const rank = c => String(c?.rank ?? c ?? '').replace(/[♠♥♦♣shdc]/gi,'').trim().toUpperCase();
      const br = (boardCards||[]).map(rank);
      const counts = {};
      br.forEach(r => counts[r]=(counts[r]||0)+1);
      const trips = Object.keys(counts).filter(r=>counts[r]>=3);
      if (!trips.length) return null;
      const order = ['2','3','4','5','6','7','8','9','10','T','J','Q','K','A'];
      const heroRanks=(holeCards||[]).map(rank);
      const risks=trips.filter(r=>!heroRanks.includes(r));
      if (!risks.length) return null;
      return `注意：公共牌已有三張 ${risks.join('、')}，對手只要持有同點數牌就可能組成更高的鐵支。即使目前牌型很強，也不是絕對最大牌。`;
    }
  };

  // UI observer: disable options explicitly marked as folded and show remaining stack hints
  function enhanceUI(){
    document.querySelectorAll('option').forEach(opt=>{
      if (/已棄牌/.test(opt.textContent||'')) opt.disabled = true;
    });

    // If an action chip says a player folded, disable matching player options immediately.
    const bodyText = document.body.innerText || '';
    const folded = new Set();
    document.querySelectorAll('body *').forEach(el=>{
      if (el.children.length===0) {
        const m=(el.textContent||'').trim().match(/^(.+?)\s*(?:棄牌|（已棄牌）|\(已棄牌\))$/);
        if(m) folded.add(m[1].trim().split(/\s+/)[0]);
      }
    });
    document.querySelectorAll('select').forEach(sel=>{
      [...sel.options].forEach(opt=>{
        const key=(opt.textContent||'').trim().split(/\s|\|/)[0];
        if(folded.has(key) && !/我/.test(opt.textContent||'')){
          opt.disabled=true;
          if(!/已棄牌/.test(opt.textContent||'')) opt.textContent += '（已棄牌）';
        }
      });
    });
  }
  new MutationObserver(enhanceUI).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded', enhanceUI);
})();
