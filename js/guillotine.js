// Guillotine Command Centre
// -----------------------------------------------------------------------
// This file is intentionally separate from app.js. It talks to the main
// app only through window.EZL (set up at the bottom of app.js) — it does
// not have (and should not need) any private references into app.js's
// closure. If EZL is missing something this file needs, add it to the
// exposure block in app.js rather than duplicating logic here.
//
// Feature (per Project Status "Next Planned Feature"):
//   - Sort teams by Projection
//   - Sort teams by FAAB
//   - Display team projections
//   - Display team FAAB
//   - Click a team -> view roster
//   - Click a team -> view potential cut pool
// -----------------------------------------------------------------------

window.Guillotine = (function(){

  // Local UI state for this screen only — deliberately not stored on
  // EZL.state, since nothing outside this file needs it.
  // Keyed per-league (league_id) rather than one shared object, so that
  // navigating from one guillotine league's Command Centre to another's
  // doesn't carry over the first league's expanded roster / sort choice
  // (a roster_id that happens to collide between leagues would otherwise
  // silently expand the wrong team, or expand nothing at all).
  const ccStateByLeague = {};
  function getCcState(leagueId){
    if(!ccStateByLeague[leagueId]){
      ccStateByLeague[leagueId] = { sortBy: 'proj', expandedRosterId: null };
    }
    return ccStateByLeague[leagueId];
  }

  function computeAliveRows(detail){
    const EZL = window.EZL;
    const cutSet = new Set(detail.cutRosters || []);
    const alive = detail.rosters.filter(r => !cutSet.has(r.roster_id));
    return alive.map(roster => {
      const user = detail.usersById[roster.owner_id];
      const opt = EZL.computeOptimalLineup(roster, detail.league);
      const projTotal = EZL.lineupTotal(opt.assignment, opt.pool);
      const faab = EZL.faabRemaining({raw: roster}, detail);
      return {roster, user, opt, projTotal, faab: faab.remaining, faabTotal: faab.total};
    });
  }

  // Whole roster (starters + bench together), sorted by this week's
  // projected points, highest first. No lineup/bench distinction — just
  // a straight ranking of everyone on the roster.
  function rosterSortedByProj(opt){
    return opt.pool
      .slice()
      .sort((a, b) => (b.hasProj ? b.proj : -1) - (a.hasProj ? a.proj : -1));
  }

  function rosterRowsHTML(sortedPool){
    const EZL = window.EZL;
    if(!sortedPool.length){
      return '<div style="color:var(--chalk-faint); font-size:12px; padding:6px 0;">No players on this roster.</div>';
    }
    return sortedPool.map(p => `
      <div class="player-row">
        <div class="slot-tag ${EZL.slotColorClass(p.pos)}">${p.pos || '?'}</div>
        <div class="player-name ${p.info ? EZL.nameColorClass(p.info.pos) : ''}" style="flex:1;">${p.info ? EZL.playerNameHTML(p.info) : p.pid}</div>
        <div class="player-meta mono">${p.hasProj ? p.proj.toFixed(1) + ' pts' : '—'}</div>
      </div>
    `).join('');
  }

  function expandedPanelHTML(row){
    const sortedPool = rosterSortedByProj(row.opt);
    return `
      <div style="padding:10px 8px 22px;">
        <div class="roster-group-title">Full Roster <span style="color:var(--chalk-faint); text-transform:none; letter-spacing:0; font-size:11px;">— sorted by projected points this week</span></div>
        <div class="roster-list">${rosterRowsHTML(sortedPool)}</div>
      </div>
    `;
  }

  function teamRowHTML(row, rank, detail, ccState){
    const EZL = window.EZL;
    const isMe = row.roster.roster_id === detail.myRosterId;
    const expanded = ccState.expandedRosterId === row.roster.roster_id;
    return `
      <div class="guillotine-row ${isMe ? 'me' : ''}" data-cc-team="${row.roster.roster_id}" style="cursor:pointer;">
        <span class="rank-num" style="width:26px; flex-shrink:0;">${rank}</span>
        <div class="team-cell" style="flex:1;">
          ${EZL.avatarHTML(row.user && row.user.avatar, row.user && row.user.display_name)}
          <div>
            <div class="team-name">${EZL.teamDisplayName(row.user, row.roster)}${isMe ? ' <span style="color:var(--gold); font-size:11px;">(You)</span>' : ''}</div>
            <div class="owner-name">${row.user ? row.user.display_name : 'Unknown'}</div>
          </div>
        </div>
        <div class="guillotine-pf mono" title="Projected Week score">${row.projTotal.toFixed(1)} <span style="color:var(--chalk-faint); font-size:10px;">PROJ</span></div>
        ${row.faabTotal > 0 ? `<div class="guillotine-faab mono">$${row.faab} <span style="color:var(--chalk-faint); font-size:10px;">FAAB</span></div>` : ''}
        <span style="color:var(--gold); font-size:11px; margin-left:6px; white-space:nowrap;">${expanded ? '▲ Hide' : '▼ Roster & Cut Pool'}</span>
      </div>
      ${expanded ? expandedPanelHTML(row) : ''}
    `;
  }

  function renderCommandCentre(detail, contentEl){
    const leagueId = window.EZL.state.currentLeagueId;
    const ccState = getCcState(leagueId);
    const rows = computeAliveRows(detail);
    const sorted = rows.slice().sort((a, b) =>
      ccState.sortBy === 'faab' ? (b.faab - a.faab) : (b.projTotal - a.projTotal)
    );

    contentEl.innerHTML = `
      <div class="empty-note" style="margin-bottom:14px;">
        Ranks teams still alive by this week's projected optimal lineup, or by FAAB remaining.
        Click a team to see their entire roster — starters and bench together — sorted by
        projected points for the week.
      </div>
      <div style="display:flex; gap:6px; margin-bottom:14px;">
        <button class="btn ${ccState.sortBy === 'proj' ? 'btn-primary' : 'btn-ghost'}" data-cc-sort="proj">Sort by Projection</button>
        <button class="btn ${ccState.sortBy === 'faab' ? 'btn-primary' : 'btn-ghost'}" data-cc-sort="faab">Sort by FAAB</button>
      </div>
      <div class="guillotine-list">
        ${sorted.map((row, i) => teamRowHTML(row, i + 1, detail, ccState)).join('') || '<div style="color:var(--chalk-faint); font-size:13px; padding:8px 2px;">Nobody left — grim.</div>'}
      </div>
    `;
    bindCommandCentre(detail, contentEl, ccState);
  }

  function bindCommandCentre(detail, contentEl, ccState){
    contentEl.querySelectorAll('[data-cc-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        ccState.sortBy = btn.dataset.ccSort;
        renderCommandCentre(detail, contentEl);
      });
    });
    contentEl.querySelectorAll('[data-cc-team]').forEach(el => {
      el.addEventListener('click', () => {
        const rid = parseInt(el.dataset.ccTeam, 10);
        ccState.expandedRosterId = (ccState.expandedRosterId === rid) ? null : rid;
        renderCommandCentre(detail, contentEl);
      });
    });
  }

  return { renderCommandCentre };
})();
