const $ = (s) => document.querySelector(s);
const api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const md = (s) => esc(s).split('```').map((p, i) => i % 2
  ? `<pre><code>${p.replace(/^\w*\n/, '')}</code></pre>`
  : p.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')).join('');

let convId = null, attachments = [], busy = false;

async function readSSE(res, cb) {
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
      if (line.startsWith('data:')) cb(JSON.parse(line.slice(5)));
    }
  }
}

// ---- Tabs
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button,.tab').forEach((x) => x.classList.remove('on'));
  b.classList.add('on'); $('#' + b.dataset.tab).classList.add('on');
  if (b.dataset.tab === 'agent') loadRepos();
  if (b.dataset.tab === 'memory') loadMemory();
});

// ---- Modelle
async function loadModels() {
  const m = await api('/models');
  $('#model').innerHTML = m.length
    ? m.map((x) => `<option value="${x.id}">${x.provider} · ${x.label}</option>`).join('')
    : '<option value="">Kein Anbieter – siehe .env</option>';
  const saved = localStorage.model; if (saved && m.some((x) => x.id === saved)) $('#model').value = saved;
}
$('#model').onchange = () => localStorage.model = $('#model').value;

// ---- Chat
function addMsg(role, text, files = []) {
  $('#msgs .empty')?.remove();
  const d = document.createElement('div');
  d.className = 'm ' + role;
  d.innerHTML = (files.length ? files.map((f) => `<span class="chip">${esc(f.name)}</span> `).join('') + '<br>' : '') + md(text);
  if (role === 'assistant') {
    const s = document.createElement('small'); s.textContent = 'Als Erinnerung merken';
    s.onclick = async () => { const t = prompt('Als Erinnerung speichern:', d.dataset.raw.slice(0, 200)); if (t) await api('/memory', { method: 'POST', body: { text: t } }); };
    d.append(s);
  }
  d.dataset.raw = text; $('#msgs').append(d); $('#msgs').scrollTop = 1e9; return d;
}

async function send() {
  const text = $('#inp').value.trim();
  if (busy || (!text && !attachments.length) || !$('#model').value) return;
  busy = true; const files = attachments; attachments = []; renderFiles(); $('#inp').value = '';
  addMsg('user', text, files);
  const box = addMsg('assistant', '…'); let out = '';
  const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: convId, model: $('#model').value, text, attachments: files }) });
  await readSSE(res, (e) => {
    if (e.t) { out += e.t; box.dataset.raw = out; box.innerHTML = md(out); }
    if (e.error) box.innerHTML = `<b>Fehler:</b> ${esc(e.error)}`;
    if (e.done) { convId = e.id; loadConvs(); }
    $('#msgs').scrollTop = 1e9;
  });
  busy = false;
}
$('#send').onclick = send;
$('#inp').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

// ---- Dateien
const renderFiles = () => $('#files').innerHTML = attachments.map((a) => `<span class="chip">${esc(a.name)}</span>`).join('');
$('#file').onchange = async (ev) => {
  for (const f of ev.target.files) {
    if (f.size > 10e6) { alert(f.name + ' ist größer als 10 MB'); continue; }
    const isBin = f.type.startsWith('image/') || f.type === 'application/pdf';
    const data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(isBin ? r.result.split(',')[1] : r.result); isBin ? r.readAsDataURL(f) : r.readAsText(f); });
    attachments.push({ name: f.name, type: f.type, kind: f.type.startsWith('image/') ? 'image' : f.type === 'application/pdf' ? 'pdf' : 'text', data });
  }
  ev.target.value = ''; renderFiles();
};

// ---- Verlauf
async function loadConvs() {
  const c = await api('/conversations');
  $('#convs').innerHTML = '';
  c.forEach((x) => {
    const d = document.createElement('div'); d.className = x.id === convId ? 'on' : '';
    d.innerHTML = `<span>${esc(x.title)}</span><span class="x" title="Löschen">×</span>`;
    d.onclick = async (e) => {
      if (e.target.classList.contains('x')) { await api('/conversations/' + x.id, { method: 'DELETE' }); if (convId === x.id) newChat(); return loadConvs(); }
      const full = await api('/conversations/' + x.id); convId = x.id; $('#msgs').innerHTML = '';
      full.messages.forEach((m) => addMsg(m.role, m.content, m.attachments)); loadConvs();
    };
    $('#convs').append(d);
  });
}
function newChat() { convId = null; $('#msgs').innerHTML = '<p class="empty">Neuer Chat.</p>'; loadConvs(); }
$('#new').onclick = newChat;

// ---- Coding-Agent
async function loadRepos() {
  const r = await api('/github/repos');
  if (r.error) { $('#repo').innerHTML = `<option value="">${esc(r.error)}</option>`; return; }
  $('#repo').innerHTML = r.repos.map((x) => `<option>${x.full_name}</option>`).join('');
  $('#wmode').textContent = r.write ? 'Schreiben per PR erlaubt' : 'Nur Lesezugriff';
  $('#wmode').className = 'pill' + (r.write ? ' w' : '');
}
$('#run').onclick = async () => {
  const repo = $('#repo').value, task = $('#task').value.trim();
  if (!repo || !task || !$('#model').value) return;
  $('#log').innerHTML = ''; $('#proposal').innerHTML = '';
  const log = (t) => { const d = document.createElement('div'); d.innerHTML = t; $('#log').append(d); };
  const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: $('#model').value, repo, task }) });
  if (!res.ok) { log('<b>Fehler:</b> ' + esc((await res.json()).error)); return; }
  await readSSE(res, (e) => {
    if (e.type === 'tool') log(`<b>${esc(e.tool)}</b> ${esc(String(e.args))}`);
    if (e.type === 'final') log(md(e.text));
    if (e.type === 'error') log('<b>Fehler:</b> ' + esc(e.text));
    if (e.type === 'proposal') showProposal(repo, e.proposal);
  });
};
function showProposal(repo, p) {
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<b>${esc(p.title || 'Vorschlag')}</b><p>${esc(p.body || '')}</p><ul>${(p.files || []).map((f) => `<li><span>${esc(f.path)}</span><button>Ansehen</button></li>`).join('')}</ul><button id="ok">Freigeben und Pull Request erstellen</button>`;
  c.querySelectorAll('li button').forEach((b, i) => b.onclick = () => alert(p.files[i].content));
  c.querySelector('#ok').onclick = async () => {
    const r = await api('/agent/approve', { method: 'POST', body: { repo, proposal: p } });
    c.append(Object.assign(document.createElement('p'), { innerHTML: r.error ? '<b>Fehler:</b> ' + esc(r.error) : `Pull Request erstellt: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` }));
  };
  $('#proposal').append(c);
}

// ---- Gedächtnis
async function loadMemory(list) {
  const m = list || await api('/memory');
  $('#memList').innerHTML = m.length ? '' : '<p class="empty">Noch nichts gespeichert.</p>';
  m.forEach((x) => { const li = document.createElement('li'); li.innerHTML = `<span>${esc(x.text)}</span><button>Löschen</button>`; li.querySelector('button').onclick = async () => loadMemory(await api('/memory/' + x.id, { method: 'DELETE' })); $('#memList').append(li); });
}
$('#memAdd').onclick = async () => { const t = $('#mem').value.trim(); if (!t) return; $('#mem').value = ''; loadMemory(await api('/memory', { method: 'POST', body: { text: t } })); };

loadModels(); loadConvs();
