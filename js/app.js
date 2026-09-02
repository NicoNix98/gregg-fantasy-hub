// Main application bootstrap
//
// This app is split across a few files, loaded in this order (see
// index.html): storage.js, app.js, planner.js, waivers.js, matchups.js,
// shares.js, guillotine.js. app.js is the shell — it owns `state`, the
// router, the topbar, and any screen not yet split into its own file.
// Anything another file needs from here is exposed on window.EZL near
// the bottom of this file, right before boot(). All localStorage
// reads/writes go through window.Storage (storage.js) — nothing in this
// file should call localStorage directly except the projection-week
// cache, which stays here because it's tightly coupled to
// state.projectionWeek's in-memory cache invalidation. The shared lineup
// engine (computeOptimalLineup, SLOT_ELIGIBILITY, lineupTotal,
// greedyAssignLineup) also stays here even though only
// matchups.js/planner.js/guillotine.js use it directly — it's exposed via
// EZL rather than owned by any one screen, since three screens depend on
// it. Same reasoning for isDraftComplete (matchups.js + shares.js).
(function(){
  /* =====================================================================
     TABLE OF CONTENTS — grep the label in CAPS to jump to a section.
     Kept in file order. Update this if functions are moved/renamed.
     ---------------------------------------------------------------------
     STATE            state object, app root
     TOAST/FETCH       toast(), fetchJSON()
     ICONS             GUILLOTINE_ICON, robotIcon(), SLEEPER_LOGO_B64
     PLAYER HELPERS    initials, avatarHTML, teamDisplayName, playerLabel,
                       playerNameHTML, nameColorClass
     DATA LOADING      ensurePlayersLoaded, ensureTrendingLoaded,
                       ensureNflState, getProjectionWeek/setProjectionWeek,
                       ensureProjectionsLoaded, projectedPoints,
                       loadLeaguesForUser, loadLeagueDetail
     STANDINGS MATH    fpts, computeStandings
     SHARED CHECKS     isDraftComplete (used by matchups.js + shares.js
                       via EZL — kept here rather than owned by either)
     ROUTER            render()
     SCREEN: setup     renderLoading, renderErrorBanner, renderSetup,
                       onSetupSubmit
     TOPBAR            renderTopbar, bindTopbar
     LEAGUE CATEGORIES categoryForLeagueName, groupByCategory,
                       isGuillotineLeague, isDynastyLeague, isFreeLeague
     SCREEN: leagues   renderLeagueList, paintLeagueList, renderLeagueCard
     SCREEN: overview  renderOverview, renderOverviewRow
     LEAGUE DETAIL     renderLeagueDetail (standings/rosters/matchup/
                       waiver/payouts tab dispatch)
     TAB: standings    renderStandingsTab, faabRemaining, guillotineRowHTML,
                       renderGuillotineStandingsTab, bindGuillotineStandings
     TAB: rosters      computeOwnedPlayerIds, renderRostersTab, slotLabel,
                       slotColorClass, projMetaHTML, rosterPlayerRow,
                       renderRosterGroups, bindRosterPicker
     LINEUP ENGINE     SLOT_ELIGIBILITY, greedyAssignLineup,
                       computeOptimalLineup, lineupTotal (shared by
                       matchups.js, planner.js, guillotine.js via EZL)
     TAB: payouts      currencySymbol, renderPayoutsTab, updatePotSummary,
                       bindPayoutsForm
     BOOT              boot()
     ===================================================================== */

  const APP_PREFIX = window.Storage.APP_PREFIX; // single source of truth lives in storage.js
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
    // Check the persisted (localStorage) cache before hitting the network —
    // this payload is large and rarely changes within a day. See
    // storage.js's loadPlayersCache/savePlayersCache for the TTL.
    const cached = await Storage.loadPlayersCache();
    if(cached){
      state.playersCache = cached;
      return cached;
    }
    const data = await fetchJSON('https://api.sleeper.app/v1/players/nfl');
    state.playersCache = data;
    await Storage.savePlayersCache(data);
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
    // No saved preference yet (first-ever load) — fall back to whatever week
    // Sleeper's own /state/nfl says is current, if it's already been fetched;
    // otherwise default to 1 until ensureNflState() resolves and calls
    // setProjectionWeek itself.
    state.projectionWeek = saved ? parseInt(saved, 10) : (state.nflState ? state.nflState.week : 1);
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

  // Computes a projected score for one raw stat line against a league's
  // exact scoring settings (yards, TDs, receptions, etc.), the same way
  // Sleeper's own app scores it for that league — rather than picking from
  // the three generic std/half-PPR/full-PPR buckets, which won't match if
  // the league has any custom scoring (bonus yardage, TE premium, different
  // TD values, etc.). Falls back to the generic PPR-tier buckets only if the
  // raw stat line didn't overlap with this league's scoring keys at all.
  //
  // Pulled out as its own function (rather than living inline inside
  // projectedPoints below) because planner.js's plannerProjectedPoints() and
  // waivers.js's candidate-building need the exact same formula against a
  // different projections cache (a specific future week's, vs. the
  // top-bar's "current" week) — this is the one place the math lives.
  function scoreStatLine(s, league){
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
    const rec = scoring.rec || 0;
    let val = rec >= 1 ? s.pts_ppr : (rec >= 0.5 ? s.pts_half_ppr : s.pts_std);
    if(val == null) val = s.pts_ppr != null ? s.pts_ppr : (s.pts_half_ppr != null ? s.pts_half_ppr : s.pts_std);
    return val != null ? val : null;
  }

  // Picks this week's raw stat line (from the top-bar's current projection
  // week cache) and scores it to the given league via scoreStatLine.
  function projectedPoints(pid, league){
    const proj = state.projectionsCache;
    if(!proj) return null;
    return scoreStatLine(proj.byPlayer[pid], league);
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
    const payout = await Storage.loadPayout(leagueId);
    const cutRosters = await Storage.loadCutRosters(leagueId);
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
    if(state.view === 'matchups') return window.Matchups.renderOverview();
    if(state.view === 'shares') return window.Shares.render();
    if(state.view === 'waiverHub') return window.Waivers.renderHub();
    if(state.view === 'waiverHubDetail') return window.Waivers.renderHubDetail();
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
      await Storage.saveSettings(username, season);
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
      await Storage.exportUserData();
    });
    const imp = document.getElementById('btn-import-data');
    if(imp) imp.addEventListener('click', async () => {

      const input = document.createElement('input');
     input.type = 'file';
      input.accept = '.json';

      input.onchange = async (e) => {
        const file = e.target.files[0];
       if(file){
         await Storage.importUserData(file);
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
    // Fetch every league's quick roster/standing snapshot concurrently
    // rather than one at a time — with N leagues this was N sequential
    // round trips (league + rosters + users each), now it's the time of
    // the single slowest league.
    const cards = await Promise.all(state.leagues.map(async lg => {
      try{
        const detail = await loadLeagueDetail(lg.league_id, state.sleeperUserId);
        state.leagueDetail[lg.league_id] = detail;
        const standings = computeStandings(detail.rosters, detail.usersById);
        const myIdx = standings.findIndex(r => r.roster_id === detail.myRosterId);
        return {lg, detail, standings, myIdx};
      }catch(e){
        return {lg, error: e.message};
      }
    }));
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
    let totalUSD = 0;
    let totalGBP = 0;
    let leaguesWithBuyIn = 0;
    // Concurrent per-league fetch (same reasoning as renderLeagueList) —
    // the buy-in totals below are just aggregated from the resolved rows
    // afterward, so parallelizing this loop doesn't change the math.
    const rows = await Promise.all(state.leagues.map(async lg => {
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
        return {lg, rank, total, playoffTeams, inPlayoffs, payout, buyIn, hasBuyIn, currency};
      }catch(e){
        return {lg, error: e.message || 'Failed to load'};
      }
    }));
    rows.forEach(r => {
      if(r.error || !r.hasBuyIn) return;
      leaguesWithBuyIn++;
      if(r.currency === 'GBP') totalGBP += r.buyIn; else totalUSD += r.buyIn;
    });

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


  function isDraftComplete(detail){
    const status = detail && detail.league && detail.league.status;
    return !!status && status !== 'pre_draft' && status !== 'drafting';
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

  async function renderLeagueDetail(){
    const detail = state.leagueDetail[state.currentLeagueId];
    const lg = state.leagues.find(l => l.league_id === state.currentLeagueId);
    if(!detail){ state.view='leagues'; return render(); }
    const free = isFreeLeague(lg.name);
    const guillotineFmt = isGuillotineLeague(lg.name);
    const plannerLeague = isPlannerLeague(lg.name);
    if(free && state.currentTab === 'payouts'){ state.currentTab = 'standings'; }
    if(guillotineFmt && state.currentTab === 'matchup'){ state.currentTab = 'standings'; }
    if(!guillotineFmt && state.currentTab === 'command'){ state.currentTab = 'standings'; }

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
          ${guillotineFmt ? `<div class="tab ${state.currentTab==='command'?'active':''}" data-tab="command">Command Centre</div>` : ''}
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
      await window.Matchups.renderTab(detail, content);
    } else if(state.currentTab === 'command' && guillotineFmt){
      content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading Command Centre...</div>`;
      await Promise.all([ensurePlayersLoaded(), ensureProjectionsLoaded().catch(()=>null)]);
      window.Guillotine.renderCommandCentre(detail, content);
    } else if(state.currentTab === 'waiver'){
      content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading player pool, trending adds, and projections...</div>`;
      await window.Waivers.renderTab(detail, content);
    } else if(state.currentTab === 'planner' && plannerLeague){
      content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading planner data...</div>`;
      await window.Planner.renderTab(detail, content);
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
          await Storage.saveCutRosters(state.currentLeagueId, detail.cutRosters);
          document.getElementById('tab-content').innerHTML = renderGuillotineStandingsTab(detail);
          rebind();
        });
      });
      document.querySelectorAll('[data-restore]').forEach(btn => {
        btn.addEventListener('click', async ()=>{
          const rid = parseInt(btn.dataset.restore, 10);
          detail.cutRosters = (detail.cutRosters || []).filter(x => x !== rid);
          await Storage.saveCutRosters(state.currentLeagueId, detail.cutRosters);
          document.getElementById('tab-content').innerHTML = renderGuillotineStandingsTab(detail);
          rebind();
        });
      });
    }
    rebind();
  }


  function computeOwnedPlayerIds(detail){
    const owned = new Set();
    detail.rosters.forEach(r => (r.players || []).forEach(pid => owned.add(pid)));
    return owned;
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
        await Storage.savePayout(state.currentLeagueId, data);
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

  // ---------------- Shared exposure for other scripts (e.g. guillotine.js) ----------------
  // app.js itself still runs as one closure internally (state/functions below
  // stay exactly as before) — this block just hangs read/write access to the
  // pieces guillotine.js needs off window.EZL so it isn't stuck guessing at
  // private references. Since `state` is a shared object reference (not a
  // copy), mutations made from guillotine.js are visible here immediately.
  window.EZL = {
    state,
    app,
    render,
    toast,
    fetchJSON,
    avatarHTML,
    teamDisplayName,
    initials,
    ensurePlayersLoaded,
    ensureTrendingLoaded,
    ensureProjectionsLoaded,
    loadLeagueDetail,
    renderLoading,
    projectedPoints,
    scoreStatLine,
    playerLabel,
    playerNameHTML,
    nameColorClass,
    slotColorClass,
    slotLabel,
    SLOT_ELIGIBILITY,
    greedyAssignLineup,
    computeStandings,
    computeOptimalLineup,
    lineupTotal,
    faabRemaining,
    isGuillotineLeague,
    isDynastyLeague,
    isDraftComplete,
    categoryForLeagueName,
    groupByCategory,
    currencySymbol,
    renderTopbar,
    bindTopbar,
    GUILLOTINE_ICON,
    computeOwnedPlayerIds,
    getProjectionWeek,
    PROJECTION_SEASON,
    BYE_WEEKS,
  };

  // ---------------- Boot ----------------
  async function boot(){
    renderLoading('Starting up...');
    // If the user has never picked a projection week before (no saved
    // preference in localStorage), default it to Sleeper's actual current
    // week instead of always starting at Week 1.
    let hasSavedWeek = false;
    try{ hasSavedWeek = localStorage.getItem(APP_PREFIX + 'projectionWeek') != null; }catch(e){}
    if(!hasSavedWeek){
      try{
        const nflState = await ensureNflState();
        setProjectionWeek(nflState.week);
      }catch(e){ /* Sleeper's /state/nfl endpoint failed — stay on the Week 1 default */ }
    }
    const settings = await Storage.loadSettings();
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