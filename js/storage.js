// Storage
// -----------------------------------------------------------------------
// Every localStorage read/write for the app lives here, nowhere else.
// Nothing in this file touches rendering, state, or the DOM — it only
// knows how to get/set JSON blobs under the ezl: prefix. app.js and any
// other screen file call into window.Storage rather than touching
// localStorage directly.
//
// Load this script BEFORE app.js in index.html — app.js's boot() calls
// Storage.loadSettings() as soon as it runs.
// -----------------------------------------------------------------------

window.Storage = (function(){

  const APP_PREFIX = 'ezl:';

  // ---------------- Username/season the user set up with ----------------
  async function loadSettings(){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'settings');
      return v ? JSON.parse(v) : null;
    }catch(e){ return null; }
  }
  async function saveSettings(username, season){
    try{ localStorage.setItem(APP_PREFIX + 'settings', JSON.stringify({username, season})); }catch(e){}
  }

  // ---------------- Full backup export/import ----------------
  // Standard browser localStorage — this app is meant to be opened as a
  // standalone local file/page, not run inside Claude's in-chat sandbox
  // (which blocks both external fetch() and localStorage).
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

    // Only ever write keys under this app's own prefix — exportUserData()
    // only ever exports ezl: keys, so anything else in the file is either
    // from a different app/tampered/corrupt and should never be written
    // into this origin's localStorage.
    let imported = 0, skipped = 0;
    Object.entries(data).forEach(([key, value]) => {
      if(typeof key === 'string' && key.startsWith(APP_PREFIX) && typeof value === 'string'){
        localStorage.setItem(key, value);
        imported++;
      } else {
        skipped++;
      }
    });

    if(imported === 0){
      alert('No valid backup data found in that file — nothing was imported.');
      return;
    }
    alert('Backup imported successfully (' + imported + ' key' + (imported===1?'':'s') + (skipped ? ', ' + skipped + ' skipped' : '') + '). Please refresh the page.');
  }

  // ---------------- Per-league buy-in / payout structure ----------------
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

  // ---------------- Guillotine cut tracking ----------------
  // Sleeper has no "eliminated" flag for guillotine-format leagues, so who's
  // been cut is tracked manually here and saved per league.
  async function loadCutRosters(leagueId){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'cut:' + leagueId);
      return v ? JSON.parse(v) : [];
    }catch(e){ return []; }
  }
  async function saveCutRosters(leagueId, rosterIds){
    try{ localStorage.setItem(APP_PREFIX + 'cut:' + leagueId, JSON.stringify(rosterIds)); }catch(e){}
  }

  // ---------------- Season Planner move history ----------------
  // A purely local plan of future add/drop moves. This CANNOT execute a
  // real Sleeper transaction (no write access); it's a what-if planning
  // tool only. Each move: {week, addPid, dropPid}.
  async function loadPlannerMoves(leagueId){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'plannerMoves:' + leagueId);
      return v ? JSON.parse(v) : [];
    }catch(e){ return []; }
  }
  async function savePlannerMoves(leagueId, moves){
    try{ localStorage.setItem(APP_PREFIX + 'plannerMoves:' + leagueId, JSON.stringify(moves)); }catch(e){}
  }

  // ---------------- Matchup difficulty rankings ----------------
  // User-entered, one ranking set per position (QB/RB/WR/TE/DEF). Stored
  // once, globally — these describe NFL defenses, not anything league-specific.
  async function loadMatchupRankings(){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'matchupRankings');
      return v ? JSON.parse(v) : {};
    }catch(e){ return {}; }
  }
  async function saveMatchupRankings(data){
    try{ localStorage.setItem(APP_PREFIX + 'matchupRankings', JSON.stringify(data)); }catch(e){}
  }

  // ---------------- Sleeper player dictionary cache ----------------
  // The full /v1/players/nfl payload is large and only changes a handful of
  // times a week (trades, signings, injury designations), so it's persisted
  // here with a timestamp rather than re-fetched on every single page load.
  // 24h TTL — generous enough to skip most reloads, short enough that a
  // Tuesday-morning transaction wave shows up within a day.
  const PLAYERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  async function loadPlayersCache(){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'playersCache');
      if(!v) return null;
      const parsed = JSON.parse(v);
      if(!parsed || !parsed.fetchedAt || !parsed.data) return null;
      if(Date.now() - parsed.fetchedAt > PLAYERS_CACHE_TTL_MS) return null; // stale
      return parsed.data;
    }catch(e){ return null; }
  }
  async function savePlayersCache(data){
    try{
      localStorage.setItem(APP_PREFIX + 'playersCache', JSON.stringify({fetchedAt: Date.now(), data}));
    }catch(e){
      // Most likely a quota error (this payload is a few MB) — fall back to
      // in-memory-only for this session rather than throwing.
    }
  }

  // ---------------- Planned FAAB bids ----------------
  // A personal checklist, not a real Sleeper waiver claim.
  // {leagueId, leagueName, week, playerId, amount}
  async function loadWaiverBids(){
    try{
      const v = localStorage.getItem(APP_PREFIX + 'waiverBids');
      return v ? JSON.parse(v) : [];
    }catch(e){ return []; }
  }
  async function saveWaiverBids(bids){
    try{ localStorage.setItem(APP_PREFIX + 'waiverBids', JSON.stringify(bids)); }catch(e){}
  }

  return {
    APP_PREFIX,
    loadSettings,
    saveSettings,
    exportUserData,
    importUserData,
    loadPayout,
    savePayout,
    loadCutRosters,
    saveCutRosters,
    loadPlannerMoves,
    savePlannerMoves,
    loadMatchupRankings,
    saveMatchupRankings,
    loadWaiverBids,
    saveWaiverBids,
    loadPlayersCache,
    savePlayersCache,
  };
})();
