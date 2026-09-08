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
  // Which leagues feed into the By Game view. null until first render of
  // By Game mode, at which point it's lazily filled with every league
  // (i.e. unfiltered) — see ensureGameFilterInitialized().
  let gameFilterLeagueIds = null;
  // By League tab's kickoff-window filter: 'all' | '6pm' | '9pm'. Bucketed
  // by the device's local hour (see matchesLeagueTimeFilter below) rather
  // than an exact time, since '9pm' here means the pair of early-afternoon
  // ET kickoffs that land just after 9pm local (not literally 21:00).
  let leagueTimeFilter = 'all';

  // ---------------- Game schedule (By Game mode only) ----------------
  // Sleeper's API has no kickoff-time or confirmed-home/away data (see
  // app.js's SCHEDULE_2026 comment — the home/away flag transcribed from
  // the schedule image was found unreliable ~30% of the time, so it's
  // never used). ESPN's public scoreboard endpoint isn't part of any
  // documented Sleeper API and isn't guaranteed to stay available/stable —
  // same caveat as the undocumented Sleeper projections endpoint used
  // elsewhere — so every use of it below is wrapped so a failure just
  // falls back to the old alphabetical-pair behavior with no time/logos
  // order info, rather than breaking the screen.
  let gameSchedule = null; // {week, byPairKey: {'AWAY-HOME sorted key': {kickoff, awayAbbr, homeAbbr}}}
  const ESPN_ABBR_MAP = { WSH: 'WAS' }; // the only abbreviation ESPN and Sleeper disagree on
  function normalizeEspnAbbr(a){ return ESPN_ABBR_MAP[a] || a; }

  async function ensureGameSchedule(week){
    if(gameSchedule && gameSchedule.week === week) return gameSchedule;
    const byPairKey = {};
    try{
      const data = await EZL.fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&year=${EZL.PROJECTION_SEASON}`);
      (data.events || []).forEach(ev => {
        const comp = ev.competitions && ev.competitions[0];
        const competitors = comp && comp.competitors;
        if(!competitors) return;
        const away = competitors.find(c => c.homeAway === 'away');
        const home = competitors.find(c => c.homeAway === 'home');
        if(!away || !home || !away.team || !home.team) return;
        const awayAbbr = normalizeEspnAbbr(away.team.abbreviation);
        const homeAbbr = normalizeEspnAbbr(home.team.abbreviation);
        const pairKey = [awayAbbr, homeAbbr].sort().join('-');
        byPairKey[pairKey] = { kickoff: comp.date ? new Date(comp.date) : null, awayAbbr, homeAbbr };
      });
    }catch(e){
      // Fall through with an empty schedule — callers already handle a
      // missing entry per game key.
    }
    gameSchedule = {week, byPairKey};
    return gameSchedule;
  }

  function teamLogoImg(abbr, size){
    if(!abbr) return '';
    size = size || 20;
    return `<img src="https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png" alt="${abbr}" style="width:${size}px;height:${size}px;vertical-align:middle;object-fit:contain;" onerror="this.style.display='none';"/>`;
  }

  function formatKickoff(date){
    if(!date) return '';
    try{
      return date.toLocaleString('en-US', { weekday:'short', hour:'numeric', minute:'2-digit' });
    }catch(e){ return ''; }
  }

  // Header used both in the By Game list and above the selected game's
  // detail view — logos always show (they only need the two team
  // abbreviations from the gameKey itself), but the AWAY @ HOME order and
  // kickoff time only show when the ESPN schedule lookup succeeded; with
  // no confirmed home/away, it falls back to the two teams in their
  // existing alphabetical order with a neutral "vs".
  function gameHeaderHTML(gameKey, schedInfo){
    let inner;
    if(schedInfo && schedInfo.awayAbbr && schedInfo.homeAbbr){
      const timeLabel = formatKickoff(schedInfo.kickoff);
      inner = `${teamLogoImg(schedInfo.awayAbbr, 24)} <span class="mono">${schedInfo.awayAbbr}</span> <span style="color:var(--chalk-faint);">@</span> <span class="mono">${schedInfo.homeAbbr}</span> ${teamLogoImg(schedInfo.homeAbbr, 24)}${timeLabel ? ` <span style="color:var(--chalk-faint); font-size:11px; font-weight:500;">${timeLabel}</span>` : ''}`;
    } else {
      const [a, b] = gameKey.split('-');
      inner = `${teamLogoImg(a, 24)} <span class="mono">${a}</span> <span style="color:var(--chalk-faint);">vs</span> <span class="mono">${b}</span> ${teamLogoImg(b, 24)}`;
    }
    // Wrapped in a single inline-flex span so this drops in safely wherever
    // it's used — including inside .section-title, which is itself a flex
    // container with a trailing line; without this the logo/text pieces
    // would each become their own flex item and pick up unwanted gaps.
    return `<span style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">${inner}</span>`;
  }

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

  // Shared ordering: chronological by kickoff time when the ESPN schedule
  // lookup resolved a time for that game; anything with no known kickoff
  // (lookup failed, or this pairing wasn't found in it) sorts after every
  // timed game, using the supplied fallback comparator among themselves so
  // the list is never unsorted-looking if the schedule fetch fails
  // entirely.
  function chronologicalGameKeyComparator(fallbackCompare){
    return (a, b) => {
      const ta = gameSchedule && gameSchedule.byPairKey[a] && gameSchedule.byPairKey[a].kickoff;
      const tb = gameSchedule && gameSchedule.byPairKey[b] && gameSchedule.byPairKey[b].kickoff;
      if(ta && tb) return ta - tb;
      if(ta && !tb) return -1;
      if(!ta && tb) return 1;
      return fallbackCompare(a, b);
    };
  }

  // ---------------- By League mode: kickoff-window filter ----------------
  function isScheduleAvailable(){
    return !!(gameSchedule && Object.keys(gameSchedule.byPairKey).length > 0);
  }

  // Bucketed by hour on the device's local clock (the same clock
  // formatKickoff() already renders against) rather than an exact minute —
  // "9pm" here means the pair of early-afternoon-ET kickoffs that land
  // just after 9pm and before 10pm locally, not a literal 21:00 kickoff.
  function matchesLeagueTimeFilter(schedInfo){
    if(!schedInfo || !schedInfo.kickoff) return false; // unknown kickoff can't match a specific window
    const hour = schedInfo.kickoff.getHours();
    if(leagueTimeFilter === '6pm') return hour === 18;
    if(leagueTimeFilter === '9pm') return hour === 21;
    return true;
  }

  function renderLeagueTimeFilterHTML(){
    return `
      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:0 0 4px;">
        <button class="btn ${leagueTimeFilter==='all'?'btn-primary':'btn-ghost'}" data-league-time-filter="all" style="font-size:12px;">All Games</button>
        <button class="btn ${leagueTimeFilter==='6pm'?'btn-primary':'btn-ghost'}" data-league-time-filter="6pm" style="font-size:12px;">6pm Games</button>
        <button class="btn ${leagueTimeFilter==='9pm'?'btn-primary':'btn-ghost'}" data-league-time-filter="9pm" style="font-size:12px;">9pm Games</button>
      </div>
      <div class="empty-note" style="margin-bottom:14px;">Kickoff windows use your device's local clock. "9pm" covers both early-afternoon kickoffs that land just after 9 and before 10 — not literally 9:00 on the dot.</div>
    `;
  }

  function renderLeagueBreakdownHTML(bd){
    if(bd.error) return `<div class="empty-note">${bd.error}</div>`;
    const oppLabel = bd.oppUser ? EZL.teamDisplayName(bd.oppUser, bd.oppRoster) : 'Opponent';
    let gameKeys = Object.keys(bd.games).sort(chronologicalGameKeyComparator((a,b) =>
      (bd.games[b].mine.length + bd.games[b].opp.length) - (bd.games[a].mine.length + bd.games[a].opp.length)
    ));

    const scheduleAvailable = isScheduleAvailable();
    let filterUnavailableNote = '';
    if(leagueTimeFilter !== 'all'){
      if(scheduleAvailable){
        gameKeys = gameKeys.filter(key => matchesLeagueTimeFilter(gameSchedule.byPairKey[key]));
      } else {
        filterUnavailableNote = `<div class="empty-note" style="margin-bottom:14px;">Kickoff times aren't available this session, so the ${leagueTimeFilter} filter can't be applied — showing every game instead.</div>`;
      }
    }
    const timeFilterApplied = leagueTimeFilter !== 'all' && scheduleAvailable;

    const notScheduledNote = bd.notScheduled
      ? `<div class="empty-note" style="margin-bottom:14px;">Week ${EZL.getProjectionWeek()} matchups haven't been generated for this league yet, so this is showing your starters only — no opponent to compare against.</div>`
      : '';
    const gamesHTML = gameKeys.map(key => gameBlockHTML(gameHeaderHTML(key, gameSchedule && gameSchedule.byPairKey[key]), bd.games[key].mine, bd.games[key].opp, bd.isGuillotine, oppLabel)).join('');
    // Bye/no-game starters don't belong to any kickoff window, so they only
    // show up under "All Games" — under a specific time filter they'd just
    // be noise unrelated to what was asked for.
    const hasNoGame = !timeFilterApplied && (bd.noGame.mine.length || bd.noGame.opp.length);
    const noGameHTML = hasNoGame ? gameBlockHTML('Bye / No Game Today', bd.noGame.mine, bd.noGame.opp, bd.isGuillotine, oppLabel) : '';
    const emptyNote = timeFilterApplied
      ? `No starters have a ${leagueTimeFilter} kickoff this week.`
      : 'No starters with a scheduled game found.';
    return `${filterUnavailableNote}${notScheduledNote}${gamesHTML || `<div class="empty-note">${emptyNote}</div>`}${noGameHTML}`;
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
    const timeFilterHTML = renderLeagueTimeFilterHTML();
    if(!selectedLeagueId) return pickerHTML + timeFilterHTML + '<div class="empty-note">No leagues found.</div>';
    const lg = state.leagues.find(l => l.league_id === selectedLeagueId);
    const bd = buildLeagueBreakdown(lg);
    return pickerHTML + timeFilterHTML + (bd ? renderLeagueBreakdownHTML(bd) : '<div class="loading-row"><div class="spinner"></div> Loading...</div>');
  }

  // ---------------- By Game mode: cross-league player aggregation ----------------
  // Collapses the same player showing up as a starter in several of your
  // leagues (for this one game) into a single row with a league count,
  // rather than repeating them once per league.
  function aggregatePlayerEntries(entries){
    const map = {};
    entries.forEach(e => {
      if(!e.pid) return;
      if(!map[e.pid]) map[e.pid] = {pid: e.pid, info: e.info, leagueNames: [], projs: []};
      map[e.pid].leagueNames.push(e.lgName);
      if(e.proj != null) map[e.pid].projs.push(e.proj);
    });
    return Object.values(map).map(p => ({
      pid: p.pid,
      info: p.info,
      leagueCount: p.leagueNames.length,
      leagueNames: p.leagueNames,
      // Scoring settings differ league to league, so this is an average
      // across the leagues this player is your (or your opponent's)
      // starter in for this game — a representative number, not exact.
      proj: p.projs.length ? (p.projs.reduce((s,v) => s+v, 0) / p.projs.length) : null,
    })).sort((a,b) => (b.proj==null?-1:b.proj) - (a.proj==null?-1:a.proj) || b.leagueCount - a.leagueCount);
  }

  function splitByTeam(list, teamA, teamB){
    const a = [], b = [];
    list.forEach(p => {
      const team = p.info && p.info.team;
      if(team === teamB) b.push(p); else a.push(p); // anything unrecognized defaults to the "away"/first column
    });
    return {a, b};
  }

  function aggregatedPlayerRowHTML(p){
    return `
      <div class="player-row">
        <div class="slot-tag ${p.info?EZL.slotColorClass(p.info.pos):''}">${p.info?p.info.pos:'?'}</div>
        <div style="flex:1; min-width:0;">
          <div class="player-name ${p.info?EZL.nameColorClass(p.info.pos):''}">${p.info?EZL.playerNameHTML(p.info):p.pid}</div>
          ${p.leagueCount>1 ? `<div style="font-size:11px; color:var(--chalk-faint); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.leagueNames.join(', ')}</div>` : ''}
        </div>
        <div class="player-meta mono" style="text-align:right; margin-right:10px; white-space:nowrap;">${p.proj!=null?p.proj.toFixed(1)+' pts':'—'}</div>
        <div class="mono" style="min-width:24px; text-align:center; background:rgba(212,160,23,0.15); color:var(--gold); border-radius:20px; font-size:11px; font-weight:700; padding:3px 8px;" title="${p.leagueCount} league${p.leagueCount===1?'':'s'}">${p.leagueCount}</div>
      </div>
    `;
  }

  function aggregatedTeamPanelHTML(teamAbbr, players){
    return `
      <div class="matchup-panel">
        <div class="matchup-panel-header">
          ${teamLogoImg(teamAbbr, 26)}
          <div class="matchup-team-name">${teamAbbr || 'Unknown'}</div>
        </div>
        <div class="roster-list">${players.length ? players.map(aggregatedPlayerRowHTML).join('') : '<div class="empty-note">None.</div>'}</div>
      </div>
    `;
  }

  // The number on the right of each row is how many of your leagues have
  // that player starting in this game — not fantasy points from more than
  // one source, just exposure count, same idea as the Player Shares screen.
  function renderGameDetailHTML(chosen, gameKey){
    const schedInfo = gameSchedule && gameSchedule.byPairKey[gameKey];
    const [teamA, teamB] = schedInfo ? [schedInfo.awayAbbr, schedInfo.homeAbbr] : gameKey.split('-');

    const mineEntries = [];
    const oppEntries = [];
    chosen.leagues.forEach(entry => {
      entry.mine.forEach(row => mineEntries.push({pid: row.pid, info: row.info, proj: row.proj, lgName: entry.lg.name}));
      if(!entry.isGuillotine){
        entry.opp.forEach(row => oppEntries.push({pid: row.pid, info: row.info, proj: row.proj, lgName: entry.lg.name}));
      }
    });

    const mineSplit = splitByTeam(aggregatePlayerEntries(mineEntries), teamA, teamB);
    const oppAgg = aggregatePlayerEntries(oppEntries);
    const oppSplit = splitByTeam(oppAgg, teamA, teamB);

    return `
      <div class="section-title" style="margin-top:4px;">Your Starters</div>
      <div class="matchup-grid" style="align-items:start; margin-bottom:8px;">
        ${aggregatedTeamPanelHTML(teamA, mineSplit.a)}
        <div class="matchup-vs">@</div>
        ${aggregatedTeamPanelHTML(teamB, mineSplit.b)}
      </div>
      ${oppAgg.length ? `
        <div style="border-top:2px dashed var(--line-strong); margin:22px 0;"></div>
        <div class="section-title">Starters You're Up Against</div>
        <div class="matchup-grid" style="align-items:start;">
          ${aggregatedTeamPanelHTML(teamA, oppSplit.a)}
          <div class="matchup-vs">@</div>
          ${aggregatedTeamPanelHTML(teamB, oppSplit.b)}
        </div>
      ` : ''}
      <div class="empty-note" style="margin-top:18px;">The number beside each player is how many of your leagues have them starting in this game. Guillotine leagues only ever appear in "Your Starters" — there's no opponent to show.</div>
    `;
  }

  // ---------------- By Game mode ----------------
  function ensureGameFilterInitialized(){
    if(!gameFilterLeagueIds){
      gameFilterLeagueIds = new Set(state.leagues.map(lg => lg.league_id));
    }
  }

  function idsMatchSet(ids, set){
    return ids.length === set.size && ids.every(id => set.has(id));
  }

  // Lets you narrow the By Game view down to just your guillotine leagues,
  // just dynasty, or any custom hand-picked set (e.g. the two close races
  // you're actually watching) — a quick per-category jump plus a
  // multi-select checklist of every league, grouped the same way the
  // League List/Shares screens are.
  function renderGameFilterHTML(){
    const groups = EZL.groupByCategory(state.leagues, lg => lg.name);
    const allIds = state.leagues.map(lg => lg.league_id);
    const allSelected = idsMatchSet(allIds, gameFilterLeagueIds);

    const quickButtonsHTML = `
      <button class="btn ${allSelected?'btn-primary':'btn-ghost'}" data-game-filter-all="1" style="font-size:12px;">All Leagues</button>
      ${groups.map(g => {
        const catIds = g.items.map(lg => lg.league_id);
        const catSelected = idsMatchSet(catIds, gameFilterLeagueIds);
        return `<button class="btn ${catSelected?'btn-primary':'btn-ghost'}" data-game-filter-cat="${g.category}" style="font-size:12px;">${g.category}</button>`;
      }).join('')}
    `;

    const checklistHTML = groups.map(g => `
      <div style="margin-bottom:10px;">
        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--chalk-faint); margin-bottom:6px;">${g.category}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${g.items.map(lg => {
            const checked = gameFilterLeagueIds.has(lg.league_id);
            return `
              <label style="display:flex; align-items:center; gap:6px; background:${checked?'rgba(212,160,23,0.12)':'var(--surface)'}; border:1px solid ${checked?'var(--gold)':'var(--line)'}; border-radius:20px; padding:5px 12px; font-size:12px; cursor:pointer;">
                <input type="checkbox" data-game-filter-league="${lg.league_id}" ${checked?'checked':''} style="accent-color:var(--gold); width:14px; height:14px; margin:0;"/>
                ${lg.name}
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');

    return `
      <div class="empty-note" style="margin-bottom:10px;">${gameFilterLeagueIds.size} of ${allIds.length} league${allIds.length===1?'':'s'} included below${allSelected?'':' — filtered'}. Jump to a category, or check/uncheck individual leagues to build your own set.</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">${quickButtonsHTML}</div>
      <div style="margin-bottom:20px; max-height:220px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:10px 12px;">${checklistHTML}</div>
    `;
  }

  function buildGamesIndex(){
    const index = {}; // gameKey -> {label, leagues:[{lg, mine, opp, isGuillotine, oppUser, oppRoster}]}
    state.leagues.forEach(lg => {
      if(!gameFilterLeagueIds.has(lg.league_id)) return;
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
    ensureGameFilterInitialized();
    const filterHTML = renderGameFilterHTML();

    if(gameFilterLeagueIds.size === 0){
      return filterHTML + '<div class="empty-note">No leagues selected — check at least one league above to see games.</div>';
    }

    const index = buildGamesIndex();
    const gameKeys = Object.keys(index).sort(chronologicalGameKeyComparator((a,b) =>
      index[b].leagues.length - index[a].leagues.length || index[a].label.localeCompare(index[b].label)
    ));
    if(!selectedGameKey || !index[selectedGameKey]){
      selectedGameKey = gameKeys.length ? gameKeys[0] : null;
    }
    const header = `<div class="section-title">This Week's Games <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">(only games with a starter in a selected league, earliest kickoff first)</span></div>`;
    if(!gameKeys.length) return filterHTML + header + '<div class="empty-note">No games with starters found among the selected leagues this week.</div>';

    // Each game's detail (when selected) is rendered as its own item right
    // after that game's row, inside the same list — not appended once at
    // the bottom of the page — so it opens up in place.
    const itemsHTML = gameKeys.map(key => {
      const isSelected = key === selectedGameKey;
      const rowHTML = `
        <div class="overview-row" data-live-game="${key}" ${isSelected?'style="border-left-color:var(--gold);"':''}>
          <div class="overview-main">
            <div class="overview-league-name">${gameHeaderHTML(key, gameSchedule && gameSchedule.byPairKey[key])}</div>
            <div class="overview-payouts">${index[key].leagues.length} league${index[key].leagues.length===1?'':'s'} with a starter in this game</div>
          </div>
        </div>
      `;
      const detailHTML = isSelected
        ? `<div style="padding:14px 16px 4px; margin-top:-4px; border:1px solid var(--line); border-top:none; border-radius:0 0 9px 9px; background:var(--surface);">${renderGameDetailHTML(index[key], key)}</div>`
        : '';
      return rowHTML + detailHTML;
    }).join('');

    return `
      ${filterHTML}
      ${header}
      <div class="overview-list" style="margin-bottom:22px;">${itemsHTML}</div>
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
      document.querySelectorAll('[data-league-time-filter]').forEach(btn => btn.addEventListener('click', () => {
        leagueTimeFilter = btn.dataset.leagueTimeFilter;
        paint();
      }));
    } else {
      document.querySelectorAll('[data-live-game]').forEach(row => row.addEventListener('click', () => {
        selectedGameKey = row.dataset.liveGame;
        paint();
      }));
      document.querySelectorAll('[data-game-filter-all]').forEach(btn => btn.addEventListener('click', () => {
        gameFilterLeagueIds = new Set(state.leagues.map(lg => lg.league_id));
        paint();
      }));
      document.querySelectorAll('[data-game-filter-cat]').forEach(btn => btn.addEventListener('click', () => {
        const cat = btn.dataset.gameFilterCat;
        gameFilterLeagueIds = new Set(state.leagues.filter(lg => EZL.categoryForLeagueName(lg.name) === cat).map(lg => lg.league_id));
        paint();
      }));
      document.querySelectorAll('[data-game-filter-league]').forEach(cb => cb.addEventListener('change', () => {
        const id = cb.dataset.gameFilterLeague;
        if(cb.checked) gameFilterLeagueIds.add(id); else gameFilterLeagueIds.delete(id);
        paint();
      }));
    }
  }

  // ---------------- Entry point called from app.js's router ----------------
  async function render(){
    EZL.renderLoading('Building your Live Hub...');
    const week = EZL.getProjectionWeek();
    await Promise.all([EZL.ensurePlayersLoaded(), EZL.ensureProjectionsLoaded().catch(()=>null), ensureGameSchedule(week)]);
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
