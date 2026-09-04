// Matchups
// -----------------------------------------------------------------------
// Two related screens live here:
//   - The cross-league Matchups overview ("matchups" view) — head-to-head
//     projected totals for every redraft/dynasty league, plus a
//     no-opponent projected-rank view for guillotine leagues.
//   - The per-league "Week N Matchup" tab (renderTab) inside a single
//     league's detail view — the interactive lineup-vs-lineup comparison
//     with swappable player slots.
//
// Both build on the shared lineup engine (computeOptimalLineup,
// SLOT_ELIGIBILITY, lineupTotal, etc.) that stays in app.js/EZL, since
// planner.js and guillotine.js depend on it too — it isn't owned by this
// file, just used by it.
//
// Like the other split-out files, this one only talks to app.js through
// window.EZL. app.js calls in at two points: the router (for the
// "matchups" view) and the per-league tab dispatch (renderTab).
//
// Load this script AFTER app.js (and after storage.js) in index.html.
// -----------------------------------------------------------------------

window.Matchups = (function(){

  const EZL = window.EZL;
  const state = EZL.state; // shared object reference — same `state` app.js uses

  function median(arr){
    if(!arr.length) return null;
    const sorted = [...arr].sort((a,b) => a-b);
    const mid = Math.floor(sorted.length/2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
  }

  // findMatchupPair moved to app.js (EZL.findMatchupPair) once live.js
  // needed the exact same this-week's-opponent lookup — see app.js's
  // SHARED CHECKS section rather than a second copy here.

  // ---------------- Cross-league Matchups overview ----------------
  async function renderOverview(){
    EZL.renderLoading('Pulling Week ' + EZL.getProjectionWeek() + ' matchups...');
    await Promise.all([EZL.ensurePlayersLoaded(), EZL.ensureProjectionsLoaded().catch(()=>null)]);
    // Fetch/process every league concurrently instead of one at a time —
    // each iteration was a handful of sequential network round trips, so
    // with many leagues this was the biggest single wait in the app.
    const rows = [];
    const guillotineRows = [];
    const results = await Promise.all(state.leagues.map(async lg => {
      try{
        let detail = state.leagueDetail[lg.league_id];
        if(!detail){
          detail = await EZL.loadLeagueDetail(lg.league_id, state.sleeperUserId);
          state.leagueDetail[lg.league_id] = detail;
        }

        if(EZL.isGuillotineLeague(lg.name)){
          if(!EZL.isDraftComplete(detail)){
            return {bucket:'guillotine', row:{lg, notDrafted:true}};
          }
          const cutSet = new Set(detail.cutRosters || []);
          if(cutSet.has(detail.myRosterId)){
            return {bucket:'guillotine', row:{lg, cut:true}};
          }
          const aliveRosters = detail.rosters.filter(r => !cutSet.has(r.roster_id));
          const aliveTotals = aliveRosters.map(r => {
            const opt = EZL.computeOptimalLineup(r, detail.league);
            return {roster_id: r.roster_id, total: EZL.lineupTotal(opt.assignment, opt.pool)};
          }).sort((a,b) => b.total - a.total);
          const myEntry = aliveTotals.find(t => t.roster_id === detail.myRosterId);
          if(!myEntry){
            return {bucket:'guillotine', row:{lg, error: "Couldn't find your team in this league"}};
          }
          const rank = aliveTotals.findIndex(t => t.roster_id === detail.myRosterId) + 1;
          return {bucket:'guillotine', row:{lg, myTotal: myEntry.total, rank, aliveCount: aliveTotals.length}};
        }

        if(!detail.matchupsWeek1){
          try{
            detail.matchupsWeek1 = await EZL.fetchJSON(`https://api.sleeper.app/v1/league/${lg.league_id}/matchups/${EZL.getProjectionWeek()}`);
          }catch(e){
            detail.matchupsWeek1 = [];
          }
        }
        const pair = EZL.findMatchupPair(detail);
        if(!pair || !pair.opp){
          return {bucket:'normal', row:{lg, notScheduled: true}};
        }
        const myRoster = detail.rosters.find(r => r.roster_id === pair.mine.roster_id);
        const oppRoster = detail.rosters.find(r => r.roster_id === pair.opp.roster_id);
        const oppUser = detail.usersById[oppRoster.owner_id];
        const myOpt = EZL.computeOptimalLineup(myRoster, detail.league);
        const oppOpt = EZL.computeOptimalLineup(oppRoster, detail.league);
        const myTotal = EZL.lineupTotal(myOpt.assignment, myOpt.pool);
        const oppTotal = EZL.lineupTotal(oppOpt.assignment, oppOpt.pool);
        const allTotals = detail.rosters.map(r => {
          const opt = EZL.computeOptimalLineup(r, detail.league);
          return EZL.lineupTotal(opt.assignment, opt.pool);
        });
        const leagueMedian = median(allTotals);
        return {bucket:'normal', row:{lg, oppName: EZL.teamDisplayName(oppUser, oppRoster), oppUser, myTotal, oppTotal, leagueMedian}};
      }catch(e){
        if(EZL.isGuillotineLeague(lg.name)){
          return {bucket:'guillotine', row:{lg, error: e.message || 'Failed to load'}};
        } else {
          return {bucket:'normal', row:{lg, error: e.message || 'Failed to load'}};
        }
      }
    }));
    results.forEach(({bucket, row}) => {
      if(bucket === 'guillotine') guillotineRows.push(row);
      else rows.push(row);
    });

    const groups = EZL.groupByCategory(rows, r => r.lg.name);
    EZL.app.innerHTML = `
      ${EZL.renderTopbar(true)}
      <div class="body-scroll">
        <div class="section-title">Week ${EZL.getProjectionWeek()} Matchups</div>
        <div class="empty-note" style="margin-bottom:18px;">Both totals are each team's best possible Week ${EZL.getProjectionWeek()} lineup based on Sleeper's projections. Green means you're currently projected ahead, red means behind. Click any matchup to open it and adjust lineups.</div>
        ${groups.map(g => `
          <div class="section-title">${g.category} <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${g.items.length})</span></div>
          <div class="overview-list" style="margin-bottom:26px;">
            ${g.items.map(renderSummaryRow).join('')}
          </div>
        `).join('')}
        ${guillotineRows.length ? `
          <div class="section-title">Guillotine Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${guillotineRows.length})</span></div>
          <div class="empty-note" style="margin-bottom:14px;">No head-to-head opponent here — just your predicted Week ${EZL.getProjectionWeek()} score and where that ranks you among teams still in.</div>
          <div class="overview-list" style="margin-bottom:26px;">
            ${guillotineRows.map(renderGuillotineRow).join('')}
          </div>
        ` : ''}
      </div>
    `;
    EZL.bindTopbar();
    rows.forEach(r => {
      if(r.error || r.notScheduled) return;
      const el = document.getElementById('mu-' + r.lg.league_id);
      if(el) el.addEventListener('click', ()=>{
        state.currentLeagueId = r.lg.league_id;
        state.currentTab = 'matchup';
        state.view = 'league';
        EZL.render();
      });
    });
    guillotineRows.forEach(r => {
      if(r.error || r.cut) return;
      const el = document.getElementById('mug-' + r.lg.league_id);
      if(el) el.addEventListener('click', ()=>{
        state.currentLeagueId = r.lg.league_id;
        state.currentTab = 'standings';
        state.view = 'league';
        EZL.render();
      });
    });
  }

  function renderGuillotineRow(r){
    if(r.error){
      return `
        <div class="overview-row" style="border-left-color:var(--alert); cursor:default;">
          <div class="overview-main">
            <div class="overview-league-name">${r.lg.name}</div>
            <div style="color:#E08A63; font-size:12px;">Couldn't load — ${r.error}</div>
          </div>
        </div>
      `;
    }
    if(r.notDrafted){
      return `
        <div class="overview-row" style="cursor:default;">
          <div class="overview-main">
            <div class="overview-league-name">${r.lg.name}</div>
            <div style="color:var(--chalk-faint); font-size:12px;">Draft not complete yet — no score to predict</div>
          </div>
        </div>
      `;
    }
    if(r.cut){
      return `
        <div class="overview-row" style="cursor:default; opacity:0.6;">
          <div class="overview-main">
            <div class="overview-league-name">${r.lg.name}</div>
            <div style="color:var(--chalk-faint); font-size:12px;">You've been cut — no Week ${EZL.getProjectionWeek()} projection to show</div>
          </div>
        </div>
      `;
    }
    const isLast = r.rank === r.aliveCount;
    const inBottomQuarter = r.rank > r.aliveCount * 0.75;
    const scoreColor = isLast ? '#E85C4A' : (inBottomQuarter ? '#E0A458' : '#7FBF8E');
    return `
      <div class="overview-row" id="mug-${r.lg.league_id}">
        <div class="overview-main">
          <div class="overview-league-name">${r.lg.name}</div>
          <div class="overview-payouts">Predicted Week ${EZL.getProjectionWeek()} score</div>
        </div>
        <div style="text-align:right;">
          <div class="scoreboard-num" style="color:${scoreColor};">${r.myTotal.toFixed(1)}</div>
          <div style="font-size:11px; color:var(--chalk-dim);">#${r.rank} (${r.aliveCount} left)</div>
        </div>
      </div>
    `;
  }

  function renderSummaryRow(r){
    if(r.error){
      return `
        <div class="overview-row" style="border-left-color:var(--alert);">
          <div class="overview-main">
            <div class="overview-league-name">${r.lg.name}</div>
            <div style="color:#E08A63; font-size:12px;">Couldn't load — ${r.error}</div>
          </div>
        </div>
      `;
    }
    if(r.notScheduled){
      return `
        <div class="overview-row" style="cursor:default;">
          <div class="overview-main">
            <div class="overview-league-name">${r.lg.name}</div>
            <div style="color:var(--chalk-faint); font-size:12px;">Week ${EZL.getProjectionWeek()} matchup not scheduled yet</div>
          </div>
        </div>
      `;
    }
    const diff = r.myTotal - r.oppTotal;
    const myColor = diff >= 0 ? '#7FBF8E' : '#E85C4A';
    const oppColor = diff < 0 ? '#7FBF8E' : '#E85C4A';
    return `
      <div class="overview-row" id="mu-${r.lg.league_id}">
        <div class="overview-main">
          <div class="overview-league-name">${r.lg.name}</div>
          <div class="overview-payouts">vs ${r.oppName}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          <div style="display:flex; gap:18px;">
            <div class="overview-stat">
              <div class="overview-stat-label">You</div>
              <div class="scoreboard-num" style="color:${myColor};">${r.myTotal.toFixed(1)}</div>
            </div>
            <div class="overview-stat">
              <div class="overview-stat-label">Opponent</div>
              <div class="scoreboard-num" style="color:${oppColor};">${r.oppTotal.toFixed(1)}</div>
            </div>
          </div>
          ${r.leagueMedian != null ? `<div style="color:var(--chalk); font-size:11px;">League median: ${r.leagueMedian.toFixed(1)} pts</div>` : ''}
        </div>
      </div>
    `;
  }

  // ---------------- Per-league Matchup tab ----------------
  function renderPanel(teamKey, opt, league){
    const total = EZL.lineupTotal(opt.assignment, opt.pool);
    const usedElsewhereBase = opt.assignment;
    const rowsHTML = opt.slotOrder.map((slot, i) => {
      const pid = opt.assignment[i];
      const eligible = EZL.SLOT_ELIGIBILITY[slot] || [slot];
      const usedElsewhere = new Set(usedElsewhereBase.filter((v, idx) => idx !== i && v));
      const candidates = opt.pool
        .filter(p => eligible.includes(p.pos))
        .filter(p => !usedElsewhere.has(p.pid) || p.pid === pid)
        .sort((a,b) => b.proj - a.proj);
      const optionsHTML = candidates.map(p => `<option value="${p.pid}" ${p.pid===pid?'selected':''}>${p.info?p.info.name:p.pid} (${p.pos}) — ${p.hasProj?p.proj.toFixed(1):'—'} pts</option>`).join('');
      const chosen = opt.pool.find(p => p.pid === pid);
      const ptsDisplay = chosen ? (chosen.hasProj ? chosen.proj.toFixed(1) : '—') : '0.0';
      return `
        <div class="matchup-slot-row">
          <div class="slot-tag ${EZL.slotColorClass(slot)}">${EZL.slotLabel(slot)}</div>
          <select class="matchup-select" data-team="${teamKey}" data-slot="${i}">
            ${!pid ? '<option value="" selected>— Empty —</option>' : ''}${optionsHTML}
          </select>
          <div class="mono" style="width:48px; text-align:right; color:var(--chalk-dim); font-size:12px;">${ptsDisplay}</div>
        </div>
      `;
    }).join('');

    const usedSet = new Set(opt.assignment.filter(Boolean));
    const bench = opt.pool.filter(p => !usedSet.has(p.pid)).sort((a,b) => b.proj - a.proj);
    const benchHTML = bench.length ? bench.map(p => `
      <div class="matchup-slot-row">
        <div class="slot-tag tag-grey">BN</div>
        <div class="player-name ${EZL.nameColorClass(p.pos)}" style="flex:1; font-size:12.5px;">${p.info ? EZL.playerNameHTML(p.info) : p.pid}</div>
        <div class="mono" style="width:48px; text-align:right; color:var(--chalk-dim); font-size:12px;">${p.hasProj ? p.proj.toFixed(1) : '—'}</div>
      </div>
    `).join('') : '<div style="color:var(--chalk-faint); font-size:12px; padding:4px 0;">Nobody left on the bench.</div>';

    return `
      <div class="matchup-panel" id="matchup-panel-${teamKey}">
        <div class="matchup-panel-header">
          ${EZL.avatarHTML(opt.user && opt.user.avatar, opt.user && opt.user.display_name, 32)}
          <div>
            <div class="matchup-team-name">${opt.teamName}</div>
            <div class="owner-name">${opt.user ? opt.user.display_name : 'Unknown'}</div>
          </div>
        </div>
        <div class="matchup-total" id="matchup-total-${teamKey}">${total.toFixed(1)}<span style="font-size:12px; color:var(--chalk-faint); font-family:'Inter',sans-serif;"> pts</span></div>
        <div class="matchup-slots">${rowsHTML}</div>
        <div class="roster-group-title" style="margin-top:16px;">Bench</div>
        <div class="matchup-slots">${benchHTML}</div>
      </div>
    `;
  }

  function renderMatchupTab(detail){
    if(!detail.myRosterId){
      return `<div class="empty-note">Couldn't find your team in this league.</div>`;
    }
    const pair = EZL.findMatchupPair(detail);
    if(!pair || !pair.opp){
      detail.matchupState = null;
      return `<div class="empty-note">Week ${EZL.getProjectionWeek()} matchups haven't been generated for this league yet — Sleeper publishes the schedule closer to the season starting. Check back later.</div>`;
    }
    const myRoster = detail.rosters.find(r => r.roster_id === pair.mine.roster_id);
    const oppRoster = detail.rosters.find(r => r.roster_id === pair.opp.roster_id);
    const myUser = detail.usersById[myRoster.owner_id];
    const oppUser = detail.usersById[oppRoster.owner_id];

    detail.matchupState = {
      my: {...EZL.computeOptimalLineup(myRoster, detail.league), teamName: EZL.teamDisplayName(myUser, myRoster) + ' (You)', user: myUser},
      opp: {...EZL.computeOptimalLineup(oppRoster, detail.league), teamName: EZL.teamDisplayName(oppUser, oppRoster), user: oppUser},
    };

    return `
      <div class="empty-note" style="margin-bottom:14px;">Both lineups are auto-built from Week ${EZL.getProjectionWeek()} projections into each team's best possible starting lineup. Use the dropdowns to swap any player and see how each total — and the edge — changes.</div>
      <div id="matchup-edge" style="margin-bottom:14px;"></div>
      <div class="matchup-grid">
        ${renderPanel('my', detail.matchupState.my, detail.league)}
        <div class="matchup-vs">VS</div>
        ${renderPanel('opp', detail.matchupState.opp, detail.league)}
      </div>
    `;
  }

  function bindMatchupTab(detail){
    if(!detail.matchupState) return;

    function updateEdge(){
      const edgeEl = document.getElementById('matchup-edge');
      if(!edgeEl) return;
      const myTotal = EZL.lineupTotal(detail.matchupState.my.assignment, detail.matchupState.my.pool);
      const oppTotal = EZL.lineupTotal(detail.matchupState.opp.assignment, detail.matchupState.opp.pool);
      const diff = myTotal - oppTotal;
      if(Math.abs(diff) < 0.05){
        edgeEl.innerHTML = `<span class="pill">Dead even</span>`;
      } else if(diff > 0){
        edgeEl.innerHTML = `<span class="pill" style="background:rgba(127,191,142,0.15); color:#7FBF8E;">You're projected ahead by ${diff.toFixed(1)} pts</span>`;
      } else {
        edgeEl.innerHTML = `<span class="pill" style="background:rgba(232,92,74,0.15); color:#E85C4A;">Behind by ${Math.abs(diff).toFixed(1)} pts</span>`;
      }
    }

    function bindPanel(teamKey){
      document.querySelectorAll(`select[data-team="${teamKey}"]`).forEach(sel => {
        sel.addEventListener('change', () => {
          const slotIdx = parseInt(sel.dataset.slot, 10);
          detail.matchupState[teamKey].assignment[slotIdx] = sel.value || null;
          const panelEl = document.getElementById('matchup-panel-' + teamKey);
          panelEl.outerHTML = renderPanel(teamKey, detail.matchupState[teamKey], detail.league);
          bindPanel(teamKey);
          updateEdge();
        });
      });
    }

    bindPanel('my');
    bindPanel('opp');
    updateEdge();
  }

  // Entry point app.js calls from the per-league "matchup" tab dispatch.
  async function renderTab(detail, contentEl){
    await Promise.all([EZL.ensurePlayersLoaded(), EZL.ensureProjectionsLoaded().catch(()=>null)]);
    if(!detail.matchupsWeek1){
      try{
        detail.matchupsWeek1 = await EZL.fetchJSON(`https://api.sleeper.app/v1/league/${state.currentLeagueId}/matchups/${EZL.getProjectionWeek()}`);
      }catch(e){
        detail.matchupsWeek1 = [];
      }
    }
    contentEl.innerHTML = renderMatchupTab(detail);
    bindMatchupTab(detail);
  }

  return { renderOverview, renderTab };
})();
