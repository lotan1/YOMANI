window.YomaniShared = (() => {
  const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];

  function cfg() {
    return window.APP_CONFIG;
  }

  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
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

  function slotKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseSlotKey(key) {
    const [datePart, timePart] = key.split("T");
    const [y, mo, da] = datePart.split("-").map(Number);
    const [h, mi] = timePart.split(":").map(Number);
    return new Date(y, mo - 1, da, h, mi, 0, 0);
  }

  function weekDays(weekStart) {
    return cfg().openWeekdays.map((wd) => addDays(weekStart, wd));
  }

  function eachSlot(dayDate, fn) {
    const c = cfg();
    const startMin = c.dayStartHour * 60;
    const endMin = c.dayEndHour * 60;
    for (let m = startMin; m < endMin; m += c.slotMinutes) {
      const d = new Date(dayDate);
      d.setHours(0, 0, 0, 0);
      d.setMinutes(m);
      fn(d, Math.floor(m / 60), m % 60);
    }
  }

  function weekLabel(weekStart) {
    const end = addDays(weekStart, 5);
    return `${weekStart.toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
    })} – ${end.toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  }

  /**
   * Render weekly board.
   * getCell(key) -> { className, label, title, disabled, onClick }
   */
  function renderBoard(container, weekStart, getCell) {
    const days = weekDays(weekStart);
    const frag = document.createDocumentFragment();

    const corner = document.createElement("div");
    corner.className = "cell corner";
    corner.textContent = "שעה";
    frag.appendChild(corner);

    for (const day of days) {
      const head = document.createElement("div");
      head.className = "cell head";
      head.innerHTML = `${DAY_NAMES[day.getDay()]}<br /><span class="head-date">${day.toLocaleDateString(
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
        const info = getCell(key, slotStart) || {
          className: "muted",
          label: "—",
          disabled: true,
        };

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `cell slot ${info.className || ""}`;
        btn.dataset.key = key;
        btn.textContent = info.label || "";
        btn.title = info.title || "";
        if (info.disabled) btn.disabled = true;
        if (info.onClick && !info.disabled) {
          btn.addEventListener("click", () => info.onClick(key, btn));
        }
        frag.appendChild(btn);
      }
    }

    container.replaceChildren(frag);
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
  }

  return {
    DAY_NAMES,
    startOfWeek,
    addDays,
    pad,
    formatTime,
    slotKey,
    parseSlotKey,
    weekDays,
    eachSlot,
    weekLabel,
    renderBoard,
    overlaps,
  };
})();
