# cv-bot-frontend

Embeddable chat widget + a minimal admin panel for editing the CV it answers questions about. Static HTML/CSS/JS, no build step, no framework — drop three files on any page.

Talks to **[cv-bot-backend](https://github.com/piccionesebastiano/cv-bot-backend)**, the NestJS API that grounds answers in the CV and proxies to an LLM. Point `apiUrl` (below) at a running instance of that backend; see its [README](https://github.com/piccionesebastiano/cv-bot-backend#readme) for setup, auth (`WIDGET_SECRET`/`ADMIN_SECRET`), and CORS (`ALLOWED_ORIGINS` must include the domain this widget is served from).

## Embed the widget

```html
<link rel="stylesheet" href="chat-widget.css" />
<div id="cv-chat-widget"></div>
<script>
  window.CV_CHAT_CONFIG = {
    apiUrl: 'https://your-backend.example.com/chat',
    widgetToken: '',   // only if the backend has WIDGET_SECRET set
  };
</script>
<script src="chat-widget.js" defer></script>
```

`chat-widget.js` reads `window.CV_CHAT_CONFIG` on load and merges it over its defaults — only set what you need to override.

| Option               | Default                          | Notes                                                        |
|-----------------------|-----------------------------------|----------------------------------------------------------------|
| `apiUrl`              | —                                  | **Required.** Backend `/chat` endpoint.                        |
| `streamApiUrl`        | `apiUrl + '/stream'`               | SSE endpoint used for token-by-token replies.                  |
| `widgetToken`          | `''`                               | Must match the backend's `WIDGET_SECRET`, if set.               |
| `botName`             | `'Sebastiano Piccione'`            | Shown in the widget header.                                     |
| `botRole`             | `'Backend Engineer'`               | Subtitle under the bot name.                                    |
| `welcomeMessage`      | (IT greeting)                      | First message shown when the widget opens.                      |
| `initialSuggestions`  | 4 example questions                | Quick-reply chips shown before the first user message.          |

The widget has no toggle bubble or close button — it always mounts open, in normal document flow. Size and position it like any other block element via `#cv-chat-widget` (see `mysite`'s override CSS for an example of theming it to match a host page).

Conversation history and message log persist in `sessionStorage` (`chat-widget.js`), so a page refresh doesn't lose an in-progress conversation.

## Admin panel

`admin.html` is a standalone page (edit the hardcoded `API` constant at the top to point it at your backend) for viewing and replacing the live CV content via `GET/POST /admin/cv`. It prompts for the admin secret client-side and sends it as `x-admin-secret` on every request — nothing is stored.

## Files

```
index.html          demo page embedding the widget
admin.html           CV content editor (calls /admin/cv*)
chat-widget.js       widget logic: rendering, SSE streaming, session storage
chat-widget.css      widget styling
fonts/                self-hosted Inter / JetBrains Mono subsets
```

## Local development

Static files — no build step. Serve the directory with anything:

```bash
npx serve .
# or: python3 -m http.server 8080
```

Point `apiUrl` at a locally running [cv-bot-backend](https://github.com/piccionesebastiano/cv-bot-backend) (`npm run start:dev`, default `http://localhost:3000/chat`) and make sure its `ALLOWED_ORIGINS` includes the origin you're serving this from.

## Deployment

Any static host works (Railway, Netlify, GitHub Pages, S3 + CDN, or served directly by a reverse proxy in front of the backend). There's nothing to build — copy the files as-is and set `apiUrl` for the target environment.

## License

MIT — see [LICENSE](LICENSE).
