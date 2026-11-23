# Session Script

A mobile-first web app for observers who sit in a session or presentation and log what happens, with a timestamp on every activity. Several people can use it at the same time, each on their own phone. There is only one event at a time; each observer keeps their own log and can export it as a plain-text file.

Built for Meeting Design Institute. This repository (`SESSION-SCRIPTING`) publishes the app on GitHub Pages.

**Live site:** https://mdi-cat-app.github.io/SESSION-SCRIPTING/

On that URL every feature works except **Send to server**, which only appears when the optional `server.py` is serving the app.

## What it does

1. Fill in the **session title**, **speakers** (one name per line), **planned start time** (defaults to now) and **your name**.
2. Tap **Session Activity**. The current time is recorded immediately and a popup asks what is happening: Introduction, Presentations, Question from a participant, Conversation, Voting, Play/Sing, Other activity (with a description), Q&A, Conclusions, or Survey. An optional note can be added.
3. The running log can be edited or deleted. The screen also shows planned start, actual start (the first activity) and minutes elapsed since the planned start.
4. Everything is autosaved in the phone’s browser, so a reload does not lose the session.
5. **New session** clears the log and session details after a confirm step. Your name and the coordinator email are kept.
6. Export the text report with **Save TXT**, **Share**, **WhatsApp**, **Email**, or **Copy to clipboard**. When the app is served from the optional Mac server, **Send to server** stores a copy in the `reports` folder.

The text file is named `YYMMDD session-title observer.txt`, for example `261123 opening-keynote maarten.txt`.

## Use it on a phone

Open https://mdi-cat-app.github.io/SESSION-SCRIPTING/ and, if you want it as an icon:

- **Android Chrome:** menu → Add to Home screen / Install app.
- **iPhone Safari:** Share → Add to Home Screen.

Opening `index.html` directly, or copying the folder onto the phone, also works. All features except **Send to server** work that way. The service worker (offline install) needs `http://` or `https://`.

## GitHub Pages

The site is the repository root. Asset URLs, the web app manifest (`start_url`, `scope`, icons) and the service worker are relative, so the same files work at `/SESSION-SCRIPTING/` and from `server.py` at `/`.

Either Pages source works:

- **GitHub Actions:** Settings → Pages → Build and deployment → Source: **GitHub Actions**. Pushes to `main` run `.github/workflows/pages.yml`.
- **Branch:** Settings → Pages → Source: **Deploy from a branch** → branch `main` → folder `/ (root)`. `.nojekyll` publishes the files as they are, without Jekyll.

`enablement: true` on `actions/configure-pages` tries to turn Pages on from the workflow. That call needs a token other than the default `GITHUB_TOKEN`, so the first time you may still need to choose a source under Settings → Pages.

## Run the server on a Mac (venue Wi-Fi)

Python 3 is included with macOS. In Terminal:

```bash
cd /path/to/session-script-app
python3 server.py
```

The app is then at `http://127.0.0.1:8080/` on the Mac, and reports are listed at `http://127.0.0.1:8080/reports`.

On the same Wi-Fi, phones should open `http://YOUR-MAC-IP:8080/`. Find the Mac’s Wi-Fi address with:

```bash
ipconfig getifaddr en0
```

If that prints nothing, try `en1`. If phones cannot connect, allow incoming connections for Python in **System Settings → Network → Firewall**, and keep the Mac awake.

To use another port:

```bash
PORT=9090 python3 server.py
```

Reports sent with **Send to server** are saved as `.txt` files in the `reports` folder next to `server.py`.

Stop the server with Ctrl+C.

## Coordinator email

The Email button opens a message to the coordinator. The default address is `maarten.vanneste@meetingsupport.org`. Change it under the gear icon (Settings).

## Limitations

- **iPhone / iPad:** Save TXT often opens the file, the share sheet, or Files — not a Downloads folder. Use Share or Copy if that is easier. WhatsApp and Email use a link, so a very long report is copied to the clipboard instead and you paste it.
- **Android:** Save TXT typically lands in Downloads. Chrome is the intended browser.
- **file://:** Opening the HTML file directly works, but the service worker (offline install) and Send to server need `http://` or `https://`.
- **GitHub Pages** does not run `server.py`, so **Send to server** stays hidden there. Use the Mac server when reports should be collected in `reports/`.

## Files

- `index.html`, `styles.css`, `app.js` — the app
- `manifest.json`, `sw.js`, `icons/` — PWA / offline
- `server.py` — optional collector (Python 3, no extra packages)
- `reports/` — submitted text files (empty until someone sends one)
- `.nojekyll` — publish the root as static files
- `.github/workflows/pages.yml` — deploy the root to GitHub Pages
