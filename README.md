# Werkbank

Eine eigene, Claude-ähnliche KI-App: Chat, Coding-Agent, Dateianalyse und Langzeitgedächtnis mit frei wählbarem KI-Anbieter. Keine npm-Abhängigkeiten, nur Node.js ≥ 18.

## Start

```bash
cp .env.example .env     # mindestens einen API-Schlüssel eintragen
npm start                # http://localhost:3000
```

## Funktionen

| Bereich | Umsetzung |
|---|---|
| KI-Chat | Mehrere Unterhaltungen, Verlauf (letzte 30 Nachrichten als Kontext), gespeichert in `data/chats.json` |
| Modell-Auswahl | Anthropic, OpenAI, Google Gemini, Ollama (lokal). Nur konfigurierte Anbieter erscheinen. Modelllisten per `.env` änderbar |
| Dateien | Quellcode/Text (alle Anbieter), Bilder (alle Anbieter), PDFs (Anthropic, Gemini) |
| Langzeitgedächtnis | Die KI schlägt Erinnerungen vor, **du** gibst sie frei oder verwirfst sie. Nur freigegebene fließen in den Kontext. Verwaltung im Tab „Gedächtnis“ |
| Coding-Agent | Liest ein GitHub-Repo (max. 10 Schritte), schlägt Änderungen vor |

## Berechtigungen des Coding-Agenten

- Standard: **nur lesen**. Ein Token mit `Contents: read` genügt.
- `ALLOW_WRITE=true` erlaubt, freigegebene Vorschläge als **neuen Branch + Pull Request** anzulegen. Es wird nie direkt auf den Hauptbranch geschrieben.
- Jede Änderung muss einzeln im Browser freigegeben werden. Für Schreibzugriff braucht das Token zusätzlich `Contents: write` und `Pull requests: write`.

## Sicherheit

- Die App ist für den lokalen Einsatz gedacht und hat keine Anmeldung. Nicht ungeschützt ins Internet stellen.
- `.env` und `data/` sind in `.gitignore`. API-Schlüssel gehören nie ins Repository.
- Chat-Inhalte werden an den gewählten Anbieter gesendet. Für vertrauliche Daten Ollama nutzen.

## Grenzen und nächste Schritte

- Antworten kommen vollständig, nicht als Stream.
- Modellnamen ändern sich bei den Anbietern. Passe sie bei Bedarf in `.env` an.
- Ideen: Streaming, Anmeldung, Tool-Calling statt JSON-Protokoll im Agent, PDF-Textextraktion für OpenAI/Ollama.
