// Season Planner
// -----------------------------------------------------------------------
// The "24hr Maccas" league's deep-dive tab: a personal what-if lineup
// planner, user-entered matchup difficulty rankings, and a season-long
// matchup overview. None of this touches a real Sleeper roster — it's a
// local planning tool only.
//
// Like guillotine.js, this file only talks to app.js through window.EZL
// (state + shared helpers) and to storage.js through window.Storage. It
// doesn't reach into app.js's private closure, and app.js doesn't reach
// into this one — the only entry point app.js calls is Planner.renderTab().
//
// Load this script AFTER app.js (and after storage.js) in index.html.
// -----------------------------------------------------------------------

window.Planner = (function(){

  const EZL = window.EZL;
  const state = EZL.state; // shared object reference — same `state` app.js uses

  // ---------------- Per-week planner projections cache ----------------
  // Separate from the main week-picker's projections cache, so planning a
  // future week doesn't disturb the cache used everywhere else in the app.
  async function ensurePlannerProjectionsForWeek(week){
    if(!state.plannerProjCache) state.plannerProjCache = {};
    if(state.plannerProjCache[week]) return state.plannerProjCache[week];
    const positions = ['QB','RB','WR','TE','K','DEF'];
    const results = await Promise.all(positions.map(pos =>
      EZL.fetchJSON(`https://api.sleeper.app/projections/nfl/${EZL.PROJECTION_SEASON}/${week}?season_type=regular&position[]=${pos}`).catch(()=>[])
    ));
    const byPlayer = {};
    results.flat().forEach(p => {
      if(p && p.player_id) byPlayer[p.player_id] = p.stats || {};
    });
    state.plannerProjCache[week] = byPlayer;
    return byPlayer;
  }
  // Same scoring formula app.js's projectedPoints() uses (exact league
  // scoring settings against the raw stat line, with the generic PPR-tier
  // fallback) — shared via EZL.scoreStatLine rather than duplicated here,
  // since this only differs from the main app's version in which cache
  // (a specific planned week's) the raw stat line comes from.
  function plannerProjectedPoints(pid, league, week){
    const byPlayer = state.plannerProjCache && state.plannerProjCache[week];
    if(!byPlayer) return null;
    return EZL.scoreStatLine(byPlayer[pid], league);
  }

  // Same optimizer as the main app's computeOptimalLineup (EZL.greedyAssignLineup),
  // but takes a plain list of player ids — which may include hypothetical
  // waiver adds not on the real Sleeper roster — and a specific week's
  // planner projections, rather than a real roster object.
  function computePlannerLineup(pids, league, week){
    const pool = pids.map(pid => {
      const info = EZL.playerLabel(pid);
      const rawProj = plannerProjectedPoints(pid, league, week);
      return {pid, pos: info ? info.pos : null, proj: rawProj == null ? -1 : rawProj, hasProj: rawProj != null, info};
    });
    const slotOrder = (league.roster_positions || []).filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI');
    const assignment = EZL.greedyAssignLineup(pool, slotOrder);
    return {slotOrder, assignment, pool};
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

  // ---------------- Matchup difficulty rankings ----------------
  // User-entered, one ranking set per position (QB/RB/WR/TE/DEF). Stored
  // once, globally, via Storage — these describe NFL defenses, not
  // anything league-specific.
  const RANKING_POSITIONS = ['QB','RB','WR','TE','DEF'];
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

  // ---------------- 2026 schedule ----------------
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

  function plannerMatchupText(pid, week){
    const info = EZL.playerLabel(pid);
    if(!info || !info.team || info.team === 'FA') return '';
    if(EZL.BYE_WEEKS[info.team] === week) return '<span style="color:var(--chalk-faint);">BYE</span>';
    const m = getMatchup(info.team, week);
    if(!m) return '<span style="color:var(--chalk-faint);">—</span>';
    const rank = getMatchupDifficulty(info.pos, m.opp);
    const color = rankColor(rank);
    const badge = color ? ` <span style="background:${color}; color:#fff; padding:0 4px; border-radius:3px; font-size:10px; font-weight:700;">${rank}</span>` : '';
    return `vs ${m.opp}${badge}`;
  }

  // ---------------- Lineup Planner sub-view ----------------
  function renderPlannerLineupSection(detail){
    const st = detail.plannerState;
    const total = EZL.lineupTotal(st.assignment, st.pool);
    const usedSet = new Set(st.assignment.filter(Boolean));
    const bench = st.pool.filter(p => !usedSet.has(p.pid)).sort((a,b) => b.proj - a.proj);

    const slotRows = st.slotOrder.map((slot,i) => {
      const pid = st.assignment[i];
      const eligible = EZL.SLOT_ELIGIBILITY[slot] || [slot];
      const usedElsewhere = new Set(st.assignment.filter((v,idx)=>idx!==i && v));
      const candidates = st.pool.filter(p => eligible.includes(p.pos)).filter(p => !usedElsewhere.has(p.pid) || p.pid===pid).sort((a,b)=>b.proj-a.proj);
      const optionsHTML = candidates.map(p => `<option value="${p.pid}" ${p.pid===pid?'selected':''}>${p.info?p.info.name:p.pid} (${p.pos}) — ${p.hasProj?p.proj.toFixed(1):'—'} pts</option>`).join('');
      const chosen = st.pool.find(p=>p.pid===pid);
      return `
        <div class="matchup-slot-row">
          <div class="slot-tag ${EZL.slotColorClass(slot)}">${EZL.slotLabel(slot)}</div>
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
        <div class="player-name ${p.info?EZL.nameColorClass(p.info.pos):''}" style="flex:1; font-size:12.5px;">${p.info?EZL.playerNameHTML(p.info):p.pid}</div>
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
      const addInfo = EZL.playerLabel(m.addPid);
      const dropInfo = EZL.playerLabel(m.dropPid);
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
        await window.Storage.savePlannerMoves(state.currentLeagueId, detail.plannerMoves);
        EZL.render();
      });
    });

    function paintWaiverResults(query){
      const resultsEl = document.getElementById('planner-waiver-results');
      const q = query.trim().toLowerCase();
      if(q.length < 2){
        resultsEl.innerHTML = '<div style="color:var(--chalk-faint); font-size:12px;">Type at least 2 letters of a player\'s name.</div>';
        return;
      }
      const owned = EZL.computeOwnedPlayerIds(detail);
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
          <div class="slot-tag ${EZL.slotColorClass(p.pos)}">${p.pos||'?'}</div>
          <div class="player-name ${EZL.nameColorClass(p.pos)}" style="flex:1;">${p.name} <span style="color:var(--chalk-faint); font-size:11px;">${p.team||'FA'}</span></div>
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
            const info = EZL.playerLabel(pid);
            return `<option value="${pid}">${info?info.name:pid} (${info?info.pos:'?'})</option>`;
          }).join('');
          resultsEl.innerHTML = `
            <div class="payout-card">
              <div style="font-size:13px; margin-bottom:10px;">Adding <strong>${EZL.playerLabel(addPid)?EZL.playerLabel(addPid).name:addPid}</strong> starting Week ${week}. Who comes off your roster?</div>
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
            await window.Storage.savePlannerMoves(state.currentLeagueId, detail.plannerMoves);
            EZL.toast('Move planned');
            EZL.render();
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

  // ---------------- Matchup Rankings sub-view ----------------
  function renderMatchupRankingsView(){
    if(!state.rankingsPositionTab) state.rankingsPositionTab = 'QB';
    const pos = state.rankingsPositionTab;
    const table = (state.matchupRankings && state.matchupRankings[pos]) || {};
    const teams = Object.keys(EZL.BYE_WEEKS).sort();
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
      await window.Storage.saveMatchupRankings(state.matchupRankings);
      EZL.toast(pos + ' rankings saved');
    });
  }

  // ---------------- Season Overview sub-view ----------------
  function renderSeasonOverviewView(detail){
    const myRoster = detail.rosters.find(r => r.roster_id === detail.myRosterId);
    if(!myRoster) return `<div class="empty-note">Couldn't find your team in this league.</div>`;
    const excluded = new Set([...(myRoster.reserve||[]), ...(myRoster.taxi||[])]);
    const pids = (myRoster.players || []).filter(pid => !excluded.has(pid));
    const players = pids.map(pid => ({pid, info: EZL.playerLabel(pid)})).filter(p => p.info)
      .sort((a,b) => (a.info.pos||'').localeCompare(b.info.pos||'') || a.info.name.localeCompare(b.info.name));

    const weekHeaders = Array.from({length:18}, (_,i)=>i+1).map(w => `<th style="min-width:36px;">${w}</th>`).join('');
    const rows = players.map(p => {
      const cells = Array.from({length:18}, (_,i) => {
        const week = i+1;
        const team = p.info.team;
        if(!team || team === 'FA') return '<td>—</td>';
        if(EZL.BYE_WEEKS[team] === week) return '<td style="color:var(--chalk-faint); font-size:11px;">BYE</td>';
        const m = getMatchup(team, week);
        if(!m) return '<td>—</td>';
        const rank = getMatchupDifficulty(p.info.pos, m.opp);
        const color = rankColor(rank);
        return `<td>${color ? `<span style="background:${color}; color:#fff; padding:1px 5px; border-radius:3px; font-size:10.5px; font-weight:700;">${rank}</span>` : '<span style="color:var(--chalk-faint); font-size:10.5px;">'+m.opp+'</span>'}</td>`;
      }).join('');
      return `<tr><td style="text-align:left; white-space:nowrap;"><span class="${EZL.nameColorClass(p.info.pos)}" style="font-weight:600;">${p.info.name}</span> <span style="color:var(--chalk-faint); font-size:11px;">${p.info.pos}</span></td>${cells}</tr>`;
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

  // ---------------- Season Planner tab shell ----------------
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
      EZL.render();
    }));
    const sub = state.plannerSubView;
    if(sub === 'rankings') bindMatchupRankingsView();
    else if(sub !== 'season') bindPlannerLineupView(detail);
  }

  // ---------------- Entry point called from app.js ----------------
  async function renderTab(detail, contentEl){
    if(!state.plannerWeek) state.plannerWeek = EZL.getProjectionWeek();
    if(!state.plannerSubView) state.plannerSubView = 'lineup';
    if(!state.matchupRankings) state.matchupRankings = await window.Storage.loadMatchupRankings();
    await Promise.all([EZL.ensurePlayersLoaded(), ensurePlannerProjectionsForWeek(state.plannerWeek).catch(()=>null)]);
    if(!detail.plannerMoves){
      detail.plannerMoves = await window.Storage.loadPlannerMoves(state.currentLeagueId);
    }
    contentEl.innerHTML = renderSeasonPlannerTab(detail);
    bindSeasonPlannerTab(detail);
  }

  return { renderTab };
})();
