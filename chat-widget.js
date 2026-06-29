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
      toggleLabel: 'Chiedimi del CV',
      welcomeMessage:
        'Ciao! Sono Sebastiano — o almeno una versione digitale abbastanza fedele 😄\nChiedimi quello che vuoi sul mio CV, esperienza o progetti.',
      initialSuggestions: [
        'Che stack tecnologico usi?',
        'Hai esperienza con sistemi ad alto traffico?',
        'Raccontami un problema tecnico risolto',
        'Parlami del progetto Steal Drink',
      ],
    },
    window.CV_CHAT_CONFIG || {},
  );

  // U2: warn clearly if apiUrl is missing
  if (!CONFIG.apiUrl) {
    console.error('[cv-chat-widget] apiUrl non configurato. Impostare window.CV_CHAT_CONFIG.apiUrl prima di caricare il widget.');
  }

  // ─── State ───────────────────────────────────────────────────────────────────

  let isOpen = false;
  let isLoading = false;
  let conversationHistory = []; // { role: 'user'|'assistant', content: string }[]
  let messageLog = [];          // { role: 'bot'|'user', text: string, time: string }[]
  let lastSuggestions = CONFIG.initialSuggestions;

  // ─── Session storage (U6) ────────────────────────────────────────────────────

  const SESSION_KEY = 'cv-chat-session';

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        history: conversationHistory,
        messages: messageLog,
        suggestions: lastSuggestions,
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
    <div class="cv-backdrop" id="cv-backdrop" aria-hidden="true"></div>

    <button class="cv-toggle" aria-label="Apri chat CV" aria-expanded="false">
      <span class="cv-toggle-pulse"></span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span>${CONFIG.toggleLabel}</span>
    </button>

    <div class="cv-panel" aria-hidden="true" role="dialog" aria-label="Chat CV">
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
        <button class="cv-close" aria-label="Chiudi chat">✕</button>
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
      <p class="cv-privacy">I messaggi sono elaborati da AI di terze parti (OpenRouter/DeepSeek). Nessun dato personale viene salvato sul tuo dispositivo.</p>
    </div>
  `;

  const backdrop      = widget.querySelector('#cv-backdrop');
  const toggleBtn     = widget.querySelector('.cv-toggle');
  const panel         = widget.querySelector('.cv-panel');
  const closeBtn      = widget.querySelector('.cv-close');
  const newChatBtn    = widget.querySelector('#cv-new-chat');
  const messagesEl    = widget.querySelector('#cv-messages');
  const suggestionsEl = widget.querySelector('#cv-suggestions');
  const inputEl       = widget.querySelector('#cv-input');
  const sendBtn       = widget.querySelector('#cv-send');

  const isMobile = () => window.matchMedia('(max-width: 520px)').matches;

  // ─── Open / Close ─────────────────────────────────────────────────────────

  function openPanel() {
    isOpen = true;
    panel.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');

    backdrop.classList.add('visible');
    requestAnimationFrame(() => backdrop.classList.add('active'));
    if (isMobile()) {
      document.body.style.overflow = 'hidden';
    } else {
      inputEl.focus();
    }

    if (messagesEl.children.length === 0) {
      const session = loadSession();
      if (session && session.messages && session.messages.length > 0) {
        // U6: restore conversation from sessionStorage
        conversationHistory = session.history || [];
        messageLog = session.messages;
        lastSuggestions = session.suggestions || CONFIG.initialSuggestions;
        session.messages.forEach((msg) => {
          if (msg.role === 'bot') addBotMessage(msg.text, msg.time);
          else if (msg.role === 'user') addUserMessage(msg.text, msg.time);
        });
        renderSuggestions(lastSuggestions);
      } else {
        addBotMessage(CONFIG.welcomeMessage);
        renderSuggestions(CONFIG.initialSuggestions);
        saveSession();
      }
    } else {
      scrollToBottom();
    }
  }

  function closePanel() {
    isOpen = false;
    panel.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');

    backdrop.classList.remove('active');
    setTimeout(() => backdrop.classList.remove('visible'), 260);
    if (isMobile()) {
      document.body.style.overflow = '';
    }
    inputEl.style.height = 'auto';
  }

  // U1: reset conversation to welcome state
  function resetConversation() {
    if (isLoading) return;
    conversationHistory = [];
    messageLog = [];
    lastSuggestions = CONFIG.initialSuggestions;
    clearSession();
    messagesEl.innerHTML = '';
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    addBotMessage(CONFIG.welcomeMessage);
    renderSuggestions(CONFIG.initialSuggestions);
    saveSession();
    inputEl.focus();
  }

  toggleBtn.addEventListener('click', () => (isOpen ? closePanel() : openPanel()));
  closeBtn.addEventListener('click', closePanel);
  newChatBtn.addEventListener('click', resetConversation);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closePanel(); });

  // ─── Messages ─────────────────────────────────────────────────────────────

  function timestamp() {
    return new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  const COPY_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

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

    // U7: copy to clipboard
    const copyBtn = wrap.querySelector('.cv-copy-btn');
    copyBtn.addEventListener('click', () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = CHECK_ICON;
        copyBtn.classList.add('cv-copy-btn--done');
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.classList.remove('cv-copy-btn--done');
        }, 1500);
      }).catch(() => {});
    });

    messagesEl.appendChild(wrap);
    if (!savedTime) messageLog.push({ role: 'bot', text, time });
    scrollToBottom();
  }

  function addUserMessage(text, savedTime) {
    const time = savedTime || timestamp();
    const wrap = document.createElement('div');
    wrap.className = 'cv-msg-user';
    wrap.innerHTML = `
      <div>
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
      <div class="cv-msg-bot-avatar" style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#a855f7);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;margin-top:2px;">SP</div>
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

  function renderSuggestions(suggestions) {
    lastSuggestions = suggestions || [];
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
      btn.addEventListener('click', () => {
        if (isLoading) return; // U3: ignore clicks while loading
        inputEl.value = text;
        send();
      });
      suggestionsEl.appendChild(btn);
    });
  }

  // ─── Input ────────────────────────────────────────────────────────────────

  inputEl.addEventListener('input', () => {
    sendBtn.disabled = inputEl.value.trim().length === 0 || isLoading;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) send();
    }
  });

  sendBtn.addEventListener('click', send);

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

    const copyBtn = wrap.querySelector('.cv-copy-btn');
    copyBtn.addEventListener('click', () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(fullText).then(() => {
        copyBtn.innerHTML = CHECK_ICON;
        copyBtn.classList.add('cv-copy-btn--done');
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.classList.remove('cv-copy-btn--done');
        }, 1500);
      }).catch(() => {});
    });

    messageLog.push({ role: 'bot', text: fullText, time });
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  const streamUrl = CONFIG.streamApiUrl || CONFIG.apiUrl + '/stream';

  async function send() {
    const message = inputEl.value.trim();
    if (!message || isLoading) return;

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
        body: JSON.stringify({ message, history: conversationHistory.slice(-20) }),
      });

      clearTimeout(fetchTimeout);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        wrap.remove();
        if (res.status === 400) {
          addBotMessage('Posso rispondere solo a domande sul CV e sull\'esperienza di Sebastiano. Hai qualcosa da chiedermi? 😊');
          renderSuggestions(CONFIG.initialSuggestions);
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
            renderSuggestions(data.suggestions || []);
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

      renderSuggestions([]);
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
    const escaped = escapeHtml(normalized);

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
      .replace(/\n/g, '<br>');
  }
})();
