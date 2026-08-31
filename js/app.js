// Main application bootstrap
(function(){
  /* =====================================================================
     TABLE OF CONTENTS — grep the label in CAPS to jump to a section.
     Kept in file order. Update this if functions are moved/renamed.
     ---------------------------------------------------------------------
     STATE            state object, app root
     TOAST/FETCH       toast(), fetchJSON()
     STORAGE           settings / payouts / cut-rosters localStorage helpers
     ICONS             GUILLOTINE_ICON, robotIcon(), SLEEPER_LOGO_B64
     PLAYER HELPERS    initials, avatarHTML, teamDisplayName, playerLabel,
                       playerNameHTML, nameColorClass
     DATA LOADING      ensurePlayersLoaded, ensureTrendingLoaded,
                       ensureNflState, getProjectionWeek/setProjectionWeek,
                       ensureProjectionsLoaded, projectedPoints,
                       loadLeaguesForUser, loadLeagueDetail
     STANDINGS MATH    fpts, computeStandings, median
     ROUTER            render()
     SCREEN: setup     renderLoading, renderErrorBanner, renderSetup,
                       onSetupSubmit
     TOPBAR            renderTopbar, bindTopbar
     LEAGUE CATEGORIES categoryForLeagueName, groupByCategory,
                       isGuillotineLeague, isDynastyLeague, isFreeLeague
     SCREEN: leagues   renderLeagueList, paintLeagueList, renderLeagueCard
     SCREEN: overview  renderOverview, renderOverviewRow
     SCREEN: matchups  renderMatchupsOverview, renderGuillotineMatchupRow,
        overview       renderMatchupSummaryRow
     SCREEN: shares    renderPlayerShares, scopedLeaguesForShares,
                       isDraftComplete, buildShareList, paintPlayerShares
     LEAGUE DETAIL     renderLeagueDetail (standings/rosters/matchup/
                       waiver/payouts tab dispatch)
     TAB: standings    renderStandingsTab, faabRemaining, guillotineRowHTML,
                       renderGuillotineStandingsTab, bindGuillotineStandings
     TAB: rosters      computeOwnedPlayerIds, renderRostersTab, slotLabel,
                       slotColorClass, projMetaHTML, rosterPlayerRow,
                       renderRosterGroups, bindRosterPicker
     TAB: matchup      SLOT_ELIGIBILITY, computeOptimalLineup, lineupTotal,
                       findMatchupPair, renderMatchupPanel, renderMatchupTab,
                       bindMatchupTab
     TAB: waiver       renderWaiverWireTab
     TAB: payouts      currencySymbol, renderPayoutsTab, updatePotSummary,
                       bindPayoutsForm
     BOOT              boot()
     ===================================================================== */

  const APP_PREFIX = 'ezl:';
  const state = {
    view: 'loading', // loading | setup | leagues | league
    username: null,
    season: null,
    leagues: [],
    leagueDetail: {}, // leagueId -> {league, rosters, users, myRosterId}
    currentLeagueId: null,
    currentTab: 'standings',
    currentTeamRosterId: null,
    leaguesSubTab: null,
    sharesMainTab: null,
    sharesSubTab: null,
    sharesThirdTab: null,
    playersCache: null,
    trendingCache: null,
    nflState: null,
    projectionsCache: null,
    projectionWeek: null,
    plannerProjCache: null,
    plannerWeek: null,
    plannerSubView: null,
    matchupRankings: null,
    waiverBids: null,
    waiverHubLeagueId: null,
    error: null,
  };

  const app = document.getElementById('app');

  function toast(msg){
    let t = document.getElementById('ezl-toast');
    if(!t){
      t = document.createElement('div');
      t.id = 'ezl-toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(()=> t.classList.remove('show'), 2200);
  }

  async function fetchJSON(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error('Sleeper API error (' + res.status + ') for ' + url);
    return res.json();
  }

  // Standard browser localStorage — this app is meant to be opened as a
  // standalone local file/page, not run inside Claude's in-chat sandbox
  // (which blocks both external fetch() and localStorage).
  async function loadSettings(){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'settings');
      return v ? JSON.parse(v) : null;
    }catch(e){ return null; }
  }
  async function saveSettings(username, season){
    try{ localStorage.setItem(APP_PREFIX + 'settings', JSON.stringify({username, season})); }catch(e){}
  }
  async function exportUserData(){
  const data = {};

  Object.keys(localStorage).forEach(key => {
    if(key.startsWith(APP_PREFIX)){
      data[key] = localStorage.getItem(key);
    }
  });

  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `fantasy-hub-backup-${new Date().toISOString().slice(0,10)}.json`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}
  async function importUserData(file){
  const text = await file.text();
  const data = JSON.parse(text);

  Object.entries(data).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });

  alert('Backup imported successfully. Please refresh the page.');
}
  async function loadPayout(leagueId){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'payouts:' + leagueId);
      return v ? JSON.parse(v) : null;
    }catch(e){ return null; }
  }
  async function savePayout(leagueId, data){
    try{ localStorage.setItem(APP_PREFIX + 'payouts:' + leagueId, JSON.stringify(data)); }catch(e){
      throw e;
    }
  }

  // Sleeper has no "eliminated" flag for guillotine-format leagues, so who's been
  // cut is tracked manually here and saved per league.
  async function loadCutRosters(leagueId){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'cut:' + leagueId);
      return v ? JSON.parse(v) : [];
    }catch(e){ return []; }
  }
  async function saveCutRosters(leagueId, rosterIds){
    try{ localStorage.setItem(APP_PREFIX + 'cut:' + leagueId, JSON.stringify(rosterIds)); }catch(e){}
  }

  // Season Planner move history — a purely local plan of future add/drop moves.
  // This CANNOT execute a real Sleeper transaction (no write access); it's a
  // what-if planning tool only. Each move: {week, addPid, dropPid}.
  async function loadPlannerMoves(leagueId){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'plannerMoves:' + leagueId);
      return v ? JSON.parse(v) : [];
    }catch(e){ return []; }
  }
  async function savePlannerMoves(leagueId, moves){
    try{ localStorage.setItem(APP_PREFIX + 'plannerMoves:' + leagueId, JSON.stringify(moves)); }catch(e){}
  }

  // Separate small per-week projections cache used only by the Season Planner,
  // so planning a future week doesn't disturb the global week picker's cache
  // used everywhere else.
  async function ensurePlannerProjectionsForWeek(week){
    if(!state.plannerProjCache) state.plannerProjCache = {};
    if(state.plannerProjCache[week]) return state.plannerProjCache[week];
    const positions = ['QB','RB','WR','TE','K','DEF'];
    const results = await Promise.all(positions.map(pos =>
      fetchJSON(`https://api.sleeper.app/projections/nfl/${PROJECTION_SEASON}/${week}?season_type=regular&position[]=${pos}`).catch(()=>[])
    ));
    const byPlayer = {};
    results.flat().forEach(p => {
      if(p && p.player_id) byPlayer[p.player_id] = p.stats || {};
    });
    state.plannerProjCache[week] = byPlayer;
    return byPlayer;
  }
  function plannerProjectedPoints(pid, league, week){
    const byPlayer = state.plannerProjCache && state.plannerProjCache[week];
    if(!byPlayer) return null;
    const s = byPlayer[pid];
    if(!s) return null;
    const scoring = league.scoring_settings || {};
    let total = 0, matched = false;
    Object.keys(scoring).forEach(key => {
      if(s[key] != null && typeof scoring[key] === 'number'){ total += s[key]*scoring[key]; matched = true; }
    });
    if(matched) return total;
    const rec = scoring.rec || 0;
    let val = rec >= 1 ? s.pts_ppr : (rec >= 0.5 ? s.pts_half_ppr : s.pts_std);
    if(val == null) val = s.pts_ppr != null ? s.pts_ppr : (s.pts_half_ppr != null ? s.pts_half_ppr : s.pts_std);
    return val != null ? val : null;
  }

  const GUILLOTINE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-3px;"><line x1="4" y1="1" x2="4" y2="23" stroke="currentColor" stroke-width="2"/><line x1="20" y1="1" x2="20" y2="23" stroke="currentColor" stroke-width="2"/><line x1="4" y1="1" x2="20" y2="1" stroke="currentColor" stroke-width="2"/><polygon points="2,9 22,13 22,17 2,13" fill="currentColor"/></svg>`;

  // Sleeper's actual logo, embedded as base64 so the app stays a single
  // self-contained file with no external image request needed.
  const SLEEPER_LOGO_B64 = "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";
  function robotIcon(size, valign){
    const radius = Math.round(size*0.22);
    return `<img src="data:image/png;base64,${SLEEPER_LOGO_B64}" width="${size}" height="${size}" style="vertical-align:${valign}px; margin:0 4px; border-radius:${radius}px; display:inline-block;" alt="Sleeper logo"/>`;
  }

  function initials(name){
    if(!name) return '??';
    return name.split(/[\s_]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
  }

  function avatarHTML(avatarId, displayName, size){
    if(avatarId){
      return `<div class="avatar" style="${size?`width:${size}px;height:${size}px;`:''}"><img src="https://sleepercdn.com/avatars/thumbs/${avatarId}" alt=""/></div>`;
    }
    return `<div class="avatar" style="${size?`width:${size}px;height:${size}px;`:''}">${initials(displayName)}</div>`;
  }

  function teamDisplayName(user, roster){
    if(roster && roster.metadata && roster.metadata.team_name) return roster.metadata.team_name;
    if(user && user.metadata && user.metadata.team_name) return user.metadata.team_name;
    if(user && user.display_name) return user.display_name + "'s Team";
    return 'Unknown Team';
  }

  // ---------------- Data loading ----------------
  async function ensurePlayersLoaded(){
    if(state.playersCache) return state.playersCache;
    const data = await fetchJSON('https://api.sleeper.app/v1/players/nfl');
    state.playersCache = data;
    return data;
  }

  // Sleeper's public API has no expert rankings endpoint. This is the one real,
  // live signal it does expose: how many Sleeper users platform-wide have added
  // a player over the last 48 hours. It's a "what people are grabbing right now"
  // proxy, not a formal expert ranking.
  async function ensureTrendingLoaded(){
    if(state.trendingCache) return state.trendingCache;
    const data = await fetchJSON('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=300');
    state.trendingCache = data;
    return data;
  }

  async function ensureNflState(){
    if(state.nflState) return state.nflState;
    const data = await fetchJSON('https://api.sleeper.app/v1/state/nfl');
    state.nflState = {season: data.season, week: data.week};
    return state.nflState;
  }

  // NOTE: unlike every other endpoint in this app, projections are NOT part of
  // Sleeper's official public API docs. This is a widely-used but undocumented
  // endpoint — it could change or disappear without notice. If it ever starts
  // failing, that's why.
  // Season stays fixed at 2026; the WEEK is user-changeable via the picker in
  // the top bar, and persists across sessions in localStorage.
  const PROJECTION_SEASON = '2026';
  function getProjectionWeek(){
    if(state.projectionWeek) return state.projectionWeek;
    let saved = null;
    try{ saved = localStorage.getItem(APP_PREFIX + 'projectionWeek'); }catch(e){}
    state.projectionWeek = saved ? parseInt(saved, 10) : 1;
    return state.projectionWeek;
  }
  function setProjectionWeek(week){
    week = Math.max(1, Math.min(18, week));
    state.projectionWeek = week;
    try{ localStorage.setItem(APP_PREFIX + 'projectionWeek', String(week)); }catch(e){}
    // Invalidate anything tied to the old week so it's refetched fresh.
    state.projectionsCache = null;
    Object.values(state.leagueDetail).forEach(d => { if(d) d.matchupsWeek1 = null; });
  }

  async function ensureProjectionsLoaded(){
    const week = getProjectionWeek();
    if(state.projectionsCache && state.projectionsCache.week === week && state.projectionsCache.season === PROJECTION_SEASON){
      return state.projectionsCache;
    }
    const season = PROJECTION_SEASON;
    const positions = ['QB','RB','WR','TE','K','DEF'];
    const results = await Promise.all(positions.map(pos =>
      fetchJSON(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&position[]=${pos}`).catch(()=>[])
    ));
    const byPlayer = {};
    results.flat().forEach(p => {
      if(p && p.player_id) byPlayer[p.player_id] = p.stats || {};
    });
    state.projectionsCache = {season, week, byPlayer};
    return state.projectionsCache;
  }

  // Picks the projection figure matching the league's own scoring format
  // (full PPR / half PPR / standard) rather than assuming one.
  // Computes the projection using this league's exact scoring settings against
  // the raw projected stat line (yards, TDs, receptions, etc.), the same way
  // Sleeper's own app scores it for that league — rather than picking from the
  // three generic std/half-PPR/full-PPR buckets, which won't match if the
  // league has any custom scoring (bonus yardage, TE premium, different TD
  // values, etc.).
  function projectedPoints(pid, league){
    const proj = state.projectionsCache;
    if(!proj) return null;
    const s = proj.byPlayer[pid];
    if(!s) return null;
    const scoring = league.scoring_settings || {};
    let total = 0;
    let matchedAnyStat = false;
    Object.keys(scoring).forEach(key => {
      if(s[key] != null && typeof scoring[key] === 'number'){
        total += s[key] * scoring[key];
        matchedAnyStat = true;
      }
    });
    if(matchedAnyStat) return total;
    // Fallback if the raw stat line didn't overlap with this league's scoring keys at all.
    const rec = scoring.rec || 0;
    let val = rec >= 1 ? s.pts_ppr : (rec >= 0.5 ? s.pts_half_ppr : s.pts_std);
    if(val == null) val = s.pts_ppr != null ? s.pts_ppr : (s.pts_half_ppr != null ? s.pts_half_ppr : s.pts_std);
    return val != null ? val : null;
  }

  async function loadLeaguesForUser(username, season){
    const user = await fetchJSON('https://api.sleeper.app/v1/user/' + encodeURIComponent(username));
    if(!user || !user.user_id) throw new Error('No Sleeper user found for "' + username + '"');
    const leagues = await fetchJSON('https://api.sleeper.app/v1/user/' + user.user_id + '/leagues/nfl/' + season);
    return {user, leagues};
  }

  async function loadLeagueDetail(leagueId, myUserId){
    const [league, rosters, users] = await Promise.all([
      fetchJSON('https://api.sleeper.app/v1/league/' + leagueId),
      fetchJSON('https://api.sleeper.app/v1/league/' + leagueId + '/rosters'),
      fetchJSON('https://api.sleeper.app/v1/league/' + leagueId + '/users'),
    ]);
    const usersById = {};
    users.forEach(u => usersById[u.user_id] = u);
    const myRoster = rosters.find(r => r.owner_id === myUserId);
    const payout = await loadPayout(leagueId);
    const cutRosters = await loadCutRosters(leagueId);
    return {league, rosters, usersById, myRosterId: myRoster ? myRoster.roster_id : null, payout, cutRosters};
  }

  function fpts(settingsObj, key){
    const base = settingsObj[key] || 0;
    const dec = settingsObj[key + '_decimal'] || 0;
    return base + dec/100;
  }

  function computeStandings(rosters, usersById){
    const rows = rosters.map(r => {
      const s = r.settings || {};
      return {
        roster_id: r.roster_id,
        owner_id: r.owner_id,
        user: usersById[r.owner_id],
        wins: s.wins||0, losses: s.losses||0, ties: s.ties||0,
        pf: fpts(s,'fpts'), pa: fpts(s,'fpts_against'),
        raw: r,
      };
    });
    rows.forEach(row => row.roster = row.raw);
    rows.sort((a,b) => {
      const aw = a.wins + a.ties*0.5, bw = b.wins + b.ties*0.5;
      if(bw !== aw) return bw - aw;
      return b.pf - a.pf;
    });
    return rows;
  }

  // ---------------- Rendering ----------------
  function render(){
    if(state.view === 'loading') return renderLoading();
    if(state.view === 'setup') return renderSetup();
    if(state.view === 'leagues') return renderLeagueList();
    if(state.view === 'league') return renderLeagueDetail();
    if(state.view === 'overview') return renderOverview();
    if(state.view === 'matchups') return renderMatchupsOverview();
    if(state.view === 'shares') return renderPlayerShares();
    if(state.view === 'waiverHub') return renderWaiverHub();
    if(state.view === 'waiverHubDetail') return renderWaiverHubDetail();
  }

  function renderLoading(msg){
    app.innerHTML = `
      <div class="topbar">
        <div class="brand"><span class="brand-mark">GREGG NORMAN'S ${robotIcon(24,-5)}<span>FANTASY HUB</span></span></div>
      </div>
      <div class="body-scroll">
        <div class="loading-row"><div class="spinner"></div> ${msg || 'Loading...'}</div>
      </div>
    `;
  }

  function renderErrorBanner(message, onRetry){
    return `<div class="error-banner"><span>${message}</span></div>`;
  }

  function renderSetup(){
    app.innerHTML = `
      <div class="topbar">
        <div class="brand"><span class="brand-mark">GREGG NORMAN'S ${robotIcon(24,-5)}<span>FANTASY HUB</span></span></div>
      </div>
      <div class="body-scroll">
        <div class="setup-wrap">
          <div class="mascot-wrap">
            <svg width="160" height="224" viewBox="0 0 120 168" xmlns="http://www.w3.org/2000/svg">
              <!-- shadow -->
              <ellipse cx="60" cy="160" rx="34" ry="6" fill="rgba(0,0,0,0.35)"/>
              <!-- legs -->
              <rect x="46" y="118" width="10" height="30" rx="4" fill="#2A3439"/>
              <rect x="64" y="118" width="10" height="30" rx="4" fill="#2A3439"/>
              <!-- torso / jersey (Falcons black) -->
              <path d="M38 78 Q60 68 82 78 L86 122 Q60 132 34 122 Z" fill="#111214"/>
              <path d="M38 78 Q60 68 82 78" fill="none" stroke="#A71930" stroke-width="3"/>
              <path d="M38 78 Q60 68 82 78" fill="none" stroke="#9EA2A2" stroke-width="1" transform="translate(0,4)"/>
              <text x="60" y="90" text-anchor="middle" font-family="Teko" font-size="10" font-weight="700" letter-spacing="1" fill="#F5F3EE">PITTS</text>
              <text x="60" y="112" text-anchor="middle" font-family="Teko" font-size="22" font-weight="700" fill="#A71930">8</text>
              <!-- arms -->
              <rect x="24" y="82" width="14" height="34" rx="7" fill="#111214"/>
              <rect x="82" y="82" width="14" height="34" rx="7" fill="#111214"/>
              <rect x="24" y="82" width="14" height="5" fill="#A71930"/>
              <rect x="82" y="82" width="14" height="5" fill="#A71930"/>
              <circle cx="31" cy="118" r="7" fill="#4A2E1E"/>
              <circle cx="89" cy="118" r="7" fill="#4A2E1E"/>
              <!-- head -->
              <circle cx="60" cy="48" r="24" fill="#4A2E1E"/>
              <!-- crown -->
              <polygon points="38,32 46,10 53,26 60,4 67,26 74,10 82,32" fill="var(--gold)" stroke="#8A6B1F" stroke-width="1.5"/>
              <rect x="38" y="30" width="44" height="7" rx="1.5" fill="var(--gold)" stroke="#8A6B1F" stroke-width="1.5"/>
              <circle cx="60" cy="14" r="3" fill="#E85C4A"/>
              <circle cx="46" cy="20" r="2.5" fill="#6CA9E0"/>
              <circle cx="74" cy="20" r="2.5" fill="#6CA9E0"/>
              <!-- stat card held up between the arms -->
              <rect x="14" y="118" width="92" height="38" rx="6" fill="var(--surface-raised)" stroke="var(--gold)" stroke-width="2"/>
              <text x="60" y="140" text-anchor="middle" font-family="Teko" font-size="19" font-weight="600" fill="var(--chalk)">45.60 PTS</text>
              <text x="60" y="151" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" letter-spacing="1" fill="var(--chalk-dim)">WEEK 15 · 2025</text>
            </svg>
          </div>
          <h1 style="line-height:1.15;">GREGG NORMAN'S<br/><span id="home-logo" style="display:inline-block; margin:6px 0;">${robotIcon(52,-14)}</span><br/><span style="color:var(--gold)">FANTASY HUB</span></h1>
          <p>Pull every league you're in from Sleeper, track where you stand, and log the buy-ins and payouts Sleeper doesn't.</p>
          ${state.error ? renderErrorBanner(state.error) : ''}
          <div class="field">
            <label>Sleeper Username</label>
            <input id="in-username" type="text" placeholder="e.g. footballfanatic22" value="${state.username||''}"/>
          </div>
          <div class="field">
            <label>Season</label>
            <select id="in-season">
              ${[2026,2025,2024].map(y=>`<option value="${y}" ${state.season==y?'selected':''}>${y}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" id="btn-load" style="width:100%; padding:12px;">Load My Leagues</button>
        </div>
      </div>
    `;
    document.getElementById('btn-load').addEventListener('click', onSetupSubmit);
    app.querySelectorAll('input,select').forEach(el=>{
      el.addEventListener('keydown', e=>{ if(e.key==='Enter') onSetupSubmit(); });
    });
  }

  async function onSetupSubmit(){
    const username = document.getElementById('in-username').value.trim();
    const season = document.getElementById('in-season').value;
    if(!username){ state.error = 'Enter a Sleeper username.'; return renderSetup(); }
    state.error = null;
    renderLoading('Looking up ' + username + '...');
    try{
      const {user, leagues} = await loadLeaguesForUser(username, season);
      state.username = username;
      state.season = season;
      state.sleeperUserId = user.user_id;
      state.leagues = leagues;
      await saveSettings(username, season);
      if(!leagues.length){
        state.error = 'No leagues found for that username in ' + season + '. Try a different season.';
        state.view = 'setup';
        return renderSetup();
      }
      state.view = 'leagues';
      render();
    }catch(e){
      state.error = e.message || 'Something went wrong reaching Sleeper.';
      state.view = 'setup';
      renderSetup();
    }
  }

  function renderTopbar(showBack){
    return `
      <div class="topbar">
        <div class="brand">
          <span class="brand-mark">GREGG NORMAN'S ${robotIcon(24,-5)}<span>FANTASY HUB</span></span>
          <span class="brand-sub">${state.username ? '@'+state.username+' · '+state.season : ''}</span>
        </div>
        <div class="topbar-actions">
          ${showBack ? `<button class="btn btn-ghost" id="btn-to-leagues">All Leagues</button>` : ''}
          ${state.leagues && state.leagues.length ? `
          <div class="week-picker">
            <label>PROJ WK</label>
            <select id="week-select">
              ${Array.from({length:18}, (_,i)=>i+1).map(w => `<option value="${w}" ${w===getProjectionWeek()?'selected':''}>${w}</option>`).join('')}
            </select>
            <button class="btn btn-ghost" id="btn-next-week" title="Advance to next week">Next Week ▶</button>
          </div>` : ''}
          ${state.leagues && state.leagues.length ? `<button class="btn btn-ghost" id="btn-matchups">⚔ Matchups</button>` : ''}
          ${state.leagues && state.leagues.length ? `<button class="btn btn-ghost" id="btn-shares">📊 Shares</button>` : ''}
          ${state.leagues && state.leagues.length ? `<button class="btn btn-ghost" id="btn-waiverhub">🧾 Waivers</button>` : ''}
          ${state.leagues && state.leagues.length ? `<button class="btn btn-ghost" id="btn-overview">💰 Buy-ins</button>` : ''}
          </div>
        <div class="topbar-utils">
          <button class="btn btn-ghost btn-mini" id="btn-export-data" title="Export Data">💾</button>
          <button class="btn btn-ghost btn-mini" id="btn-import-data" title="Import Data">📂</button>
          <button class="btn btn-ghost btn-mini" id="btn-change-user" title="Change User">👤</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindTopbar(){
    const back = document.getElementById('btn-to-leagues');
    if(back) back.addEventListener('click', ()=>{ state.view='leagues'; render(); });
    const weekSelect = document.getElementById('week-select');
    if(weekSelect) weekSelect.addEventListener('change', ()=>{
      setProjectionWeek(parseInt(weekSelect.value, 10));
      render();
    });
    const nextWeekBtn = document.getElementById('btn-next-week');
    if(nextWeekBtn) nextWeekBtn.addEventListener('click', ()=>{
      setProjectionWeek(getProjectionWeek() + 1);
      render();
    });
    const mu = document.getElementById('btn-matchups');
    if(mu) mu.addEventListener('click', ()=>{ state.view='matchups'; render(); });
    const sh = document.getElementById('btn-shares');
    if(sh) sh.addEventListener('click', ()=>{ state.view='shares'; render(); });
    const wh = document.getElementById('btn-waiverhub');
    if(wh) wh.addEventListener('click', ()=>{ state.view='waiverHub'; render(); });
    const ov = document.getElementById('btn-overview');
    if(ov) ov.addEventListener('click', ()=>{ state.view='overview'; render(); });
    const exp = document.getElementById('btn-export-data');
    if(exp) exp.addEventListener('click', async () => {
      await exportUserData();
    });
    const imp = document.getElementById('btn-import-data');
    if(imp) imp.addEventListener('click', async () => {

      const input = document.createElement('input');
     input.type = 'file';
      input.accept = '.json';

      input.onchange = async (e) => {
        const file = e.target.files[0];
       if(file){
         await importUserData(file);
        }
     };

      input.click();

});
    const chg = document.getElementById('btn-change-user');
    if(chg) chg.addEventListener('click', ()=>{ state.view='setup'; state.error=null; render(); });
  }

  // League groupings — matched case-insensitively against league name.
  // A league not matching any group falls into "Other Leagues" rather than being dropped.
  const LEAGUE_CATEGORIES = [
    { name: 'Redraft (Managed)', matches: ['a league of our own', '24hr maccas'] },
    { name: 'Redraft (Unmanaged)', matches: ['draftahol'] },
    { name: 'Guillotine Leagues', matches: ['cut throat','guillotine deathmatch','the block','heads will roll','chop chop','chop suey','most dangerous gully league','knives out','royal rumble','guillotine'] },
    { name: 'Dynasty Leagues', matches: ['the kingmaker','the captain dynasty league','special olympics','ah shit here we go again','mordor','no punt intended'] },
  ];
  function categoryForLeagueName(name){
    const lower = (name||'').toLowerCase();
    for(const cat of LEAGUE_CATEGORIES){
      if(cat.matches.some(m => lower.includes(m))) return cat.name;
    }
    return 'Other Leagues';
  }
  function groupByCategory(items, nameOf){
    const order = LEAGUE_CATEGORIES.map(c=>c.name).concat(['Other Leagues']);
    const buckets = {};
    order.forEach(o => buckets[o] = []);
    items.forEach(it => buckets[categoryForLeagueName(nameOf(it))].push(it));
    return order.map(o => ({category:o, items:buckets[o]})).filter(g => g.items.length);
  }

  async function renderLeagueList(){
    renderLoading('Fetching your leagues...');
    // fetch quick roster/standing snapshot for each league card
    const cards = [];
    for(const lg of state.leagues){
      try{
        const detail = await loadLeagueDetail(lg.league_id, state.sleeperUserId);
        state.leagueDetail[lg.league_id] = detail;
        const standings = computeStandings(detail.rosters, detail.usersById);
        const myIdx = standings.findIndex(r => r.roster_id === detail.myRosterId);
        cards.push({lg, detail, standings, myIdx});
      }catch(e){
        cards.push({lg, error: e.message});
      }
    }
    const groups = groupByCategory(cards, c => c.lg.name);
    if(!state.leaguesSubTab || !groups.find(g => g.category === state.leaguesSubTab)){
      state.leaguesSubTab = groups.length ? groups[0].category : null;
    }
    paintLeagueList(cards, groups);
  }

  function paintLeagueList(cards, groups){
    const activeGroup = groups.find(g => g.category === state.leaguesSubTab) || {items:[]};
    app.innerHTML = `
      ${renderTopbar(false)}
      <div class="body-scroll">
        <div class="tabs">
          ${groups.map(g => `<div class="tab ${g.category===state.leaguesSubTab?'active':''}" data-cat="${g.category}">${g.category} <span style="opacity:0.6;">(${g.items.length})</span></div>`).join('')}
        </div>
        <div class="league-grid">
          ${activeGroup.items.map(c => renderLeagueCard(c)).join('')}
        </div>
      </div>
    `;
    bindTopbar();
    app.querySelectorAll('.tab').forEach(t => t.addEventListener('click', ()=>{
      state.leaguesSubTab = t.dataset.cat;
      paintLeagueList(cards, groups);
    }));
    cards.forEach(c=>{
      if(c.error) return;
      const el = document.getElementById('card-' + c.lg.league_id);
      if(el) el.addEventListener('click', ()=>{
        state.currentLeagueId = c.lg.league_id;
        state.currentTab = 'standings';
        state.currentTeamRosterId = null;
        state.view = 'league';
        render();
      });
    });
  }

  function renderLeagueCard({lg, detail, standings, myIdx, error}){
    if(error){
      return `<div class="league-card" style="border-left-color:var(--alert);">
        <div class="league-card-name">${lg.name}</div>
        <div class="league-card-meta" style="color:#E08A63;">Couldn't load — ${error}</div>
      </div>`;
    }
    const me = myIdx >= 0 ? standings[myIdx] : null;
    const record = me ? `${me.wins}-${me.losses}${me.ties?('-'+me.ties):''}` : '—';
    const rank = myIdx >= 0 ? (myIdx+1) : '—';
    const total = standings.length;
    const winClass = me && me.wins >= me.losses ? 'win' : 'loss';
    const guillotine = isGuillotineLeague(lg.name);
    return `
      <div class="league-card" id="card-${lg.league_id}">
        <div class="league-card-name">${lg.name}</div>
        <div class="league-card-meta">${total} teams · ${lg.status}</div>
        <div class="league-card-row">
          <div>
            <div class="league-card-label">Your Record</div>
            <div class="scoreboard-num ${winClass}">${record}</div>
          </div>
          ${guillotine ? '' : `
          <div style="text-align:right;">
            <div class="league-card-label">Rank</div>
            <div class="scoreboard-num">${rank}<span style="font-size:14px; color:var(--chalk-faint);">/${total}</span></div>
          </div>`}
        </div>
      </div>
    `;
  }

  async function renderOverview(){
    renderLoading('Pulling buy-ins and standings...');
    const rows = [];
    let totalUSD = 0;
    let totalGBP = 0;
    let leaguesWithBuyIn = 0;
    for(const lg of state.leagues){
      try{
        let detail = state.leagueDetail[lg.league_id];
        if(!detail){
          detail = await loadLeagueDetail(lg.league_id, state.sleeperUserId);
          state.leagueDetail[lg.league_id] = detail;
        }
        const standings = computeStandings(detail.rosters, detail.usersById);
        const myIdx = standings.findIndex(r => r.roster_id === detail.myRosterId);
        const total = standings.length;
        const playoffTeams = (detail.league.settings && detail.league.settings.playoff_teams) || 0;
        const rank = myIdx >= 0 ? myIdx+1 : null;
        const inPlayoffs = playoffTeams > 0 && rank !== null && rank <= playoffTeams;
        const payout = detail.payout;
        const hasBuyIn = payout && payout.buyIn !== '' && payout.buyIn != null;
        const buyIn = hasBuyIn ? (parseFloat(payout.buyIn)||0) : 0;
        const currency = (payout && payout.currency) || 'USD';
        if(hasBuyIn){
          leaguesWithBuyIn++;
          if(currency === 'GBP') totalGBP += buyIn; else totalUSD += buyIn;
        }
        rows.push({lg, rank, total, playoffTeams, inPlayoffs, payout, buyIn});
      }catch(e){
        rows.push({lg, error: e.message || 'Failed to load'});
      }
    }

    const groups = groupByCategory(rows, r => r.lg.name);
    app.innerHTML = `
      ${renderTopbar(true)}
      <div class="body-scroll">
        <div class="section-title">Buy-ins &amp; Standings Overview</div>
        <div class="overview-summary">
          <div class="overview-summary-item">
            <div class="overview-summary-label">Total Buy-in — USD (${leaguesWithBuyIn} leagues w/ buy-in)</div>
            <div class="overview-summary-val">$${totalUSD.toFixed(2)}</div>
          </div>
          <div class="overview-summary-item">
            <div class="overview-summary-label">Total Buy-in — GBP</div>
            <div class="overview-summary-val">£${totalGBP.toFixed(2)}</div>
          </div>
        </div>
        <div class="empty-note" style="margin-bottom:18px;">Shown separately rather than combined — converting between currencies would need a live exchange rate this app doesn't have, so USD and GBP totals are kept apart rather than guessed at.</div>
        ${groups.map(g => `
          <div class="section-title">${g.category} <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${g.items.length})</span></div>
          <div class="overview-list" style="margin-bottom:26px;">
            ${g.items.map(renderOverviewRow).join('')}
          </div>
        `).join('')}
      </div>
    `;
    bindTopbar();
    rows.forEach(r => {
      if(r.error) return;
      const el = document.getElementById('ov-' + r.lg.league_id);
      if(el) el.addEventListener('click', ()=>{
        state.currentLeagueId = r.lg.league_id;
        state.currentTab = 'payouts';
        state.view = 'league';
        render();
      });
    });
  }

  function isGuillotineLeague(name){
    return categoryForLeagueName(name) === 'Guillotine Leagues';
  }
  function isDynastyLeague(name){
    return categoryForLeagueName(name) === 'Dynasty Leagues';
  }

  function renderOverviewRow(r){
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
    const free = isFreeLeague(r.lg.name);
    const sym = currencySymbol(r.payout && r.payout.currency);
    const hasPayoutRows = r.payout && r.payout.payouts && r.payout.payouts.some(p => p.place || p.amount);
    const payoutsText = hasPayoutRows
      ? r.payout.payouts.filter(p => p.place || p.amount).map(p => `${p.place || '—'}: ${sym}${(parseFloat(p.amount)||0).toFixed(0)}`).join(' · ')
      : 'No payout structure entered yet';
    const hasBuyIn = r.payout && r.payout.buyIn !== '' && r.payout.buyIn != null;
    const guillotine = isGuillotineLeague(r.lg.name);
    const advance = isDynastyLeague(r.lg.name) ? (r.payout && r.payout.advanceDues) : null;
    const empire = isDynastyLeague(r.lg.name) ? (r.payout && r.payout.empirePot) : null;
    const extraLines = [];
    if(advance && advance.paid){
      extraLines.push(`<span class="pill" style="background:rgba(127,191,142,0.15); color:#7FBF8E;">✓ Advance dues paid${advance.throughSeason ? ' ('+advance.throughSeason+')' : ''}</span>`);
    }
    if(empire && empire.enabled){
      const total = empire.total !== '' && empire.total != null ? parseFloat(empire.total).toFixed(2) : '—';
      const wins = empire.consecutiveWins !== '' && empire.consecutiveWins != null ? empire.consecutiveWins : '0';
      extraLines.push(`<span class="pill" style="background:rgba(212,160,23,0.15); color:var(--gold);">👑 Empire Pot: ${sym}${total}${empire.leaderName ? ' — '+empire.leaderName+' ('+wins+'/2 titles)' : ''}</span>`);
    }
    const buyInHTML = hasBuyIn
      ? ('Buy-in: <strong style="color:var(--gold);">'+sym+parseFloat(r.payout.buyIn).toFixed(2)+'</strong>')
      : '<span style="color:var(--chalk-faint);">Buy-in not set</span>';
    const payoutsHTML = hasPayoutRows
      ? `<span style="color:var(--gold);">${payoutsText}</span>`
      : `<span style="color:var(--chalk-faint);">${payoutsText}</span>`;
    return `
      <div class="overview-row" id="ov-${r.lg.league_id}">
        <div class="overview-main">
          <div class="overview-league-name">${r.lg.name}</div>
          <div class="overview-payouts">
            ${free
              ? '<span style="color:var(--chalk-faint);">Free league — no buy-in</span>'
              : buyInHTML + ' &nbsp;·&nbsp; ' + payoutsHTML}
          </div>
          ${extraLines.length ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${extraLines.join('')}</div>` : ''}
        </div>
        ${guillotine ? '' : `
        <div class="overview-stat">
          <div class="overview-stat-label">Rank</div>
          <div class="scoreboard-num">${r.rank || '—'}<span style="font-size:13px; color:var(--chalk-faint);">/${r.total}</span></div>
        </div>
        <div class="overview-stat">
          <div class="overview-stat-label">Playoffs (top ${r.playoffTeams || '—'})</div>
          <span class="pill ${r.inPlayoffs ? '' : 'pill-out'}">${r.inPlayoffs ? 'In the hunt' : 'Outside the line'}</span>
        </div>`}
      </div>
    `;
  }

  async function renderMatchupsOverview(){
    renderLoading('Pulling Week ' + getProjectionWeek() + ' matchups...');
    await Promise.all([ensurePlayersLoaded(), ensureProjectionsLoaded().catch(()=>null)]);
    const rows = [];
    const guillotineRows = [];
    for(const lg of state.leagues){
      try{
        let detail = state.leagueDetail[lg.league_id];
        if(!detail){
          detail = await loadLeagueDetail(lg.league_id, state.sleeperUserId);
          state.leagueDetail[lg.league_id] = detail;
        }

        if(isGuillotineLeague(lg.name)){
          if(!isDraftComplete(detail)){
            guillotineRows.push({lg, notDrafted:true});
            continue;
          }
          const cutSet = new Set(detail.cutRosters || []);
          if(cutSet.has(detail.myRosterId)){
            guillotineRows.push({lg, cut:true});
            continue;
          }
          const aliveRosters = detail.rosters.filter(r => !cutSet.has(r.roster_id));
          const aliveTotals = aliveRosters.map(r => {
            const opt = computeOptimalLineup(r, detail.league);
            return {roster_id: r.roster_id, total: lineupTotal(opt.assignment, opt.pool)};
          }).sort((a,b) => b.total - a.total);
          const myEntry = aliveTotals.find(t => t.roster_id === detail.myRosterId);
          if(!myEntry){
            guillotineRows.push({lg, error: "Couldn't find your team in this league"});
            continue;
          }
          const rank = aliveTotals.findIndex(t => t.roster_id === detail.myRosterId) + 1;
          guillotineRows.push({lg, myTotal: myEntry.total, rank, aliveCount: aliveTotals.length});
          continue;
        }

        if(!detail.matchupsWeek1){
          try{
            detail.matchupsWeek1 = await fetchJSON(`https://api.sleeper.app/v1/league/${lg.league_id}/matchups/${getProjectionWeek()}`);
          }catch(e){
            detail.matchupsWeek1 = [];
          }
        }
        const pair = findMatchupPair(detail);
        if(!pair || !pair.opp){
          rows.push({lg, notScheduled: true});
          continue;
        }
        const myRoster = detail.rosters.find(r => r.roster_id === pair.mine.roster_id);
        const oppRoster = detail.rosters.find(r => r.roster_id === pair.opp.roster_id);
        const oppUser = detail.usersById[oppRoster.owner_id];
        const myOpt = computeOptimalLineup(myRoster, detail.league);
        const oppOpt = computeOptimalLineup(oppRoster, detail.league);
        const myTotal = lineupTotal(myOpt.assignment, myOpt.pool);
        const oppTotal = lineupTotal(oppOpt.assignment, oppOpt.pool);
        const allTotals = detail.rosters.map(r => {
          const opt = computeOptimalLineup(r, detail.league);
          return lineupTotal(opt.assignment, opt.pool);
        });
        const leagueMedian = median(allTotals);
        rows.push({lg, oppName: teamDisplayName(oppUser, oppRoster), oppUser, myTotal, oppTotal, leagueMedian});
      }catch(e){
        if(isGuillotineLeague(lg.name)){
          guillotineRows.push({lg, error: e.message || 'Failed to load'});
        } else {
          rows.push({lg, error: e.message || 'Failed to load'});
        }
      }
    }

    const groups = groupByCategory(rows, r => r.lg.name);
    app.innerHTML = `
      ${renderTopbar(true)}
      <div class="body-scroll">
        <div class="section-title">Week ${getProjectionWeek()} Matchups</div>
        <div class="empty-note" style="margin-bottom:18px;">Both totals are each team's best possible Week ${getProjectionWeek()} lineup based on Sleeper's projections. Green means you're currently projected ahead, red means behind. Click any matchup to open it and adjust lineups.</div>
        ${groups.map(g => `
          <div class="section-title">${g.category} <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${g.items.length})</span></div>
          <div class="overview-list" style="margin-bottom:26px;">
            ${g.items.map(renderMatchupSummaryRow).join('')}
          </div>
        `).join('')}
        ${guillotineRows.length ? `
          <div class="section-title">Guillotine Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${guillotineRows.length})</span></div>
          <div class="empty-note" style="margin-bottom:14px;">No head-to-head opponent here — just your predicted Week ${getProjectionWeek()} score and where that ranks you among teams still in.</div>
          <div class="overview-list" style="margin-bottom:26px;">
            ${guillotineRows.map(renderGuillotineMatchupRow).join('')}
          </div>
        ` : ''}
      </div>
    `;
    bindTopbar();
    rows.forEach(r => {
      if(r.error || r.notScheduled) return;
      const el = document.getElementById('mu-' + r.lg.league_id);
      if(el) el.addEventListener('click', ()=>{
        state.currentLeagueId = r.lg.league_id;
        state.currentTab = 'matchup';
        state.view = 'league';
        render();
      });
    });
    guillotineRows.forEach(r => {
      if(r.error || r.cut) return;
      const el = document.getElementById('mug-' + r.lg.league_id);
      if(el) el.addEventListener('click', ()=>{
        state.currentLeagueId = r.lg.league_id;
        state.currentTab = 'standings';
        state.view = 'league';
        render();
      });
    });
  }

  function renderGuillotineMatchupRow(r){
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
            <div style="color:var(--chalk-faint); font-size:12px;">You've been cut — no Week ${getProjectionWeek()} projection to show</div>
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
          <div class="overview-payouts">Predicted Week ${getProjectionWeek()} score</div>
        </div>
        <div style="text-align:right;">
          <div class="scoreboard-num" style="color:${scoreColor};">${r.myTotal.toFixed(1)}</div>
          <div style="font-size:11px; color:var(--chalk-dim);">#${r.rank} (${r.aliveCount} left)</div>
        </div>
      </div>
    `;
  }

  function renderMatchupSummaryRow(r){
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
            <div style="color:var(--chalk-faint); font-size:12px;">Week ${getProjectionWeek()} matchup not scheduled yet</div>
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

  async function renderWaiverHub(){
    renderLoading('Pulling waiver targets across your leagues...');
    await Promise.all([ensurePlayersLoaded(), ensureTrendingLoaded(), ensureProjectionsLoaded().catch(()=>null)]);
    if(!state.waiverBids) state.waiverBids = await loadWaiverBids();
    const week = getProjectionWeek();
    const guillotineLeagues = [];
    const redraftLeagues = [];
    const dynastyLeagues = [];
    for(const lg of state.leagues){
      const category = categoryForLeagueName(lg.name);
      if(category === 'Redraft (Unmanaged)') continue;
      try{
        let detail = state.leagueDetail[lg.league_id];
        if(!detail){ detail = await loadLeagueDetail(lg.league_id, state.sleeperUserId); state.leagueDetail[lg.league_id] = detail; }
        const owned = computeOwnedPlayerIds(detail);
        const candidates = [];
        if(state.projectionsCache){
          Object.keys(state.projectionsCache.byPlayer).forEach(pid => {
            if(owned.has(pid)) return;
            const info = playerLabel(pid);
            if(!info) return;
            const pts = projectedPoints(pid, detail.league);
            if(pts == null) return;
            candidates.push({pid, info, proj: pts});
          });
        }
        candidates.sort((a,b)=>b.proj-a.proj);
        const entry = {lg, top5:candidates.slice(0,5)};
        if(category === 'Guillotine Leagues') guillotineLeagues.push(entry);
        else if(category === 'Dynasty Leagues') dynastyLeagues.push(entry);
        else if(category === 'Redraft (Managed)') redraftLeagues.push(entry);
      }catch(e){}
    }
    app.innerHTML = `
      ${renderTopbar(true)}
      <div class="body-scroll">
        <div class="section-title">Waiver Wire — Week ${week}</div>

        <div class="section-title">Guillotine Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${guillotineLeagues.length})</span></div>
        <div class="overview-list" style="margin-bottom:26px;">${guillotineLeagues.map(renderWaiverHubLeagueCard).join('')}</div>

        <div class="section-title">Redraft Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${redraftLeagues.length})</span></div>
        <div class="overview-list" style="margin-bottom:26px;">${redraftLeagues.map(renderWaiverHubLeagueCard).join('')}</div>

        <div class="section-title">Dynasty Leagues <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(${dynastyLeagues.length})</span></div>
        <div class="overview-list" style="margin-bottom:26px;">${dynastyLeagues.map(renderWaiverHubLeagueCard).join('')}</div>

        <div class="section-title">Your Bids This Week (Week ${week})</div>
        <div id="waiver-bids-summary">${renderWaiverBidsSummary(week)}</div>
      </div>`;
    bindTopbar();
    bindWaiverHub();
  }

function renderWaiverHubLeagueCard({lg, top5, error}){
    if(error) return '';
    const best = top5 && top5.length ? top5[0] : null;
    const detail = state.leagueDetail[lg.league_id];
    const myRoster = detail ? detail.rosters.find(r=>r.roster_id===detail.myRosterId) : null;
    const faab = detail && myRoster ? ((detail.league.settings?.waiver_budget||0) - (myRoster.settings?.waiver_budget_used||0)) : null;
    const bids = (state.waiverBids||[]).filter(b=>b.leagueId===lg.league_id && b.week===getProjectionWeek()).length;
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

function renderWaiverBidsSummary(week){
    const bids = (state.waiverBids||[]).filter(b => b.week === week);
    if(!bids.length) return '<div style="color:var(--chalk-faint); font-size:12px;">No bids staged for this week yet.</div>';
    const total = bids.reduce((s,b) => s + (parseFloat(b.amount)||0), 0);
    return `
      <div class="overview-list">
        ${bids.map(b => {
          const info = playerLabel(b.playerId);
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

  function bindWaiverHub(){
    const week = getProjectionWeek();
    state.leagues.forEach(lg => {
      const el = document.getElementById('waiver-open-' + lg.league_id);
      if(el) el.addEventListener('click', () => {
        state.waiverHubLeagueId = lg.league_id;
        state.view = 'waiverHubDetail';
        render();
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
          await saveWaiverBids(state.waiverBids);
          toast('Bid staged');
          const summaryEl = document.getElementById('waiver-bids-summary');
          if(summaryEl) summaryEl.innerHTML = renderWaiverBidsSummary(week);
          bindWaiverBidRemovals();
          render();
        });
        document.getElementById('bid-cancel-btn').addEventListener('click', () => render());
      });
    });
    bindWaiverBidRemovals();
  }

  function bindWaiverBidRemovals(){
    document.querySelectorAll('[data-remove-bid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.removeBid;
        state.waiverBids = (state.waiverBids||[]).filter(b => b.id !== id);
        await saveWaiverBids(state.waiverBids);
        document.getElementById('waiver-bids-summary').innerHTML = renderWaiverBidsSummary(getProjectionWeek());
        bindWaiverBidRemovals();
      });
    });
  }

  function renderWaiverHubDetail(){
    const lg = state.leagues.find(l => l.league_id === state.waiverHubLeagueId);
    const detail = state.leagueDetail[state.waiverHubLeagueId];
    if(!lg || !detail){
      return renderWaiverHub();
    }
    const week = getProjectionWeek();
    const {groups} = buildWaiverCandidatesByPosition(detail);

    app.innerHTML = `
      ${renderTopbar(true)}
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
    bindTopbar();
    document.getElementById('btn-back-to-waiverhub').addEventListener('click', () => {
      state.view = 'waiverHub';
      render();
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
                  <div class="slot-tag ${slotColorClass(pos)}">${pos}</div>
                  <div class="player-name ${nameColorClass(pos)}" style="flex:1;">${playerNameHTML(p)} <span style="color:var(--chalk-faint); font-size:11px;">${p.team}</span></div>
                  <div class="player-meta" style="width:170px;">${p.proj!=null ? `<span style="color:var(--gold);">Proj ${p.proj.toFixed(1)}</span>` : ''}${p.adds ? ` · +${p.adds} adds` : ''}</div>
                  <button class="btn btn-primary" data-stage-bid="${p.pid}" data-league-id="${lg.league_id}" data-league-name="${lg.name}" style="font-size:11px; padding:5px 10px;">Bid</button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');
      resultsEl.innerHTML = html || '<div style="color:var(--chalk-faint); font-size:13px;">No matching players.</div>';
      bindWaiverHub();
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

  async function renderPlayerShares(){
    renderLoading('Building your player shares...');
    await ensurePlayersLoaded();
    for(const lg of state.leagues){
      if(!state.leagueDetail[lg.league_id]){
        try{
          state.leagueDetail[lg.league_id] = await loadLeagueDetail(lg.league_id, state.sleeperUserId);
        }catch(e){ /* league skipped if it fails to load */ }
      }
    }
    if(!state.sharesMainTab) state.sharesMainTab = 'all';
    if(!state.sharesSubTab) state.sharesSubTab = 'all';
    if(!state.sharesThirdTab) state.sharesThirdTab = 'all';
    paintPlayerShares();
  }

  function scopedLeaguesForShares(){
    const nonDynasty = state.leagues.filter(lg => !isDynastyLeague(lg.name));
    if(state.sharesMainTab === 'all') return state.leagues;
    if(state.sharesMainTab === 'dynasty') return state.leagues.filter(lg => isDynastyLeague(lg.name));
    if(state.sharesSubTab === 'guillotine') return nonDynasty.filter(lg => isGuillotineLeague(lg.name));
    if(state.sharesSubTab === 'redraft'){
      const trueRedraft = nonDynasty.filter(lg => !isGuillotineLeague(lg.name));
      if(state.sharesThirdTab === 'managed') return trueRedraft.filter(lg => categoryForLeagueName(lg.name) === 'Redraft (Managed)');
      if(state.sharesThirdTab === 'unmanaged') return trueRedraft.filter(lg => categoryForLeagueName(lg.name) === 'Redraft (Unmanaged)');
      return trueRedraft; // 'all'
    }
    return nonDynasty; // redraft top-level 'all'
  }

  function isDraftComplete(detail){
    const status = detail && detail.league && detail.league.status;
    return !!status && status !== 'pre_draft' && status !== 'drafting';
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
    const draftedLeagues = leaguesScope.filter(lg => isDraftComplete(state.leagueDetail[lg.league_id]));
    const totalDrafted = draftedLeagues.length;
    return Object.keys(shareMap).map(pid => {
      const info = playerLabel(pid);
      const count = shareMap[pid].count;
      const pct = totalDrafted > 0 ? (count / totalDrafted * 100) : 0;
      return {pid, info, count, pct, leagues: shareMap[pid].leagues};
    }).sort((a,b) => b.count - a.count || (a.info?a.info.name:'').localeCompare(b.info?b.info.name:''));
  }

  function paintPlayerShares(){
    const scopeLeagues = scopedLeaguesForShares();
    const list = buildShareList(scopeLeagues);

    app.innerHTML = `
      ${renderTopbar(true)}
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
    bindTopbar();

    document.querySelectorAll('[data-main]').forEach(t => t.addEventListener('click', ()=>{
      state.sharesMainTab = t.dataset.main;
      state.sharesSubTab = 'all';
      state.sharesThirdTab = 'all';
      paintPlayerShares();
    }));
    document.querySelectorAll('[data-sub]').forEach(t => t.addEventListener('click', ()=>{
      state.sharesSubTab = t.dataset.sub;
      state.sharesThirdTab = 'all';
      paintPlayerShares();
    }));
    document.querySelectorAll('[data-third]').forEach(t => t.addEventListener('click', ()=>{
      state.sharesThirdTab = t.dataset.third;
      paintPlayerShares();
    }));

    function paintList(query){
      const q = query.trim().toLowerCase();
      const minShares = state.shareMinFilter || 1; const posFilter = state.sharePositionFilter || "ALL"; const base=(q ? list.filter(p => p.info && p.info.name.toLowerCase().includes(q)) : list); const filtered=base.filter(p=>p.count>=minShares).filter(p=>posFilter==="ALL" || (p.info && p.info.pos===posFilter));
      const grouped={QB:[],RB:[],WR:[],TE:[],OTHER:[]}; filtered.forEach(p=>{const k=(p.info&&['QB','RB','WR','TE'].includes(p.info.pos))?p.info.pos:'OTHER'; grouped[k].push(p);}); document.getElementById('shares-list').innerHTML = ['QB','RB','WR','TE','OTHER'].map(pos=>{ const arr=grouped[pos]; if(!arr.length) return ''; return `<div style="margin-bottom:20px;"><div class="roster-group-title">${pos==='OTHER'?'Other Positions':pos+' Exposure'}</div><div class="roster-list">${arr.map(p => `
            <div class="player-row">
              <div class="slot-tag ${slotColorClass(p.info?p.info.pos:'')}">${p.info?p.info.pos:'?'}</div>
              <div style="flex:1; min-width:0;">
                <div class="player-name ${p.info?nameColorClass(p.info.pos):''}">${p.info?playerNameHTML(p.info):p.pid}</div>
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

  // Leagues with no real money on the line — no buy-in/payout tracking needed for these.
  const FREE_LEAGUE_NAMES = ['24hr maccas'];
  function isFreeLeague(name){
    const lower = (name||'').toLowerCase();
    return FREE_LEAGUE_NAMES.some(n => lower.includes(n));
  }

  // The one league that gets the deep-dive Season Planner tab.
  const PLANNER_LEAGUE_NAMES = ['24hr maccas'];
  function isPlannerLeague(name){
    const lower = (name||'').toLowerCase();
    return PLANNER_LEAGUE_NAMES.some(n => lower.includes(n));
  }

  // Feature 2: user-entered matchup difficulty rankings (1=hardest, 32=easiest),
  // one ranking set per position (QB/RB/WR/TE/DEF). Stored once, globally —
  // these describe NFL defenses, not anything league-specific.
  const RANKING_POSITIONS = ['QB','RB','WR','TE','DEF'];
  async function loadMatchupRankings(){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'matchupRankings');
      return v ? JSON.parse(v) : {};
    }catch(e){ return {}; }
  }
  async function saveMatchupRankings(data){
    try{ localStorage.setItem(APP_PREFIX + 'matchupRankings', JSON.stringify(data)); }catch(e){}
  }
  function getMatchupDifficulty(pos, oppTeam){
    const table = state.matchupRankings && state.matchupRankings[pos];
    if(!table) return null;
    const r = table[oppTeam];
    return (r === '' || r == null) ? null : parseInt(r, 10);
  }
  // 1 (hardest) -> dark red, 32 (easiest) -> dark green, through orange/yellow between.
  function rankColor(rank){
    if(rank == null || isNaN(rank)) return null;
    const clamped = Math.max(1, Math.min(32, rank));
    const hue = (clamped - 1) / 31 * 120;
    return `hsl(${hue.toFixed(0)}, 68%, 34%)`;
  }

  // Feature 3: planned FAAB bids — a personal checklist, not a real Sleeper
  // waiver claim. {leagueId, leagueName, week, playerId, amount}
  async function loadWaiverBids(){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'waiverBids');
      return v ? JSON.parse(v) : [];
    }catch(e){ return []; }
  }
  async function saveWaiverBids(bids){
    try{ localStorage.setItem(APP_PREFIX + 'waiverBids', JSON.stringify(bids)); }catch(e){}
  }

  async function renderLeagueDetail(){
    const detail = state.leagueDetail[state.currentLeagueId];
    const lg = state.leagues.find(l => l.league_id === state.currentLeagueId);
    if(!detail){ state.view='leagues'; return render(); }
    const free = isFreeLeague(lg.name);
    const guillotineFmt = isGuillotineLeague(lg.name);
    const plannerLeague = isPlannerLeague(lg.name);
    if(free && state.currentTab === 'payouts'){ state.currentTab = 'standings'; }
    if(guillotineFmt && state.currentTab === 'matchup'){ state.currentTab = 'standings'; }

    app.innerHTML = `
      ${renderTopbar(true)}
      <div class="body-scroll">
        <div class="league-header">
          <h2>${lg.name}</h2>
          <span class="pill">${detail.league.status}</span>
          ${free ? `<span class="pill pill-out">Free League</span>` : ''}
        </div>
        <div class="tabs">
          <div class="tab ${state.currentTab==='standings'?'active':''}" data-tab="standings">Standings</div>
          <div class="tab ${state.currentTab==='rosters'?'active':''}" data-tab="rosters">Rosters</div>
          ${guillotineFmt ? '' : `<div class="tab ${state.currentTab==='matchup'?'active':''}" data-tab="matchup">Week ${getProjectionWeek()} Matchup</div>`}
          <div class="tab ${state.currentTab==='waiver'?'active':''}" data-tab="waiver">Waiver Wire</div>
          ${plannerLeague ? `<div class="tab ${state.currentTab==='planner'?'active':''}" data-tab="planner">Season Planner</div>` : ''}
          ${free ? '' : `<div class="tab ${state.currentTab==='payouts'?'active':''}" data-tab="payouts">Buy-in &amp; Payouts</div>`}
        </div>
        <div id="tab-content"></div>
      </div>
    `;
    bindTopbar();
    app.querySelectorAll('.tab').forEach(t => t.addEventListener('click', ()=>{
      state.currentTab = t.dataset.tab;
      render();
    }));

    const content = document.getElementById('tab-content');
    if(state.currentTab === 'standings'){
      if(guillotineFmt){
        content.innerHTML = renderGuillotineStandingsTab(detail);
        bindGuillotineStandings(detail);
      } else {
        content.innerHTML = renderStandingsTab(detail);
      }
    } else if(state.currentTab === 'rosters'){
      content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading player data and projections...</div>`;
      await Promise.all([ensurePlayersLoaded(), ensureProjectionsLoaded().catch(()=>null)]);
      content.innerHTML = renderRostersTab(detail);
      bindRosterPicker(detail);
    } else if(state.currentTab === 'matchup' && !guillotineFmt){
      content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading Week ${getProjectionWeek()} matchup and projections...</div>`;
      await Promise.all([ensurePlayersLoaded(), ensureProjectionsLoaded().catch(()=>null)]);
      if(!detail.matchupsWeek1){
        try{
          detail.matchupsWeek1 = await fetchJSON(`https://api.sleeper.app/v1/league/${state.currentLeagueId}/matchups/${getProjectionWeek()}`);
        }catch(e){
          detail.matchupsWeek1 = [];
        }
      }
      content.innerHTML = renderMatchupTab(detail);
      bindMatchupTab(detail);
    } else if(state.currentTab === 'waiver'){
      content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading player pool, trending adds, and projections...</div>`;
      await Promise.all([ensurePlayersLoaded(), ensureTrendingLoaded(), ensureProjectionsLoaded().catch(()=>null)]);
      content.innerHTML = renderWaiverWireTab(detail);
    } else if(state.currentTab === 'planner' && plannerLeague){
      content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading planner data...</div>`;
      if(!state.plannerWeek) state.plannerWeek = getProjectionWeek();
      if(!state.plannerSubView) state.plannerSubView = 'lineup';
      if(!state.matchupRankings) state.matchupRankings = await loadMatchupRankings();
      await Promise.all([ensurePlayersLoaded(), ensurePlannerProjectionsForWeek(state.plannerWeek).catch(()=>null)]);
      if(!detail.plannerMoves){
        detail.plannerMoves = await loadPlannerMoves(state.currentLeagueId);
      }
      content.innerHTML = renderSeasonPlannerTab(detail);
      bindSeasonPlannerTab(detail);
    } else if(state.currentTab === 'payouts' && !free){
      content.innerHTML = renderPayoutsTab(detail, lg.name);
      bindPayoutsForm(detail, lg.name);
    }
  }

  function renderStandingsTab(detail){
    const standings = computeStandings(detail.rosters, detail.usersById);
    const playoffTeams = (detail.league.settings && detail.league.settings.playoff_teams) || 0;
    let rowsHTML = '';
    standings.forEach((row, idx) => {
      if(playoffTeams > 0 && idx === playoffTeams){
        rowsHTML += `<tr><td colspan="6" style="padding:0; border:none;">
          <div class="yard-marker"><span class="yard-marker-label">Playoff Line</span></div>
        </td></tr>`;
      }
      const isMe = row.roster_id === detail.myRosterId;
      const u = row.user;
      rowsHTML += `
        <tr class="${isMe?'me':''}">
          <td><span class="rank-num">${idx+1}</span></td>
          <td>
            <div class="team-cell">
              ${avatarHTML(u&&u.avatar, u&&u.display_name)}
              <div>
                <div class="team-name">${teamDisplayName(u, row.raw)}${isMe?' <span style="color:var(--gold); font-size:11px;">(You)</span>':''}</div>
                <div class="owner-name">${u ? u.display_name : 'Unknown'}</div>
              </div>
            </div>
          </td>
          <td class="mono">${row.wins}-${row.losses}${row.ties?('-'+row.ties):''}</td>
          <td class="mono">${row.pf.toFixed(2)}</td>
          <td class="mono">${row.pa.toFixed(2)}</td>
        </tr>
      `;
    });
    return `
      <table class="standings-table">
        <thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th></tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    `;
  }

  function faabRemaining(row, detail){
    const total = (detail.league.settings && detail.league.settings.waiver_budget) || 0;
    const used = (row.raw.settings && row.raw.settings.waiver_budget_used) || 0;
    return {total, remaining: total - used};
  }

  function guillotineRowHTML(row, detail, isCut){
    const u = row.user;
    const isMe = row.roster_id === detail.myRosterId;
    const faab = faabRemaining(row, detail);
    return `
      <div class="guillotine-row ${isCut?'cut-row':''} ${isMe?'me':''}">
        <div class="team-cell">
          ${avatarHTML(u&&u.avatar, u&&u.display_name)}
          <div>
            <div class="team-name">${teamDisplayName(u, row.raw)}${isMe?' <span style="color:var(--gold); font-size:11px;">(You)</span>':''}</div>
            <div class="owner-name">${u ? u.display_name : 'Unknown'}</div>
          </div>
        </div>
        <div class="guillotine-pf mono">${row.pf.toFixed(2)} <span style="color:var(--chalk-faint); font-size:10px;">PF</span></div>
        ${faab.total > 0 ? `<div class="guillotine-faab mono">$${faab.remaining} <span style="color:var(--chalk-faint); font-size:10px;">FAAB</span></div>` : ''}
        ${isCut
          ? `<span class="cut-badge">${GUILLOTINE_ICON} CUT</span><button class="btn-ghost" data-restore="${row.roster_id}">Restore</button>`
          : `<button class="btn-danger-ghost" data-cut="${row.roster_id}">Mark Cut</button>`}
      </div>
    `;
  }

  function renderGuillotineStandingsTab(detail){
    const standings = computeStandings(detail.rosters, detail.usersById);
    const sorted = [...standings].sort((a,b) => b.pf - a.pf);
    const cutSet = new Set(detail.cutRosters || []);
    const alive = sorted.filter(r => !cutSet.has(r.roster_id));
    const cut = sorted.filter(r => cutSet.has(r.roster_id));
    const leagueBudget = (detail.league.settings && detail.league.settings.waiver_budget) || 0;
    const totalFaabRemaining = alive.reduce((sum, r) => sum + faabRemaining(r, detail).remaining, 0);
    const myRow = alive.find(r => r.roster_id === detail.myRosterId);
    const iAmCut = !myRow && cutSet.has(detail.myRosterId);
    const myFaab = myRow ? faabRemaining(myRow, detail).remaining : 0;
    const myShare = (totalFaabRemaining > 0 && myRow) ? (myFaab / totalFaabRemaining * 100) : 0;
    const fairShare = alive.length > 0 ? (100 / alive.length) : 0;
    const fairShareDollars = alive.length > 0 ? (totalFaabRemaining / alive.length) : 0;

    return `
      ${leagueBudget > 0 ? `
      <div class="overview-summary" style="margin-bottom:18px; flex-wrap:wrap;">
        <div class="overview-summary-item">
          <div class="overview-summary-label">Total FAAB Remaining (Still In)</div>
          <div class="overview-summary-val">$${totalFaabRemaining}</div>
        </div>
        ${myRow ? `
        <div class="overview-summary-item">
          <div class="overview-summary-label">Your FAAB</div>
          <div class="overview-summary-val">$${myFaab}</div>
        </div>
        <div class="overview-summary-item">
          <div class="overview-summary-label">Your Share of Remaining Pool</div>
          <div class="overview-summary-val">${myShare.toFixed(1)}%</div>
        </div>
        <div class="overview-summary-item">
          <div class="overview-summary-label">Equal Split Would Be</div>
          <div class="overview-summary-val">${fairShare.toFixed(1)}%<span style="font-size:14px; color:var(--chalk-faint);"> ($${fairShareDollars.toFixed(0)})</span></div>
        </div>` : iAmCut ? `
        <div class="overview-summary-item" style="border-left-color:var(--alert);">
          <div class="overview-summary-label">Your FAAB</div>
          <div class="overview-summary-val" style="font-size:16px; color:var(--chalk-dim);">You're cut</div>
        </div>` : ''}
      </div>` : ''}
      <div class="section-title">Still In (${alive.length}) <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">— ranked by points for</span></div>
      <div class="guillotine-list">
        ${alive.map(r => guillotineRowHTML(r, detail, false)).join('') || '<div style="color:var(--chalk-faint); font-size:13px; padding:8px 2px;">Nobody left — grim.</div>'}
      </div>
      ${cut.length ? `
        <div class="section-title" style="margin-top:24px;">Eliminated 💀</div>
        <div class="guillotine-list">
          ${cut.map(r => guillotineRowHTML(r, detail, true)).join('')}
        </div>
      ` : ''}
      ${leagueBudget > 0 && myRow ? `<div class="empty-note">Your share vs. an equal split tells you whether you're FAAB-rich or FAAB-poor relative to the field — above the equal-split number means you have more buying power than average, below means less.</div>` : ''}
      <div class="empty-note" style="margin-top:8px;">Sleeper doesn't track eliminations for guillotine leagues, so mark teams cut yourself as they go — it's saved to this league from then on.</div>
      <div class="empty-note" style="margin-top:14px;">Sleeper doesn't track eliminations for guillotine leagues, so mark teams cut yourself as they go — it's saved to this league from then on.</div>
    `;
  }

  function bindGuillotineStandings(detail){
    function rebind(){
      document.querySelectorAll('[data-cut]').forEach(btn => {
        btn.addEventListener('click', async ()=>{
          const rid = parseInt(btn.dataset.cut, 10);
          const set = new Set(detail.cutRosters || []);
          set.add(rid);
          detail.cutRosters = Array.from(set);
          await saveCutRosters(state.currentLeagueId, detail.cutRosters);
          document.getElementById('tab-content').innerHTML = renderGuillotineStandingsTab(detail);
          rebind();
        });
      });
      document.querySelectorAll('[data-restore]').forEach(btn => {
        btn.addEventListener('click', async ()=>{
          const rid = parseInt(btn.dataset.restore, 10);
          detail.cutRosters = (detail.cutRosters || []).filter(x => x !== rid);
          await saveCutRosters(state.currentLeagueId, detail.cutRosters);
          document.getElementById('tab-content').innerHTML = renderGuillotineStandingsTab(detail);
          rebind();
        });
      });
    }
    rebind();
  }


  const WAIVER_POSITIONS = ['QB','RB','WR','TE','K','DEF'];

  function computeOwnedPlayerIds(detail){
    const owned = new Set();
    detail.rosters.forEach(r => (r.players || []).forEach(pid => owned.add(pid)));
    return owned;
  }

  function findMatchupPair(detail){
    const matchups = detail.matchupsWeek1 || [];
    const mine = matchups.find(m => m.roster_id === detail.myRosterId);
    if(!mine) return null;
    const opp = matchups.find(m => m.matchup_id === mine.matchup_id && m.roster_id !== mine.roster_id);
    return {mine, opp};
  }

  function renderMatchupPanel(teamKey, opt, league){
    const total = lineupTotal(opt.assignment, opt.pool);
    const usedElsewhereBase = opt.assignment;
    const rowsHTML = opt.slotOrder.map((slot, i) => {
      const pid = opt.assignment[i];
      const eligible = SLOT_ELIGIBILITY[slot] || [slot];
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
          <div class="slot-tag ${slotColorClass(slot)}">${slotLabel(slot)}</div>
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
        <div class="player-name ${nameColorClass(p.pos)}" style="flex:1; font-size:12.5px;">${p.info ? playerNameHTML(p.info) : p.pid}</div>
        <div class="mono" style="width:48px; text-align:right; color:var(--chalk-dim); font-size:12px;">${p.hasProj ? p.proj.toFixed(1) : '—'}</div>
      </div>
    `).join('') : '<div style="color:var(--chalk-faint); font-size:12px; padding:4px 0;">Nobody left on the bench.</div>';

    return `
      <div class="matchup-panel" id="matchup-panel-${teamKey}">
        <div class="matchup-panel-header">
          ${avatarHTML(opt.user && opt.user.avatar, opt.user && opt.user.display_name, 32)}
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
    const pair = findMatchupPair(detail);
    if(!pair || !pair.opp){
      detail.matchupState = null;
      return `<div class="empty-note">Week ${getProjectionWeek()} matchups haven't been generated for this league yet — Sleeper publishes the schedule closer to the season starting. Check back later.</div>`;
    }
    const myRoster = detail.rosters.find(r => r.roster_id === pair.mine.roster_id);
    const oppRoster = detail.rosters.find(r => r.roster_id === pair.opp.roster_id);
    const myUser = detail.usersById[myRoster.owner_id];
    const oppUser = detail.usersById[oppRoster.owner_id];

    detail.matchupState = {
      my: {...computeOptimalLineup(myRoster, detail.league), teamName: teamDisplayName(myUser, myRoster) + ' (You)', user: myUser},
      opp: {...computeOptimalLineup(oppRoster, detail.league), teamName: teamDisplayName(oppUser, oppRoster), user: oppUser},
    };

    return `
      <div class="empty-note" style="margin-bottom:14px;">Both lineups are auto-built from Week ${getProjectionWeek()} projections into each team's best possible starting lineup. Use the dropdowns to swap any player and see how each total — and the edge — changes.</div>
      <div id="matchup-edge" style="margin-bottom:14px;"></div>
      <div class="matchup-grid">
        ${renderMatchupPanel('my', detail.matchupState.my, detail.league)}
        <div class="matchup-vs">VS</div>
        ${renderMatchupPanel('opp', detail.matchupState.opp, detail.league)}
      </div>
    `;
  }

  function bindMatchupTab(detail){
    if(!detail.matchupState) return;

    function updateEdge(){
      const edgeEl = document.getElementById('matchup-edge');
      if(!edgeEl) return;
      const myTotal = lineupTotal(detail.matchupState.my.assignment, detail.matchupState.my.pool);
      const oppTotal = lineupTotal(detail.matchupState.opp.assignment, detail.matchupState.opp.pool);
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
          panelEl.outerHTML = renderMatchupPanel(teamKey, detail.matchupState[teamKey], detail.league);
          bindPanel(teamKey);
          updateEdge();
        });
      });
    }

    bindPanel('my');
    bindPanel('opp');
    updateEdge();
  }

  function computeEffectiveRosterPids(basePids, moves, week){
    let pids = [...basePids];
    const applicable = moves.filter(m => m.week <= week).sort((a,b) => a.week - b.week);
    applicable.forEach(m => {
      if(m.dropPid) pids = pids.filter(p => p !== m.dropPid);
      if(m.addPid && !pids.includes(m.addPid)) pids.push(m.addPid);
    });
    return pids;
  }

  function getInjuryBadge(pid){
    const p = state.playersCache ? state.playersCache[pid] : null;
    const status = p && p.injury_status;
    if(!status) return '';
    const color = (status === 'Out' || status === 'IR' || status === 'PUP') ? '#E85C4A' : '#E0A458';
    return ` <span style="color:${color}; font-size:10px; font-weight:700; border:1px solid ${color}; border-radius:4px; padding:1px 4px;">${status.toUpperCase()}</span>`;
  }

  function plannerMatchupText(pid, week){
    const info = playerLabel(pid);
    if(!info || !info.team || info.team === 'FA') return '';
    if(BYE_WEEKS[info.team] === week) return '<span style="color:var(--chalk-faint);">BYE</span>';
    const m = getMatchup(info.team, week);
    if(!m) return '<span style="color:var(--chalk-faint);">—</span>';
    const rank = getMatchupDifficulty(info.pos, m.opp);
    const color = rankColor(rank);
    const badge = color ? ` <span style="background:${color}; color:#fff; padding:0 4px; border-radius:3px; font-size:10px; font-weight:700;">${rank}</span>` : '';
    return `vs ${m.opp}${badge}`;
  }

  function renderPlannerLineupSection(detail){
    const st = detail.plannerState;
    const total = lineupTotal(st.assignment, st.pool);
    const usedSet = new Set(st.assignment.filter(Boolean));
    const bench = st.pool.filter(p => !usedSet.has(p.pid)).sort((a,b) => b.proj - a.proj);

    const slotRows = st.slotOrder.map((slot,i) => {
      const pid = st.assignment[i];
      const eligible = SLOT_ELIGIBILITY[slot] || [slot];
      const usedElsewhere = new Set(st.assignment.filter((v,idx)=>idx!==i && v));
      const candidates = st.pool.filter(p => eligible.includes(p.pos)).filter(p => !usedElsewhere.has(p.pid) || p.pid===pid).sort((a,b)=>b.proj-a.proj);
      const optionsHTML = candidates.map(p => `<option value="${p.pid}" ${p.pid===pid?'selected':''}>${p.info?p.info.name:p.pid} (${p.pos}) — ${p.hasProj?p.proj.toFixed(1):'—'} pts</option>`).join('');
      const chosen = st.pool.find(p=>p.pid===pid);
      return `
        <div class="matchup-slot-row">
          <div class="slot-tag ${slotColorClass(slot)}">${slotLabel(slot)}</div>
          <select class="matchup-select" data-planner-slot="${i}">
            ${!pid ? '<option value="" selected>— Empty —</option>' : ''}${optionsHTML}
          </select>
          <div style="width:90px; font-size:11px; color:var(--chalk-dim);">${pid ? plannerMatchupText(pid, st.week) : ''}${pid?getInjuryBadge(pid):''}</div>
          <div class="mono" style="width:44px; text-align:right; color:var(--chalk-dim); font-size:12px;">${chosen ? (chosen.hasProj?chosen.proj.toFixed(1):'—') : '0.0'}</div>
        </div>
      `;
    }).join('');

    const benchHTML = bench.map(p => `
      <div class="matchup-slot-row">
        <div class="slot-tag tag-grey">BN</div>
        <div class="player-name ${p.info?nameColorClass(p.info.pos):''}" style="flex:1; font-size:12.5px;">${p.info?playerNameHTML(p.info):p.pid}</div>
        <div style="width:90px; font-size:11px; color:var(--chalk-dim);">${plannerMatchupText(p.pid, st.week)}${getInjuryBadge(p.pid)}</div>
        <div class="mono" style="width:44px; text-align:right; color:var(--chalk-dim); font-size:12px;">${p.hasProj?p.proj.toFixed(1):'—'}</div>
      </div>
    `).join('') || '<div style="color:var(--chalk-faint); font-size:12px; padding:6px 0;">Nobody on the bench.</div>';

    return `
      <div class="matchup-total" id="planner-total" style="margin-bottom:14px;">${total.toFixed(1)}<span style="font-size:12px; color:var(--chalk-faint); font-family:'Inter',sans-serif;"> pts — Week ${st.week} plan</span></div>
      <div class="roster-group-title">Starting Lineup</div>
      <div class="matchup-slots" style="margin-bottom:18px;">${slotRows}</div>
      <div class="roster-group-title">Bench</div>
      <div class="matchup-slots" style="margin-bottom:22px;">${benchHTML}</div>
    `;
  }

  function renderPlannerLineupView(detail){
    const myRoster = detail.rosters.find(r => r.roster_id === detail.myRosterId);
    if(!myRoster) return `<div class="empty-note">Couldn't find your team in this league.</div>`;
    const week = state.plannerWeek;
    const excluded = new Set([...(myRoster.reserve||[]), ...(myRoster.taxi||[])]);
    const basePids = (myRoster.players || []).filter(pid => !excluded.has(pid));
    const effectivePids = computeEffectiveRosterPids(basePids, detail.plannerMoves, week);
    const lineup = computePlannerLineup(effectivePids, detail.league, week);
    detail.plannerState = {week, slotOrder: lineup.slotOrder, assignment: lineup.assignment, pool: lineup.pool};

    const weekButtons = Array.from({length:18}, (_,i)=>i+1).map(w =>
      `<button class="btn ${w===week?'btn-primary':'btn-ghost'}" data-planner-week="${w}" style="padding:5px 9px; font-size:12px;">${w}</button>`
    ).join('');

    const movesThisFar = detail.plannerMoves.slice().sort((a,b)=>a.week-b.week);
    const movesHTML = movesThisFar.length ? movesThisFar.map((m,idx) => {
      const addInfo = playerLabel(m.addPid);
      const dropInfo = playerLabel(m.dropPid);
      return `
        <div class="overview-row" style="cursor:default; padding:10px 14px;">
          <div class="overview-main">
            <div style="font-size:12px;"><strong>Week ${m.week}:</strong> +${addInfo?addInfo.name:m.addPid} / −${dropInfo?dropInfo.name:m.dropPid}</div>
          </div>
          <button class="btn-danger-ghost" data-remove-move="${idx}">Undo</button>
        </div>
      `;
    }).join('') : '<div style="color:var(--chalk-faint); font-size:12px;">No planned moves yet.</div>';

    return `
      <div class="empty-note" style="margin-bottom:10px;">
        Plan your lineup week by week and test out waiver moves before making them for real — this is a personal what-if planner and can't submit anything to Sleeper itself. Matchup shows opponent only (no home/away — ask if you want to know why), pulled from the 2026 schedule; BYE and injury status come straight from Sleeper's own data. Swapping players in the lineup below is a live "what if" — it recalculates instantly but doesn't touch your real roster; use "Add From Waivers" to actually change who's on your team.
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px;">${weekButtons}</div>
      <div id="planner-lineup-section">${renderPlannerLineupSection(detail)}</div>

      <div class="payout-card">
        <div class="section-title" style="margin-top:0;">Add From Waivers (effective Week ${week} onward)</div>
        <div class="field" style="max-width:320px;">
          <label>Search available players</label>
          <input id="planner-waiver-search" type="text" placeholder="e.g. player name"/>
        </div>
        <div id="planner-waiver-results" style="margin-top:10px;"></div>
      </div>

      <div class="payout-card" style="margin-top:16px;">
        <div class="section-title" style="margin-top:0;">Planned Moves</div>
        <div class="overview-list">${movesHTML}</div>
      </div>
    `;
  }

  function renderSeasonPlannerTab(detail){
    const sub = state.plannerSubView;
    return `
      <div class="tabs" style="margin-bottom:16px;">
        <div class="tab ${sub==='lineup'?'active':''}" data-planner-sub="lineup">Lineup Planner</div>
        <div class="tab ${sub==='rankings'?'active':''}" data-planner-sub="rankings">Matchup Rankings</div>
        <div class="tab ${sub==='season'?'active':''}" data-planner-sub="season">Season Overview</div>
      </div>
      <div id="planner-subview">
        ${sub === 'rankings' ? renderMatchupRankingsView() : sub === 'season' ? renderSeasonOverviewView(detail) : renderPlannerLineupView(detail)}
      </div>
    `;
  }

  function bindSeasonPlannerTab(detail){
    document.querySelectorAll('[data-planner-sub]').forEach(t => t.addEventListener('click', () => {
      state.plannerSubView = t.dataset.plannerSub;
      render();
    }));
    const sub = state.plannerSubView;
    if(sub === 'rankings') bindMatchupRankingsView();
    else if(sub !== 'season') bindPlannerLineupView(detail);
  }

  function renderMatchupRankingsView(){
    if(!state.rankingsPositionTab) state.rankingsPositionTab = 'QB';
    const pos = state.rankingsPositionTab;
    const table = (state.matchupRankings && state.matchupRankings[pos]) || {};
    const teams = Object.keys(BYE_WEEKS).sort();
    const posTabsHTML = RANKING_POSITIONS.map(p =>
      `<div class="tab ${p===pos?'active':''}" data-ranking-pos="${p}">${p}</div>`
    ).join('');
    const rowsHTML = teams.map(team => `
      <div style="display:flex; align-items:center; gap:10px; padding:6px 4px; border-bottom:1px solid var(--line);">
        <div style="width:48px; font-weight:600; font-size:13px;">${team}</div>
        <input type="number" min="1" max="32" data-rank-team="${team}" value="${table[team] != null ? table[team] : ''}" placeholder="1-32" style="width:70px; background:var(--bg); border:1px solid var(--line-strong); color:var(--chalk); padding:6px 8px; border-radius:6px; font-family:'IBM Plex Mono',monospace;"/>
        <div id="rank-swatch-${team}" style="width:20px; height:20px; border-radius:4px; background:${rankColor(table[team]) || 'transparent'}; border:1px solid var(--line-strong);"></div>
      </div>
    `).join('');

    return `
      <div class="empty-note" style="margin-bottom:14px;">
        Enter each team's matchup difficulty for this position: <strong>1 = hardest matchup, 32 = easiest</strong>. These are your own rankings — Sleeper doesn't provide this. Every number 1-32 should be used once per position, but nothing stops you from leaving gaps or duplicates if you're still working through it.
      </div>
      <div class="tabs" style="margin-bottom:14px;">${posTabsHTML}</div>
      <div style="max-width:280px; max-height:520px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:4px 10px;">${rowsHTML}</div>
      <button class="btn btn-primary" id="btn-save-rankings" style="margin-top:14px;">Save ${pos} Rankings</button>
    `;
  }

  function bindMatchupRankingsView(){
    document.querySelectorAll('[data-ranking-pos]').forEach(t => t.addEventListener('click', () => {
      state.rankingsPositionTab = t.dataset.rankingPos;
      document.getElementById('planner-subview').innerHTML = renderMatchupRankingsView();
      bindMatchupRankingsView();
    }));
    document.querySelectorAll('[data-rank-team]').forEach(inp => {
      inp.addEventListener('input', () => {
        const swatch = document.getElementById('rank-swatch-' + inp.dataset.rankTeam);
        if(swatch) swatch.style.background = rankColor(parseInt(inp.value,10)) || 'transparent';
      });
    });
    const saveBtn = document.getElementById('btn-save-rankings');
    if(saveBtn) saveBtn.addEventListener('click', async () => {
      const pos = state.rankingsPositionTab;
      if(!state.matchupRankings) state.matchupRankings = {};
      const table = {};
      document.querySelectorAll('[data-rank-team]').forEach(inp => {
        if(inp.value !== '') table[inp.dataset.rankTeam] = parseInt(inp.value, 10);
      });
      state.matchupRankings[pos] = table;
      await saveMatchupRankings(state.matchupRankings);
      toast(pos + ' rankings saved');
    });
  }

  function renderSeasonOverviewView(detail){
    const myRoster = detail.rosters.find(r => r.roster_id === detail.myRosterId);
    if(!myRoster) return `<div class="empty-note">Couldn't find your team in this league.</div>`;
    const excluded = new Set([...(myRoster.reserve||[]), ...(myRoster.taxi||[])]);
    const pids = (myRoster.players || []).filter(pid => !excluded.has(pid));
    const players = pids.map(pid => ({pid, info: playerLabel(pid)})).filter(p => p.info)
      .sort((a,b) => (a.info.pos||'').localeCompare(b.info.pos||'') || a.info.name.localeCompare(b.info.name));

    const weekHeaders = Array.from({length:18}, (_,i)=>i+1).map(w => `<th style="min-width:36px;">${w}</th>`).join('');
    const rows = players.map(p => {
      const cells = Array.from({length:18}, (_,i) => {
        const week = i+1;
        const team = p.info.team;
        if(!team || team === 'FA') return '<td>—</td>';
        if(BYE_WEEKS[team] === week) return '<td style="color:var(--chalk-faint); font-size:11px;">BYE</td>';
        const m = getMatchup(team, week);
        if(!m) return '<td>—</td>';
        const rank = getMatchupDifficulty(p.info.pos, m.opp);
        const color = rankColor(rank);
        return `<td>${color ? `<span style="background:${color}; color:#fff; padding:1px 5px; border-radius:3px; font-size:10.5px; font-weight:700;">${rank}</span>` : '<span style="color:var(--chalk-faint); font-size:10.5px;">'+m.opp+'</span>'}</td>`;
      }).join('');
      return `<tr><td style="text-align:left; white-space:nowrap;"><span class="${nameColorClass(p.info.pos)}" style="font-weight:600;">${p.info.name}</span> <span style="color:var(--chalk-faint); font-size:11px;">${p.info.pos}</span></td>${cells}</tr>`;
    }).join('');

    return `
      <div class="empty-note" style="margin-bottom:14px;">Your current roster's matchup difficulty, Week 1 through 18, using the rankings you've entered. Blank/grey cells mean no ranking entered yet for that position.</div>
      <div style="overflow-x:auto;">
        <table class="standings-table" style="text-align:center;">
          <thead><tr><th style="text-align:left;">Player</th>${weekHeaders}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function bindPlannerLineupView(detail){
    const week = state.plannerWeek;

    document.querySelectorAll('[data-planner-week]').forEach(btn => {
      btn.addEventListener('click', async () => {
        state.plannerWeek = parseInt(btn.dataset.plannerWeek, 10);
        const content = document.getElementById('planner-subview');
        content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading Week ${state.plannerWeek} projections...</div>`;
        await ensurePlannerProjectionsForWeek(state.plannerWeek).catch(()=>null);
        content.innerHTML = renderPlannerLineupView(detail);
        bindPlannerLineupView(detail);
      });
    });

    function bindLineupSelects(){
      document.querySelectorAll('[data-planner-slot]').forEach(sel => {
        sel.addEventListener('change', () => {
          const slotIdx = parseInt(sel.dataset.plannerSlot, 10);
          detail.plannerState.assignment[slotIdx] = sel.value || null;
          document.getElementById('planner-lineup-section').innerHTML = renderPlannerLineupSection(detail);
          bindLineupSelects();
        });
      });
    }
    bindLineupSelects();

    document.querySelectorAll('[data-remove-move]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.removeMove, 10);
        const moves = detail.plannerMoves.slice().sort((a,b)=>a.week-b.week);
        const target = moves[idx];
        detail.plannerMoves = detail.plannerMoves.filter(m => m !== target);
        await savePlannerMoves(state.currentLeagueId, detail.plannerMoves);
        renderCurrentTab();
      });
    });

    function paintWaiverResults(query){
      const resultsEl = document.getElementById('planner-waiver-results');
      const q = query.trim().toLowerCase();
      if(q.length < 2){
        resultsEl.innerHTML = '<div style="color:var(--chalk-faint); font-size:12px;">Type at least 2 letters of a player\'s name.</div>';
        return;
      }
      const owned = computeOwnedPlayerIds(detail);
      const alreadyPlanned = new Set(detail.plannerMoves.map(m=>m.addPid));
      const cache = state.playersCache || {};
      const matches = [];
      for(const pid in cache){
        if(owned.has(pid) || alreadyPlanned.has(pid)) continue;
        const p = cache[pid];
        if(!p || !p.full_name) continue;
        if(p.full_name.toLowerCase().includes(q)){
          matches.push({pid, name: p.full_name, pos: p.position, team: p.team});
          if(matches.length >= 15) break;
        }
      }
      resultsEl.innerHTML = matches.length ? matches.map(p => `
        <div class="player-row">
          <div class="slot-tag ${slotColorClass(p.pos)}">${p.pos||'?'}</div>
          <div class="player-name ${nameColorClass(p.pos)}" style="flex:1;">${p.name} <span style="color:var(--chalk-faint); font-size:11px;">${p.team||'FA'}</span></div>
          <button class="btn btn-primary" data-stage-add="${p.pid}" style="font-size:11px; padding:5px 10px;">Add</button>
        </div>
      `).join('') : '<div style="color:var(--chalk-faint); font-size:12px;">No matching available players.</div>';

      resultsEl.querySelectorAll('[data-stage-add]').forEach(btn => {
        btn.addEventListener('click', () => {
          const addPid = btn.dataset.stageAdd;
          const myRoster = detail.rosters.find(r => r.roster_id === detail.myRosterId);
          const excluded = new Set([...(myRoster.reserve||[]), ...(myRoster.taxi||[])]);
          const basePids = (myRoster.players || []).filter(pid => !excluded.has(pid));
          const effectivePids = computeEffectiveRosterPids(basePids, detail.plannerMoves, week);
          const dropOptionsHTML = effectivePids.map(pid => {
            const info = playerLabel(pid);
            return `<option value="${pid}">${info?info.name:pid} (${info?info.pos:'?'})</option>`;
          }).join('');
          resultsEl.innerHTML = `
            <div class="payout-card">
              <div style="font-size:13px; margin-bottom:10px;">Adding <strong>${playerLabel(addPid)?playerLabel(addPid).name:addPid}</strong> starting Week ${week}. Who comes off your roster?</div>
              <div class="field">
                <label>Drop</label>
                <select id="planner-drop-select">${dropOptionsHTML}</select>
              </div>
              <button class="btn btn-primary" id="planner-confirm-move" style="margin-top:10px;">Confirm Move</button>
              <button class="btn btn-ghost" id="planner-cancel-move" style="margin-top:10px;">Cancel</button>
            </div>
          `;
          document.getElementById('planner-confirm-move').addEventListener('click', async () => {
            const dropPid = document.getElementById('planner-drop-select').value;
            detail.plannerMoves.push({week, addPid, dropPid});
            await savePlannerMoves(state.currentLeagueId, detail.plannerMoves);
            toast('Move planned');
            renderCurrentTab();
          });
          document.getElementById('planner-cancel-move').addEventListener('click', () => {
            paintWaiverResults(document.getElementById('planner-waiver-search').value);
          });
        });
      });
    }

    const searchInput = document.getElementById('planner-waiver-search');
    if(searchInput) searchInput.addEventListener('input', (e) => paintWaiverResults(e.target.value));
  }

  function renderCurrentTab(){
    render();
  }

  function buildWaiverCandidatesByPosition(detail){
    const owned = computeOwnedPlayerIds(detail);
    const trendingMap = {};
    (state.trendingCache || []).forEach(t => trendingMap[t.player_id] = t.count);
    const proj = state.projectionsCache;
    const groups = {};
    WAIVER_POSITIONS.forEach(p => groups[p] = []);

    if(proj){
      Object.keys(proj.byPlayer).forEach(pid => {
        if(owned.has(pid)) return;
        const info = playerLabel(pid);
        if(!info || !groups[info.pos]) return;
        const pts = projectedPoints(pid, detail.league);
        if(pts == null) return;
        groups[info.pos].push({...info, pid, proj: pts, adds: trendingMap[pid] || 0});
      });
    } else {
      // Projections didn't load this session (undocumented endpoint) — fall back to trending adds only.
      (state.trendingCache || []).forEach(t => {
        if(owned.has(t.player_id)) return;
        const info = playerLabel(t.player_id);
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
                <div class="slot-tag ${slotColorClass(pos)}">${pos}</div>
                <div class="player-name ${nameColorClass(pos)}">${playerNameHTML(p)}</div>
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

  function renderRostersTab(detail){
    const standings = computeStandings(detail.rosters, detail.usersById);
    if(!state.currentTeamRosterId){
      state.currentTeamRosterId = detail.myRosterId || (standings[0] && standings[0].roster_id);
    }
    const chips = standings.map(row => {
      const u = row.user;
      const active = row.roster_id === state.currentTeamRosterId;
      return `
        <div class="team-chip ${active?'active':''}" data-roster="${row.roster_id}">
          ${avatarHTML(u&&u.avatar, u&&u.display_name, 22)}
          <span class="team-chip-name">${teamDisplayName(u, row.raw)}${row.roster_id===detail.myRosterId?' ★':''}</span>
        </div>
      `;
    }).join('');

    const roster = detail.rosters.find(r => r.roster_id === state.currentTeamRosterId);
    const rosterGroupsHTML = roster ? renderRosterGroups(roster, detail.league) : '<p style="color:var(--chalk-dim);">Select a team.</p>';
    const proj = state.projectionsCache;

    return `
      <div class="team-picker">${chips}</div>
      ${proj ? `<div class="empty-note" style="margin-bottom:14px;">Projections shown are for <strong>Week ${proj.week}, ${proj.season} regular season</strong> — check this matches what you're comparing against in the Sleeper app.</div>` : `<div class="empty-note" style="margin-bottom:14px;">Projections didn't load this session — showing rosters without them.</div>`}
      <div id="roster-groups">${rosterGroupsHTML}</div>
    `;
  }

  const SLOT_LABELS = {
    'WRRB_FLEX':'WR/RB',
    'REC_FLEX':'WR/TE',
    'SUPER_FLEX':'SFLEX',
  };
  function slotLabel(slot){ return SLOT_LABELS[slot] || slot; }
  function slotColorClass(slot){
    if(slot === 'QB' || slot === 'SUPER_FLEX') return 'tag-red';
    if(slot === 'RB') return 'tag-green';
    if(slot === 'WR') return 'tag-blue';
    if(slot === 'TE') return 'tag-orange';
    if(slot === 'K') return 'tag-purple';
    if(slot === 'DEF') return 'tag-brown';
    if(slot === 'FLEX') return 'tag-mix-flex';
    if(slot === 'WRRB_FLEX') return 'tag-mix-wrrb';
    if(slot === 'REC_FLEX') return 'tag-mix-wrte';
    return '';
  }

  // 2026 NFL regular-season bye weeks by team (source: league schedule release, May 2026).
  // Static because byes are fixed once the schedule is out — not available on Sleeper's player endpoint.
  const BYE_WEEKS = {
    KC:5, CAR:5,
    MIA:6, CIN:6, DET:6, MIN:6,
    BUF:7, LAC:7, WAS:7, JAX:7,
    NYG:8, NO:8, SF:8, HOU:8,
    TEN:9, PIT:9,
    DEN:10, PHI:10, CHI:10, TB:10,
    NE:11, CLE:11, SEA:11, GB:11, ATL:11, LAR:11,
    IND:13, NYJ:13, LV:13, BAL:13,
    DAL:14, ARI:14,
  };

  // Full 2026 regular-season schedule (opponent per week), transcribed from a
  // user-supplied schedule image. An automated self-consistency check (does
  // each team's claimed opponent match up with that opponent's own row) found
  // the home/away flag was unreliable in roughly 30% of games, so it is NOT
  // used or displayed anywhere — only the opponent identity is shown, which
  // checked out reliably. The one opponent-identity conflict found (Kansas
  // City / New Orleans / NY Jets, Week 9) was resolved by cross-referencing
  // Cleveland's independently-consistent row.
  // Format: TEAM: [[opp, _unused], ... 18 entries] or null for a bye week.
  const SCHEDULE_2026 = {
    ARI: [['LAC',0],['SEA',1],['SF',0],['NYG',0],['DET',1],['LAR',0],['DEN',1],['DAL',0],['SEA',0],['LAR',1],['KC',0],['WAS',1],['PHI',1],null,['NYJ',1],['NO',0],['LV',1],['SF',1]],
    ATL: [['PIT',0],['CAR',1],['GB',0],['NO',0],['BAL',1],['CHI',1],['SF',1],['TB',1],['CIN',1],['KC',1],null,['MIN',0],['DET',1],['CLE',0],['WAS',1],['TB',1],['NO',1],['CAR',0]],
    BAL: [['IND',0],['NO',1],['DAL',0],['TEN',1],['ATL',0],['CLE',0],['CIN',1],['BUF',0],['JAX',1],['LAC',1],['CAR',0],['HOU',0],null,['TB',1],['PIT',0],['CLE',1],['CIN',0],['PIT',1]],
    BUF: [['HOU',0],['DET',1],['LAC',1],['NE',1],['LAR',0],['LV',0],null,['BAL',1],['MIN',0],['NYJ',1],['MIA',1],['KC',0],['NE',0],['GB',0],['CHI',0],['DEN',0],['MIA',1],['NYJ',1]],
    CAR: [['CHI',1],['ATL',0],['CLE',0],['DET',1],null,['PHI',0],['TB',1],['GB',1],['DEN',1],['NO',0],['BAL',1],['TB',0],['MIN',0],['NO',1],['CIN',1],['PIT',0],['SEA',1],['ATL',1]],
    CHI: [['CAR',0],['MIN',1],['PHI',1],['NYJ',1],['GB',0],['ATL',0],['NE',1],['SEA',1],['TB',1],null,['NO',1],['DET',0],['JAX',1],['MIA',0],['BUF',0],['GB',1],['DET',1],['MIN',0]],
    CIN: [['TB',1],['HOU',0],['PIT',0],['JAX',1],['MIA',0],null,['BAL',0],['TEN',1],['ATL',0],['PIT',1],['WAS',0],['NO',1],['CLE',0],['KC',0],['CAR',1],['IND',0],['BAL',1],['CLE',1]],
    CLE: [['JAX',0],['TB',0],['CAR',1],['PIT',1],['NYJ',0],['BAL',1],['TEN',0],['PIT',0],['NO',0],['HOU',1],null,['LV',1],['CIN',1],['ATL',0],['NYG',1],['BAL',0],['IND',1],['CIN',0]],
    DAL: [['NYG',0],['WAS',1],['BAL',1],['HOU',0],['TB',1],['GB',0],['PHI',0],['ARI',1],['IND',0],['SF',1],['TEN',1],['PHI',1],['SEA',0],null,['LAR',0],['JAX',1],['NYG',1],['WAS',0]],
    DEN: [['KC',0],['JAX',1],['LAR',1],['SF',0],['LAC',0],['SEA',1],['ARI',0],['KC',1],['CAR',0],null,['LV',1],['PIT',0],['MIA',1],['NYJ',0],['LV',0],['BUF',0],['NE',0],['LAC',1]],
    DET: [['NO',1],['BUF',0],['NYJ',1],['CAR',0],['ARI',0],null,['GB',1],['MIN',1],['MIA',1],['NE',1],['TB',1],['CHI',0],['ATL',0],['TEN',1],['MIN',1],['NYG',1],['CHI',0],['GB',1]],
    GB: [['MIN',0],['NYJ',0],['ATL',1],['TB',0],['CHI',1],['DAL',1],['DET',0],['CAR',1],['NE',0],['MIN',1],null,['LAR',1],['NO',0],['BUF',1],['MIA',1],['CHI',0],['HOU',1],['DET',0]],
    HOU: [['BUF',1],['CIN',1],['IND',0],['DAL',1],['TEN',0],['JAX',0],['NYG',1],null,['LAC',0],['CLE',0],['IND',1],['BAL',1],['PIT',0],['WAS',0],['JAX',1],['PHI',0],['GB',0],['TEN',1]],
    IND: [['BAL',1],['KC',0],['HOU',1],['WAS',0],['PIT',0],['TEN',1],['MIN',0],['JAX',1],['DAL',1],['MIA',1],['HOU',0],['NYG',1],null,['PHI',1],['TEN',0],['CIN',1],['CLE',0],['JAX',1]],
    JAX: [['CLE',1],['DEN',0],['NE',1],['CIN',0],['PHI',1],['HOU',1],null,['IND',1],['BAL',0],['TEN',0],['NYG',0],['TEN',1],['CHI',0],['PIT',1],['HOU',0],['DAL',0],['WAS',1],['IND',0]],
    KC: [['DEN',1],['IND',1],['MIA',0],['LV',0],null,['LAC',1],['SEA',0],['DEN',0],['NYJ',1],['ATL',0],['ARI',1],['BUF',0],['LAR',1],['CIN',0],['NE',1],['SF',1],['LAC',0],['LV',1]],
    LAC: [['ARI',1],['LV',1],['BUF',0],['SEA',0],['DEN',1],['KC',0],null,['LAR',1],['HOU',1],['BAL',0],['NYJ',1],['NE',1],['TB',0],['LV',0],['SF',1],['MIA',1],['KC',1],['DEN',0]],
    LAR: [['SF',1],['NYG',1],['DEN',0],['PHI',0],['BUF',1],['ARI',1],['LV',0],['LAC',1],['WAS',0],['ARI',0],null,['GB',1],['KC',1],['SF',0],['DAL',1],['SEA',0],['TB',0],['SEA',1]],
    LV: [['MIA',1],['LAC',0],['NO',0],['KC',1],['NE',0],['BUF',1],['LAR',1],['NYJ',1],['SF',0],['SEA',1],['DEN',0],['CLE',0],null,['LAC',1],['DEN',1],['TEN',1],['ARI',0],['KC',0]],
    MIA: [['LV',0],['SF',0],['KC',1],['MIN',0],['CIN',1],null,['NYJ',0],['NE',1],['DET',1],['IND',1],['BUF',1],['NYJ',1],['DEN',1],['CHI',1],['GB',1],['LAC',1],['BUF',1],['NE',0]],
    MIN: [['GB',1],['CHI',0],['TB',0],['MIA',1],['NO',0],null,['IND',1],['DET',0],['BUF',1],['GB',1],['SF',0],['ATL',1],['CAR',0],['NE',1],['DET',0],['WAS',1],['NYJ',0],['CHI',1]],
    NE: [['SEA',0],['PIT',1],['JAX',1],['BUF',0],['LV',1],['NYJ',1],['CHI',0],['MIA',1],['GB',1],['DET',0],null,['LAC',0],['BUF',1],['MIN',1],['KC',0],['NYJ',0],['DEN',1],['MIA',1]],
    NO: [['DET',0],['BAL',0],['LV',1],['ATL',1],['MIN',1],['NYG',0],['PIT',1],null,['CLE',1],['CAR',1],['CHI',0],['CIN',0],['GB',1],['CAR',0],['TB',0],['ARI',1],['ATL',0],['TB',1]],
    NYG: [['DAL',1],['LAR',0],['TEN',1],['ARI',1],['WAS',0],['NO',1],['HOU',0],null,['PHI',0],['WAS',1],['JAX',1],['IND',0],['SF',1],['SEA',0],['CLE',1],['DET',1],['DAL',0],['PHI',1]],
    NYJ: [['TEN',0],['GB',1],['DET',0],['CHI',0],['CLE',1],['NE',0],['MIA',1],['LV',1],['KC',0],['BUF',1],['LAC',0],['MIA',1],null,['DEN',1],['ARI',0],['NE',1],['MIN',1],['BUF',0]],
    PHI: [['WAS',1],['TEN',1],['CHI',0],['LAR',1],['JAX',0],['CAR',1],['DAL',1],['WAS',0],['NYG',1],null,['PIT',1],['DAL',0],['ARI',0],['IND',1],['SEA',0],['HOU',0],['SF',0],['NYG',0]],
    PIT: [['ATL',1],['NE',0],['CIN',1],['CLE',0],['IND',1],['TB',0],['NO',0],['CLE',1],null,['CIN',0],['PHI',0],['DEN',1],['HOU',1],['JAX',1],['BAL',1],['CAR',1],['TEN',0],['BAL',0]],
    SEA: [['NE',1],['ARI',0],['WAS',0],['LAC',1],['SF',1],['DEN',0],['KC',1],['CHI',0],['ARI',1],['LV',0],null,['SF',0],['DAL',1],['NYG',1],['PHI',1],['LAR',1],['CAR',0],['LAR',0]],
    SF: [['LAR',0],['MIA',1],['ARI',1],['DEN',1],['SEA',0],['WAS',1],['ATL',1],null,['LV',1],['DAL',0],['MIN',1],['SEA',1],['NYG',0],['LAR',1],['LAC',0],['KC',1],['PHI',1],['ARI',0]],
    TB: [['CIN',0],['CLE',0],['MIN',1],['GB',1],['DAL',0],['PIT',1],['CAR',0],['ATL',1],['CHI',0],null,['DET',0],['CAR',1],['LAC',1],['BAL',0],['NO',1],['ATL',1],['LAR',1],['NO',0]],
    TEN: [['NYJ',1],['PHI',1],['NYG',0],['BAL',0],['HOU',1],['IND',1],['CLE',1],['CIN',0],null,['JAX',1],['DAL',0],['JAX',0],['WAS',1],['DET',0],['IND',1],['LV',0],['PIT',1],['HOU',0]],
    WAS: [['PHI',0],['DAL',0],['SEA',1],['IND',1],['NYG',1],['SF',0],null,['PHI',1],['LAR',1],['NYG',0],['CIN',1],['ARI',0],['TEN',0],['HOU',1],['ATL',1],['MIN',0],['JAX',0],['DAL',1]],
  };
  function getMatchup(teamAbbr, week){
    const row = SCHEDULE_2026[teamAbbr];
    if(!row) return null;
    const entry = row[week-1];
    if(entry === null || entry === undefined) return null; // bye
    return {opp: entry[0]};
  }

  function nameColorClass(pos){
    if(pos === 'QB') return 'name-red';
    if(pos === 'TE') return 'name-orange';
    if(pos === 'WR') return 'name-blue';
    if(pos === 'RB') return 'name-green';
    return '';
  }

  function playerLabel(pid){
    if(!pid) return null;
    const p = state.playersCache ? state.playersCache[pid] : null;
    if(p){
      const name = p.full_name || ((p.first_name||'') + ' ' + (p.last_name||'')).trim() || pid;
      const team = p.team||'FA';
      return {name, pos: p.position||'', team, bye: BYE_WEEKS[team] || null};
    }
    // Defense entries use team abbreviation as the id
    if(pid.length <= 3){
      return {name: pid + ' D/ST', pos:'DEF', team: pid, bye: BYE_WEEKS[pid] || null};
    }
    return {name: pid, pos:'', team:'', bye:null};
  }

  function playerNameHTML(info){
    return info.name + (info.bye ? ` <span class="bye-tag">(Bye ${info.bye})</span>` : '');
  }

  // Which actual positions can fill each roster slot.
  const SLOT_ELIGIBILITY = {
    QB:['QB'], RB:['RB'], WR:['WR'], TE:['TE'], K:['K'], DEF:['DEF'],
    FLEX:['RB','WR','TE'], WRRB_FLEX:['WR','RB'], REC_FLEX:['WR','TE'],
    SUPER_FLEX:['QB','RB','WR','TE'],
  };

  // Greedy best-lineup solver: fills the most restrictive slots (single position)
  // first, then narrower flex slots, then the widest flex (SUPER_FLEX) last, each
  // time taking the highest-projected eligible player not already used elsewhere
  // in the lineup. This matches how these lineups are optimized in practice —
  // it isn't a formal solver, but gets the right answer in the vast majority of
  // real rosters.
  function greedyAssignLineup(pool, slotOrder){
    const breadth = slot => (SLOT_ELIGIBILITY[slot] ? SLOT_ELIGIBILITY[slot].length : 1);
    const order = slotOrder.map((slot, i) => ({slot, i})).sort((a,b) => breadth(a.slot) - breadth(b.slot) || a.i - b.i);
    const used = new Set();
    const assignment = new Array(slotOrder.length).fill(null);
    order.forEach(({slot, i}) => {
      const eligible = SLOT_ELIGIBILITY[slot] || [slot];
      let best = null;
      pool.forEach(p => {
        if(used.has(p.pid)) return;
        if(!eligible.includes(p.pos)) return;
        if(!best || p.proj > best.proj) best = p;
      });
      if(best){ used.add(best.pid); assignment[i] = best.pid; }
    });
    return assignment;
  }

  function computeOptimalLineup(roster, league){
    const excluded = new Set([...(roster.reserve||[]), ...(roster.taxi||[])]);
    const pool = (roster.players || []).filter(pid => !excluded.has(pid)).map(pid => {
      const info = playerLabel(pid);
      const rawProj = projectedPoints(pid, league);
      return {pid, pos: info ? info.pos : null, proj: rawProj == null ? -1 : rawProj, hasProj: rawProj != null, info};
    });
    const slotOrder = (league.roster_positions || []).filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI');
    const assignment = greedyAssignLineup(pool, slotOrder);
    return {slotOrder, assignment, pool};
  }

  // Same optimizer, but for the Season Planner: takes a plain list of player
  // ids (which may include hypothetical waiver adds not on the real Sleeper
  // roster) and a specific week's projections, rather than a real roster object.
  function computePlannerLineup(pids, league, week){
    const pool = pids.map(pid => {
      const info = playerLabel(pid);
      const rawProj = plannerProjectedPoints(pid, league, week);
      return {pid, pos: info ? info.pos : null, proj: rawProj == null ? -1 : rawProj, hasProj: rawProj != null, info};
    });
    const slotOrder = (league.roster_positions || []).filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI');
    const assignment = greedyAssignLineup(pool, slotOrder);
    return {slotOrder, assignment, pool};
  }

  function median(arr){
    if(!arr.length) return null;
    const sorted = [...arr].sort((a,b) => a-b);
    const mid = Math.floor(sorted.length/2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
  }

  function lineupTotal(assignment, pool){
    return assignment.reduce((sum, pid) => {
      if(!pid) return sum;
      const p = pool.find(x => x.pid === pid);
      return sum + (p && p.hasProj ? p.proj : 0);
    }, 0);
  }

  function projMetaHTML(pid, league){
    const p = projectedPoints(pid, league);
    return p != null ? ` · <span style="color:var(--gold);">Proj ${p.toFixed(1)}</span>` : '';
  }

  // Shared row template for starters/bench/IR — avoids three near-identical
  // copies of the same markup.
  function rosterPlayerRow(pid, slotTagHTML, league){
    const info = playerLabel(pid);
    const name = info ? playerNameHTML(info) : (pid || '<span style="color:var(--chalk-faint)">Empty</span>');
    const meta = info ? (info.pos + ' · ' + info.team + projMetaHTML(pid, league)) : '';
    return `
      <div class="player-row">
        ${slotTagHTML}
        <div class="player-name ${info?nameColorClass(info.pos):''}">${name}</div>
        <div class="player-meta">${meta}</div>
      </div>
    `;
  }

  function renderRosterGroups(roster, league){
    const slotOrder = (league.roster_positions || []).filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI');
    const starters = roster.starters || [];
    const startersHTML = slotOrder.map((slot, i) => {
      const pid = starters[i];
      const tag = `<div class="slot-tag ${slotColorClass(slot)}">${slotLabel(slot)}</div>`;
      return rosterPlayerRow(pid, tag, league);
    }).join('');

    const allPlayers = roster.players || [];
    const benchIds = allPlayers.filter(pid => !starters.includes(pid) && !(roster.reserve||[]).includes(pid) && !(roster.taxi||[]).includes(pid));
    const benchHTML = benchIds.map(pid => rosterPlayerRow(pid, '<div class="slot-tag tag-grey">BN</div>', league)).join('')
      || '<div style="color:var(--chalk-faint); font-size:12px; padding:6px 2px;">No bench players.</div>';

    const irIds = [...(roster.reserve||[]), ...(roster.taxi||[])];
    const irTag = '<div class="slot-tag" style="color:var(--alert); background:rgba(193,68,14,0.1);">IR</div>';
    const irHTML = irIds.length ? irIds.map(pid => rosterPlayerRow(pid, irTag, league)).join('') : '';

    return `
      <div class="roster-groups">
        <div>
          <div class="roster-group-title">Starters</div>
          <div class="roster-list">${startersHTML}</div>
        </div>
        <div>
          <div class="roster-group-title">Bench</div>
          <div class="roster-list">${benchHTML}</div>
        </div>
        ${irIds.length ? `<div>
          <div class="roster-group-title">IR / Taxi</div>
          <div class="roster-list">${irHTML}</div>
        </div>` : ''}
      </div>
    `;
  }

  function bindRosterPicker(detail){
    document.querySelectorAll('.team-chip').forEach(chip => {
      chip.addEventListener('click', ()=>{
        state.currentTeamRosterId = parseInt(chip.dataset.roster, 10);
        const rg = document.getElementById('roster-groups');
        const roster = detail.rosters.find(r => r.roster_id === state.currentTeamRosterId);
        rg.innerHTML = roster ? renderRosterGroups(roster, detail.league) : '';
        document.querySelectorAll('.team-chip').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  }

  function currencySymbol(cur){
    return cur === 'GBP' ? '£' : '$';
  }

  function renderPayoutsTab(detail, leagueName){
    const numTeams = detail.rosters.length;
    const payout = detail.payout || {
      buyIn:'', currency:'USD', payouts:[{place:'1st', amount:''}], notes:'',
      advanceDues: {paid:false, throughSeason:''},
      empirePot: {enabled:false, contribution:'', total:'', leaderName:'', consecutiveWins:''}
    };
    const currency = payout.currency || 'USD';
    const sym = currencySymbol(currency);
    const advance = payout.advanceDues || {paid:false, throughSeason:''};
    const empire = payout.empirePot || {enabled:false, contribution:'', total:'', leaderName:'', consecutiveWins:''};
    const dynasty = isDynastyLeague(leagueName);
    const rowsHTML = payout.payouts.map((p, i) => `
      <div class="payout-row" data-idx="${i}">
        <input class="place-input" type="text" placeholder="e.g. 1st" value="${p.place||''}" data-field="place"/>
        <input class="amount-input" type="number" placeholder="amount" value="${p.amount!==''&&p.amount!=null?p.amount:''}" data-field="amount"/>
        <button class="btn-danger-ghost" data-remove="${i}">Remove</button>
      </div>
    `).join('');

    return `
      <div class="payout-card">
        <div style="display:flex; gap:12px;">
          <div class="field" style="flex:1;">
            <label>Buy-in per team</label>
            <input id="buyin-input" type="number" placeholder="amount" value="${payout.buyIn!==''&&payout.buyIn!=null?payout.buyIn:''}"/>
          </div>
          <div class="field" style="width:110px;">
            <label>Currency</label>
            <select id="currency-input">
              <option value="USD" ${currency==='USD'?'selected':''}>USD ($)</option>
              <option value="GBP" ${currency==='GBP'?'selected':''}>GBP (£)</option>
            </select>
          </div>
        </div>
        <div class="section-title" style="margin-top:18px;">Payout Structure</div>
        <div id="payout-rows">${rowsHTML}</div>
        <button class="btn btn-ghost" id="btn-add-row" style="margin-top:8px;">+ Add Place</button>
        <div class="pot-summary" id="pot-summary"></div>
        <button class="btn btn-primary" id="btn-save-payout" style="margin-top:16px; width:100%;">Save</button>
        <div class="empty-note">${numTeams} teams in this league. Saved locally to your account — Sleeper doesn't track buy-ins or payouts, so this stays with you between visits.</div>
      </div>

      ${dynasty ? `
      <div class="payout-card" style="margin-top:16px;">
        <div class="section-title" style="margin-top:0;">Advance Dues</div>
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
          <input type="checkbox" id="advance-paid-input" ${advance.paid?'checked':''} style="width:16px; height:16px;"/>
          I've paid next season's dues in advance for this league
        </label>
        <div class="field" style="margin-top:12px; max-width:180px;">
          <label>Paid through season</label>
          <input id="advance-season-input" type="text" placeholder="e.g. 2027" value="${advance.throughSeason||''}"/>
        </div>
        <div class="empty-note">For leagues that require next year's buy-in upfront to stop people bailing after a season.</div>
      </div>

      <div class="payout-card" style="margin-top:16px;">
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
          <input type="checkbox" id="empire-enabled-input" ${empire.enabled?'checked':''} style="width:16px; height:16px;"/>
          <span class="section-title" style="margin:0; border:none;">This league has an Empire Pot</span>
        </label>
        <div id="empire-fields" style="${empire.enabled?'':'display:none;'} margin-top:14px;">
          <div style="display:flex; gap:12px;">
            <div class="field" style="flex:1;">
              <label>Annual contribution per team</label>
              <input id="empire-contribution-input" type="number" placeholder="amount" value="${empire.contribution!==''&&empire.contribution!=null?empire.contribution:''}"/>
            </div>
            <div class="field" style="flex:1;">
              <label>Current pot total</label>
              <input id="empire-total-input" type="number" placeholder="amount" value="${empire.total!==''&&empire.total!=null?empire.total:''}"/>
            </div>
          </div>
          <div style="display:flex; gap:12px;">
            <div class="field" style="flex:1;">
              <label>Reigning leader</label>
              <input id="empire-leader-input" type="text" placeholder="Team or owner name" value="${empire.leaderName||''}"/>
            </div>
            <div class="field" style="width:150px;">
              <label>Consecutive titles</label>
              <input id="empire-wins-input" type="number" min="0" max="2" placeholder="0, 1 or 2" value="${empire.consecutiveWins!==''&&empire.consecutiveWins!=null?empire.consecutiveWins:''}"/>
            </div>
          </div>
          <div class="empty-note">Everyone pays the same amount into this pot every year; it rolls over and grows until one team wins the league two seasons running, at which point they take the whole pot. Update the total and leader here yourself each season — this isn't something Sleeper tracks.</div>
        </div>
        <button class="btn btn-primary" id="btn-save-empire" style="margin-top:14px; width:100%;">Save Advance Dues &amp; Empire Pot</button>
      </div>
      ` : ''}
    `;
  }

  function updatePotSummary(numTeams){
    const buyIn = parseFloat(document.getElementById('buyin-input').value) || 0;
    const sym = currencySymbol(document.getElementById('currency-input').value);
    const pot = buyIn * numTeams;
    let allocated = 0;
    document.querySelectorAll('.payout-row').forEach(row => {
      const amt = parseFloat(row.querySelector('[data-field="amount"]').value) || 0;
      allocated += amt;
    });
    const el = document.getElementById('pot-summary');
    const diff = pot - allocated;
    el.innerHTML = `
      <span>Total pot (${numTeams} × ${sym}${buyIn.toFixed(2)})</span>
      <span class="val">${sym}${pot.toFixed(2)}</span>
    `;
    el.innerHTML += `<br/><span>Allocated in payouts</span><span class="val ${Math.abs(diff)<0.01?'match-ok':'mismatch'}">${sym}${allocated.toFixed(2)}${Math.abs(diff)>=0.01 ? (diff>0? '  (short '+sym+diff.toFixed(2)+')' : '  (over '+sym+Math.abs(diff).toFixed(2)+')') : '  ✓'}</span>`;
  }

  function bindPayoutsForm(detail, leagueName){
    const numTeams = detail.rosters.length;
    const dynasty = isDynastyLeague(leagueName);
    const container = document.getElementById('tab-content');

    function currentPayoutsArray(){
      return Array.from(document.querySelectorAll('.payout-row')).map(row => ({
        place: row.querySelector('[data-field="place"]').value,
        amount: row.querySelector('[data-field="amount"]').value,
      }));
    }

    function rebindRowRemovals(){
      document.querySelectorAll('[data-remove]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const rows = currentPayoutsArray();
          rows.splice(parseInt(btn.dataset.remove,10),1);
          rerenderRows(rows);
        });
      });
      document.querySelectorAll('.payout-row input').forEach(inp=>{
        inp.addEventListener('input', ()=>updatePotSummary(numTeams));
      });
    }

    function rerenderRows(rows){
      if(!rows.length) rows = [{place:'',amount:''}];
      const rowsHTML = rows.map((p,i)=>`
        <div class="payout-row" data-idx="${i}">
          <input class="place-input" type="text" placeholder="e.g. 1st" value="${p.place||''}" data-field="place"/>
          <input class="amount-input" type="number" placeholder="$ amount" value="${p.amount!==''&&p.amount!=null?p.amount:''}" data-field="amount"/>
          <button class="btn-danger-ghost" data-remove="${i}">Remove</button>
        </div>
      `).join('');
      document.getElementById('payout-rows').innerHTML = rowsHTML;
      rebindRowRemovals();
      updatePotSummary(numTeams);
    }

    rebindRowRemovals();
    updatePotSummary(numTeams);
    document.getElementById('buyin-input').addEventListener('input', ()=>updatePotSummary(numTeams));
    document.getElementById('currency-input').addEventListener('change', ()=>updatePotSummary(numTeams));

    document.getElementById('btn-add-row').addEventListener('click', ()=>{
      const rows = currentPayoutsArray();
      rows.push({place:'', amount:''});
      rerenderRows(rows);
    });

    const empireEnabledInput = dynasty ? document.getElementById('empire-enabled-input') : null;
    const empireFields = dynasty ? document.getElementById('empire-fields') : null;
    if(dynasty){
      empireEnabledInput.addEventListener('change', ()=>{
        empireFields.style.display = empireEnabledInput.checked ? '' : 'none';
      });
    }

    function gatherFullPayoutData(){
      const data = {
        buyIn: document.getElementById('buyin-input').value,
        currency: document.getElementById('currency-input').value,
        payouts: currentPayoutsArray(),
        notes: '',
      };
      if(dynasty){
        data.advanceDues = {
          paid: document.getElementById('advance-paid-input').checked,
          throughSeason: document.getElementById('advance-season-input').value,
        };
        data.empirePot = {
          enabled: empireEnabledInput.checked,
          contribution: document.getElementById('empire-contribution-input').value,
          total: document.getElementById('empire-total-input').value,
          leaderName: document.getElementById('empire-leader-input').value,
          consecutiveWins: document.getElementById('empire-wins-input').value,
        };
      }
      return data;
    }

    async function saveAll(){
      const data = gatherFullPayoutData();
      try{
        await savePayout(state.currentLeagueId, data);
        detail.payout = data;
        toast('Saved');
      }catch(e){
        toast('Save failed — try again');
      }
    }

    document.getElementById('btn-save-payout').addEventListener('click', saveAll);
    if(dynasty){
      const empireSaveBtn = document.getElementById('btn-save-empire');
      if(empireSaveBtn) empireSaveBtn.addEventListener('click', saveAll);
    }
  }

  // ---------------- Boot ----------------
  async function boot(){
    console.log(typeof importUserData);
    renderLoading('Starting up...');
    const settings = await loadSettings();
    if(settings && settings.username && settings.season){
      state.username = settings.username;
      state.season = settings.season;
      renderLoading('Welcome back — loading ' + settings.username + '...');
      try{
        const {user, leagues} = await loadLeaguesForUser(settings.username, settings.season);
        state.sleeperUserId = user.user_id;
        state.leagues = leagues;
        if(leagues.length){
          state.view = 'leagues';
          return render();
        }
      }catch(e){ /* fall through to setup */ }
    }
    state.view = 'setup';
    render();
  }

  boot();
})();