require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mm = require('./lib/mindmap');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-.env';
// APP_PASSWORD_HASH is a bcrypt hash of the login password, generated with
// scripts/set-password.js. Never store the plaintext password.
const APP_PASSWORD_HASH = process.env.APP_PASSWORD_HASH;

if (!APP_PASSWORD_HASH) {
  console.error('APP_PASSWORD_HASH is not set. Run `node scripts/set-password.js <password>` to generate one and put it in .env.');
  process.exit(1);
}

const db = mm.initDb(path.join(__dirname, 'db', 'mindmap.db'));

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    sameSite: 'lax',
  },
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login.html');
}

// --- Auth routes ---------------------------------------------------------

app.post('/api/login', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  const ok = await bcrypt.compare(password, APP_PASSWORD_HASH);
  if (!ok) return res.status(401).json({ error: 'Incorrect password' });
  req.session.authed = true;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// Static assets: login page must be reachable without auth; everything
// else in /public is gated behind requireAuth.
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.use('/login.js', express.static(path.join(__dirname, 'public', 'login.js')));
app.use('/shared.css', express.static(path.join(__dirname, 'public', 'shared.css')));
app.use('/theme.js', express.static(path.join(__dirname, 'public', 'theme.js')));
app.use('/ui-helpers.js', express.static(path.join(__dirname, 'public', 'ui-helpers.js')));

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// --- API routes ------------------------------------------------------
app.use('/api', require('./routes/api')(db, mm));

app.listen(PORT, () => {
  console.log(`Mind Map app listening on port ${PORT}`);
});
