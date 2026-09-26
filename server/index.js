require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { pool, initSchema } = require('./db');
const pagesRouter = require('./routes/pages');
const registerSocket = require('./socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

app.use('/api', pagesRouter);

// Admin dashboard
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

// Shared static assets for the user-facing page (css/js)
app.use('/user-assets', express.static(path.join(__dirname, '..', 'public', 'user')));

// Dynamic user page: /p/:pageId -> injects the pageId into the static template
app.get('/p/:pageId', async (req, res) => {
  try {
    const [[page]] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.pageId]);
    if (!page) return res.status(404).send('Page not found');

    const templatePath = path.join(__dirname, '..', 'public', 'user', 'page.html');
    let html = fs.readFileSync(templatePath, 'utf8');
    html = html
      .replace(/__PAGE_ID__/g, page.id)
      .replace(/__PAGE_TITLE__/g, page.title);

    res.send(html);
  } catch (err) {
    console.error('Failed to render user page', err);
    res.status(500).send('Server error');
  }
});

app.get('/', (req, res) => res.redirect('/admin'));

registerSocket(io);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema', err);
    process.exit(1);
  });
