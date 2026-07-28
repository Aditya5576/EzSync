/**
 * EzSync — editor.js
 * =====================================================================
 * SYNC ENGINE:
 *   On change  → debounced POST /sync/<roomId>   (push your code)
 *   Every 300ms → GET /poll/<roomId>              (fetch others' code)
 *
 *   Server is the single source of truth per room.
 *   Works across: normal tab, incognito, Firefox, mobile, LAN.
 * =====================================================================
 */
'use strict';

// ── CONFIG ─────────────────────────────────────────────────────────────────
const POLL_MS         = 300;    // how often we ask server for updates
const DEBOUNCE_MS     = 200;    // wait this long after typing before POSTing
const SESSIONS_KEY    = 'ezsync_sessions';

// ── STATE ──────────────────────────────────────────────────────────────────
let editor           = null;
let roomId           = '';
let myPeerId         = '';
let myColor          = '';
let myName           = '';

let knownVersion     = 0;    // last version we received from server
let myPostedVersion  = 0;    // last version WE posted (so we don't apply echo)
let pollTimer        = null;
let debounceTimer    = null;
let typingTimer      = null;
let isApplying       = false; // guard: prevents change event while applying remote

let currentLang      = 'javascript';
let currentTheme     = 'dracula';
let fontSize         = 14;
let tabSize          = 2;
let wordWrap         = false;
let readOnly         = false;

// BroadcastChannel for INSTANT same-browser tab sync (no server round-trip)
let channel          = null;

// ── PEER IDENTITY ─────────────────────────────────────────────────────────
const PEER_COLORS = ['#4f8ef7','#a855f7','#10b981','#f59e0b','#ec4899','#22d3ee','#f97316','#84cc16'];
const PEER_NAMES  = ['Alice','Bob','Carol','Dave','Eve','Frank','Grace','Hank','Ivy','Jack','Kara','Leo','Mia','Nick','Ona','Pete'];

function randomId()   { return Math.random().toString(36).slice(2, 10); }
function pickColor(id){ return PEER_COLORS[parseInt(id.slice(-2),36) % PEER_COLORS.length]; }
function pickName(id) { return PEER_NAMES[parseInt(id.slice(-2),36) % PEER_NAMES.length]; }

// ══════════════════════════════════════════════════════════════════════════
//  SYNC ENGINE
// ══════════════════════════════════════════════════════════════════════════

/** Called on every editor change (after debounce). POSTs code to server. */
async function pushCode(code) {
  try {
    const res = await fetch(`/sync/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code, lang: currentLang,
        peerId: myPeerId, name: myName, color: myColor,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Remember the version we just posted so poll() doesn't re-apply it
    myPostedVersion = data.version;
    knownVersion    = data.version;
    updateSyncBar('live', 'All changes saved');
  } catch (e) {
    console.warn('[PUSH] failed:', e.message);
    updateSyncBar('disconnected', 'Server unreachable — retrying…');
  }
}

/** Polls server every POLL_MS. Applies code if version is newer and from someone else. */
async function poll() {
  try {
    const res = await fetch(`/poll/${roomId}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const serverVersion = data.version || 0;
    const fromMe = data.peerId === myPeerId;

    // Only apply if:
    //  1. Server has a newer version than we know about
    //  2. The update is NOT from us (avoid echo)
    if (serverVersion > knownVersion && !fromMe) {
      knownVersion = serverVersion;
      applyRemoteCode(data.code, data);

      // Sync language if changed
      if (data.lang && data.lang !== currentLang) {
        setLanguage(data.lang, false);
        const sel = document.getElementById('lang-select');
        if (sel) sel.value = data.lang;
      }
    }

    // Silently update knownVersion even on echo to stay in sync
    if (fromMe && serverVersion > knownVersion) {
      knownVersion = serverVersion;
    }

    // If server has a version we haven't polled yet, note it
    if (serverVersion > 0 && knownVersion === 0) {
      knownVersion = serverVersion;
    }

  } catch (e) {
    // Server temporarily down — just keep trying
    console.warn('[POLL]', e.message);
  }
}

/** Applies code from a remote peer to the editor without triggering a re-push. */
function applyRemoteCode(code, from) {
  if (!editor) return;
  if (code === editor.getValue()) return; // no actual change

  isApplying = true;

  // Save cursor + scroll position so typing feels natural
  const cursor = editor.getCursor();
  const scroll = editor.getScrollInfo();

  editor.setValue(code);

  try { editor.setCursor(cursor); } catch (_) {}
  editor.scrollTo(scroll.left, scroll.top);

  isApplying = false;

  const who = (from && from.name) ? from.name : 'peer';
  updateSyncBar('live', `Received from ${who}`);
  showTypingDots(who);
  checkAndShowImageButton();

  // Instant same-browser broadcast (so OTHER tabs don't have to wait for poll)
  broadcastLocal(code);
}

// ── BroadcastChannel (same-browser, zero latency) ────────────────────────
function initBroadcastChannel() {
  if (!window.BroadcastChannel) return;
  channel = new BroadcastChannel('ezsync_' + roomId);
  channel.onmessage = e => {
    const msg = e.data;
    if (!msg || msg.peerId === myPeerId) return;
    if (msg.type === 'code' && msg.code !== editor?.getValue()) {
      applyRemoteCode(msg.code, msg);
    }
  };
}

function broadcastLocal(code) {
  if (!channel) return;
  try {
    channel.postMessage({ type: 'code', peerId: myPeerId, name: myName, color: myColor, code });
  } catch (_) {}
}

// ── START / STOP POLLING ──────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollTimer = setInterval(poll, POLL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ══════════════════════════════════════════════════════════════════════════
//  CODEMIRROR SETUP
// ══════════════════════════════════════════════════════════════════════════

const LANGUAGES = [
  { label: 'JavaScript',  value: 'javascript',  mime: 'text/javascript'        },
  { label: 'JSX (React)',  value: 'jsx',         mime: 'text/jsx'               },
  { label: 'TypeScript',  value: 'typescript',  mime: 'text/typescript'        },
  { label: 'TSX',         value: 'tsx',         mime: 'text/typescript-jsx'    },
  { label: 'Python',      value: 'python',      mime: 'text/x-python'          },
  { label: 'Java',        value: 'java',        mime: 'text/x-java'            },
  { label: 'JSP (JavaServer Pages)', value: 'jsp', mime: 'text/html'          },
  { label: 'Vue.js',      value: 'vue',         mime: 'text/html'              },
  { label: 'Svelte',      value: 'svelte',      mime: 'text/html'              },
  { label: 'C',           value: 'c',           mime: 'text/x-csrc'            },
  { label: 'C++',         value: 'cpp',         mime: 'text/x-c++src'          },
  { label: 'C#',          value: 'csharp',      mime: 'text/x-csharp'          },
  { label: 'PHP',         value: 'php',         mime: 'application/x-httpd-php'},
  { label: 'Ruby',        value: 'ruby',        mime: 'text/x-ruby'            },
  { label: 'Go',          value: 'go',          mime: 'text/x-go'              },
  { label: 'Rust',        value: 'rust',        mime: 'text/x-rustsrc'         },
  { label: 'Swift',       value: 'swift',       mime: 'text/x-swift'           },
  { label: 'Kotlin',      value: 'kotlin',      mime: 'text/x-kotlin'          },
  { label: 'HTML',        value: 'html',        mime: 'text/html'              },
  { label: 'CSS',         value: 'css',         mime: 'text/css'               },
  { label: 'SCSS',        value: 'scss',        mime: 'text/x-scss'            },
  { label: 'SQL',         value: 'sql',         mime: 'text/x-sql'             },
  { label: 'Shell / Docker / Env', value: 'shell', mime: 'text/x-sh'          },
  { label: 'Markdown',    value: 'markdown',    mime: 'text/x-markdown'        },
  { label: 'JSON',        value: 'json',        mime: 'application/json'       },
  { label: 'YAML / TOML', value: 'yaml',        mime: 'text/x-yaml'            },
  { label: 'XML / SVG',   value: 'xml',         mime: 'application/xml'        },
  { label: 'Dart',        value: 'dart',        mime: 'application/dart'       },
  { label: 'Lua',         value: 'lua',         mime: 'text/x-lua'             },
  { label: 'R',           value: 'r',           mime: 'text/x-rsrc'            },
  { label: 'Scala',       value: 'scala',       mime: 'text/x-scala'           },
  { label: 'Haskell',     value: 'haskell',     mime: 'text/x-haskell'         },
  { label: 'Image (Base64)', value: 'image',    mime: 'text/html'              },
  { label: 'Plain Text',  value: 'plaintext',   mime: 'text/plain'             },
];

const THEMES = [
  { label: '🌑 Dracula',      value: 'dracula'  },
  { label: '🎨 Monokai',      value: 'monokai'  },
  { label: '🌤 GitHub Light',  value: 'github'   },
  { label: '🧊 Nord',         value: 'nord'     },
  { label: '⚫ Material',     value: 'material' },
];

const THEME_TO_CM = {
  dracula: 'dracula', monokai: 'monokai',
  github:  'default', nord: 'nord', material: 'material',
};

const EXT_MAP = {
  javascript:'js', typescript:'ts', python:'py', java:'java', c:'c',
  cpp:'cpp', csharp:'cs', php:'php', ruby:'rb', go:'go', rust:'rs',
  swift:'swift', kotlin:'kt', html:'html', css:'css', scss:'scss',
  sql:'sql', shell:'sh', markdown:'md', json:'json', yaml:'yaml',
  xml:'xml', dart:'dart', lua:'lua', r:'r', scala:'scala',
  haskell:'hs', plaintext:'txt',
};

function initEditor() {
  const el = document.getElementById('editor-textarea');
  if (!el) return;

  editor = CodeMirror.fromTextArea(el, {
    lineNumbers:       true,
    mode:              'javascript',
    theme:             'dracula',
    indentUnit:        2,
    tabSize:           2,
    indentWithTabs:    false,
    lineWrapping:      false,
    matchBrackets:     true,
    autoCloseBrackets: true,
    autoCloseTags:     true,
    foldGutter:        true,
    styleActiveLine:   true,
    gutters:           ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Ctrl-S':       () => manualSave(),
      'Cmd-S':        () => manualSave(),
      'Ctrl-/':       'toggleComment',
      'Cmd-/':        'toggleComment',
      'Ctrl-F':       'findPersistent',
      'Cmd-F':        'findPersistent',
      'Ctrl-D':       cm => cm.execCommand('deleteLine'),
      'Tab':          cm => cm.execCommand('indentMore'),
      'Shift-Tab':    cm => cm.execCommand('indentLess'),
      'Ctrl-Shift-F': () => beautifyCode(),
      'Ctrl-Shift-P': () => toggleReadOnly(),
    },
  });

  // ── ON CHANGE ─────────────────────────────────────────────────────
  editor.on('change', () => {
    if (isApplying) return;               // don't re-push remote code
    const code = editor.getValue();

    updateStatusBar();
    updateSyncBar('syncing', 'Saving…');

    // Instant same-browser sync via BroadcastChannel
    broadcastLocal(code);

    // Debounced push to server
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      pushCode(code);
      saveRoomMeta();
    }, DEBOUNCE_MS);
  });

  editor.on('cursorActivity', updateStatusBar);
  setTimeout(() => editor.focus(), 100);
}

// ══════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════════════════

function setLanguage(value, doPush = true) {
  currentLang = value;
  const lang = LANGUAGES.find(l => l.value === value);
  if (lang && editor) editor.setOption('mode', lang.mime);
  updateStatusBar();
  if (doPush) pushCode(editor?.getValue() || '');
}

function setTheme(value) {
  currentTheme = value;
  if (editor) editor.setOption('theme', THEME_TO_CM[value] || value);
  const wrap = document.querySelector('.editor-wrapper');
  if (value === 'github') {
    document.documentElement.setAttribute('data-theme','light');
    if (wrap) wrap.style.background = '#fff';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (wrap) wrap.style.background = '';
  }
}

function setFontSize(size) {
  fontSize = size;
  const cm = document.querySelector('.CodeMirror');
  if (cm) cm.style.fontSize = size + 'px';
  document.querySelectorAll('#font-size-value, #font-size-value-inline')
    .forEach(el => el.textContent = size + 'px');
}

function setTabSize(size) {
  tabSize = size;
  if (editor) { editor.setOption('tabSize', size); editor.setOption('indentUnit', size); }
  document.querySelectorAll('#tab-size-value, #tab-size-value-inline')
    .forEach(el => el.textContent = size);
}

function setWordWrap(on) {
  wordWrap = on;
  if (editor) editor.setOption('lineWrapping', on);
}

function toggleReadOnly() {
  readOnly = !readOnly;
  if (editor) editor.setOption('readOnly', readOnly);
  document.getElementById('btn-readonly')?.classList.toggle('active', readOnly);
  showToast(readOnly ? 'Read-only ON' : 'Editor editable', 'info', readOnly ? '🔒' : '✏️');
}

function applySettings() {
  const $ = id => document.getElementById(id);
  setFontSize(parseInt($('setting-font-size')?.value || fontSize));
  setTabSize(parseInt($('setting-tab-size')?.value  || tabSize));
  setWordWrap($('setting-word-wrap')?.checked ?? wordWrap);
  const ro = $('setting-read-only')?.checked ?? readOnly;
  if (ro !== readOnly) toggleReadOnly();
  closeModal('modal-settings');
  showToast('Settings applied', 'success', '⚙️');
}

// ══════════════════════════════════════════════════════════════════════════
//  ACTIONS
// ══════════════════════════════════════════════════════════════════════════

function copyCode() {
  navigator.clipboard.writeText(editor?.getValue() || '')
    .then(() => showToast('Code copied!', 'success', '📋'))
    .catch(() => showToast('Copy failed', 'error', '❌'));
}

function copyShareLink() {
  const url = `${location.origin}/${roomId}`;
  navigator.clipboard.writeText(url)
    .then(() => showToast('Link copied!', 'success', '🔗'))
    .catch(() => showToast('Copy failed', 'error', '❌'));
}

function downloadCode() {
  const code = editor?.getValue();
  if (!code?.trim()) { showToast('Nothing to download', 'error', '⚠️'); return; }
  const ext  = EXT_MAP[currentLang] || 'txt';
  const name = `ezsync_${roomId}.${ext}`;
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([code], { type: 'text/plain' })),
    download: name,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Downloaded ${name}`, 'success', '⬇️');
}

// ══════════════════════════════════════════════════════════════════════════
//  FILE UPLOAD — read any text/code file into the editor
// ══════════════════════════════════════════════════════════════════════════

// Map file extension → language value
const FILE_EXT_TO_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx',
  py: 'python', pyw: 'python',
  java: 'java', jsp: 'jsp',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte', asp: 'html', aspx: 'html', ejs: 'html', erb: 'html',
  css: 'css',
  scss: 'scss', sass: 'scss',
  sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', bat: 'shell', cmd: 'shell', env: 'shell', dockerfile: 'shell',
  md: 'markdown', mdx: 'markdown',
  json: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml',
  xml: 'xml', svg: 'xml',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  hs: 'haskell',
  txt: 'plaintext',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', ico: 'image', bmp: 'image',
};

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'];

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function langFromFile(filename) {
  return FILE_EXT_TO_LANG[getExtension(filename)] || 'plaintext';
}

function extractDataUrl(text) {
  if (!text) return null;
  const match = text.match(/data:image\/[a-zA-Z0-9+.-]+;base64,[^"'\s>)]+/);
  return match ? match[0] : null;
}

function checkAndShowImageButton() {
  const code = editor?.getValue() || '';
  const dataUrl = extractDataUrl(code);
  const btn = document.getElementById('btn-view-image');
  if (btn) {
    btn.style.display = dataUrl ? 'inline-flex' : 'none';
  }
}

function openImageModal(dataUrl, filename = 'Image') {
  if (!dataUrl) dataUrl = extractDataUrl(editor?.getValue() || '');
  if (!dataUrl) {
    showToast('No image data found in editor', 'error', '🖼️');
    return;
  }
  const imgEl = document.getElementById('image-preview-img');
  const metaEl = document.getElementById('image-meta-info');
  const dlBtn = document.getElementById('btn-download-image');

  if (imgEl) {
    imgEl.src = dataUrl;
    imgEl.onload = () => {
      if (metaEl) {
        metaEl.textContent = `${filename} • ${imgEl.naturalWidth} × ${imgEl.naturalHeight} px`;
      }
    };
  }

  if (dlBtn) {
    dlBtn.href = dataUrl;
    dlBtn.download = filename.includes('.') ? filename : `${filename}.png`;
  }

  openModal('modal-image');
}

/** Read a File object, load it into the editor, sync to all peers */
function loadFileIntoEditor(file) {
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB limit
  if (file.size > MAX_SIZE) {
    showToast(`File too large (max 10MB)`, 'error', '📦');
    return;
  }

  const ext = getExtension(file.name);
  const isImage = file.type.startsWith('image/') || IMAGE_EXTS.includes(ext);

  if (isImage) {
    // Image file -> convert to base64 Data URL so it syncs to all peers
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const code = `<!-- IMAGE: ${file.name} -->\n<img src="${dataUrl}" alt="${file.name}" />`;

      isApplying = true;
      editor.setValue(code);
      isApplying = false;

      setLanguage('image', false);
      const sel = document.getElementById('lang-select');
      if (sel) sel.value = 'image';

      pushCode(code);
      broadcastLocal(code);

      showToast(`Uploaded Image: ${file.name}`, 'success', '🖼️');
      checkAndShowImageButton();
      openImageModal(dataUrl, file.name);
      updateStatusBar();
      saveRoomMeta();
    };
    reader.onerror = () => showToast('Failed to read image file', 'error', '❌');
    reader.readAsDataURL(file);
    return;
  }

  // Code / Text file (HTML, CSS, JS, JSX, TSX, JSP, Python, C++, Java, etc.)
  const reader = new FileReader();
  reader.onload = e => {
    const code = e.target.result;

    if (code.includes('\0')) {
      showToast('Binary file detected — text & image files supported', 'error', '🚫');
      return;
    }

    const lang = langFromFile(file.name);

    isApplying = true;
    editor.setValue(code);
    isApplying = false;

    setLanguage(lang, false);
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = lang;

    pushCode(code);
    broadcastLocal(code);

    showToast(`Loaded: ${file.name}`, 'success', '📂');
    checkAndShowImageButton();
    updateStatusBar();
    saveRoomMeta();
  };
  reader.onerror = () => showToast('Failed to read file', 'error', '❌');
  reader.readAsText(file, 'UTF-8');
}

/** Wire up the file <input> button */
function initFileUpload() {
  const input = document.getElementById('file-upload-input');
  if (!input) return;
  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadFileIntoEditor(file);
    input.value = ''; // reset so same file can be re-uploaded
  });
}

/** Wire up drag & drop onto the editor wrapper */
function initDragDrop() {
  const wrapper = document.getElementById('editor-wrapper');
  const overlay = document.getElementById('drop-overlay');
  if (!wrapper || !overlay) return;

  let dragCounter = 0; // track nested drag events

  wrapper.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.add('active');
  });

  wrapper.addEventListener('dragleave', e => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.classList.remove('active');
    }
  });

  wrapper.addEventListener('dragover', e => {
    e.preventDefault(); // needed to allow drop
    e.dataTransfer.dropEffect = 'copy';
  });

  wrapper.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    if (files.length > 1) {
      showToast('Drop one file at a time', 'error', '⚠️');
      return;
    }

    loadFileIntoEditor(files[0]);
  });

  // Also allow drops on the overlay itself
  overlay.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('active');
    const files = e.dataTransfer.files;
    if (files.length > 0) loadFileIntoEditor(files[0]);
  });
  overlay.addEventListener('dragover', e => e.preventDefault());
}


function manualSave() {
  pushCode(editor?.getValue() || '');
  showToast('Saved!', 'success', '💾');
}

function beautifyCode() {
  if (!editor) return;
  if (readOnly) { showToast('Disable read-only first', 'error', '🔒'); return; }
  const code = editor.getValue();
  let out = code;
  try {
    if (['javascript','typescript','json'].includes(currentLang)) out = prettyJs(code);
    else if (['html','xml'].includes(currentLang))                out = prettyHtml(code);
    else if (['css','scss'].includes(currentLang))                out = prettyCss(code);
  } catch (e) { showToast('Cannot beautify', 'error', '❌'); return; }

  if (out !== code) {
    isApplying = true;
    editor.setValue(out);
    isApplying = false;
    pushCode(out);
    broadcastLocal(out);
    showToast('Beautified!', 'success', '✨');
  } else {
    showToast('Already looks good!', 'info', '👍');
  }
}

function prettyJs(code) {
  try { return JSON.stringify(JSON.parse(code), null, tabSize); } catch (_) {}
  return code.split('\n').map(l => l.trimEnd()).join('\n');
}
function prettyHtml(code) {
  let d = 0;
  return code.replace(/>\s*</g,'>\n<').split('\n').map(l => {
    const t = l.trim(); if (!t) return '';
    if (/^<\//.test(t)) d = Math.max(0, d - 1);
    const r = ' '.repeat(tabSize * d) + t;
    if (/^<[^\/!][^>]*[^\/]>$/.test(t)) d++;
    return r;
  }).filter(Boolean).join('\n');
}
function prettyCss(code) {
  return code
    .replace(/\s*{\s*/g,' {\n  ').replace(/;\s*/g,';\n  ')
    .replace(/\s*}\s*/g,'\n}\n').replace(/\n\s*\n/g,'\n').trim();
}

// ══════════════════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════════════════

function updateStatusBar() {
  if (!editor) return;
  const cur   = editor.getCursor();
  const code  = editor.getValue();
  const lines = code.split('\n').length;
  const $ = id => document.getElementById(id);
  if ($('status-line'))    $('status-line').textContent    = `Ln ${cur.line + 1}`;
  if ($('status-col'))     $('status-col').textContent     = `Col ${cur.ch + 1}`;
  if ($('status-lines'))   $('status-lines').textContent   = `${lines} lines`;
  if ($('status-chars'))   $('status-chars').textContent   = `${code.length.toLocaleString()} chars`;
  if ($('status-lang'))    $('status-lang').textContent    = LANGUAGES.find(l => l.value === currentLang)?.label || currentLang;
  if ($('status-tab'))     $('status-tab').textContent     = `Tab: ${tabSize}`;
  if ($('status-room-id')) $('status-room-id').textContent = roomId || '';
  checkAndShowImageButton();
}

let syncBarTimer = null;
function updateSyncBar(state, msg) {
  const bar = document.getElementById('sync-bar');
  const txt = document.getElementById('sync-text');
  const ts  = document.getElementById('sync-timestamp');
  if (!bar) return;
  bar.className = 'sync-bar ' + state;
  if (txt) txt.textContent = msg;
  if (ts && state === 'live') ts.textContent = 'Last sync: ' + new Date().toLocaleTimeString();
  clearTimeout(syncBarTimer);
  if (state === 'syncing')
    syncBarTimer = setTimeout(() => updateSyncBar('live', 'Saved'), 5000);
}

function showTypingDots(who) {
  const el = document.getElementById('typing-indicator');
  if (!el) return;
  const lbl = el.querySelector('.typing-label');
  if (lbl && who) lbl.textContent = `${who} is typing…`;
  el.classList.add('visible');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}

function showToast(msg, type = 'info', icon = 'ℹ️') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icon}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3200);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  el.addEventListener('click', e => { if (e.target === el) closeModal(id); }, { once: true });
}
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
});

function openShareModal() {
  const url = `${location.origin}/${roomId}`;
  const inp = document.getElementById('share-url-input');
  if (inp) inp.value = url;
  openModal('modal-share');
}

function saveRoomMeta() {
  try {
    const list = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    const idx  = list.findIndex(s => s.id === roomId);
    const meta = { id: roomId, lang: currentLang, lastEdited: Date.now(), codeLength: editor?.getValue().length || 0 };
    if (idx >= 0) list[idx] = meta; else list.unshift(meta);
    if (list.length > 8) list.pop();
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════════
//  POPULATE SELECTS + BIND BUTTONS
// ══════════════════════════════════════════════════════════════════════════

function populateSelects() {
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.innerHTML = LANGUAGES.map(l =>
      `<option value="${l.value}" ${l.value === currentLang ? 'selected':''}>${l.label}</option>`
    ).join('');
    langSel.addEventListener('change', e => setLanguage(e.target.value));
  }

  const themeSel = document.getElementById('theme-select');
  if (themeSel) {
    themeSel.innerHTML = THEMES.map(t =>
      `<option value="${t.value}" ${t.value === currentTheme ? 'selected':''}>${t.label}</option>`
    ).join('');
    themeSel.addEventListener('change', e => setTheme(e.target.value));
  }
}

function bindButtons() {
  const b = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);

  b('btn-copy-code',   copyCode);
  b('btn-download',    downloadCode);
  b('btn-beautify',    beautifyCode);
  b('btn-share',       openShareModal);
  b('btn-shortcuts',   () => openModal('modal-shortcuts'));
  b('btn-readonly',    toggleReadOnly);
  b('btn-new-session', () => window.open('/' + Date.now().toString(36).slice(-5), '_blank'));
  b('session-info-bar', copyShareLink);
  b('btn-share-copy',  () => {
    const inp = document.getElementById('share-url-input');
    if (inp) navigator.clipboard.writeText(inp.value).then(() => showToast('Copied!','success','🔗'));
  });
  b('btn-view-image',  () => openImageModal());
  b('btn-copy-image-url', () => {
    const dataUrl = extractDataUrl(editor?.getValue() || '');
    if (dataUrl) {
      navigator.clipboard.writeText(dataUrl)
        .then(() => showToast('Image Data URL copied!', 'success', '📋'))
        .catch(() => showToast('Copy failed', 'error', '❌'));
    }
  });
  b('btn-settings-apply', applySettings);

  // Settings modal — open with pre-filled values
  b('btn-settings', () => {
    const $ = id => document.getElementById(id);
    const fsEl = $('setting-font-size');
    const tsEl = $('setting-tab-size');
    if (fsEl) { fsEl.value = fontSize; document.querySelectorAll('#font-size-value,#font-size-value-inline').forEach(el=>el.textContent=fontSize+'px'); }
    if (tsEl) { tsEl.value = tabSize;  document.querySelectorAll('#tab-size-value,#tab-size-value-inline').forEach(el=>el.textContent=tabSize); }
    const ww = $('setting-word-wrap'); if (ww) ww.checked = wordWrap;
    const ro = $('setting-read-only'); if (ro) ro.checked = readOnly;
    openModal('modal-settings');
  });

  document.getElementById('setting-font-size')?.addEventListener('input', e => {
    document.querySelectorAll('#font-size-value,#font-size-value-inline').forEach(el=>el.textContent=e.target.value+'px');
  });
  document.getElementById('setting-tab-size')?.addEventListener('input', e => {
    document.querySelectorAll('#tab-size-value,#tab-size-value-inline').forEach(el=>el.textContent=e.target.value);
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal))
  );

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
      if (confirm('Clear all code in this session?')) {
        editor?.setValue('');
        pushCode('');
        broadcastLocal('');
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Room ID from URL PATH (e.g. localhost:3000/aditya → roomId = 'aditya')
  roomId = location.pathname.slice(1); // strip leading '/'

  // If no room in path (e.g. opened editor.html directly), generate one and redirect
  if (!roomId || roomId === 'editor.html' || roomId === 'index.html') {
    roomId = randomId();
    history.replaceState(null, '', '/' + roomId);
  }

  // 2. Peer identity
  myPeerId = randomId();
  myColor  = pickColor(myPeerId);
  myName   = pickName(myPeerId);

  // 3. Show room ID in toolbar
  const roomEl = document.getElementById('room-id-display');
  if (roomEl) roomEl.textContent = roomId;

  // 4. Init CodeMirror
  initEditor();

  // 5. Populate dropdowns + bind buttons
  populateSelects();
  bindButtons();

  // 6. File upload (button click) + drag & drop
  initFileUpload();
  initDragDrop();

  // 7. BroadcastChannel (same-browser instant sync)
  initBroadcastChannel();

  // 8. Immediate fetch of current room code from server
  updateSyncBar('syncing', 'Connecting…');
  try {
    const res = await fetch(`/poll/${roomId}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.version > 0) {
        knownVersion = data.version;
        if (data.code) {
          isApplying = true;
          editor.setValue(data.code);
          isApplying = false;
        }
        if (data.lang && data.lang !== currentLang) {
          setLanguage(data.lang, false);
          const sel = document.getElementById('lang-select');
          if (sel) sel.value = data.lang;
        }
        updateSyncBar('live', `Loaded — ${data.name || 'someone'} is in this room`);
      } else {
        updateSyncBar('live', 'New session — share the URL to collaborate');
      }
    }
  } catch (e) {
    updateSyncBar('disconnected', 'Cannot reach server — is server.py running?');
  }

  // 9. Start polling
  startPolling();

  // 10. Periodic room meta save
  setInterval(saveRoomMeta, 10000);

  // 11. Update status bar
  updateStatusBar();

  console.log(
    `%cEzSync | Room: ${roomId} | You: ${myName} (${myPeerId}) | Poll: ${POLL_MS}ms`,
    'color:#4f8ef7;font-weight:bold;font-family:monospace;font-size:12px;'
  );
});

window.addEventListener('beforeunload', () => {
  stopPolling();
  if (channel) try { channel.close(); } catch (_) {}
  saveRoomMeta();
});
