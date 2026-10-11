import { complete } from './providers.js';
import * as gh from './github.js';

const tools = {
  tree: (repo) => gh.tree(repo),
  read_file: (repo, a) => gh.readFile(repo, a.path),
  search_code: (repo, a) => gh.search(repo, a.query),
};

const system = (repo) => `Du bist ein sorgfältiger Coding-Agent für das GitHub-Repository ${repo}.
Antworte IMMER mit genau einem JSON-Objekt und sonst nichts.
Werkzeuge (nur lesend):
{"tool":"tree","args":{}}                          – alle Dateipfade
{"tool":"read_file","args":{"path":"src/x.js"}}    – Datei lesen
{"tool":"search_code","args":{"query":"suchbegriff"}}
Änderungen vorschlagen (wird NICHT sofort ausgeführt, der Nutzer muss freigeben):
{"tool":"propose_pr","args":{"branch":"kurzer-name","title":"...","body":"Begründung","files":[{"path":"...","content":"VOLLSTÄNDIGER neuer Dateiinhalt"}]}}
Antwort an den Nutzer (Analyse, Erklärung):
{"final":"Text in Markdown"}
Lies erst die relevanten Dateien, bevor du etwas vorschlägst. Ändere nur, was die Aufgabe verlangt.`;

export async function* runAgent({ model, task, repo, signal }) {
  const msgs = [{ role: 'user', content: task }];
  for (let i = 0; i < 10; i++) {
    const out = await complete({ model, system: system(repo), messages: msgs, signal });
    let call;
    try { call = JSON.parse(out.match(/\{[\s\S]*\}/)[0]); } catch { yield { type: 'final', text: out }; return; }
    if (call.final) { yield { type: 'final', text: call.final }; return; }
    yield { type: 'tool', tool: call.tool, args: call.args?.path || call.args?.query || call.args?.title || '' };
    if (call.tool === 'propose_pr') { yield { type: 'proposal', proposal: call.args }; return; }
    msgs.push({ role: 'assistant', content: out });
    let res;
    try {
      if (!tools[call.tool]) throw new Error('Unbekanntes Werkzeug');
      res = JSON.stringify(await tools[call.tool](repo, call.args || {}));
    } catch (err) { res = 'Fehler: ' + err.message; }
    msgs.push({ role: 'user', content: 'Ergebnis: ' + res.slice(0, 15000) });
  }
  yield { type: 'final', text: 'Schrittlimit erreicht.' };
}
