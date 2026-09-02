// Player Shares
// -----------------------------------------------------------------------
// Cross-league player exposure: how many of a scoped set of leagues
// (all / dynasty / redraft, with a further guillotine/managed/unmanaged
// split) each rostered player appears in, with position and
// minimum-league-count filters.
//
// Like the other split-out files, this one only talks to app.js through
// window.EZL. app.js calls in at one point: the router, for the "shares"
// view. Single entry point: Shares.render().
//
// Load this script AFTER app.js (and after storage.js) in index.html.
// -----------------------------------------------------------------------

window.Shares = (function(){

  const EZL = window.EZL;
  const state = EZL.state; // shared object reference — same `state` app.js uses

  function scopedLeagues(){
    const nonDynasty = state.leagues.filter(lg => !EZL.isDynastyLeague(lg.name));
    if(state.sharesMainTab === 'all') return state.leagues;
    if(state.sharesMainTab === 'dynasty') return state.leagues.filter(lg => EZL.isDynastyLeague(lg.name));
    if(state.sharesSubTab === 'guillotine') return nonDynasty.filter(lg => EZL.isGuillotineLeague(lg.name));
    if(state.sharesSubTab === 'redraft'){
      const trueRedraft = nonDynasty.filter(lg => !EZL.isGuillotineLeague(lg.name));
      if(state.sharesThirdTab === 'managed') return trueRedraft.filter(lg => EZL.categoryForLeagueName(lg.name) === 'Redraft (Managed)');
      if(state.sharesThirdTab === 'unmanaged') return trueRedraft.filter(lg => EZL.categoryForLeagueName(lg.name) === 'Redraft (Unmanaged)');
      return trueRedraft; // 'all'
    }
    return nonDynasty; // redraft top-level 'all'
  }

  function buildShareList(leaguesScope){
    const shareMap = {};
    leaguesScope.forEach(lg => {
      const detail = state.leagueDetail[lg.league_id];
      if(!detail) return;
      const myRoster = detail.rosters.find(r => r.roster_id === detail.myRosterId);
      if(!myRoster) return;
      (myRoster.players || []).forEach(pid => {
        if(!shareMap[pid]) shareMap[pid] = {count:0, leagues:[]};
        shareMap[pid].count++;
        shareMap[pid].leagues.push(lg.name);
      });
    });
    const draftedLeagues = leaguesScope.filter(lg => EZL.isDraftComplete(state.leagueDetail[lg.league_id]));
    const totalDrafted = draftedLeagues.length;
    return Object.keys(shareMap).map(pid => {
      const info = EZL.playerLabel(pid);
      const count = shareMap[pid].count;
      const pct = totalDrafted > 0 ? (count / totalDrafted * 100) : 0;
      return {pid, info, count, pct, leagues: shareMap[pid].leagues};
    }).sort((a,b) => b.count - a.count || (a.info?a.info.name:'').localeCompare(b.info?b.info.name:''));
  }

  function paint(){
    const scopeLeagues = scopedLeagues();
    const list = buildShareList(scopeLeagues);

    EZL.app.innerHTML = `
      ${EZL.renderTopbar(true)}
      <div class="body-scroll">
        <div class="section-title">Player Shares</div>
        <div class="tabs">
          <div class="tab ${state.sharesMainTab==='all'?'active':''}" data-main="all">All</div>
          <div class="tab ${state.sharesMainTab==='dynasty'?'active':''}" data-main="dynasty">Dynasty Leagues</div>
          <div class="tab ${state.sharesMainTab==='redraft'?'active':''}" data-main="redraft">Redraft Leagues</div>
        </div>
        ${state.sharesMainTab==='redraft' ? `
        <div class="tabs" style="margin-top:2px;">
          <div class="tab ${state.sharesSubTab==='all'?'active':''}" data-sub="all">All</div>
          <div class="tab ${state.sharesSubTab==='guillotine'?'active':''}" data-sub="guillotine">Guillotine</div>
          <div class="tab ${state.sharesSubTab==='redraft'?'active':''}" data-sub="redraft">Redraft</div>
        </div>` : ''}
        ${state.sharesMainTab==='redraft' && state.sharesSubTab==='redraft' ? `
        <div class="tabs" style="margin-top:2px;">
          <div class="tab ${state.sharesThirdTab==='all'?'active':''}" data-third="all">All</div>
          <div class="tab ${state.sharesThirdTab==='managed'?'active':''}" data-third="managed">Managed</div>
          <div class="tab ${state.sharesThirdTab==='unmanaged'?'active':''}" data-third="unmanaged">Unmanaged</div>
        </div>` : ''}
        <div class="empty-note" style="margin:14px 0;">How many of your leagues in this view (${scopeLeagues.length} league${scopeLeagues.length===1?'':'s'}) each player is on your roster in — includes bench and IR. Percentage is out of leagues that have finished drafting only. Highest share first.</div>
        <div class="field" style="max-width:320px; margin-bottom:18px;">
          <label>Search all waiver players</label>
          <input id="shares-search" type="text" placeholder="e.g. Justin Herbert"/>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"><button class="btn btn-primary" data-share-filter="1">All</button><button class="btn btn-ghost" data-share-filter="2">2+ Leagues</button><button class="btn btn-ghost" data-share-filter="3">3+ Leagues</button><button class="btn btn-ghost" data-share-filter="5">5+ Leagues</button></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"><button class="btn btn-primary" data-position-filter="ALL">All Positions</button><button class="btn btn-ghost" data-position-filter="QB">QB</button><button class="btn btn-ghost" data-position-filter="RB">RB</button><button class="btn btn-ghost" data-position-filter="WR">WR</button><button class="btn btn-ghost" data-position-filter="TE">TE</button></div><div id="shares-list"></div>
      </div>
    `;
    EZL.bindTopbar();

    document.querySelectorAll('[data-main]').forEach(t => t.addEventListener('click', ()=>{
      state.sharesMainTab = t.dataset.main;
      state.sharesSubTab = 'all';
      state.sharesThirdTab = 'all';
      paint();
    }));
    document.querySelectorAll('[data-sub]').forEach(t => t.addEventListener('click', ()=>{
      state.sharesSubTab = t.dataset.sub;
      state.sharesThirdTab = 'all';
      paint();
    }));
    document.querySelectorAll('[data-third]').forEach(t => t.addEventListener('click', ()=>{
      state.sharesThirdTab = t.dataset.third;
      paint();
    }));

    function paintList(query){
      const q = query.trim().toLowerCase();
      const minShares = state.shareMinFilter || 1; const posFilter = state.sharePositionFilter || "ALL"; const base=(q ? list.filter(p => p.info && p.info.name.toLowerCase().includes(q)) : list); const filtered=base.filter(p=>p.count>=minShares).filter(p=>posFilter==="ALL" || (p.info && p.info.pos===posFilter));
      const grouped={QB:[],RB:[],WR:[],TE:[],OTHER:[]}; filtered.forEach(p=>{const k=(p.info&&['QB','RB','WR','TE'].includes(p.info.pos))?p.info.pos:'OTHER'; grouped[k].push(p);}); document.getElementById('shares-list').innerHTML = ['QB','RB','WR','TE','OTHER'].map(pos=>{ const arr=grouped[pos]; if(!arr.length) return ''; return `<div style="margin-bottom:20px;"><div class="roster-group-title">${pos==='OTHER'?'Other Positions':pos+' Exposure'}</div><div class="roster-list">${arr.map(p => `
            <div class="player-row">
              <div class="slot-tag ${EZL.slotColorClass(p.info?p.info.pos:'')}">${p.info?p.info.pos:'?'}</div>
              <div style="flex:1; min-width:0;">
                <div class="player-name ${p.info?EZL.nameColorClass(p.info.pos):''}">${p.info?EZL.playerNameHTML(p.info):p.pid}</div>
                <div style="font-size:11px; color:var(--chalk-faint); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.leagues.join(', ')}</div>
              </div>
              <div style="text-align:right; flex-shrink:0; min-width:74px;">
                <div class="scoreboard-num" style="font-size:22px;">${p.pct.toFixed(0)}%</div>
                <div style="font-size:10px; color:var(--chalk-faint);">${p.count} share${p.count===1?'':'s'}</div>
              </div>
            </div>
          `).join('')}</div></div>`;}).join('') || '<div style="color:var(--chalk-faint); font-size:13px; padding:12px 2px;">No players match your search.</div>';
    }

    paintList('');
    document.getElementById('shares-search').addEventListener('input', (e) => paintList(e.target.value)); document.querySelectorAll('[data-position-filter]').forEach(btn=>btn.addEventListener('click',()=>{state.sharePositionFilter=btn.dataset.positionFilter; document.querySelectorAll('[data-position-filter]').forEach(b=>{b.classList.remove('btn-primary');b.classList.add('btn-ghost');}); btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary'); paintList(document.getElementById('shares-search').value);})); document.querySelectorAll('[data-share-filter]').forEach(btn=>btn.addEventListener('click',()=>{state.shareMinFilter=parseInt(btn.dataset.shareFilter,10); document.querySelectorAll('[data-share-filter]').forEach(b=>{b.classList.remove('btn-primary');b.classList.add('btn-ghost');}); btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary'); paintList(document.getElementById('shares-search').value);}));
  }

  // Entry point app.js calls from the router for the "shares" view.
  async function render(){
    EZL.renderLoading('Building your player shares...');
    await EZL.ensurePlayersLoaded();
    // Load every not-yet-cached league concurrently rather than one at a
    // time — a failed league is simply skipped, same as before.
    await Promise.all(state.leagues.map(async lg => {
      if(!state.leagueDetail[lg.league_id]){
        try{
          state.leagueDetail[lg.league_id] = await EZL.loadLeagueDetail(lg.league_id, state.sleeperUserId);
        }catch(e){ /* league skipped if it fails to load */ }
      }
    }));
    if(!state.sharesMainTab) state.sharesMainTab = 'all';
    if(!state.sharesSubTab) state.sharesSubTab = 'all';
    if(!state.sharesThirdTab) state.sharesThirdTab = 'all';
    paint();
  }

  return { render };
})();
