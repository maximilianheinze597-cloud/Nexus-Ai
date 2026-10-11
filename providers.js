const e = process.env;
const csv = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);

export function listModels() {
  const m = [];
  const add = (p, label, ids) => ids.forEach((id) => m.push({ id: `${p}:${id}`, label: id, provider: label }));
  if (e.ANTHROPIC_API_KEY) add('anthropic', 'Anthropic', csv(e.ANTHROPIC_MODELS, 'claude-sonnet-5-5,claude-opus-5-5,claude-haiku-5-5'));
  if (e.OPENAI_API_KEY) add('openai', 'OpenAI', csv(e.OPENAI_MODELS, 'gpt-4o,gpt-4o-mini'));
  if (e.CUSTOM_BASE_URL) add('custom', e.CUSTOM_NAME || 'Custom', csv(e.CUSTOM_MODELS, 'llama3.1'));
  return m;
}

async function* sse(res) {
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim();
        if (d && d !== '[DONE]') yield d;
      }
    }
  }
}

async function* anthropic(model, system, messages, signal) {
  const msgs = messages.map((m) => ({
    role: m.role,
    content: [
      ...(m.attachments || []).map((a) =>
        a.kind === 'image' ? { type: 'image', source: { type: 'base64', media_type: a.type, data: a.data } }
        : a.kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
        : { type: 'text', text: `Datei ${a.name}:\n${a.data}` }),
      { type: 'text', text: m.content || '(leer)' },
    ],
  }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'x-api-key': e.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, system, messages: msgs, max_tokens: 4096, stream: true }),
  });
  for await (const d of sse(res)) {
    const j = JSON.parse(d);
    if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text;
    if (j.type === 'error') throw new Error(j.error?.message || 'Anthropic-Fehler');
  }
}

async function* openaiLike(p, model, system, messages, signal) {
  const base = p === 'openai' ? 'https://api.openai.com/v1' : e.CUSTOM_BASE_URL.replace(/\/$/, '');
  const key = p === 'openai' ? e.OPENAI_API_KEY : e.CUSTOM_API_KEY || 'none';
  const msgs = [
    { role: 'system', content: system },
    ...messages.map((m) => ({
      role: m.role,
      content: [
        ...(m.attachments || []).map((a) =>
          a.kind === 'image' ? { type: 'image_url', image_url: { url: `data:${a.type};base64,${a.data}` } }
          : { type: 'text', text: a.kind === 'pdf' ? `[PDF ${a.name}: von diesem Anbieter nicht direkt lesbar]` : `Datei ${a.name}:\n${a.data}` }),
        { type: 'text', text: m.content || '(leer)' },
      ],
    })),
  ];
  const res = await fetch(base + '/chat/completions', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, stream: true }),
  });
  for await (const d of sse(res)) {
    const t = JSON.parse(d).choices?.[0]?.delta?.content;
    if (t) yield t;
  }
}

export async function* stream({ model, system, messages, signal }) {
  const [p, ...rest] = model.split(':');
  const name = rest.join(':');
  if (p === 'anthropic') yield* anthropic(name, system, messages, signal);
  else if (p === 'openai' || p === 'custom') yield* openaiLike(p, name, system, messages, signal);
  else throw new Error('Unbekannter Anbieter: ' + p);
}

export async function complete(opts) {
  let t = '';
  for await (const x of stream(opts)) t += x;
  return t;
}
