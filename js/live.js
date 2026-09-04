// Live Hub
// -----------------------------------------------------------------------
// A game-day dashboard: which of your current starters (and your
// opponents', where the league has a head-to-head matchup) are in each
// real NFL game this week, so you know what to have on while you watch.
// Uses each roster's actual starters — not a re-optimized lineup — since
// this is about what's really set on Sleeper right now, not a what-if.
//
// Two ways to browse the same underlying data:
//   - By League: pick a league (grouped into the same categories as the
//     League List/Shares screens — Redraft Managed/Unmanaged, Guillotine,
//     Dynasty, Other), see this week's games and who's starting in each.
//   - By Game: pick one of this week's NFL games, see every league that
//     has a starter in it, broken down the same way.
// Guillotine leagues have no weekly opponent, so they show your starters
// only — no "vs" column — same treatment the Standings tab already gives
// them elsewhere in the app.
//
// Like the other split-out files, this one only talks to app.js through
// window.EZL. Single entry point: Live.render(), called from the router
// for the "liveHub" view.
//
// Load this script AFTER app.js (and after storage.js) in index.html.
// -----------------------------------------------------------------------

window.Live = (function(){

  const EZL = window.EZL;
  const state = EZL.state; // shared object reference — same `state` app.js uses

  // Local UI state for this screen only — deliberately not on EZL.state,
  // since nothing outside this file needs it (same reasoning as
  // guillotine.js's ccStateByLeague). Persists for the session so flipping
  // to another screen and back doesn't reset your place.
  let mode = 'league'; // 'league' | 'game'
  let leagueCategoryTab = null;
  let selectedLeagueId = null;
  let selectedGameKey = null;

  // ---------------- Shared per-league computation ----------------
  // Figures out, for one league, which real NFL game each of your (and
  // your opponent's, if any) starters is playing in this week. Both the
  // By League and By Game views build on this same function rather than
  // two separate traversals of the same rosters.
  function getPlayerGameInfo(pid, week){
    const info = EZL.playerLabel(pid);
    if(!info || !info.team || info.team === 'FA') return {status:'none', info};
    if(EZL.BYE_WEEKS[info.team] === week) return {status:'bye', info};
    const m = EZL.getMatchup(info.team, week);
    if(!m) return {status:'none', info};
    const pair = [info.team, m.opp].sort();
    return {status:'scheduled', info, gameKey: pair.join('-'), gameLabel: pair.join(' vs ')};
  }

  function buildLeagueBreakdown(lg){
    const detail = state.leagueDetail[lg.league_id];
    if(!detail) return null;
    const week = EZL.getProjectionWeek();
    const isGuillotine = EZL.isGuillotineLeague(lg.name);
    const myRoster = detail.rosters.find(r => r.roster_id === detail.myRosterId);
    if(!myRoster) return {lg, error: "Couldn't find your team in this league."};

    let oppRoster = null;
    let notScheduled = false;
    if(!isGuillotine){
      const pair = EZL.findMatchupPair(detail);
      if(!pair || !pair.opp) notScheduled = true;
      else oppRoster = detail.rosters.find(r => r.roster_id === pair.opp.roster_id);
    }

    const games = {};  // gameKey -> {label, mine:[], opp:[]}
    const noGame = {mine: [], opp: []}; // bye or no schedule data

    function fileStarter(pid, side){
      if(!pid) return;
      const g = getPlayerGameInfo(pid, week);
      const proj = EZL.projectedPoints(pid, detail.league);
      const row = {pid, info: g.info, proj};
      if(g.status === 'scheduled'){
        if(!games[g.gameKey]) games[g.gameKey] = {label: g.gameLabel, mine: [], opp: []};
        games[g.gameKey][side].push(row);
      } else {
        noGame[side].push(row);
      }
    }

    (myRoster.starters || []).forEach(pid => fileStarter(pid, 'mine'));
    if(oppRoster) (oppRoster.starters || []).forEach(pid => fileStarter(pid, 'opp'));

    const oppUser = oppRoster ? detail.usersById[oppRoster.owner_id] : null;
    return {lg, isGuillotine, notScheduled, games, noGame, oppUser, oppRoster};
  }

  // ---------------- Shared rendering pieces ----------------
  function playerRowsHTML(rows){
    if(!rows.length) return '<div class="empty-note">None.</div>';
    return rows.map(p => `
      <div class="player-row">
        <div class="slot-tag ${EZL.slotColorClass(p.info?p.info.pos:'')}">${p.info?p.info.pos:'?'}</div>
        <div class="player-name ${p.info?EZL.nameColorClass(p.info.pos):''}" style="flex:1;">${p.info?EZL.playerNameHTML(p.info):p.pid}</div>
        <div class="player-meta mono">${p.proj!=null?p.proj.toFixed(1)+' pts':'—'}</div>
      </div>
    `).join('');
  }

  // Renders one "vs"-style block (or single-sided for guillotine) for a
  // {label, mine, opp} game bucket. Shared by both the By League single-
  // league view and the By Game cross-league breakdown.
  function gameBlockHTML(title, mine, opp, isGuillotine, oppLabel){
    return `
      <div class="section-title" style="margin-top:18px;">${title}</div>
      <div class="matchup-grid" style="align-items:start;">
        <div class="matchup-panel">
          <div class="roster-group-title">Your Starters</div>
          <div class="roster-list">${playerRowsHTML(mine)}</div>
        </div>
        ${isGuillotine ? '' : `
        <div class="matchup-vs">VS</div>
        <div class="matchup-panel">
          <div class="roster-group-title">${oppLabel || "Opponent"}'s Starters</div>
          <div class="roster-list">${playerRowsHTML(opp)}</div>
        </div>`}
      </div>
    `;
  }

  function renderLeagueBreakdownHTML(bd){
    if(bd.error) return `<div class="empty-note">${bd.error}</div>`;
    const oppLabel = bd.oppUser ? EZL.teamDisplayName(bd.oppUser, bd.oppRoster) : 'Opponent';
    const gameKeys = Object.keys(bd.games).sort((a,b) =>
      (bd.games[b].mine.length + bd.games[b].opp.length) - (bd.games[a].mine.length + bd.games[a].opp.length)
    );
    const notScheduledNote = bd.notScheduled
      ? `<div class="empty-note" style="margin-bottom:14px;">Week ${EZL.getProjectionWeek()} matchups haven't been generated for this league yet, so this is showing your starters only — no opponent to compare against.</div>`
      : '';
    const gamesHTML = gameKeys.map(key => gameBlockHTML(bd.games[key].label, bd.games[key].mine, bd.games[key].opp, bd.isGuillotine, oppLabel)).join('');
    const hasNoGame = bd.noGame.mine.length || bd.noGame.opp.length;
    const noGameHTML = hasNoGame ? gameBlockHTML('Bye / No Game Today', bd.noGame.mine, bd.noGame.opp, bd.isGuillotine, oppLabel) : '';
    return `${notScheduledNote}${gamesHTML || '<div class="empty-note">No starters with a scheduled game found.</div>'}${noGameHTML}`;
  }

  // ---------------- By League mode ----------------
  function renderLeaguePickerHTML(){
    const groups = EZL.groupByCategory(state.leagues, lg => lg.name);
    if(!leagueCategoryTab || !groups.find(g => g.category === leagueCategoryTab)){
      leagueCategoryTab = groups.length ? groups[0].category : null;
    }
    const activeGroup = groups.find(g => g.category === leagueCategoryTab) || {items:[]};
    if(!selectedLeagueId || !activeGroup.items.find(l => l.league_id === selectedLeagueId)){
      selectedLeagueId = activeGroup.items.length ? activeGroup.items[0].league_id : null;
    }
    return `
      <div class="tabs">
        ${groups.map(g => `<div class="tab ${g.category===leagueCategoryTab?'active':''}" data-live-cat="${g.category}">${g.category} <span style="opacity:0.6;">(${g.items.length})</span></div>`).join('')}
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin:14px 0;">
        ${activeGroup.items.map(lg => `<button class="btn ${lg.league_id===selectedLeagueId?'btn-primary':'btn-ghost'}" data-live-league="${lg.league_id}" style="font-size:12px;">${lg.name}</button>`).join('') || '<div class="empty-note">No leagues in this category.</div>'}
      </div>
    `;
  }

  function renderByLeagueMode(){
    const pickerHTML = renderLeaguePickerHTML();
    if(!selectedLeagueId) return pickerHTML + '<div class="empty-note">No leagues found.</div>';
    const lg = state.leagues.find(l => l.league_id === selectedLeagueId);
    const bd = buildLeagueBreakdown(lg);
    return pickerHTML + (bd ? renderLeagueBreakdownHTML(bd) : '<div class="loading-row"><div class="spinner"></div> Loading...</div>');
  }

  // ---------------- By Game mode ----------------
  function buildGamesIndex(){
    const index = {}; // gameKey -> {label, leagues:[{lg, mine, opp, isGuillotine, oppUser, oppRoster}]}
    state.leagues.forEach(lg => {
      const bd = buildLeagueBreakdown(lg);
      if(!bd || bd.error) return;
      Object.keys(bd.games).forEach(key => {
        const g = bd.games[key];
        if(!index[key]) index[key] = {label: g.label, leagues: []};
        index[key].leagues.push({lg, mine: g.mine, opp: g.opp, isGuillotine: bd.isGuillotine, oppUser: bd.oppUser, oppRoster: bd.oppRoster});
      });
    });
    return index;
  }

  function renderByGameMode(){
    const index = buildGamesIndex();
    const gameKeys = Object.keys(index).sort((a,b) =>
      index[b].leagues.length - index[a].leagues.length || index[a].label.localeCompare(index[b].label)
    );
    if(!selectedGameKey || !index[selectedGameKey]){
      selectedGameKey = gameKeys.length ? gameKeys[0] : null;
    }
    const listHTML = `
      <div class="overview-list" style="margin-bottom:22px;">
        ${gameKeys.map(key => `
          <div class="overview-row" data-live-game="${key}" ${key===selectedGameKey?'style="border-left-color:var(--gold);"':''}>
            <div class="overview-main">
              <div class="overview-league-name">${index[key].label}</div>
              <div class="overview-payouts">${index[key].leagues.length} league${index[key].leagues.length===1?'':'s'} with a starter in this game</div>
            </div>
          </div>
        `).join('') || '<div class="empty-note">No games with starters found this week.</div>'}
      </div>
    `;
    const header = `<div class="section-title">This Week's Games <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(only games where you have a starter)</span></div>`;
    if(!selectedGameKey) return header + listHTML;

    const chosen = index[selectedGameKey];
    const groups = EZL.groupByCategory(chosen.leagues.map(e => e.lg), lg => lg.name);
    const breakdownHTML = groups.map(g => `
      <div class="section-title" style="margin-top:18px;">${g.category}</div>
      ${g.items.map(lg => {
        const entry = chosen.leagues.find(e => e.lg.league_id === lg.league_id);
        const oppLabel = entry.oppUser ? EZL.teamDisplayName(entry.oppUser, entry.oppRoster) : 'Opponent';
        return `
          <div style="font-size:13px; font-weight:600; color:var(--chalk); margin-bottom:6px;">${lg.name}</div>
          <div class="matchup-grid" style="align-items:start; margin-bottom:18px;">
            <div class="matchup-panel">
              <div class="roster-group-title">Your Starters</div>
              <div class="roster-list">${playerRowsHTML(entry.mine)}</div>
            </div>
            ${entry.isGuillotine ? '' : `
            <div class="matchup-vs">VS</div>
            <div class="matchup-panel">
              <div class="roster-group-title">${oppLabel}'s Starters</div>
              <div class="roster-list">${playerRowsHTML(entry.opp)}</div>
            </div>`}
          </div>
        `;
      }).join('')}
    `).join('');

    return `
      ${header}
      ${listHTML}
      <div class="section-title">${chosen.label} <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${chosen.leagues.length} league${chosen.leagues.length===1?'':'s'})</span></div>
      ${breakdownHTML}
    `;
  }

  // ---------------- Shell ----------------
  function paint(){
    const week = EZL.getProjectionWeek();
    EZL.app.innerHTML = `
      ${EZL.renderTopbar(true)}
      <div class="body-scroll">
        <div class="section-title">Live Hub — Week ${week}</div>
        <div class="empty-note" style="margin-bottom:16px;">See which of your starters — and your opponents' — are in each NFL game this week, so you know what's worth watching. Browse by league, or pick a specific game to see every league it touches.</div>
        <div style="display:flex; gap:6px; margin-bottom:18px;">
          <button class="btn ${mode==='league'?'btn-primary':'btn-ghost'}" id="live-mode-league">By League</button>
          <button class="btn ${mode==='game'?'btn-primary':'btn-ghost'}" id="live-mode-game">By Game</button>
        </div>
        <div id="live-body">${mode==='league' ? renderByLeagueMode() : renderByGameMode()}</div>
      </div>
    `;
    EZL.bindTopbar();
    document.getElementById('live-mode-league').addEventListener('click', () => { mode = 'league'; paint(); });
    document.getElementById('live-mode-game').addEventListener('click', () => { mode = 'game'; paint(); });
    bindModeHandlers();
  }

  function bindModeHandlers(){
    if(mode === 'league'){
      document.querySelectorAll('[data-live-cat]').forEach(t => t.addEventListener('click', () => {
        leagueCategoryTab = t.dataset.liveCat;
        selectedLeagueId = null; // reset so the new category's first league is picked
        paint();
      }));
      document.querySelectorAll('[data-live-league]').forEach(b => b.addEventListener('click', () => {
        selectedLeagueId = b.dataset.liveLeague;
        paint();
      }));
    } else {
      document.querySelectorAll('[data-live-game]').forEach(row => row.addEventListener('click', () => {
        selectedGameKey = row.dataset.liveGame;
        paint();
      }));
    }
  }

  // ---------------- Entry point called from app.js's router ----------------
  async function render(){
    EZL.renderLoading('Building your Live Hub...');
    await Promise.all([EZL.ensurePlayersLoaded(), EZL.ensureProjectionsLoaded().catch(()=>null)]);
    const week = EZL.getProjectionWeek();
    // Load every league's detail + this week's matchups concurrently (same
    // pattern as Matchups.renderOverview) so both modes below can read
    // straight from state.leagueDetail without further round trips.
    await Promise.all(state.leagues.map(async lg => {
      try{
        let detail = state.leagueDetail[lg.league_id];
        if(!detail){
          detail = await EZL.loadLeagueDetail(lg.league_id, state.sleeperUserId);
          state.leagueDetail[lg.league_id] = detail;
        }
        if(!EZL.isGuillotineLeague(lg.name) && !detail.matchupsWeek1){
          try{
            detail.matchupsWeek1 = await EZL.fetchJSON(`https://api.sleeper.app/v1/league/${lg.league_id}/matchups/${week}`);
          }catch(e){
            detail.matchupsWeek1 = [];
          }
        }
      }catch(e){ /* league skipped if it fails to load, same as other cross-league screens */ }
    }));
    paint();
  }

  return { render };
})();
