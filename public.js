(() => {
  const S = window.YomaniShared;
  const cfg = window.APP_CONFIG;

  const el = {
    board: document.getElementById("board"),
    weekLabel: document.getElementById("weekLabel"),
    status: document.getElementById("status"),
    selectedLabel: document.getElementById("selectedLabel"),
    bookForm: document.getElementById("bookForm"),
    btnBook: document.getElementById("btnBook"),
    bookStatus: document.getElementById("bookStatus"),
    btnMyCal: document.getElementById("btnMyCal"),
    btnClearCal: document.getElementById("btnClearCal"),
    myCalStatus: document.getElementById("myCalStatus"),
  };

  let weekStart = S.startOfWeek(new Date());
  /** @type {Map<string, string[]>} */
  let openMap = new Map();
  /** @type {Set<string>} */
  let myFree = new Set();
  let selected = null;
  let tokenClient = null;
  let myToken = null;
  let pendingMyCal = false;
  let gisAttempts = 0;

  function setStatus(msg, isError = false) {
    el.status.textContent = msg || "";
    el.status.classList.toggle("error", !!isError);
  }

  function setBookStatus(msg, isError = false) {
    el.bookStatus.textContent = msg || "";
    el.bookStatus.classList.toggle("error", !!isError);
  }

  function requestMyCal() {
    if (!tokenClient) {
      pendingMyCal = true;
      el.myCalStatus.textContent = "Google עדיין נטען… מנסה שוב אוטומטית.";
      ensureGis();
      return;
    }
    pendingMyCal = false;
    el.myCalStatus.textContent = "נפתח חלון התחברות Google…";
    try {
      tokenClient.requestAccessToken({ prompt: "consent" });
    } catch (err) {
      console.error(err);
      el.myCalStatus.textContent = "לא הצלחנו לפתוח את Google. רעננו את הדף.";
    }
  }

  function ensureGis() {
    if (tokenClient) return;
    initGis();
  }

  async function loadAvailability() {
    setStatus("טוען משבצות פנויות…");
    try {
      const res = await fetch("/api/availability");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      openMap = new Map((data.slots || []).map((s) => [s.slotKey, s.interviewers]));
      const n = openMap.size;
      setStatus(
        n
          ? `${n} משבצות פתוחות` +
              (data.lastSyncAt
                ? ` · עודכן ${new Date(data.lastSyncAt).toLocaleString("he-IL")}`
                : " · טרם סונכרן יומן (מוצג לוח ברירת מחדל)")
          : "אין משבצות פתוחות בטווח הנוכחי."
      );
    } catch (err) {
      console.error(err);
      openMap = new Map();
      setStatus("לא הצלחנו לטעון זמינות מהשרת. מוצג לוח ריק — נסו לרענן.", true);
    }
    render();
  }

  function render() {
    if (!el.board || !el.weekLabel) return;
    el.weekLabel.textContent = S.weekLabel(weekStart);
    S.renderBoard(el.board, weekStart, (key, slotStart) => {
      const past = slotStart.getTime() + cfg.slotMinutes * 60000 <= Date.now();
      if (past) {
        return { className: "past", label: "—", disabled: true, title: "עבר" };
      }
      const open = openMap.has(key);
      if (!open) {
        return { className: "muted", label: "—", disabled: true, title: "לא זמין" };
      }
      const mine = myFree.has(key);
      const isSel = selected === key;
      let className = "open";
      if (mine) className += " glow";
      if (isSel) className += " selected";
      return {
        className,
        label: isSel ? "נבחר" : mine ? "מתאים" : "פנוי",
        title: slotStart.toLocaleString("he-IL"),
        disabled: false,
        onClick: (k) => {
          selected = k;
          el.selectedLabel.textContent = `נבחר: ${S.parseSlotKey(k).toLocaleString("he-IL")}`;
          el.btnBook.disabled = false;
          render();
        },
      };
    });
  }

  el.bookForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(el.bookForm);
    el.btnBook.disabled = true;
    setBookStatus("שומרים את ההזמנה…");
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          email: fd.get("email"),
          slotKey: selected,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setBookStatus(
        data.booking.calendarSynced
          ? `נקבע מול ${data.booking.interviewerName}. נשלח זימון לאימייל שלכם.`
          : `נרשמתם מול ${data.booking.interviewerName}. הזימון ליומן יושלם לאחר הגדרת חיבור היומנים בשרת.`
      );
      selected = null;
      el.btnBook.disabled = true;
      el.selectedLabel.textContent = "ההזמנה נקלטה.";
      await loadAvailability();
    } catch (err) {
      setBookStatus(err.message || "שגיאה בהזמנה", true);
      el.btnBook.disabled = false;
    }
  });

  function initGis() {
    if (tokenClient) {
      if (pendingMyCal) requestMyCal();
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      gisAttempts += 1;
      if (gisAttempts > 80) {
        el.myCalStatus.textContent =
          "Google לא נטען. בדקו חוסם פרסומות / רשת, או רעננו. ודאו ש־origin רשום ב־Google Cloud.";
        pendingMyCal = false;
        return;
      }
      setTimeout(initGis, 150);
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: "https://www.googleapis.com/auth/calendar.freebusy",
      callback: async (resp) => {
        if (resp.error) {
          el.myCalStatus.textContent =
            resp.error === "popup_closed_by_user"
              ? "החלון נסגר — נסו שוב."
              : `החיבור נכשל (${resp.error}).`;
          return;
        }
        myToken = resp.access_token;
        el.btnClearCal.hidden = false;
        el.myCalStatus.textContent = "מסמן משבצות שפנויות גם אצלכם…";
        await markMyFree();
      },
      error_callback: (err) => {
        console.error(err);
        el.myCalStatus.textContent =
          "שגיאת Google (לעיתים origin_mismatch). הוסיפו את כתובת האתר ל־Authorized JavaScript origins.";
      },
    });
    if (pendingMyCal) requestMyCal();
  }

  async function markMyFree() {
    myFree = new Set();
    const keys = [...openMap.keys()];
    if (!myToken) {
      el.myCalStatus.textContent = "";
      render();
      return;
    }
    if (!keys.length) {
      el.myCalStatus.textContent =
        "היומן חובר, אבל אין עדיין משבצות פתוחות אצלנו לסמן מולן. אחרי סנכרון במסך הניהול זה יופיע.";
      render();
      return;
    }
    keys.sort();
    const timeMin = S.parseSlotKey(keys[0]);
    const last = S.parseSlotKey(keys[keys.length - 1]);
    const timeMax = new Date(last.getTime() + cfg.slotMinutes * 60000);

    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${myToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: cfg.timezone,
        items: [{ id: "primary" }],
      }),
    });
    if (!res.ok) {
      el.myCalStatus.textContent = "לא הצלחנו לקרוא את היומן שלכם.";
      return;
    }
    const data = await res.json();
    const busy = (data.calendars?.primary?.busy || []).map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }));

    for (const key of keys) {
      const start = S.parseSlotKey(key);
      const end = new Date(start.getTime() + cfg.slotMinutes * 60000);
      const blocked = busy.some((b) => S.overlaps(start, end, b.start, b.end));
      if (!blocked) myFree.add(key);
    }
    el.myCalStatus.textContent = `סומנו ${myFree.size} משבצות שפנויות גם אצלכם.`;
    render();
  }

  el.btnMyCal.addEventListener("click", () => requestMyCal());

  el.btnClearCal.addEventListener("click", () => {
    myFree = new Set();
    el.btnClearCal.hidden = true;
    el.myCalStatus.textContent = "";
    render();
  });

  el.btnPrevWeek.addEventListener("click", () => {
    weekStart = S.addDays(weekStart, -7);
    render();
  });
  el.btnNextWeek.addEventListener("click", () => {
    weekStart = S.addDays(weekStart, 7);
    render();
  });
  el.btnThisWeek.addEventListener("click", () => {
    weekStart = S.startOfWeek(new Date());
    render();
  });

  initGis();
  render();
  loadAvailability();

  window.__gisReady = () => {
    gisAttempts = 0;
    initGis();
  };
  window.__gisFailed = () => {
    el.myCalStatus.textContent =
      "טעינת Google נחסמה. בדקו חוסם פרסומות או נסו דפדפן אחר.";
    pendingMyCal = false;
  };
})();
