# Realtime Lead Session Admin

Admin creates shareable pages. When a user opens a page, it shows up live as a
"session" in the admin dashboard (and is stored in MySQL). Admin can push a
lead-capture popup onto that user's page in real time, and watches the form
fields fill in **as the user types**, keystroke by keystroke. Admin can close
the popup and push a new one at any time.

## Stack
- Node.js + Express (HTTP + REST)
- Socket.IO (realtime channel between admin dashboard and user pages)
- MySQL (`mysql2`) — pages, sessions, forms, form_fields
- Vanilla JS/HTML/CSS frontend (no build step)

## Setup

1. Install MySQL and have it running locally (or point `.env` at a remote instance).
2. Copy the env file and fill in your DB credentials:
   ```
   cp .env.example .env
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Start the server (it auto-creates the database/tables on boot):
   ```
   npm start
   ```
   or with auto-reload during development:
   ```
   npm run dev
   ```
5. Open the admin dashboard: http://localhost:3000/admin

## How it works

1. **Create a page** in the admin sidebar. This generates a unique URL like
   `http://localhost:3000/p/<pageId>` and stores it in the `pages` table.
2. **Share that link** with a user. The moment they open it, their browser
   registers over Socket.IO, a row is written to `sessions`, and it instantly
   appears in the admin dashboard's session list for that page.
3. Click the session, pick a form template (Lead Form / Contact Form / Quote
   Form) from the dropdown, and hit **Open Form**. That pushes a popup onto
   the user's page in real time.
4. As the user types into any field, every keystroke is streamed to the admin
   panel and shown live under that field (also persisted to `form_fields`,
   debounced ~250ms to avoid hammering the DB on rapid typing).
5. Admin can **Close Form** at any time (it disappears from the user's
   screen immediately), then open a new one — e.g. a different template, or
   the same one again for a fresh conversation.

## Data model
- `pages` — one row per generated shareable page/link
- `sessions` — one row per time a user opens a page (this is what shows up
  live as a "session" in the admin UI)
- `forms` — one row per popup pushed to a session (open/closed/submitted)
- `form_fields` — live + final field values per form, keyed by field name

## Adding new form templates
Edit `server/formTemplates.js` — it's the single source of truth served to
both the admin dropdown and the fields rendered on the user's popup.
