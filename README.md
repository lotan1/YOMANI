# YOMANI — Interview scheduling

Public booking + admin availability for Lotan & Vered.

## URLs

| Page | URL |
|------|-----|
| Public (candidates) | https://yomanmenahalimhonenoshi.netlify.app/ |
| Admin | https://yomanmenahalimhonenoshi.netlify.app/admin.html |

## Public page

1. Candidate picks **one** open slot on the board.
2. Enters full name + email (no account / password).
3. Optional: connect their Google Calendar — slots that are free on **their** calendar **and** open on ours glow on the board. They can still pick any open slot.
4. On confirm → booking is saved, assigned to Lotan or Vered (whoever is free; round-robin if both), calendar invite when a service account is configured.

## Admin page

Allowed Google accounts: `lotan.br@gmail.com`, `veredpisga@gmail.com`.

- See who booked whom + totals per interviewer
- Toggle slots: open / close
- Force-open a calendar-busy slot (temporary). On the next sync, if still busy → blocked again
- “Sync my calendar” pushes FreeBusy from the signed-in admin
- Hourly scheduled sync (server) when `GOOGLE_SERVICE_ACCOUNT_JSON` is set
- While the admin tab is open, data also reloads every hour

## Google Cloud (OAuth client)

Authorized JavaScript origins must include:

- `https://yomanmenahalimhonenoshi.netlify.app`
- `http://localhost:5500` (local)

Client ID lives in `config.js`.

## Netlify: service account (for invites + hourly sync)

1. Google Cloud → create a **Service Account** → JSON key
2. Enable **Google Calendar API**
3. Share both calendars with the SA email (**Make changes to events**)
4. Netlify site env var `GOOGLE_SERVICE_ACCOUNT_JSON` = full JSON key (one line)
5. Redeploy

Without the service account: admins can still sync their own FreeBusy from the admin UI; bookings are stored but calendar invites need the SA.

## Local

```powershell
npm install
npx --yes netlify-cli dev
```

## Slot rules

- Sun–Fri, 09:00–21:00, 15-minute slots
- Public slot is shown if **at least one** interviewer can take it
- Manual close always hides for that interviewer
- Force-open overrides busy until the next sync finds it busy again
