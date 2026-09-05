(() => {
  const S = window.YomaniShared;
  const cfg = window.APP_CONFIG;

  const el = {
    gate: document.getElementById("gate"),
    app: document.getElementById("app"),
    btnSignIn: document.getElementById("btnSignIn"),
    btnSignOut: document.getElementById("btnSignOut"),
    userChip: document.getElementById("userChip"),
    userEmail: document.getElementById("userEmail"),
    board: document.getElementById("board"),
    weekLabel: document.getElementById("weekLabel"),
    status: document.getElementById("status"),
    statRow: document.getElementById("statRow"),
    syncMeta: document.getElementById("syncMeta"),
    bookingsTable: document.querySelector("#bookingsTable tbody"),
    btnPushBusy: document.getElementById("btnPushBusy"),
    btnSyncAll: document.getElementById("btnSyncAll"),
    btnReload: document.getElementById("btnReload"),
  };

  let tokenClient = null;
  let accessToken = null;
  let userEmail = null;
  let weekStart = S.startOfWeek(new Date());
  let person = null;
  let bookedKeys = new Set();

  function setStatus(msg, isError = false) {
    el.status.textContent = msg || "";
    el.status.classList.toggle("error", !!isError);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function showIn() {
    el.gate.hidden = true;
    el.app.hidden = false;
    el.btnSignIn.hidden = true;
    el.userChip.hidden = false;
    el.userEmail.textContent = userEmail;
  }

  function showOut(msg) {
    accessToken = null;
    userEmail = null;
    el.gate.hidden = false;
    el.app.hidden = true;
    el.btnSignIn.hidden = false;
    el.userChip.hidden = true;
    if (msg) setStatus(msg, true);
  }

  async function reload() {
    const data = await api("/api/admin");
    person = data.interviewers[userEmail];
    bookedKeys = new Set((data.bookings || []).map((b) => b.slotKey));

    el.statRow.innerHTML = Object.entries(data.counts || {})
      .map(
        ([email, c]) =>
          `<div class="stat"><strong>${c.name}</strong><span>${c.total} ראיונות</span><small>${email}</small></div>`
      )
      .join("");

    el.syncMeta.textContent = [
      data.lastSyncAt
        ? `סנכרון אחרון: ${new Date(data.lastSyncAt).toLocaleString("he-IL")}`
        : "עדיין לא סונכרן מול היומנים",
      data.hasServiceAccount ? "חשבון שירות מוגדר" : "אין חשבון שירות — סנכרנו ידנית מהיומן שלכם",
    ].join(" · ");

    el.bookingsTable.innerHTML = (data.bookings || [])
      .map((b) => {
        const when = S.parseSlotKey(b.slotKey).toLocaleString("he-IL");
        return `<tr><td>${when}</td><td>${escapeHtml(b.name)}</td><td>${escapeHtml(
          b.email
        )}</td><td>${escapeHtml(b.interviewerName)}</td></tr>`;
      })
      .join("");

    renderBoard();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slotState(key) {
    if (!person) return "muted";
    if (bookedKeys.has(key)) return "booked";
    const closed = (person.closed || []).includes(key);
    const busy = (person.busy || []).includes(key);
    const forced = (person.forceOpen || []).includes(key);
    if (closed) return "closed";
    if (busy && forced) return "force";
    if (busy) return "busy";
    return "open";
  }

  function renderBoard() {
    el.weekLabel.textContent = S.weekLabel(weekStart);
    S.renderBoard(el.board, weekStart, (key, slotStart) => {
      const st = slotState(key);
      const labels = {
        open: "פתוח",
        closed: "סגור",
        busy: "תפוס",
        force: "נפתח",
        booked: "נרשם",
        muted: "—",
      };
      const past = slotStart.getTime() + cfg.slotMinutes * 60000 <= Date.now();
      if (past) {
        return { className: "past", label: "—", disabled: true };
      }
      if (st === "booked") {
        return { className: "booked", label: "נרשם", disabled: true, title: "כבר נקבעה פגישה" };
      }

      return {
        className: st,
        label: labels[st] || "—",
        title: slotStart.toLocaleString("he-IL"),
        disabled: false,
        onClick: () => onToggle(key, st),
      };
    });
  }

  async function onToggle(key, st) {
    try {
      let mode;
      if (st === "open" || st === "force") mode = "close";
      else if (st === "closed") mode = "open";
      else if (st === "busy") mode = "forceOpen";
      else return;

      setStatus("מעדכן…");
      const data = await api("/api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "toggle", slotKey: key, mode }),
      });
      person = data.person;
      setStatus("עודכן.");
      renderBoard();
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  async function pushMyBusy() {
    setStatus("קורא FreeBusy מהיומן שלך…");
    const days = [];
    let cursor = S.startOfWeek(new Date());
    for (let w = 0; w < (cfg.weeksAhead || 2); w++) {
      for (const wd of cfg.openWeekdays) days.push(S.addDays(cursor, wd + w * 7));
    }
    const timeMin = new Date(days[0]);
    timeMin.setHours(cfg.dayStartHour, 0, 0, 0);
    const timeMax = new Date(days[days.length - 1]);
    timeMax.setHours(cfg.dayEndHour, 0, 0, 0);

    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: cfg.timezone,
        items: [{ id: "primary" }],
      }),
    });
    if (!res.ok) throw new Error("FreeBusy נכשל");
    const fb = await res.json();
    const busyRanges = (fb.calendars?.primary?.busy || []).map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }));

    const busyKeys = [];
    for (const day of days) {
      S.eachSlot(day, (slotStart) => {
        const end = new Date(slotStart.getTime() + cfg.slotMinutes * 60000);
        if (end <= new Date()) return;
        const key = S.slotKey(slotStart);
        if (busyRanges.some((b) => S.overlaps(slotStart, end, b.start, b.end))) {
          busyKeys.push(key);
        }
      });
    }

    const data = await api("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "pushBusy", busyKeys }),
    });
    person = data.person;
    setStatus(`סונכרן. ${busyKeys.length} משבצות תפוסות מהיומן.`);
    await reload();
  }

  async function afterLogin() {
    const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((r) => r.json());
    const email = (me.email || "").toLowerCase();
    if (!cfg.allowedEmails.map((e) => e.toLowerCase()).includes(email)) {
      showOut("החשבון לא מורשה.");
      return;
    }
    userEmail = email;
    showIn();
    await reload();
    try {
      await pushMyBusy();
    } catch (err) {
      console.warn(err);
      setStatus("התחברתם, אך סנכרון היומן נכשל — נסו שוב.", true);
    }
  }

  function initGis() {
    if (!window.google?.accounts?.oauth2) {
      setTimeout(initGis, 150);
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: [
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" "),
      callback: (resp) => {
        if (resp.error) {
          setStatus("ההתחברות נכשלה.", true);
          return;
        }
        accessToken = resp.access_token;
        afterLogin().catch((e) => setStatus(e.message, true));
      },
    });
  }

  el.btnSignIn.addEventListener("click", () => {
    tokenClient?.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });
  el.btnSignOut.addEventListener("click", () => showOut(""));
  el.btnReload.addEventListener("click", () => reload().catch((e) => setStatus(e.message, true)));
  el.btnPushBusy.addEventListener("click", () =>
    pushMyBusy().catch((e) => setStatus(e.message, true))
  );
  el.btnSyncAll.addEventListener("click", () =>
    api("/api/admin", { method: "POST", body: JSON.stringify({ action: "syncAll" }) })
      .then(() => reload())
      .then(() => setStatus("סנכרון שרת הושלם."))
      .catch((e) => setStatus(e.message, true))
  );
  el.btnPrevWeek.addEventListener("click", () => {
    weekStart = S.addDays(weekStart, -7);
    renderBoard();
  });
  el.btnNextWeek.addEventListener("click", () => {
    weekStart = S.addDays(weekStart, 7);
    renderBoard();
  });
  el.btnThisWeek.addEventListener("click", () => {
    weekStart = S.startOfWeek(new Date());
    renderBoard();
  });

  // Auto-refresh board data hourly while admin page is open
  setInterval(() => {
    if (accessToken) {
      reload().catch(() => {});
    }
  }, 60 * 60 * 1000);

  initGis();
})();
