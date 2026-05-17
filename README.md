# laughing-octo-lamp

Visual-first chess game coach app:

- Paste/upload PGN and choose your side.
- Configure Gemini model tier fallback list (free-text).
- Replay move-by-move with arrow controls and coach commentary.
- View move classifications (book/good/inaccuracy/miss/blunder/brilliant).
- Generate puzzle flashcards and store them in browser local storage.
- Export/import puzzle decks for spaced repetition.

## Run locally

```bash
python3 -m http.server 4173
```

Open: `http://127.0.0.1:4173/index.html`

## Tests

```bash
npm test
```
