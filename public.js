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

  function setStatus(msg, isError = false) {
    el.status.textContent = msg || "";
    el.status.classList.toggle("error", !!isError);
  }

  function setBookStatus(msg, isError = false) {
    el.bookStatus.textContent = msg || "";
    el.bookStatus.classList.toggle("error", !!isError);
  }

  async function loadAvailability() {
    setStatus("טוען משבצות פנויות…");
    try {
      const res = await fetch("/api/availability");
      const data = await res.json();
      openMap = new Map((data.slots || []).map((s) => [s.slotKey, s.interviewers]));
      setStatus(
        !(data.slots || []).length
          ? "עדיין אין משבצות פתוחות — המנהלים צריכים לסנכרן יומן במסך הניהול."
          : data.lastSyncAt
            ? `עודכן לאחרונה: ${new Date(data.lastSyncAt).toLocaleString("he-IL")}`
            : "מוצגות המשבצות הפתוחות לתיאום."
      );
      render();
    } catch (err) {
      console.error(err);
      setStatus("לא הצלחנו לטעון זמינות. נסו לרענן.", true);
    }
  }

  function render() {
    el.weekLabel.textContent = S.weekLabel(weekStart);
    S.renderBoard(el.board, weekStart, (key, slotStart) => {
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
    if (!window.google?.accounts?.oauth2) {
      setTimeout(initGis, 150);
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: "https://www.googleapis.com/auth/calendar.freebusy",
      callback: async (resp) => {
        if (resp.error) {
          el.myCalStatus.textContent = "החיבור בוטל.";
          return;
        }
        myToken = resp.access_token;
        el.btnClearCal.hidden = false;
        el.myCalStatus.textContent = "מסמן משבצות שפנויות גם אצלכם…";
        await markMyFree();
      },
    });
  }

  async function markMyFree() {
    myFree = new Set();
    const keys = [...openMap.keys()];
    if (!keys.length || !myToken) {
      el.myCalStatus.textContent = "";
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

  el.btnMyCal.addEventListener("click", () => {
    if (!tokenClient) {
      el.myCalStatus.textContent = "Google עדיין נטען…";
      return;
    }
    tokenClient.requestAccessToken({ prompt: "" });
  });

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
  loadAvailability();
})();
