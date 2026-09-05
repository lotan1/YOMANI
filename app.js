(() => {
  const cfg = window.APP_CONFIG;
  const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];

  const el = {
    gate: document.getElementById("gate"),
    boardWrap: document.getElementById("boardWrap"),
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    weekLabel: document.getElementById("weekLabel"),
    btnSignIn: document.getElementById("btnSignIn"),
    btnSignOut: document.getElementById("btnSignOut"),
    userChip: document.getElementById("userChip"),
    userEmail: document.getElementById("userEmail"),
    btnPrevWeek: document.getElementById("btnPrevWeek"),
    btnNextWeek: document.getElementById("btnNextWeek"),
    btnThisWeek: document.getElementById("btnThisWeek"),
    btnRefresh: document.getElementById("btnRefresh"),
  };

  /** @type {google.accounts.oauth2.TokenClient | null} */
  let tokenClient = null;
  let accessToken = null;
  let userEmail = null;
  /** Monday-anchored? We use Sunday start for Israel week. */
  let weekStart = startOfWeek(new Date());
  /** slotKey -> { state, eventId? } */
  let slotMap = new Map();

  function setStatus(msg, isError = false) {
    el.status.textContent = msg || "";
    el.status.classList.toggle("error", !!isError);
  }

  function configReady() {
    return cfg.clientId && !cfg.clientId.startsWith("PASTE_");
  }

  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = x.getDay(); // 0=Sun
    x.setDate(x.getDate() - day);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatTime(h, m) {
    return `${pad(h)}:${pad(m)}`;
  }

  function toLocalIso(date) {
    const y = date.getFullYear();
    const mo = pad(date.getMonth() + 1);
    const da = pad(date.getDate());
    const h = pad(date.getHours());
    const mi = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const oh = pad(Math.floor(Math.abs(offset) / 60));
    const om = pad(Math.abs(offset) % 60);
    return `${y}-${mo}-${da}T${h}:${mi}:${s}${sign}${oh}:${om}`;
  }

  function slotKey(date) {
    return toLocalIso(date).slice(0, 16);
  }

  function weekDays() {
    return cfg.openWeekdays.map((wd) => addDays(weekStart, wd));
  }

  function eachSlot(dayDate, fn) {
    const startMin = cfg.dayStartHour * 60;
    const endMin = cfg.dayEndHour * 60;
    for (let m = startMin; m < endMin; m += cfg.slotMinutes) {
      const d = new Date(dayDate);
      d.setHours(0, 0, 0, 0);
      d.setMinutes(m);
      fn(d, Math.floor(m / 60), m % 60);
    }
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
  }

  async function gapiFetch(path, options = {}) {
    const url = path.startsWith("http")
      ? path
      : `https://www.googleapis.com/calendar/v3${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      accessToken = null;
      showSignedOut("פג תוקף ההתחברות — התחברו שוב.");
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function loadFreeBusyAndBlocks() {
    const days = weekDays();
    const timeMin = new Date(days[0]);
    timeMin.setHours(cfg.dayStartHour, 0, 0, 0);
    const timeMax = new Date(days[days.length - 1]);
    timeMax.setHours(cfg.dayEndHour, 0, 0, 0);

    setStatus("טוען זמינות מהיומן…");

    const [fb, blockedEvents] = await Promise.all([
      gapiFetch("/freeBusy", {
        method: "POST",
        body: JSON.stringify({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timeZone: cfg.timezone,
          items: [{ id: "primary" }],
        }),
      }),
      gapiFetch(
        `/calendars/primary/events?` +
          new URLSearchParams({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "2500",
          })
      ),
    ]);

    const busy = (fb.calendars?.primary?.busy || []).map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }));

    const ourBlocks = new Map();
    for (const ev of blockedEvents.items || []) {
      if (!ev.summary || !ev.summary.startsWith(cfg.blockEventPrefix)) continue;
      if (!ev.start?.dateTime) continue;
      const start = new Date(ev.start.dateTime);
      ourBlocks.set(slotKey(start), ev.id);
    }

    const now = new Date();
    slotMap = new Map();

    for (const day of days) {
      eachSlot(day, (slotStart) => {
        const slotEnd = new Date(slotStart.getTime() + cfg.slotMinutes * 60000);
        const key = slotKey(slotStart);
        const blockId = ourBlocks.get(key);

        if (slotEnd <= now) {
          slotMap.set(key, { state: "past", start: slotStart, end: slotEnd });
          return;
        }

        if (blockId) {
          slotMap.set(key, {
            state: "closed",
            start: slotStart,
            end: slotEnd,
            eventId: blockId,
          });
          return;
        }

        const isBusy = busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
        slotMap.set(key, {
          state: isBusy ? "busy" : "open",
          start: slotStart,
          end: slotEnd,
        });
      });
    }

    setStatus(`מחובר כ־${userEmail} · עודכן ${now.toLocaleTimeString("he-IL")}`);
  }

  function renderBoard() {
    const days = weekDays();
    const end = addDays(weekStart, 5);
    el.weekLabel.textContent = `${days[0].toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
    })} – ${end.toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;

    const frag = document.createDocumentFragment();
    const corner = document.createElement("div");
    corner.className = "cell corner";
    corner.textContent = "שעה";
    frag.appendChild(corner);

    for (const day of days) {
      const head = document.createElement("div");
      head.className = "cell head";
      head.innerHTML = `${DAY_NAMES[day.getDay()]}<br /><span style="font-weight:500;color:var(--muted);font-size:0.75rem">${day.toLocaleDateString(
        "he-IL",
        { day: "numeric", month: "numeric" }
      )}</span>`;
      frag.appendChild(head);
    }

    const times = [];
    eachSlot(days[0], (_d, h, m) => times.push({ h, m }));

    for (const { h, m } of times) {
      const timeCell = document.createElement("div");
      timeCell.className = "cell time";
      timeCell.textContent = formatTime(h, m);
      frag.appendChild(timeCell);

      for (const day of days) {
        const slotStart = new Date(day);
        slotStart.setHours(h, m, 0, 0);
        const key = slotKey(slotStart);
        const info = slotMap.get(key) || {
          state: "busy",
          start: slotStart,
          end: new Date(slotStart.getTime() + cfg.slotMinutes * 60000),
        };

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `cell slot ${info.state}`;
        btn.dataset.key = key;
        btn.title = labelFor(info);
        btn.textContent =
          info.state === "open"
            ? "פתוח"
            : info.state === "closed"
              ? "סגור"
              : info.state === "busy"
                ? "תפוס"
                : "—";

        if (info.state === "open" || info.state === "closed") {
          btn.addEventListener("click", () => onToggle(key, btn));
        } else {
          btn.disabled = true;
        }

        frag.appendChild(btn);
      }
    }

    el.board.replaceChildren(frag);
  }

  function labelFor(info) {
    const t = info.start.toLocaleString("he-IL", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    if (info.state === "open") return `${t} — פתוח לראיון (קליק לסגירה)`;
    if (info.state === "closed") return `${t} — סגור ידנית (קליק לפתיחה)`;
    if (info.state === "busy") return `${t} — תפוס ביומן`;
    return `${t} — עבר`;
  }

  async function onToggle(key, btn) {
    const info = slotMap.get(key);
    if (!info || (info.state !== "open" && info.state !== "closed")) return;

    btn.classList.add("loading");
    btn.disabled = true;

    try {
      if (info.state === "open") {
        const created = await gapiFetch("/calendars/primary/events", {
          method: "POST",
          body: JSON.stringify({
            summary: `${cfg.blockEventPrefix}`,
            description: "נחסם מלוח הזמינות לראיונות. מחיקה תפתח שוב את המשבצת.",
            start: { dateTime: toLocalIso(info.start), timeZone: cfg.timezone },
            end: { dateTime: toLocalIso(info.end), timeZone: cfg.timezone },
            transparency: "opaque",
            status: "confirmed",
            visibility: "private",
          }),
        });
        info.state = "closed";
        info.eventId = created.id;
      } else if (info.state === "closed" && info.eventId) {
        await gapiFetch(`/calendars/primary/events/${encodeURIComponent(info.eventId)}`, {
          method: "DELETE",
        });
        info.state = "open";
        delete info.eventId;
      }
      slotMap.set(key, info);
      btn.className = `cell slot ${info.state}`;
      btn.textContent = info.state === "open" ? "פתוח" : "סגור";
      btn.title = labelFor(info);
      btn.disabled = false;
      setStatus(
        info.state === "closed"
          ? `נסגר ונחסם ביומן: ${info.start.toLocaleString("he-IL")}`
          : `נפתח שוב: ${info.start.toLocaleString("he-IL")}`
      );
    } catch (err) {
      console.error(err);
      setStatus("שגיאה בעדכון המשבצת. נסו שוב.", true);
      btn.disabled = false;
    } finally {
      btn.classList.remove("loading");
    }
  }

  async function refresh() {
    try {
      await loadFreeBusyAndBlocks();
      renderBoard();
    } catch (err) {
      if (err.message !== "unauthorized") {
        console.error(err);
        setStatus("לא הצלחנו לטעון את היומן. בדקו הרשאות Calendar API.", true);
      }
    }
  }

  function showSignedIn() {
    el.btnSignIn.hidden = true;
    el.userChip.hidden = false;
    el.userEmail.textContent = userEmail;
    el.gate.hidden = true;
    el.boardWrap.hidden = false;
  }

  function showSignedOut(msg) {
    userEmail = null;
    accessToken = null;
    el.btnSignIn.hidden = false;
    el.userChip.hidden = true;
    el.gate.hidden = false;
    el.boardWrap.hidden = true;
    if (msg) setStatus(msg, true);
  }

  function onTokenResponse(resp) {
    if (resp.error) {
      setStatus("ההתחברות נכשלה או בוטלה.", true);
      return;
    }
    accessToken = resp.access_token;
    identifyAndLoad();
  }

  async function identifyAndLoad() {
    try {
      const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((r) => r.json());

      const email = (me.email || "").toLowerCase();
      if (!cfg.allowedEmails.map((e) => e.toLowerCase()).includes(email)) {
        showSignedOut("החשבון לא מורשה. השתמשו ב־lotan.br או veredpisga.");
        accessToken = null;
        return;
      }

      userEmail = email;
      showSignedIn();
      await refresh();
    } catch (err) {
      console.error(err);
      showSignedOut("שגיאה בזיהוי המשתמש.", true);
    }
  }

  function signIn() {
    if (!configReady()) {
      setStatus("חסר Client ID ב־config.js — ראו README.", true);
      return;
    }
    if (!tokenClient) {
      setStatus("Google עדיין נטען — נסו שוב בעוד רגע.", true);
      return;
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  }

  function signOut() {
    if (accessToken && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    showSignedOut("");
    setStatus("התנתקתם.");
  }

  function initGis() {
    if (!window.google?.accounts?.oauth2) {
      setTimeout(initGis, 150);
      return;
    }

    if (!configReady()) {
      el.btnSignIn.hidden = false;
      el.gate.hidden = false;
      setStatus("הדביקו את ה־Client ID של Google ב־config.js (הוראות ב־README).", true);
      return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" "),
      callback: onTokenResponse,
    });

    el.btnSignIn.hidden = false;
    el.gate.hidden = false;
  }

  el.btnSignIn.addEventListener("click", signIn);
  el.btnSignOut.addEventListener("click", signOut);
  el.btnRefresh.addEventListener("click", refresh);
  el.btnPrevWeek.addEventListener("click", async () => {
    weekStart = addDays(weekStart, -7);
    await refresh();
  });
  el.btnNextWeek.addEventListener("click", async () => {
    weekStart = addDays(weekStart, 7);
    await refresh();
  });
  el.btnThisWeek.addEventListener("click", async () => {
    weekStart = startOfWeek(new Date());
    await refresh();
  });

  initGis();
})();
