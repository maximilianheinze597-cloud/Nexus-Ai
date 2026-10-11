import 'dotenv/config';
import express from 'express';
import { randomUUID as uid } from 'node:crypto';
import { load, save } from './lib/store.js';
import { listModels, stream } from './lib/providers.js';
import * as gh from './lib/github.js';
import { runAgent } from './lib/agent.js';

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(express.static('public'));

const wrap = (f) => (q, s) => Promise.resolve(f(q, s)).catch((e) => s.status(500).json({ error: e.message }));
const sseInit = (s) => { s.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); s.flushHeaders(); };
const send = (s, o) => s.write(`data: ${JSON.stringify(o)}\n\n`);
const allowedList = () => (process.env.GITHUB_ALLOWED_REPOS || '').split(',').map((x) => x.trim()).filter(Boolean);
const checkRepo = (r) => { const a = allowedList(); if (!/^[\w.-]+\/[\w.-]+$/.test(r || '') || (a.length && !a.includes(r))) throw new Error('Repo nicht freigegeben'); };

const systemPrompt = () => {
  const mem = load('memory', []);
  return 'Du bist Nova, ein hilfreicher, ehrlicher KI-Assistent. Antworte in der Sprache des Nutzers.' +
    (mem.length ? '\n\nVom Nutzer freigegebene Erinnerungen:\n' + mem.map((x) => '- ' + x.text).join('\n') : '');
};

// ---- Modelle
app.get('/api/models', (_q, s) => s.json(listModels()));

// ---- Unterhaltungen
app.get('/api/conversations', (_q, s) =>
  s.json(Object.values(load('conversations', {})).sort((a, b) => b.updated - a.updated).map(({ id, title }) => ({ id, title }))));
app.get('/api/conversations/:id', (q, s) => {
  const c = load('conversations', {})[q.params.id];
  s.json(c ? { ...c, messages: c.messages.map((m) => ({ ...m, attachments: (m.attachments || []).map(({ name, kind }) => ({ name, kind })) })) } : { error: 'Nicht gefunden' });
});
app.delete('/api/conversations/:id', (q, s) => {
  const all = load('conversations', {}); delete all[q.params.id]; save('conversations', all); s.json({ ok: true });
});

app.post('/api/chat', wrap(async (q, s) => {
  const { id, model, text = '', attachments = [] } = q.body;
  if (!model) throw new Error('Kein Modell gewählt');
  const all = load('conversations', {});
  let c = all[id];
  if (!c) { c = { id: uid(), title: text.slice(0, 50) || 'Neuer Chat', messages: [] }; all[c.id] = c; }
  c.messages.push({ role: 'user', content: text, attachments });
  sseInit(s);
  const ac = new AbortController();
  s.on('close', () => ac.abort());
  let out = '';
  try {
    for await (const t of stream({ model, system: systemPrompt(), messages: c.messages, signal: ac.signal })) { out += t; send(s, { t }); }
  } catch (e) { if (!ac.signal.aborted) send(s, { error: e.message }); }
  if (out) c.messages.push({ role: 'assistant', content: out }); else c.messages.pop();
  c.updated = Date.now();
  save('conversations', all);
  send(s, { done: true, id: c.id });
  s.end();
}));

// ---- Gedächtnis (nur was der Nutzer freigibt)
app.get('/api/memory', (_q, s) => s.json(load('memory', [])));
app.post('/api/memory', (q, s) => {
  const text = String(q.body.text || '').trim().slice(0, 500);
  if (!text) return s.status(400).json({ error: 'Leer' });
  const m = load('memory', []); m.push({ id: uid(), text }); save('memory', m); s.json(m);
});
app.delete('/api/memory/:id', (q, s) => {
  const m = load('memory', []).filter((x) => x.id !== q.params.id); save('memory', m); s.json(m);
});

// ---- GitHub-Agent
app.get('/api/github/repos', wrap(async (_q, s) => {
  const a = allowedList();
  const r = await gh.repos();
  s.json({ write: process.env.GITHUB_ALLOW_WRITE === 'true', repos: a.length ? r.filter((x) => a.includes(x.full_name)) : r });
}));

app.post('/api/agent', wrap(async (q, s) => {
  const { model, repo, task } = q.body;
  checkRepo(repo);
  sseInit(s);
  const ac = new AbortController();
  s.on('close', () => ac.abort());
  try { for await (const ev of runAgent({ model, task, repo, signal: ac.signal })) send(s, ev); }
  catch (e) { send(s, { type: 'error', text: e.message }); }
  s.end();
}));

app.post('/api/agent/approve', wrap(async (q, s) => {
  if (process.env.GITHUB_ALLOW_WRITE !== 'true') throw new Error('Schreibzugriff ist deaktiviert (GITHUB_ALLOW_WRITE=true setzen)');
  const { repo, proposal: p } = q.body;
  checkRepo(repo);
  if (!Array.isArray(p?.files) || !p.files.length) throw new Error('Keine Dateien im Vorschlag');
  const branch = 'nova/' + String(p.branch || 'aenderung').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36);
  const url = await gh.createPR(repo, { branch, title: p.title || 'Änderung von Nova', body: p.body || '', files: p.files });
  s.json({ url });
}));

const port = process.env.PORT || 3000;
app.listen(port, '127.0.0.1', () => console.log(`Nova läuft auf http://localhost:${port}`));
