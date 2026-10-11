// Werkbank – KI-Chat, Coding-Agent, Dateianalyse, Gedächtnis. Keine npm-Abhängigkeiten (Node >= 18).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

// .env laden
try {
  for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const E = process.env;
const PORT = +E.PORT || 3000;
const ALLOW_WRITE = E.ALLOW_WRITE === 'true';
const list = (v, d) => (v || d).split(',').map(s => s.trim()).filter(Boolean);

const PROVIDERS = {
  anthropic: { label: 'Anthropic', on: !!E.ANTHROPIC_API_KEY, models: list(E.ANTHROPIC_MODELS, 'claude-sonnet-5-5,claude-opus-5-5,claude-haiku-5-5') },
  openai: { label: 'OpenAI', on: !!E.OPENAI_API_KEY, models: list(E.OPENAI_MODELS, 'gpt-4o,gpt-4o-mini') },
  gemini: { label: 'Google Gemini', on: !!E.GEMINI_API_KEY, models: list(E.GEMINI_MODELS, 'gemini-2.5-flash,gemini-2.5-pro') },
  ollama: { label: 'Ollama (lokal)', on: !!E.OLLAMA_HOST, models: [] },
};

// ---------- Speicher ----------
const load = (n, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8')); } catch { return d; } };
const save = (n, v) => fs.writeFileSync(path.join(DATA, n), JSON.stringify(v, null, 2));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Modellaufrufe ----------
async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`API ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}
const toText = m => (m.content || '') + (m.files || []).filter(f => f.text != null)
  .map(f => `\n\n[Datei: ${f.name}]\n${f.text}`).join('');
const bin = (m, test) => (m.files || []).filter(f => f.data && test(f.mime));
const isImg = x => x.startsWith('image/');

async function callModel(provider, model, system, msgs) {
  const p = PROVIDERS[provider];
  if (!p || !p.on) throw new Error(`Anbieter "${provider}" ist nicht konfiguriert.`);
  if (provider === 'anthropic') {
    const d = await post('https://api.anthropic.com/v1/messages',
      { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 4096, system, messages: msgs.map(m => ({ role: m.role, content: [
        ...bin(m, x => isImg(x) || x === 'application/pdf').map(f => ({
          type: f.mime === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: f.mime, data: f.data } })),
        { type: 'text', text: toText(m) || '(leer)' }] })) });
    return d.content.map(b => b.text || '').join('');
  }
  if (provider === 'openai') {
    const d = await post('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${E.OPENAI_API_KEY}` },
      { model, messages: [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: [
        { type: 'text', text: toText(m) || '(leer)' },
        ...bin(m, isImg).map(f => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.data}` } }))] }))] });
    return d.choices[0].message.content;
  }
  if (provider === 'gemini') {
    const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${E.GEMINI_API_KEY}`, {},
      { systemInstruction: { parts: [{ text: system }] }, contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [
        { text: toText(m) || '(leer)' },
        ...bin(m, x => isImg(x) || x === 'application/pdf').map(f => ({ inlineData: { mimeType: f.mime, data: f.data } }))] })) });
    return (d.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
  }
  if (provider === 'ollama') {
    const d = await post(`${E.OLLAMA_HOST}/api/chat`, {}, { model, stream: false,
      messages: [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: toText(m), images: bin(m, isImg).map(f => f.data) }))] });
    return d.message.content;
  }
}

// ---------- Gedächtnis ----------
const MEM_RULE = 'Wenn du etwas Dauerhaftes über den Nutzer oder sein Projekt erfährst, das künftig hilft, hänge am Ende deiner Antwort eine Zeile `[[merken: kurzer Satz]]` an. Der Nutzer entscheidet, ob es gespeichert wird. Speichere keine Passwörter, Schlüssel oder sensiblen Daten.';
function systemPrompt() {
  const mem = load('memory.json', []);
  return 'Du bist Werkbank, ein hilfreicher, ehrlicher KI-Assistent. Antworte in der Sprache des Nutzers, klar und präzise.\n' + MEM_RULE +
    (mem.length ? '\n\nFreigegebene Erinnerungen:\n' + mem.map(m => '- ' + m.text).join('\n') : '');
}
const extractMem = t => { const p = [...t.matchAll(/\[\[merken:\s*(.+?)\]\]/g)].map(m => m[1].trim());
  return { text: t.replace(/\[\[merken:[\s\S]*?\]\]/g, '').trim(), proposals: p }; };

// ---------- GitHub / Coding-Agent ----------
async function gh(p, opt = {}) {
  if (!E.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN fehlt in .env');
  const r = await fetch('https://api.github.com' + p, { ...opt, headers: { authorization: `Bearer ${E.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json', 'user-agent': 'werkbank', 'content-type': 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}
const okRepo = r => /^[\w.-]+\/[\w.-]+$/.test(r || '');
const okPath = p => typeof p === 'string' && p && !p.includes('..') && !p.startsWith('/');
const enc = p => p.split('/').map(encodeURIComponent).join('/');

async function agent({ repo, task, provider, model }) {
  if (!okRepo(repo)) throw new Error('Repo im Format "besitzer/name" angeben.');
  const info = await gh(`/repos/${repo}`);
  const tree = await gh(`/repos/${repo}/git/trees/${info.default_branch}?recursive=1`);
  const files = tree.tree.filter(t => t.type === 'blob').map(t => t.path);
  const sys = `Du bist ein Coding-Agent für das GitHub-Repo ${repo}. Du arbeitest nur lesend; Änderungen schlägst du nur vor, der Nutzer gibt sie frei.
Antworte in jedem Schritt mit genau einem JSON-Objekt, ohne weiteren Text:
{"action":"read","path":"..."}  – Datei lesen
{"action":"propose","path":"...","content":"<vollständiger neuer Inhalt>","reason":"..."}  – Änderung vorschlagen
{"action":"done","summary":"..."}  – fertig, Zusammenfassung auf Deutsch
Maximal 10 Schritte. Dateien (${files.length}${files.length > 300 ? ', gekürzt' : ''}):\n${files.slice(0, 300).join('\n')}`;
  const msgs = [{ role: 'user', content: `Aufgabe: ${task}` }];
  const log = [], proposals = [];
  let summary = 'Schrittlimit erreicht.';
  for (let i = 0; i < 10; i++) {
    const out = await callModel(provider, model, sys, msgs);
    msgs.push({ role: 'assistant', content: out });
    let a; try { a = JSON.parse(out.match(/\{[\s\S]*\}/)[0]); } catch { msgs.push({ role: 'user', content: 'Ungültig. Antworte nur mit einem JSON-Objekt.' }); continue; }
    if (a.action === 'done') { summary = a.summary || ''; break; }
    if (a.action === 'read' && okPath(a.path)) {
      let obs;
      try { const f = await gh(`/repos/${repo}/contents/${enc(a.path)}?ref=${info.default_branch}`);
        obs = Buffer.from(f.content || '', 'base64').toString('utf8').slice(0, 30000); } catch (e) { obs = 'Fehler: ' + e.message; }
      log.push(`gelesen: ${a.path}`);
      msgs.push({ role: 'user', content: `Inhalt von ${a.path}:\n${obs}` });
    } else if (a.action === 'propose' && okPath(a.path) && typeof a.content === 'string') {
      proposals.push({ id: uid(), path: a.path, content: a.content, reason: a.reason || '' });
      log.push(`Vorschlag: ${a.path}`);
      msgs.push({ role: 'user', content: 'Vorschlag gespeichert. Weiter oder done.' });
    } else msgs.push({ role: 'user', content: 'Unbekannte Aktion.' });
  }
  return { branch: info.default_branch, log, proposals, summary, writeEnabled: ALLOW_WRITE };
}

async function applyPR({ repo, title, changes }) {
  if (!ALLOW_WRITE) throw new Error('Schreibzugriff ist deaktiviert (ALLOW_WRITE=false).');
  if (!okRepo(repo) || !Array.isArray(changes) || !changes.length) throw new Error('Ungültige Anfrage.');
  const info = await gh(`/repos/${repo}`);
  const base = await gh(`/repos/${repo}/git/ref/heads/${info.default_branch}`);
  const branch = `werkbank/${uid()}`;
  await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }) });
  for (const c of changes) {
    if (!okPath(c.path)) throw new Error('Ungültiger Pfad: ' + c.path);
    let sha; try { sha = (await gh(`/repos/${repo}/contents/${enc(c.path)}?ref=${branch}`)).sha; } catch {}
    await gh(`/repos/${repo}/contents/${enc(c.path)}`, { method: 'PUT', body: JSON.stringify({
      message: `Werkbank: ${c.path}`, content: Buffer.from(c.content).toString('base64'), branch, sha }) });
  }
  const pr = await gh(`/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({
    title: title || 'Änderungen von Werkbank', head: branch, base: info.default_branch, body: 'Vom Nutzer freigegebene Änderungen des Werkbank-Agenten.' }) });
  return { url: pr.html_url };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, no) => { let n = 0; const c = [];
  req.on('data', d => { n += d.length; if (n > 40e6) { no(new Error('Anfrage zu groß')); req.destroy(); } else c.push(d); });
  req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c)) : {}); } catch (e) { no(e); } }); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
  try {
    if (!p.startsWith('/api/')) {
      const f = path.join(ROOT, 'public', p === '/' ? 'index.html' : p);
      if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Nicht gefunden'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f));
    }
    if (p === '/api/config') {
      if (PROVIDERS.ollama.on) { try { PROVIDERS.ollama.models = (await (await fetch(E.OLLAMA_HOST + '/api/tags')).json()).models.map(x => x.name); } catch { PROVIDERS.ollama.models = []; } }
      return send(res, 200, { providers: Object.entries(PROVIDERS).filter(([, v]) => v.on && v.models.length).map(([id, v]) => ({ id, label: v.label, models: v.models })),
        github: !!E.GITHUB_TOKEN, writeEnabled: ALLOW_WRITE });
    }
    if (p === '/api/chats' && m === 'GET') return send(res, 200, load('chats.json', []).map(({ id, title, updated }) => ({ id, title, updated })));
    const cm = p.match(/^\/api\/chats\/([\w]+)$/);
    if (cm && m === 'GET') return send(res, 200, load('chats.json', []).find(c => c.id === cm[1]) || {});
    if (cm && m === 'DELETE') { save('chats.json', load('chats.json', []).filter(c => c.id !== cm[1])); return send(res, 200, {}); }
    if (p === '/api/chat' && m === 'POST') {
      const b = await body(req), chats = load('chats.json', []);
      let c = chats.find(x => x.id === b.chatId);
      if (!c) { c = { id: uid(), title: (b.message || 'Neuer Chat').slice(0, 50), messages: [] }; chats.unshift(c); }
      c.messages.push({ role: 'user', content: b.message || '', files: b.files || [] });
      // Kontext: letzte 30 Nachrichten; Anhänge nur der aktuellen Nachricht werden erneut gesendet
      const ctx = c.messages.slice(-30).map((x, i, a) => i === a.length - 1 ? x : { role: x.role, content: toText(x) });
      const r = extractMem(await callModel(b.provider, b.model, systemPrompt(), ctx));
      c.messages.push({ role: 'assistant', content: r.text, model: `${b.provider}/${b.model}` });
      c.updated = Date.now();
      // Anhänge im Verlauf nur als Namen speichern (spart Platz)
      c.messages = c.messages.map(x => x.files ? { ...x, files: x.files.map(f => ({ name: f.name, mime: f.mime, text: f.text })) } : x);
      save('chats.json', chats);
      return send(res, 200, { chatId: c.id, reply: r.text, proposals: r.proposals });
    }
    if (p === '/api/memory' && m === 'GET') return send(res, 200, load('memory.json', []));
    if (p === '/api/memory' && m === 'POST') { const b = await body(req); const mem = load('memory.json', []);
      if (b.text?.trim()) mem.push({ id: uid(), text: b.text.trim().slice(0, 500) }); save('memory.json', mem); return send(res, 200, mem); }
    const mm = p.match(/^\/api\/memory\/([\w]+)$/);
    if (mm && m === 'DELETE') { const mem = load('memory.json', []).filter(x => x.id !== mm[1]); save('memory.json', mem); return send(res, 200, mem); }
    if (p === '/api/agent' && m === 'POST') return send(res, 200, await agent(await body(req)));
    if (p === '/api/agent/apply' && m === 'POST') return send(res, 200, await applyPR(await body(req)));
    send(res, 404, { error: 'Unbekannte Route' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`Werkbank läuft auf http://localhost:${PORT}`));
