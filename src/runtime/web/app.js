/* HakuNeko workspace surface — DOM app. Runs in the isolated plugin iframe. */
(function () {
  'use strict';

  var L = window.HakunekoSurfaceLogic;
  var bridge = window.mangalist;

  var el = {
    q: document.getElementById('q'),
    sort: document.getElementById('sort'),
    count: document.getElementById('count'),
    list: document.getElementById('list'),
    listState: document.getElementById('listState'),
    detail: document.getElementById('detail'),
    toast: document.getElementById('toast')
  };

  var state = {
    ui: { search: '', sort: 'mangaTitle', sortDesc: false, page: 1 },
    rows: [],
    linkByEntryId: {},
    selectedId: null,
    detailEntry: null,
    totalPages: 1,
    loading: false
  };

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  function req(action, payload) {
    return bridge.request(action, payload).catch(function (err) {
      toast((err && err.message) || ('bridge request "' + action + '" failed'));
      throw err;
    });
  }

  // ── list ────────────────────────────────────────────────
  function loadList() {
    if (state.loading) return;
    state.loading = true;
    el.listState.className = 'state';
    el.listState.textContent = 'Loading…';
    el.list.innerHTML = '';
    el.list.appendChild(el.listState);

    var params = L.buildListRequest(state.ui);
    bridge.getOwnEntries(params.filters, params.pagination).then(function (page) {
      state.loading = false;
      var entries = (page && Array.isArray(page.entries)) ? page.entries : [];
      state.rows = entries.map(L.flattenEntry);
      state.totalPages = L.pageCount(page);
      el.count.textContent = (page && Number.isFinite(page.totalCount))
        ? page.totalCount + (page.totalCount === 1 ? ' bookmark' : ' bookmarks')
        : '';
      renderList();
      refreshLinkStates(state.rows.map(function (r) { return r.pluginEntryId; }));
    }).catch(function (err) {
      state.loading = false;
      el.listState.className = 'state error';
      el.listState.textContent = 'Could not load HakuNeko bookmarks: ' + ((err && err.message) || 'unknown error');
      el.list.innerHTML = '';
      el.list.appendChild(el.listState);
    });
  }

  function renderList() {
    el.list.innerHTML = '';
    if (state.rows.length === 0) {
      el.listState.className = 'state';
      el.listState.textContent = 'No HakuNeko bookmarks match the current filter.';
      el.list.appendChild(el.listState);
      return;
    }

    state.rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'row' + (r.pluginEntryId === state.selectedId ? ' selected' : '');

      var title = document.createElement('span');
      title.className = 'title';
      title.textContent = r.mangaTitle;

      var badge = document.createElement('span');
      var linked = state.linkByEntryId[r.pluginEntryId];
      badge.className = 'badge ' + (linked ? 'linked' : 'unlinked');
      badge.textContent = linked === undefined ? '…' : (linked ? 'In mangalist' : 'Not linked');

      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.appendChild(chip(r.connectorLabel || 'unknown connector'));
      if (r.chapterTitle) meta.appendChild(chip('last read: ' + r.chapterTitle));

      row.appendChild(title);
      row.appendChild(badge);
      row.appendChild(meta);
      row.addEventListener('click', function () { select(r.pluginEntryId); });
      el.list.appendChild(row);
    });

    if (state.totalPages > 1) {
      var pager = document.createElement('div');
      pager.className = 'pager';
      pager.appendChild(pagerBtn('‹ Prev', state.ui.page > 1, function () { state.ui.page--; loadList(); }));
      var label = document.createElement('span');
      label.textContent = 'Page ' + state.ui.page + ' / ' + state.totalPages;
      pager.appendChild(label);
      pager.appendChild(pagerBtn('Next ›', state.ui.page < state.totalPages, function () { state.ui.page++; loadList(); }));
      el.list.appendChild(pager);
    }
  }

  function chip(text) {
    var s = document.createElement('span');
    s.textContent = text;
    return s;
  }
  function pagerBtn(text, enabled, onClick) {
    var b = document.createElement('button');
    b.textContent = text;
    b.disabled = !enabled;
    if (enabled) b.addEventListener('click', onClick);
    return b;
  }

  // ── link-state badges (get-info, array) ─────────────────
  function refreshLinkStates(ids) {
    if (!ids || ids.length === 0) return;
    req('get-info', { entries: ids.map(function (id) { return { pluginEntryId: id }; }) })
      .then(function (results) {
        (results || []).forEach(function (row) {
          state.linkByEntryId[row.pluginEntryId] = L.linkActionsFor(row).linked;
        });
        renderList();
        if (state.selectedId) renderDetail();
      })
      .catch(function () { /* toast already fired */ });
  }

  // ── detail panel ────────────────────────────────────────
  function select(id) {
    state.selectedId = id;
    renderList();
    el.detail.hidden = false;
    el.detail.innerHTML = '<div class="state">Loading…</div>';
    bridge.getOwnEntry(id).then(function (entry) {
      if (state.selectedId !== id) return;
      state.detailEntry = entry ? L.flattenEntry(entry) : null;
      renderDetail();
    }).catch(function (err) {
      if (state.selectedId !== id) return;
      el.detail.innerHTML = '<div class="state error">' + esc((err && err.message) || 'Could not load entry') + '</div>';
    });
  }

  function renderDetail() {
    var d = state.detailEntry;
    if (!d || d.pluginEntryId !== state.selectedId) return;
    var linked = state.linkByEntryId[d.pluginEntryId];
    var acts = L.linkActionsFor({ success: linked === true });

    var html = '';
    html += '<h2>' + esc(d.mangaTitle) + '</h2>';
    html += '<div class="sub">' + esc(d.connectorLabel || 'unknown connector') + '</div>';
    html += '<dl>';
    html += '<dt>Last read</dt><dd>' + esc(d.chapterTitle || '—') + '</dd>';
    html += '<dt>In mangalist</dt><dd>' + (linked === undefined ? '…' : (linked ? 'Yes' : 'No')) + '</dd>';
    if (d.folderMatch !== null) {
      html += '<dt>Local folder</dt><dd>' + (d.folderMatch ? 'Present' : 'Not found on disk') + '</dd>';
    }
    html += '</dl>';

    html += '<div class="actions">';
    if (acts.canBookmark) html += '<button class="primary" data-act="bookmark">Add to mangalist</button>';
    if (acts.canFind) html += '<button data-act="find">Find in mangalist</button>';
    if (d.folderMatch && L.folderUrl(d.folderPath)) html += '<button data-act="folder">Open folder ↗</button>';
    html += '</div>';

    el.detail.innerHTML = html;
    el.detail.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { runAction(b.dataset.act, d); });
    });
  }

  function runAction(act, d) {
    var id = d.pluginEntryId;
    if (act === 'bookmark') {
      req('bookmark', { entries: [{ pluginEntryId: id, pluginType: 'adapter' }] }).then(function (results) {
        var ok = results && results[0] && results[0].success;
        toast(ok ? 'Added to mangalist' : ('Add failed: ' + ((results && results[0] && results[0].error) || 'unknown')));
        if (ok) { state.linkByEntryId[id] = true; renderList(); renderDetail(); }
      }).catch(function () {});
    } else if (act === 'find') {
      req('find-in-mangalist', { pluginEntryId: id }).catch(function () {});
    } else if (act === 'folder') {
      req('open-url', { url: L.folderUrl(d.folderPath) }).catch(function () {});
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── events ──────────────────────────────────────────────
  var searchTimer = null;
  el.q.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.ui.search = el.q.value;
      state.ui.page = 1;
      loadList();
    }, 250);
  });
  el.sort.addEventListener('change', function () {
    state.ui.sort = el.sort.value;
    state.ui.page = 1;
    loadList();
  });

  if (bridge && typeof bridge.onDataChanged === 'function') {
    bridge.onDataChanged(function (ev) {
      if (!ev || !ev.pluginEntryId) return;
      refreshLinkStates([ev.pluginEntryId]);
      if (ev.pluginEntryId === state.selectedId) select(state.selectedId);
    });
  }

  // ── boot ────────────────────────────────────────────────
  if (!bridge) {
    el.listState.className = 'state error';
    el.listState.textContent = 'Workspace bridge unavailable — reload the plugin workspace.';
  } else {
    loadList();
  }
})();
