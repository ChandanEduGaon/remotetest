const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');

const router = express.Router();

// Create a new shareable page
router.post('/pages', async (req, res) => {
  try {
    const title = (req.body && req.body.title) || 'Untitled Page';
    const id = uuidv4();
    await pool.query('INSERT INTO pages (id, title) VALUES (?, ?)', [id, title]);

    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ id, title, url: `${base}/p/${id}` });
  } catch (err) {
    console.error('Failed to create page', err);
    res.status(500).json({ error: 'Failed to create page' });
  }
});

// List all pages
router.get('/pages', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pages ORDER BY created_at DESC');
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const pages = rows.map((p) => ({ ...p, url: `${base}/p/${p.id}` }));
    res.json(pages);
  } catch (err) {
    console.error('Failed to list pages', err);
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

// List sessions for a page (with any open/latest form info)
router.get('/pages/:pageId/sessions', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM sessions WHERE page_id = ? ORDER BY created_at DESC',
      [req.params.pageId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to list sessions', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Full detail for one session: forms + field values
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const [[session]] = await pool.query('SELECT * FROM sessions WHERE id = ?', [
      req.params.sessionId
    ]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const [forms] = await pool.query(
      'SELECT * FROM forms WHERE session_id = ? ORDER BY created_at DESC',
      [req.params.sessionId]
    );

    for (const form of forms) {
      const [fields] = await pool.query(
        'SELECT field_name, field_value, updated_at FROM form_fields WHERE form_id = ?',
        [form.id]
      );
      form.fields = fields;
    }

    res.json({ session, forms });
  } catch (err) {
    console.error('Failed to load session detail', err);
    res.status(500).json({ error: 'Failed to load session detail' });
  }
});

module.exports = router;
