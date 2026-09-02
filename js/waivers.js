// Waivers
// -----------------------------------------------------------------------
// Two related screens live here:
//   - The global Waiver Hub ("waiverHub" / "waiverHubDetail" views) —
//     cross-league top-5 previews plus a full per-league waiver board,
//     with a personal FAAB bid tracker (not a real Sleeper transaction).
//   - The per-league "Waiver Wire" tab inside a single league's detail
//     view (renderTab), which shares the same candidate-building logic.
//
// Like planner.js and guillotine.js, this file only talks to app.js
// through window.EZL and to storage.js through window.Storage. app.js
// calls into this file at three points: the router (for the two
// "waiverHub*" views) and the per-league tab dispatch (renderTab).
//
// Load this script AFTER app.js (and after storage.js) in index.html.
// -----------------------------------------------------------------------

window.Waivers = (function(){

  const EZL = window.EZL;
  const state = EZL.state; // shared object reference — same `state` app.js uses

  const WAIVER_POSITIONS = ['QB','RB','WR','TE','K','DEF'];

  // ---------------- Shared candidate-building ----------------
  // Used by both the per-league Waiver Wire tab and (indirectly, via the
  // full waiver board) the Waiver Hub detail screen.
  function buildWaiverCandidatesByPosition(detail){
    const owned = EZL.computeOwnedPlayerIds(detail);
    const trendingMap = {};
    (state.trendingCache || []).forEach(t => trendingMap[t.player_id] = t.count);
    const proj = state.projectionsCache;
    const groups = {};
    WAIVER_POSITIONS.forEach(p => groups[p] = []);

    if(proj){
      Object.keys(proj.byPlayer).forEach(pid => {
        if(owned.has(pid)) return;
        const info = EZL.playerLabel(pid);
        if(!info || !groups[info.pos]) return;
        const pts = EZL.projectedPoints(pid, detail.league);
        if(pts == null) return;
        groups[info.pos].push({...info, pid, proj: pts, adds: trendingMap[pid] || 0});
      });
    } else {
      // Projections didn't load this session (undocumented endpoint) — fall back to trending adds only.
      (state.trendingCache || []).forEach(t => {
        if(owned.has(t.player_id)) return;
        const info = EZL.playerLabel(t.player_id);
        if(!info || !groups[info.pos]) return;
        groups[info.pos].push({...info, pid: t.player_id, proj: null, adds: t.count});
      });
    }

    Object.keys(groups).forEach(pos => {
      groups[pos].sort((a,b) => {
        if(a.proj != null && b.proj != null) return b.proj - a.proj;
        if(a.proj != null) return -1;
        if(b.proj != null) return 1;
        return b.adds - a.adds;
      });
    });
    return {groups, proj};
  }

  // ---------------- Per-league Waiver Wire tab ----------------
  function renderWaiverWireTab(detail){
    const {groups, proj} = buildWaiverCandidatesByPosition(detail);

    const sectionsHTML = WAIVER_POSITIONS.filter(pos => groups[pos].length).map(pos => {
      const top = groups[pos].slice(0, 8);
      return `
        <div style="margin-bottom:22px;">
          <div class="roster-group-title">${pos}</div>
          <div class="roster-list">
            ${top.map(p => `
              <div class="player-row">
                <div class="slot-tag ${EZL.slotColorClass(pos)}">${pos}</div>
                <div class="player-name ${EZL.nameColorClass(pos)}">${EZL.playerNameHTML(p)}</div>
                <div class="player-meta">${p.team}${p.proj!=null ? ` · <span style="color:var(--gold);">Proj ${p.proj.toFixed(1)}</span>` : ''}${p.adds ? ` · +${p.adds} adds (48h)` : ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    const projNote = proj
      ? `Ranked by Week ${proj.week} (${proj.season}) projections, scored to match this league's format — Sleeper-wide waiver-add counts from the last 48 hours are shown alongside for context.`
      : `Projections didn't load this session, so this is ranked by Sleeper-wide waiver-add counts from the last 48 hours instead.`;

    return `
      <div class="empty-note" style="margin-bottom:16px;">
        ${projNote} Points are calculated from the raw projected stat line using this league's exact scoring settings, the same way Sleeper's own app does it. Projections themselves come from an undocumented Sleeper endpoint though (not part of their official API), and update on their own schedule — so if a number still looks off versus the Sleeper app, it's most likely the underlying projection having refreshed since this session loaded, not the scoring math. Players already rostered in this league are excluded.
      </div>
      ${sectionsHTML || '<div style="color:var(--chalk-faint); font-size:13px; padding:8px 2px;">No waiver candidates found.</div>'}
    `;
  }

  // Entry point app.js calls from the per-league "waiver" tab dispatch.
  async function renderTab(detail, contentEl){
    await Promise.all([EZL.ensurePlayersLoaded(), EZL.ensureTrendingLoaded(), EZL.ensureProjectionsLoaded().catch(()=>null)]);
    contentEl.innerHTML = renderWaiverWireTab(detail);
  }

  // ---------------- Waiver Hub (cross-league) ----------------
  async function renderHub(){
    EZL.renderLoading('Pulling waiver targets across your leagues...');
    await Promise.all([EZL.ensurePlayersLoaded(), EZL.ensureTrendingLoaded(), EZL.ensureProjectionsLoaded().catch(()=>null)]);
    if(!state.waiverBids) state.waiverBids = await window.Storage.loadWaiverBids();
    const week = EZL.getProjectionWeek();
    const guillotineLeagues = [];
    const redraftLeagues = [];
    const dynastyLeagues = [];
    // Build every eligible league's top-5 preview concurrently rather than
    // one at a time, then sort the resolved entries into their category
    // buckets afterward — same skip-on-failure behavior as before.
    const eligibleLeagues = state.leagues.filter(lg => EZL.categoryForLeagueName(lg.name) !== 'Redraft (Unmanaged)');
    const built = await Promise.all(eligibleLeagues.map(async lg => {
      const category = EZL.categoryForLeagueName(lg.name);
      try{
        let detail = state.leagueDetail[lg.league_id];
        if(!detail){ detail = await EZL.loadLeagueDetail(lg.league_id, state.sleeperUserId); state.leagueDetail[lg.league_id] = detail; }
        const owned = EZL.computeOwnedPlayerIds(detail);
        const candidates = [];
        if(state.projectionsCache){
          Object.keys(state.projectionsCache.byPlayer).forEach(pid => {
            if(owned.has(pid)) return;
            const info = EZL.playerLabel(pid);
            if(!info) return;
            const pts = EZL.projectedPoints(pid, detail.league);
            if(pts == null) return;
            candidates.push({pid, info, proj: pts});
          });
        }
        candidates.sort((a,b)=>b.proj-a.proj);
        return {category, entry: {lg, top5:candidates.slice(0,5)}};
      }catch(e){
        return {category, entry: null};
      }
    }));
    built.forEach(({category, entry}) => {
      if(!entry) return;
      if(category === 'Guillotine Leagues') guillotineLeagues.push(entry);
      else if(category === 'Dynasty Leagues') dynastyLeagues.push(entry);
      else if(category === 'Redraft (Managed)') redraftLeagues.push(entry);
    });
    EZL.app.innerHTML = `
      ${EZL.renderTopbar(true)}
      <div class="body-scroll">
        <div class="section-title">Waiver Wire — Week ${week}</div>

        <div class="section-title">Guillotine Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${guillotineLeagues.length})</span></div>
        <div class="overview-list" style="margin-bottom:26px;">${guillotineLeagues.map(renderHubLeagueCard).join('')}</div>

        <div class="section-title">Redraft Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${redraftLeagues.length})</span></div>
        <div class="overview-list" style="margin-bottom:26px;">${redraftLeagues.map(renderHubLeagueCard).join('')}</div>

        <div class="section-title">Dynasty Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${dynastyLeagues.length})</span></div>
        <div class="overview-list" style="margin-bottom:26px;">${dynastyLeagues.map(renderHubLeagueCard).join('')}</div>

        <div class="section-title">Your Bids This Week (Week ${week})</div>
        <div id="waiver-bids-summary">${renderBidsSummary(week)}</div>
      </div>`;
    EZL.bindTopbar();
    bindHub();
  }

  function renderHubLeagueCard({lg, top5, error}){
    if(error) return '';
    const best = top5 && top5.length ? top5[0] : null;
    const detail = state.leagueDetail[lg.league_id];
    const myRoster = detail ? detail.rosters.find(r=>r.roster_id===detail.myRosterId) : null;
    const faab = detail && myRoster ? ((detail.league.settings?.waiver_budget||0) - (myRoster.settings?.waiver_budget_used||0)) : null;
    const bids = (state.waiverBids||[]).filter(b=>b.leagueId===lg.league_id && b.week===EZL.getProjectionWeek()).length;
    return `<div class="overview-row" id="waiver-open-${lg.league_id}">
      <div class="overview-main">
      <div class="overview-league-name">${lg.name}</div>
      <div class="overview-payouts">${best ? `Best available: ${best.info.name} (${best.proj.toFixed(1)} pts)` : 'Open waiver board'}</div>
      </div>
      <div style="text-align:right;">
        ${faab!==null?`<div style="font-size:12px;color:var(--gold);">FAAB: $${faab}</div>`:''}
        <div style="font-size:11px;color:var(--chalk-dim);">${bids} staged bid${bids===1?'':'s'}</div>
      </div>
    </div>`;
  }

  function renderBidsSummary(week){
    const bids = (state.waiverBids||[]).filter(b => b.week === week);
    if(!bids.length) return '<div style="color:var(--chalk-faint); font-size:12px;">No bids staged for this week yet.</div>';
    const total = bids.reduce((s,b) => s + (parseFloat(b.amount)||0), 0);
    return `
      <div class="overview-list">
        ${bids.map(b => {
          const info = EZL.playerLabel(b.playerId);
          return `
            <div class="overview-row" style="cursor:default;">
              <div class="overview-main">
                <div class="overview-league-name">${info?info.name:b.playerId}</div>
                <div class="overview-payouts">${b.leagueName} · $${(parseFloat(b.amount)||0).toFixed(0)} FAAB</div>
              </div>
              <button class="btn-danger-ghost" data-remove-bid="${b.id}">Remove</button>
            </div>
          `;
        }).join('')}
      </div>
      <div class="empty-note" style="margin-top:10px;">Total staged: $${total.toFixed(0)} across ${bids.length} bid${bids.length===1?'':'s'}.</div>
    `;
  }

  function bindHub(){
    const week = EZL.getProjectionWeek();
    state.leagues.forEach(lg => {
      const el = document.getElementById('waiver-open-' + lg.league_id);
      if(el) el.addEventListener('click', () => {
        state.waiverHubLeagueId = lg.league_id;
        state.view = 'waiverHubDetail';
        EZL.render();
      });
    });
    document.querySelectorAll('[data-stage-bid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.stageBid;
        const leagueId = btn.dataset.leagueId;
        const leagueName = btn.dataset.leagueName;
        const rowEl = document.getElementById('waiver-row-' + leagueId + '-' + playerId);
        if(!rowEl) return;
        rowEl.innerHTML = `
          <div style="flex:1; font-size:12px;">FAAB amount for this bid:</div>
          <input type="number" min="0" id="bid-amount-input" style="width:80px; background:var(--bg); border:1px solid var(--line-strong); color:var(--chalk); padding:6px 8px; border-radius:6px; font-family:'IBM Plex Mono',monospace;"/>
          <button class="btn btn-primary" id="bid-confirm-btn" style="font-size:11px; padding:5px 10px; margin-left:8px;">Confirm</button>
          <button class="btn btn-ghost" id="bid-cancel-btn" style="font-size:11px; padding:5px 10px;">Cancel</button>
        `;
        document.getElementById('bid-confirm-btn').addEventListener('click', async () => {
          const amount = document.getElementById('bid-amount-input').value;
          if(amount === '') return;
          if(!state.waiverBids) state.waiverBids = [];
          state.waiverBids.push({id: Date.now()+'-'+Math.random().toString(36).slice(2), week, leagueId, leagueName, playerId, amount});
          await window.Storage.saveWaiverBids(state.waiverBids);
          EZL.toast('Bid staged');
          const summaryEl = document.getElementById('waiver-bids-summary');
          if(summaryEl) summaryEl.innerHTML = renderBidsSummary(week);
          bindBidRemovals();
          EZL.render();
        });
        document.getElementById('bid-cancel-btn').addEventListener('click', () => EZL.render());
      });
    });
    bindBidRemovals();
  }

  function bindBidRemovals(){
    document.querySelectorAll('[data-remove-bid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.removeBid;
        state.waiverBids = (state.waiverBids||[]).filter(b => b.id !== id);
        await window.Storage.saveWaiverBids(state.waiverBids);
        document.getElementById('waiver-bids-summary').innerHTML = renderBidsSummary(EZL.getProjectionWeek());
        bindBidRemovals();
      });
    });
  }

  // ---------------- Waiver Hub detail (single league, full board) ----------------
  function renderHubDetail(){
    const lg = state.leagues.find(l => l.league_id === state.waiverHubLeagueId);
    const detail = state.leagueDetail[state.waiverHubLeagueId];
    if(!lg || !detail){
      return renderHub();
    }
    const week = EZL.getProjectionWeek();
    const {groups} = buildWaiverCandidatesByPosition(detail);

    EZL.app.innerHTML = `
      ${EZL.renderTopbar(true)}
      <div class="body-scroll">
        <button class="btn btn-ghost" id="btn-back-to-waiverhub" style="margin-bottom:14px;">← All Leagues Waiver Wire</button>
        <div class="section-title">${lg.name} — Full Waiver Board (Week ${week})</div>
        <div class="field" style="max-width:320px; margin-bottom:10px;">
         <label>Search all waiver players</label>
          <input id="waiver-detail-search" type="text" placeholder="e.g. player name"/>
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
         <button class="btn btn-ghost btn-mini" data-waiver-filter="ALL">ALL</button>
         <button class="btn btn-ghost btn-mini" data-waiver-filter="QB">QB</button>
         <button class="btn btn-ghost btn-mini" data-waiver-filter="RB">RB</button>
         <button class="btn btn-ghost btn-mini" data-waiver-filter="WR">WR</button>
         <button class="btn btn-ghost btn-mini" data-waiver-filter="TE">TE</button>
        </div>

        <div id="waiver-detail-results" style="max-height:640px; overflow-y:auto; padding-right:4px;"></div>
      </div>
    `;
    EZL.bindTopbar();
    document.getElementById('btn-back-to-waiverhub').addEventListener('click', () => {
      state.view = 'waiverHub';
      EZL.render();
    });
    let waiverPositionFilter = 'ALL';
    function paint(query){
      const q = query.trim().toLowerCase();
      const resultsEl = document.getElementById('waiver-detail-results');
      const html = WAIVER_POSITIONS
        .filter(pos => groups[pos].length)
       .filter(pos => waiverPositionFilter === 'ALL' || pos === waiverPositionFilter)
        .map(pos => {
        const filtered = q ? groups[pos].filter(p => p.name.toLowerCase().includes(q)) : groups[pos];
        if(!filtered.length) return '';
        return `
          <div style="margin-bottom:22px;">
            <div class="roster-group-title">${pos}${q ? ` <span style="text-transform:none; letter-spacing:0; color:var(--chalk-faint);">(${filtered.length} match${filtered.length===1?'':'es'})</span>` : ''}</div>
            <div class="roster-list">
              ${filtered.map(p => `
                <div class="player-row" id="waiver-row-${lg.league_id}-${p.pid}">
                  <div class="slot-tag ${EZL.slotColorClass(pos)}">${pos}</div>
                  <div class="player-name ${EZL.nameColorClass(pos)}" style="flex:1;">${EZL.playerNameHTML(p)} <span style="color:var(--chalk-faint); font-size:11px;">${p.team}</span></div>
                  <div class="player-meta" style="width:170px;">${p.proj!=null ? `<span style="color:var(--gold);">Proj ${p.proj.toFixed(1)}</span>` : ''}${p.adds ? ` · +${p.adds} adds` : ''}</div>
                  <button class="btn btn-primary" data-stage-bid="${p.pid}" data-league-id="${lg.league_id}" data-league-name="${lg.name}" style="font-size:11px; padding:5px 10px;">Bid</button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');
      resultsEl.innerHTML = html || '<div style="color:var(--chalk-faint); font-size:13px;">No matching players.</div>';
      // Rebinds the stage-bid buttons in the freshly-painted results (this
      // also re-attaches the league-card and bid-removal handlers from the
      // hub screen underneath, which is harmless — same behavior as the
      // original single-file version).
      bindHub();
    }

    paint('');

    document.getElementById('waiver-detail-search')
      .addEventListener('input', (e) => paint(e.target.value));

    document.querySelectorAll('[data-waiver-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        waiverPositionFilter = btn.dataset.waiverFilter;
        document.querySelectorAll('[data-waiver-filter]').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-ghost');
        });
        btn.classList.remove('btn-ghost');
        btn.classList.add('btn-primary');
        paint(document.getElementById('waiver-detail-search').value);
      });
    });
  }

  return { renderHub, renderHubDetail, renderTab };
})();
