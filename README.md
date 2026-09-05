# Interview availability board (`CALENDERS`)

A static page for managing interview slots against Google Calendar.

**Allowed accounts:** `lotan.br@gmail.com` · `veredpisga@gmail.com`

## What it does

- Sign in with Google (no extra password)
- Weekly board: **Sunday–Friday**, **09:00–21:00**, **15-minute** slots
- Free time on the calendar shows as open for interviews
- Click an open slot → closes it and creates a private Busy event: `⛔ ראיון חסום`
- Click a slot closed from this board → deletes that event and reopens the slot
- Normal calendar meetings stay “busy” and cannot be changed here

## Files

| File | Role |
|------|------|
| `index.html` | Board UI |
| `styles.css` | Styles |
| `app.js` | OAuth, FreeBusy, open/close |
| `config.js` | Client ID and allowed emails |

## Run locally

From this folder:

```powershell
npx --yes serve -p 5500
```

Open in the browser: `http://localhost:5500`

In Google Cloud Console, under the OAuth client, make sure `http://localhost:5500` is listed in **Authorized JavaScript origins**.

## Google setup (one time)

1. [Google Cloud Console](https://console.cloud.google.com/) — existing or new project
2. Enable **Google Calendar API**
3. **OAuth consent screen** — add both emails as Test users (while in Testing)
4. **Credentials** → OAuth client ID of type **Web application**
5. Authorized JavaScript origins — at least `http://localhost:5500`
6. Paste the Client ID into `config.js` as `clientId`

The Client ID is already set in this project; if you switch Google projects, update `config.js`.

## Notes

- Each signed-in user manages only **their own** calendar
- OAuth Testing mode is enough for short internal use
- No live hosting / deploy steps here — intended for local use or a GitHub copy only
