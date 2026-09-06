import { getStore } from "@netlify/blobs";

export const INTERVIEWERS = [
  { email: "lotan.br@gmail.com", name: "לוטן" },
  { email: "veredpisga@gmail.com", name: "ורד" },
];

export const SLOT_MINUTES = 15;
export const DAY_START = 9;
export const DAY_END = 21;
export const OPEN_WEEKDAYS = [0, 1, 2, 3, 4, 5];
export const TIMEZONE = "Asia/Jerusalem";
export const WEEKS_AHEAD = 2;

export function emptyState() {
  const interviewers = {};
  for (const i of INTERVIEWERS) {
    interviewers[i.email] = {
      name: i.name,
      /** slot keys closed manually */
      closed: [],
      /** slot keys force-opened while calendar was busy — cleared on sync if still busy */
      forceOpen: [],
      /** slot keys busy according to last calendar sync */
      busy: [],
      bookingCount: 0,
    };
  }
  return {
    interviewers,
    bookings: [],
    lastSyncAt: null,
    updatedAt: null,
  };
}

export async function getState() {
  const store = getStore("yomani");
  const raw = await store.get("state", { type: "json" });
  if (!raw) return emptyState();
  // ensure shape
  const base = emptyState();
  return {
    ...base,
    ...raw,
    interviewers: { ...base.interviewers, ...(raw.interviewers || {}) },
    bookings: raw.bookings || [],
  };
}

export async function saveState(state) {
  const store = getStore("yomani");
  state.updatedAt = new Date().toISOString();
  await store.setJSON("state", state);
  return state;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Yomani-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

export function corsOptions() {
  return json({ ok: true });
}

/** Build all slot start ISO keys (local Jerusalem wall-clock as YYYY-MM-DDTHH:mm) for upcoming window */
export function allSlotKeys(fromDate = new Date(), weeks = WEEKS_AHEAD) {
  const keys = [];
  const start = startOfWeek(fromDate);
  const days = weeks * 7;
  for (let d = 0; d < days; d++) {
    const day = addDays(start, d);
    if (!OPEN_WEEKDAYS.includes(day.getDay())) continue;
    const startMin = DAY_START * 60;
    const endMin = DAY_END * 60;
    for (let m = startMin; m < endMin; m += SLOT_MINUTES) {
      const slot = new Date(day);
      slot.setHours(0, 0, 0, 0);
      slot.setMinutes(m);
      if (slot.getTime() + SLOT_MINUTES * 60000 <= Date.now()) continue;
      keys.push(slotKey(slot));
    }
  }
  return keys;
}

export function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function slotKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseSlotKey(key) {
  const [datePart, timePart] = key.split("T");
  const [y, mo, da] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, 0, 0);
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * A slot is offerable by an interviewer if:
 * - not manually closed
 * - and (not busy OR in forceOpen)
 * Note: after sync, forceOpen entries that are still busy are removed (re-block).
 */
export function isOfferable(person, key) {
  if ((person.closed || []).includes(key)) return false;
  const busy = (person.busy || []).includes(key);
  const forced = (person.forceOpen || []).includes(key);
  if (busy && !forced) return false;
  return true;
}

/** Combined public slots: open if at least one interviewer can take it and not already booked.
 *  Before the first calendar sync, busy=[] so all schedule slots are offerable (calendar-free by default).
 */
export function publicOpenSlots(state) {
  const booked = new Set((state.bookings || []).map((b) => b.slotKey));
  const keys = allSlotKeys();
  const out = [];
  for (const key of keys) {
    if (booked.has(key)) continue;
    const who = INTERVIEWERS.filter((i) =>
      isOfferable(state.interviewers[i.email] || { closed: [], busy: [], forceOpen: [] }, key)
    ).map((i) => i.email);
    if (who.length) out.push({ slotKey: key, interviewers: who });
  }
  return out;
}

export function pickInterviewer(state, slotKey) {
  const candidates = INTERVIEWERS.filter((i) =>
    isOfferable(state.interviewers[i.email], slotKey)
  );
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0].email;
  candidates.sort(
    (a, b) =>
      (state.interviewers[a.email].bookingCount || 0) -
      (state.interviewers[b.email].bookingCount || 0)
  );
  return candidates[0].email;
}

export async function getCalendarClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const { google } = await import("googleapis");
  const creds = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

export async function freeBusyForEmail(calendar, email, timeMin, timeMax) {
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: TIMEZONE,
      items: [{ id: email }],
    },
  });
  return (res.data.calendars?.[email]?.busy || []).map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));
}

export function busyKeysFromRanges(ranges) {
  const keys = allSlotKeys();
  const busy = [];
  for (const key of keys) {
    const start = parseSlotKey(key);
    const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
    if (ranges.some((b) => overlaps(start, end, b.start, b.end))) busy.push(key);
  }
  return busy;
}

/**
 * Apply calendar busy sets: update busy[], drop forceOpen that are still busy (re-block).
 */
export function applyBusySync(state, busyByEmail) {
  for (const email of Object.keys(state.interviewers)) {
    const person = state.interviewers[email];
    const busy = busyByEmail[email] || [];
    person.busy = busy;
    const busySet = new Set(busy);
    person.forceOpen = (person.forceOpen || []).filter((k) => !busySet.has(k));
  }
  state.lastSyncAt = new Date().toISOString();
  return state;
}
