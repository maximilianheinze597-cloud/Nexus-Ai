# Nova

Lokale KI-App im Stil moderner Assistenten – mit Chat, GitHub-Coding-Agent, Dateianalyse, Gedächtnis und Modellwahl.

| Funktion | Umsetzung |
|---|---|
| **KI-Chat** | Streaming-Antworten, gespeicherter Verlauf, mehrere Unterhaltungen |
| **Coding-Agent** | Liest dein GitHub-Repo (Dateibaum, Dateien, Codesuche). Änderungen nur als Pull Request auf einem eigenen `nova/…`-Branch, nur nach Klick auf „Freigeben“ und nur mit `GITHUB_ALLOW_WRITE=true` |
| **Dateien** | Quellcode/Text (alle Anbieter), Bilder (Anthropic, OpenAI, Vision-Modelle), PDFs (Anthropic) |
| **Gedächtnis** | Nur Einträge, die du selbst speicherst („Als Erinnerung merken“ oder Tab „Gedächtnis“); jederzeit löschbar |
| **Modellwahl** | Anthropic, OpenAI und jeder OpenAI-kompatible Dienst (Ollama, OpenRouter, LM Studio …) |

## Start

```bash
npm install
cp .env.example .env     # Keys eintragen
npm start                # http://localhost:3000
```

Voraussetzung: Node.js 18 oder neuer.

## Sicherheit

- Server lauscht nur auf `127.0.0.1`. Für Netzwerkbetrieb zuerst eine Authentifizierung ergänzen.
- API-Keys liegen nur in `.env` (nicht im Repo) und werden nie an den Browser gesendet.
- GitHub: Fine-grained Token mit minimalen Rechten verwenden und mit `GITHUB_ALLOWED_REPOS` einschränken.
- Daten (Verlauf, Gedächtnis) liegen unverschlüsselt in `data/*.json`.

## Struktur

```
server.js        API und statische Dateien
lib/providers.js Modell-Anbieter (Streaming)
lib/agent.js     Agent-Schleife (Lesen → Vorschlag → Freigabe)
lib/github.js    GitHub-REST-Zugriff
lib/store.js     JSON-Speicher
public/          Oberfläche
```
