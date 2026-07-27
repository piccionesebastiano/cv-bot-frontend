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
| `contextSuggestions`  | `[]`                               | Per-page chip overrides — see below.                            |
| `proactive`           | enabled, 12s                       | Nudge message if the visitor looks but doesn't type — see below. |
| `tracking`            | `true`                             | Set `false` to disable telemetry entirely.                      |
| `eventsUrl`           | `apiUrl` host + `/events`          | Where batched events are posted.                                |

### Per-page suggestions

The first rule whose `match` (a regex source, falling back to a substring test if it doesn't compile) hits the current context wins. The context is the `data-cv-chat-context` attribute on `#cv-chat-widget` if present, otherwise `location.pathname + location.hash`. With no match, `initialSuggestions` is used.

```js
window.CV_CHAT_CONFIG = {
  apiUrl: '…',
  contextSuggestions: [
    { match: '/progetti', suggestions: ['Parlami di Steal Drink', 'Che problemi hai risolto?'] },
    { match: '#esperienza', suggestions: ['Dove hai lavorato?', 'Che ruolo cerchi?'] },
  ],
};
```

### Proactive nudge

If the visitor hasn't typed anything, the widget posts one extra bot message with chips. The countdown starts when the widget actually **enters the viewport** — not on page load — since it's mounted in normal document flow and may sit below the fold. It fires at most once per session, is cancelled as soon as the visitor types or opens a new chat, and survives a refresh via `sessionStorage`.

```js
proactive: {
  enabled: true,
  delay: 12000,
  message: 'Se non sai da dove partire…',
  suggestions: null,   // null = reuse the chips already on screen
}
```

### Telemetry

Events are queued and flushed every 8s (and on `pagehide`/tab-hide via `fetch(..., { keepalive: true })`, which unlike `sendBeacon` still carries the widget token header). Failures are swallowed — telemetry never disturbs the chat. Nothing is stored client-side beyond the existing `sessionStorage` conversation, no cookie is set, and the whole thing is skipped when the browser sends Do Not Track.

Emitted: `session_start`, `widget_seen`, `chip_click`, `message_sent`, `proactive_shown`, `proactive_converted`, `copy_click`, `conversation_reset` — each with the ephemeral `sessionId`, the page path, and where the interaction came from (`initial` / `context` / `dynamic` / `proactive` / `typed`).

The widget has no toggle bubble or close button — it always mounts open, in normal document flow. Size and position it like any other block element via `#cv-chat-widget` (see `mysite`'s override CSS for an example of theming it to match a host page).

Conversation history and message log persist in `sessionStorage` (`chat-widget.js`), so a page refresh doesn't lose an in-progress conversation.

## Admin panel

`admin.html` is a standalone page (edit the hardcoded `API` constant at the top to point it at your backend) for viewing and replacing the live CV content via `GET/POST /admin/cv`. It prompts for the admin secret client-side and sends it as `x-admin-secret` on every request — nothing is stored.

## Files

```
index.html          demo page embedding the widget
admin.html           CV content editor (calls /admin/cv*)
conversations.html   logged Q&A browser (calls /admin/conversations)
analytics.html       widget engagement dashboard (calls /admin/analytics)
site-analytics.html  site-wide click/attention heatmap (calls /admin/site*)
chat-widget.js       widget logic: rendering, SSE streaming, session storage
chat-widget.css      widget styling
fonts/                self-hosted Inter / JetBrains Mono subsets
```

## Site-wide heatmap

`site-analytics.html` renders the click and attention heatmaps collected by `analytics.js` (which lives in the *site* repo, not this one) and served by the backend's `/admin/site*` endpoints.

It draws the page underneath in an iframe at a fixed render width per device class (desktop 1440 / tablet 820 / mobile 390 — the same widths the coordinates were normalised against), then overlays a canvas: each grid cell becomes a radial gradient whose opacity tracks its hit count, the overlaps accumulate via `globalCompositeOperation = 'lighter'`, and the accumulated alpha indexes a one-hue sequential ramp. Hovering any point reports the hits in that cell.

Two caveats worth knowing:

- The iframe is laid out at the page's **full document height**, so a site that sizes anything with `vh` units will render it stretched. Check before trusting the alignment.
- The framed site must allow embedding (no `X-Frame-Options: deny`). GitHub Pages does.

Set `SITE_ORIGIN` at the top of the page's script to the site being measured.

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
