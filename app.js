/**
 * EzSync — app.js
 * Landing page: room name input, session history, animations
 */
'use strict';

const SESSIONS_KEY = 'ezsync_sessions';

const LANG_ICONS = {
  javascript:'🟨', typescript:'🔷', python:'🐍', java:'☕',
  cpp:'⚡', c:'🔵', csharp:'💜', php:'🐘', ruby:'💎',
  go:'🐹', rust:'🦀', swift:'🍎', kotlin:'🎯', html:'🌐',
  css:'🎨', sql:'🗄️', shell:'🖥️', markdown:'📝', json:'📋',
  yaml:'📄', xml:'🔖', default:'📄',
};

// ── Short random ID (5 chars, easy to share) ──────────────────────────────
function generateRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ── Sanitise user-typed room name ─────────────────────────────────────────
// Allows: letters, digits, hyphens, underscores. Trims to 40 chars.
function sanitiseRoomName(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')   // replace invalid chars with hyphen
    .replace(/-+/g, '-')              // collapse multiple hyphens
    .replace(/^-|-$/g, '')            // strip leading/trailing hyphens
    .slice(0, 40);
}

// ── Navigate to editor with given room ID ────────────────────────────────
function goToRoom(roomId) {
  window.location.href = '/' + roomId;
}

// ── Handle Go button / Enter key ─────────────────────────────────────────
function handleGo() {
  const input = document.getElementById('room-name-input');
  const bar   = document.getElementById('room-input-bar');
  const raw   = input ? input.value : '';

  let roomId;

  if (!raw.trim()) {
    // No name entered → generate a short random ID
    roomId = generateRoomId();
  } else {
    roomId = sanitiseRoomName(raw);
    if (!roomId) {
      // Sanitised to empty (e.g. all spaces) → shake + random
      bar?.classList.add('error');
      setTimeout(() => bar?.classList.remove('error'), 500);
      roomId = generateRoomId();
    }
  }

  goToRoom(roomId);
}

// ── Recent Sessions ──────────────────────────────────────────────────────
function getSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); } catch { return []; }
}

function getLangColor(lang) {
  const colors = {
    javascript:'#f7df1e', typescript:'#3178c6', python:'#3776ab',
    java:'#f89820', cpp:'#00599c', html:'#e34c26', css:'#264de4',
    rust:'#dea584', go:'#00add8', ruby:'#cc342d', php:'#777bb3',
    swift:'#fa7343', kotlin:'#7f52ff', default:'#4f8ef7',
  };
  return colors[lang] || colors.default;
}

function formatTimeAgo(ts) {
  if (!ts) return 'just now';
  const diff = Date.now() - ts;
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function renderSessions() {
  const container = document.getElementById('sessions-list');
  if (!container) return;
  const sessions = getSessions();

  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="no-sessions-msg">
        <span class="emoji">✨</span>
        No recent sessions yet — start one above!
      </div>`;
    return;
  }

  container.innerHTML = sessions.map(s => {
    const icon    = LANG_ICONS[s.lang] || LANG_ICONS.default;
    const bgColor = getLangColor(s.lang);
    const timeAgo = formatTimeAgo(s.lastEdited);
    const chars   = (s.codeLength || 0).toLocaleString();
    return `
      <a href="/${s.id}" class="session-card">
        <div class="session-card-icon" style="background:${bgColor}22;border:1px solid ${bgColor}33;">
          ${icon}
        </div>
        <div class="session-card-body">
          <div class="session-card-id">#${s.id}</div>
          <div class="session-card-meta">
            <span>${s.lang || 'plaintext'}</span>
            <span>·</span>
            <span>${chars} chars</span>
            <span>·</span>
            <span>${timeAgo}</span>
          </div>
        </div>
        <svg class="session-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>`;
  }).join('');
}

// ── Clear history ────────────────────────────────────────────────────────
function clearSessions() {
  if (confirm('Clear all session history?')) {
    localStorage.removeItem(SESSIONS_KEY);
    renderSessions();
  }
}

// ── Scroll nav ───────────────────────────────────────────────────────────
function setupScroll() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 20), { passive: true });
}

// ── Counter animation ─────────────────────────────────────────────────────
function animateCounters() {
  document.querySelectorAll('.stat-number[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    let start = 0;
    const step = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / 1400, 1);
      el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ── Intersection observer ────────────────────────────────────────────────
function setupAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        if (e.target.classList.contains('stats-row')) animateCounters();
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card, .stats-row').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    obs.observe(el);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupScroll();
  renderSessions();
  setupAnimations();

  // Dynamically set the URL prefix (e.g. "localhost:3000/")
  const prefixEl = document.querySelector('.room-input-prefix');
  if (prefixEl) prefixEl.textContent = location.host + '/';

  // Go button
  document.getElementById('btn-go')?.addEventListener('click', handleGo);

  // Nav "New Session" button (top-right) → random ID
  document.getElementById('btn-new-session')?.addEventListener('click', () => goToRoom(generateRoomId()));

  // Enter key on input
  document.getElementById('room-name-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleGo();
  });

  // Live sanitise preview while typing
  document.getElementById('room-name-input')?.addEventListener('input', e => {
    const raw = e.target.value;
    const hint = document.querySelector('.room-input-hint');
    if (!hint) return;
    if (!raw.trim()) {
      hint.innerHTML = `Type a name like <code>aditya</code> or <code>team-alpha</code>, or leave blank for a random ID`;
      return;
    }
    const cleaned = sanitiseRoomName(raw);
    if (cleaned) {
      hint.innerHTML = `Will open: <code>${location.host}/${cleaned}</code>`;
    } else {
      hint.innerHTML = `<span style="color:#ef4444">Invalid name — will use a random ID</span>`;
    }
  });

  // Clear sessions
  document.getElementById('btn-clear-sessions')?.addEventListener('click', clearSessions);
});
