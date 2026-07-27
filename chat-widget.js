/**
 * CV Chat Widget
 * Configura tramite window.CV_CHAT_CONFIG prima di includere questo script.
 */

(function () {
  'use strict';

  const CONFIG = Object.assign(
    {
      apiUrl: 'https://cv-bot-backend-production.up.railway.app/chat',
      widgetToken: '',   // Imposta con WIDGET_SECRET del backend
      botName: 'Sebastiano Piccione',
      botRole: 'Backend Engineer',
      welcomeMessage:
        'Ciao! Sono Sebastiano, o almeno una versione digitale abbastanza fedele 😄\nChiedimi quello che vuoi sul mio CV, esperienza o progetti.',
      initialSuggestions: [
        'Che stack tecnologico usi?',
        'Hai esperienza con sistemi ad alto traffico?',
        'Raccontami un problema tecnico risolto',
        'Parlami del progetto Steal Drink',
      ],
      // Suggerimenti per pagina: la prima regola il cui `match` (regex o
      // sottostringa) combacia col contesto vince. Il contesto è
      // data-cv-chat-context sul contenitore, oppure pathname + hash.
      // [{ match: '/progetti', suggestions: ['...'] }]
      contextSuggestions: [],
      // Messaggio proattivo se l'utente guarda il widget senza scrivere.
      proactive: {
        enabled: true,
        delay: 12000,
        message:
          'Se non sai da dove partire: la maggior parte di chi passa di qui mi chiede dello stack o dei progetti su cui ho lavorato. Scegli pure una domanda qui sotto 👇',
        suggestions: null, // null = riusa i suggerimenti già a schermo
      },
      // Telemetria anonima (nessun cookie): quali suggerimenti vengono cliccati,
      // cosa viene chiesto, se il nudge proattivo converte.
      tracking: true,
      eventsUrl: '', // default: stesso host di apiUrl, path /events
    },
    window.CV_CHAT_CONFIG || {},
  );

  // U2: warn clearly if apiUrl is missing
  if (!CONFIG.apiUrl) {
    console.error('[cv-chat-widget] apiUrl non configurato. Impostare window.CV_CHAT_CONFIG.apiUrl prima di caricare il widget.');
  }

  // ─── State ───────────────────────────────────────────────────────────────────

  let isLoading = false;
  let conversationHistory = []; // { role: 'user'|'assistant', content: string }[]
  let messageLog = [];          // { role: 'bot'|'user', text: string, time: string }[]
  let lastSuggestions = CONFIG.initialSuggestions;
  let suggestionSource = 'initial'; // provenienza dei chip a schermo, per la telemetria
  let proactiveShown = false;
  let proactiveConverted = false;
  let proactiveTimer = null;

  // Unique id per conversation — lets the backend group logged Q&A turns.
  function newSessionId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  let sessionId = newSessionId();

  // ─── Session storage (U6) ────────────────────────────────────────────────────

  const SESSION_KEY = 'cv-chat-session';

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        sessionId: sessionId,
        history: conversationHistory,
        messages: messageLog,
        suggestions: lastSuggestions,
        suggestionSource: suggestionSource,
        proactiveShown: proactiveShown,
        proactiveConverted: proactiveConverted,
      }));
    } catch (_) {}
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  // ─── DOM ─────────────────────────────────────────────────────────────────────

  const widget = document.getElementById('cv-chat-widget');
  if (!widget) {
    console.error('[cv-chat-widget] Elemento #cv-chat-widget non trovato.');
    return;
  }

  widget.innerHTML = `
    <div class="cv-panel" role="dialog" aria-label="Chat CV">
      <div class="cv-header">
        <div class="cv-avatar">SP</div>
        <div class="cv-header-info">
          <span class="cv-header-name">${CONFIG.botName}</span>
          <span class="cv-header-status">
            <span class="cv-status-dot"></span>online
          </span>
        </div>
        <button class="cv-new-chat" id="cv-new-chat" aria-label="Nuova conversazione" title="Nuova conversazione">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>

      <div class="cv-messages" id="cv-messages" role="log" aria-live="polite"></div>

      <div class="cv-suggestions" id="cv-suggestions"></div>

      <div class="cv-input-area">
        <textarea
          class="cv-input"
          id="cv-input"
          placeholder="Scrivi una domanda..."
          rows="1"
          aria-label="Messaggio"
          maxlength="500"
        ></textarea>
        <button class="cv-send" id="cv-send" aria-label="Invia" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <p class="cv-privacy">I messaggi sono elaborati da AI di terze parti (OpenRouter/DeepSeek) e conservati a fini di analisi del titolare. Evita di inserire dati personali o sensibili. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p>
    </div>
  `;

  const newChatBtn    = widget.querySelector('#cv-new-chat');
  const messagesEl    = widget.querySelector('#cv-messages');
  const suggestionsEl = widget.querySelector('#cv-suggestions');
  const inputEl       = widget.querySelector('#cv-input');
  const sendBtn       = widget.querySelector('#cv-send');

  // ─── Site theme sync ──────────────────────────────────────────────────────

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
  }

  function darkenHex(hex, amount) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return hex;
    const clamp = (v) => Math.max(0, Math.min(255, v));
    return '#' + [
      clamp(parseInt(m[1], 16) - amount),
      clamp(parseInt(m[2], 16) - amount),
      clamp(parseInt(m[3], 16) - amount),
    ].map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  function applySiteTheme() {
    const root = getComputedStyle(document.documentElement);
    const get = (v) => root.getPropertyValue(v).trim();

    const accent = get('--accent');
    if (!accent) return;

    const accentRgb = hexToRgb(accent);
    const vars = {
      '--bg':           get('--bg'),
      '--surface':      get('--bg-soft') || get('--surface'),
      '--surface-2':    get('--border'),
      '--border':       get('--border'),
      '--text':         get('--text'),
      '--text-muted':   get('--text-dim'),
      '--accent':       accent,
      '--accent-dim':   get('--accent-soft') || (accentRgb ? `rgba(${accentRgb}, 0.12)` : ''),
      '--accent-hover': darkenHex(accent, 20),
      '--online':       get('--signal'),
      '--radius':       get('--radius-sm') || get('--radius'),
      '--shadow':       get('--shadow-md'),
    };

    Object.entries(vars).forEach(([prop, val]) => {
      if (val) widget.style.setProperty(prop, val);
    });
  }

  applySiteTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySiteTheme);

  // ─── Telemetria ───────────────────────────────────────────────────────────

  // Nessun cookie, nessun identificatore persistente: solo il sessionId effimero
  // già usato per raggruppare la conversazione lato backend.
  const eventsUrl = CONFIG.eventsUrl || CONFIG.apiUrl.replace(/\/chat\/?$/, '') + '/events';
  const trackingOn =
    CONFIG.tracking !== false &&
    navigator.doNotTrack !== '1' &&
    window.doNotTrack !== '1';

  const eventQueue = [];
  let flushTimer = null;

  function pageKey() {
    return (location.pathname + location.hash).slice(0, 300);
  }

  function track(name, extra) {
    if (!trackingOn) return;
    eventQueue.push(Object.assign({ name: name, sessionId: sessionId, page: pageKey() }, extra || {}));
    if (eventQueue.length >= 20) flushEvents();
    else if (!flushTimer) flushTimer = setTimeout(flushEvents, 8000);
  }

  // keepalive lets the request outlive the page on pagehide/visibilitychange —
  // unlike sendBeacon it still carries the widget token header.
  function flushEvents(keepalive) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (eventQueue.length === 0) return;

    const batch = eventQueue.splice(0, 30);

    fetch(eventsUrl, {
      method: 'POST',
      keepalive: !!keepalive,
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        ...(CONFIG.widgetToken ? { 'X-Widget-Token': CONFIG.widgetToken } : {}),
      },
      body: JSON.stringify({ events: batch }),
    }).catch(() => {}); // la telemetria non deve mai disturbare la chat

    if (eventQueue.length > 0 && !flushTimer) flushTimer = setTimeout(flushEvents, 8000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEvents(true);
  });
  window.addEventListener('pagehide', () => flushEvents(true));

  // ─── Suggerimenti contestuali ─────────────────────────────────────────────

  // Il contesto è un attributo esplicito sul contenitore, altrimenti l'URL.
  // Ogni regola: { match: 'regex o sottostringa', suggestions: [...] }.
  function resolveContextSuggestions() {
    const context = widget.dataset.cvChatContext || pageKey();
    const rules = Array.isArray(CONFIG.contextSuggestions) ? CONFIG.contextSuggestions : [];

    for (const rule of rules) {
      if (!rule || !rule.match || !Array.isArray(rule.suggestions) || rule.suggestions.length === 0) continue;
      let hit;
      try {
        hit = new RegExp(rule.match, 'i').test(context);
      } catch (_) {
        hit = context.toLowerCase().includes(String(rule.match).toLowerCase());
      }
      if (hit) return { suggestions: rule.suggestions, source: 'context' };
    }

    return { suggestions: CONFIG.initialSuggestions, source: 'initial' };
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  // The widget has no toggle/close button — it's always mounted open. Populates the
  // conversation on load, restoring from sessionStorage (U6) or falling back to the
  // welcome message.
  function initMessagesIfEmpty() {
    if (messagesEl.children.length > 0) {
      scrollToBottom();
      return;
    }
    const session = loadSession();
    if (session && session.messages && session.messages.length > 0) {
      if (session.sessionId) sessionId = session.sessionId;
      conversationHistory = session.history || [];
      messageLog = session.messages;
      proactiveShown = !!session.proactiveShown;
      proactiveConverted = !!session.proactiveConverted;
      session.messages.forEach((msg) => {
        if (msg.role === 'bot') addBotMessage(msg.text, msg.time);
        else if (msg.role === 'user') addUserMessage(msg.text, msg.time);
      });
      renderSuggestions(session.suggestions || CONFIG.initialSuggestions, session.suggestionSource || 'dynamic');
    } else {
      const context = resolveContextSuggestions();
      addBotMessage(CONFIG.welcomeMessage);
      renderSuggestions(context.suggestions, context.source);
      saveSession();
      track('session_start', { source: context.source });
    }

    armProactive();
  }

  // U1: reset conversation to welcome state
  function resetConversation() {
    if (isLoading) return;
    track('conversation_reset');
    // Chi apre una nuova chat è già ingaggiato: il nudge diventerebbe rumore.
    cancelProactive();
    sessionId = newSessionId();
    conversationHistory = [];
    messageLog = [];
    clearSession();
    messagesEl.innerHTML = '';
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    const context = resolveContextSuggestions();
    addBotMessage(CONFIG.welcomeMessage);
    renderSuggestions(context.suggestions, context.source);
    saveSession();
    inputEl.focus();
  }

  newChatBtn.addEventListener('click', resetConversation);

  // ─── Nudge proattivo ──────────────────────────────────────────────────────

  // Il widget è sempre montato aperto e può stare sotto la piega: il conto alla
  // rovescia parte quando entra davvero nel viewport, non al load della pagina.
  function armProactive() {
    const cfg = CONFIG.proactive || {};
    if (!cfg.enabled || proactiveShown) return;
    if (messageLog.some((m) => m.role === 'user')) return; // conversazione già avviata

    const start = () => {
      if (proactiveTimer || proactiveShown) return;
      proactiveTimer = setTimeout(showProactive, cfg.delay || 12000);
    };

    if (!('IntersectionObserver' in window)) {
      track('widget_seen');
      start();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        track('widget_seen');
        start();
      }
      // threshold 0: un widget più alto del viewport non raggiungerebbe mai
      // una soglia percentuale su mobile.
    }, { threshold: 0 });

    observer.observe(widget);
  }

  function cancelProactive() {
    if (proactiveTimer) {
      clearTimeout(proactiveTimer);
      proactiveTimer = null;
    }
  }

  function showProactive() {
    proactiveTimer = null;
    const cfg = CONFIG.proactive || {};
    if (proactiveShown || isLoading) return;
    if (messageLog.some((m) => m.role === 'user')) return;

    proactiveShown = true;
    addBotMessage(cfg.message);

    const suggestions = Array.isArray(cfg.suggestions) && cfg.suggestions.length > 0
      ? cfg.suggestions
      : lastSuggestions;
    renderSuggestions(suggestions, 'proactive');

    saveSession();
    track('proactive_shown');
  }

  const COPY_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  initMessagesIfEmpty();

  // ─── Messages ─────────────────────────────────────────────────────────────

  function timestamp() {
    return new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  // U7: copy to clipboard. Una copia è un segnale forte di interesse — la tracciamo.
  function wireCopyButton(copyBtn, text) {
    copyBtn.addEventListener('click', () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(() => {
        track('copy_click');
        copyBtn.innerHTML = CHECK_ICON;
        copyBtn.classList.add('cv-copy-btn--done');
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.classList.remove('cv-copy-btn--done');
        }, 1500);
      }).catch(() => {});
    });
  }

  // savedTime is passed when restoring from sessionStorage — skips pushing to messageLog
  function addBotMessage(text, savedTime) {
    const time = savedTime || timestamp();
    const wrap = document.createElement('div');
    wrap.className = 'cv-msg-bot';
    wrap.innerHTML = `
      <div class="cv-msg-bot-avatar">SP</div>
      <div class="cv-msg-bot-body">
        <div class="cv-msg-bot-text">${renderMarkdown(text)}</div>
        <div class="cv-msg-meta">
          <span class="cv-msg-time">${time}</span>
          <button class="cv-copy-btn" aria-label="Copia risposta" title="Copia">${COPY_ICON}</button>
        </div>
      </div>
    `;

    wireCopyButton(wrap.querySelector('.cv-copy-btn'), text);

    messagesEl.appendChild(wrap);
    if (!savedTime) messageLog.push({ role: 'bot', text, time });
    scrollToBottom();
  }

  function addUserMessage(text, savedTime) {
    const time = savedTime || timestamp();
    const wrap = document.createElement('div');
    wrap.className = 'cv-msg-user';
    wrap.innerHTML = `
      <div class="cv-msg-user-wrap">
        <div class="cv-msg-user-text">${escapeHtml(text)}</div>
        <div class="cv-msg-time">${time}</div>
      </div>
    `;
    messagesEl.appendChild(wrap);
    if (!savedTime) messageLog.push({ role: 'user', text, time });
    scrollToBottom();
  }

  function addErrorMessage(text) {
    const el = document.createElement('div');
    el.className = 'cv-msg-error';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'cv-typing';
    el.id = 'cv-typing';
    el.innerHTML = `
      <div class="cv-msg-bot-avatar">SP</div>
      <div class="cv-typing-dots"><span></span><span></span><span></span></div>
    `;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById('cv-typing');
    if (el) el.remove();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ─── Suggestions (dinamiche) ──────────────────────────────────────────────

  // `source` traccia da dove arrivano i chip a schermo: initial (default),
  // context (regola per pagina), proactive (nudge), dynamic (proposti dal modello).
  function renderSuggestions(suggestions, source) {
    lastSuggestions = suggestions || [];
    suggestionSource = source || 'dynamic';
    suggestionsEl.innerHTML = '';

    if (!suggestions || suggestions.length === 0) {
      suggestionsEl.hidden = true;
      return;
    }

    suggestionsEl.hidden = false;

    suggestions.forEach((text) => {
      const btn = document.createElement('button');
      btn.className = 'cv-chip';
      btn.type = 'button';
      btn.textContent = text;
      const source = suggestionSource;
      btn.addEventListener('click', () => {
        if (isLoading) return; // U3: ignore clicks while loading
        track('chip_click', { label: text, source: source });
        inputEl.value = text;
        send(source);
      });
      suggestionsEl.appendChild(btn);
    });
  }

  // ─── Input ────────────────────────────────────────────────────────────────

  inputEl.addEventListener('input', () => {
    // Chi sta scrivendo non ha bisogno di essere spronato.
    if (inputEl.value.length > 0) cancelProactive();
    sendBtn.disabled = inputEl.value.trim().length === 0 || isLoading;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) send('typed');
    }
  });

  sendBtn.addEventListener('click', () => send('typed'));

  // ─── Streaming helpers ────────────────────────────────────────────────────

  function addBotMessageStreaming() {
    const time = timestamp();
    const wrap = document.createElement('div');
    wrap.className = 'cv-msg-bot';
    wrap.innerHTML = `
      <div class="cv-msg-bot-avatar">SP</div>
      <div class="cv-msg-bot-body">
        <div class="cv-msg-bot-text cv-msg-bot-text--streaming"></div>
        <div class="cv-msg-meta">
          <span class="cv-msg-time">${time}</span>
          <button class="cv-copy-btn" aria-label="Copia risposta" title="Copia">${COPY_ICON}</button>
        </div>
      </div>
    `;
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return { wrap, textEl: wrap.querySelector('.cv-msg-bot-text'), time };
  }

  function finalizeStreamingMessage(wrap, fullText, time) {
    const textEl = wrap.querySelector('.cv-msg-bot-text');
    textEl.classList.remove('cv-msg-bot-text--streaming');
    textEl.innerHTML = renderMarkdown(fullText);

    wireCopyButton(wrap.querySelector('.cv-copy-btn'), fullText);

    messageLog.push({ role: 'bot', text: fullText, time });
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  const streamUrl = CONFIG.streamApiUrl || CONFIG.apiUrl + '/stream';

  async function send(source) {
    const message = inputEl.value.trim();
    if (!message || isLoading) return;

    cancelProactive();
    track('message_sent', { label: message, source: source || 'typed' });
    if (proactiveShown && !proactiveConverted) {
      proactiveConverted = true;
      track('proactive_converted', { label: message, source: source || 'typed' });
    }

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    isLoading = true;
    suggestionsEl.classList.add('cv-suggestions--loading');

    addUserMessage(message);

    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 45000);

    const { wrap, textEl, time } = addBotMessageStreaming();
    let accumulatedReply = '';

    try {
      const res = await fetch(streamUrl, {
        method: 'POST',
        signal: fetchController.signal,
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...(CONFIG.widgetToken ? { 'X-Widget-Token': CONFIG.widgetToken } : {}),
        },
        body: JSON.stringify({ message, sessionId, history: conversationHistory.slice(-20) }),
      });

      clearTimeout(fetchTimeout);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        wrap.remove();
        if (res.status === 400) {
          addBotMessage('Posso rispondere solo a domande sul CV e sull\'esperienza di Sebastiano. Hai qualcosa da chiedermi? 😊');
          const fallback = resolveContextSuggestions();
          renderSuggestions(fallback.suggestions, fallback.source);
          saveSession();
          return;
        }
        throw new Error(errData.message || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let finalized = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });

        // SSE events are separated by \n\n
        const parts = lineBuffer.split('\n\n');
        lineBuffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (data.error) {
            wrap.remove();
            addErrorMessage('Si è verificato un errore. Riprova tra qualche istante.');
            finalized = true;
            break;
          }

          if (data.token !== undefined) {
            accumulatedReply += data.token;
            textEl.innerHTML = renderMarkdown(accumulatedReply);
            scrollToBottom();
          }

          if (data.done) {
            const finalReply = data.reply || accumulatedReply;
            finalizeStreamingMessage(wrap, finalReply, time);
            conversationHistory.push(
              { role: 'user',      content: message },
              { role: 'assistant', content: finalReply },
            );
            renderSuggestions(data.suggestions || [], 'dynamic');
            saveSession();
            finalized = true;
          }
        }

        if (finalized) break;
      }

      if (!finalized && accumulatedReply) {
        finalizeStreamingMessage(wrap, accumulatedReply, time);
        conversationHistory.push(
          { role: 'user',      content: message },
          { role: 'assistant', content: accumulatedReply },
        );
        saveSession();
      }
    } catch (err) {
      clearTimeout(fetchTimeout);
      wrap.remove();
      console.error('[cv-chat-widget] Errore:', err);

      if (err.name === 'AbortError') {
        addErrorMessage('Il server ha impiegato troppo tempo. Riprova tra qualche istante.');
      } else if (err instanceof TypeError) {
        addErrorMessage('Non riesco a raggiungere il server. Assicurati che il backend sia avviato.');
      } else {
        addErrorMessage('Si è verificato un errore. Riprova tra qualche istante.');
      }

      renderSuggestions([], 'dynamic');
    } finally {
      isLoading = false;
      suggestionsEl.classList.remove('cv-suggestions--loading');
      sendBtn.disabled = inputEl.value.trim().length === 0;
    }
  }

  // ─── Utils ────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(raw) {
    // Normalize both actual newlines and the two-char sequence \n (from JSON/HTML configs)
    const normalized = raw.replace(/\\n/g, '\n');

    // Extract inline code spans before escaping so backtick content is preserved verbatim
    const codeSpans = [];
    const withCodePlaceholders = normalized.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codeSpans.push(code) - 1;
      return `\x00CODE${idx}\x00`;
    });

    const escaped = escapeHtml(withCodePlaceholders);

    const withLists = escaped.replace(
      /((?:^|\n)- .+)+/g,
      (block) => {
        const items = block
          .trim()
          .split('\n')
          .filter((l) => l.trim().startsWith('- '))
          .map((l) => `<li>${l.trim().slice(2)}</li>`)
          .join('');
        return `\n<ul>${items}</ul>`;
      },
    );

    return withLists
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')
      .replace(/\x00CODE(\d+)\x00/g, (_, i) => `<code>${escapeHtml(codeSpans[+i])}</code>`);
  }
})();
