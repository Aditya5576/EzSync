# ⚡ EzSync — Real-Time Collaborative Code & Image Editor

**EzSync** is a lightweight, zero-dependency, real-time collaborative code and image sharing platform built for developers, teams, and educators. Create a session with a custom URL, share the link, and code together instantly with zero setup or accounts required.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.x-green.svg)
![JavaScript](https://img.shields.io/badge/javascript-ES6%2B-yellow.svg)
![Sync](https://img.shields.io/badge/sync-Real--Time%20%7E300ms-brightgreen.svg)

---

## 🌟 Key Features

- ⚡ **Instant Real-Time Sync**: Synchronizes code within ~300ms across all connected devices, browsers, and incognito windows.
- 🔗 **Clean Custom URLs**: Share rooms using simple human-readable paths (e.g., `ezsync-editor.onrender.com/aditya`).
- 📁 **Code & File Upload**: Drag-and-drop or upload code files (`.js`, `.jsx`, `.tsx`, `.py`, `.java`, `.jsp`, `.html`, `.css`, `.vue`, `.svelte`, `.sql`, etc.).
- 🖼️ **Image Sharing & Live Preview**: Upload or drop PNG, JPG, JPEG, GIF, WEBP, or SVG files — automatically converted to Base64 and synced with a live Image Preview modal.
- 🎨 **50+ Languages & 4 Themes**: Full syntax highlighting for 50+ programming languages with Dracula, Monokai, Nord, and GitHub Light editor themes.
- ✨ **Code Beautifier & Download**: Format code with a single click and download files with auto-detected extensions.
- 🔒 **Read-Only Mode & Shortcuts**: Toggle read-only lock mode and full keyboard shortcut support (`Ctrl+S`, `Ctrl+/`, `Ctrl+Shift+F`).

---

## 🛠️ Technology Stack & Languages

- **Frontend**: HTML5, Vanilla CSS3 (Custom Design System with JetBrains Mono typography), JavaScript (ES6+)
- **Editor Engine**: CodeMirror 5
- **Backend**: Pure Python 3 Standard Library (`http.server`, `threading`) — **Zero external dependencies**
- **Typography**: JetBrains Mono, Fira Code, SF Mono

---

## 🚀 Quick Start (Local Setup)

Clone the repository and start the server with pure Python:

```bash
# 1. Clone the repository
git clone https://github.com/Aditya5576/EzSync.git
cd EzSync

# 2. Run the server (no pip install needed!)
python server.py
```

Open your browser at **`http://localhost:3000`** or open any room directly at **`http://localhost:3000/my-room`**.

---

## ☁️ Deployment

Pre-configured for 1-click cloud deployment on **Render**, **Koyeb**, or **Heroku**:
- Includes `Procfile` (`web: python server.py`)
- Includes `render.yaml` for zero-config Render deployments
- Respects dynamic cloud `$PORT` environment variables

---

## 📄 License

MIT License — Feel free to use, modify, and distribute.
