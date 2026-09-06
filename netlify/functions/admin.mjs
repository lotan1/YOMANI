import {
  getState,
  saveState,
  json,
  corsOptions,
  INTERVIEWERS,
  applyBusySync,
  getCalendarClient,
  freeBusyForEmail,
  busyKeysFromRanges,
  WEEKS_AHEAD,
  startOfWeek,
  addDays,
  DAY_END,
} from "./_lib.mjs";

async function readToken(req) {
  const fromHeader =
    header(req, "x-yomani-token") ||
    header(req, "authorization").replace(/^Bearer\s+/i, "").trim();
  if (fromHeader) return fromHeader;
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("access_token");
    if (q) return q;
  } catch {
    /* ignore */
  }
  return "";
}

function header(req, name) {
  try {
    if (req.headers && typeof req.headers.get === "function") {
      return (
        req.headers.get(name) ||
        req.headers.get(name.toLowerCase()) ||
        req.headers.get(name.toUpperCase()) ||
        ""
      );
    }
  } catch {
    /* ignore */
  }
  const h = req.headers || {};
  return h[name] || h[name.toLowerCase()] || "";
}

async function adminEmailFromAuth(req) {
  const token = await readToken(req);
  if (!token) return { email: "", reason: "missing_token" };

  // Prefer tokeninfo (query-based; reliable from serverless)
  try {
    const tip = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    );
    if (tip.ok) {
      const info = await tip.json();
      const email = String(info.email || "").toLowerCase();
      if (email) return { email, reason: "ok" };
    }
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { email: "", reason: `userinfo_${res.status}` };
    const me = await res.json();
    const email = String(me.email || "").toLowerCase();
    return email ? { email, reason: "ok" } : { email: "", reason: "no_email_in_token" };
  } catch {
    return { email: "", reason: "verify_failed" };
  }
}

function assertAdmin(email) {
  return INTERVIEWERS.some((i) => i.email === email);
}

export default async (req) => {
  if (req.method === "OPTIONS") return corsOptions();

  const { email, reason } = await adminEmailFromAuth(req);
  if (!assertAdmin(email)) {
    return json(
      {
        error: "unauthorized",
        detail: reason === "ok" ? "email_not_allowed" : reason,
      },
      401
    );
  }

  if (req.method === "GET") {
    const state = await getState();
    const counts = {};
    for (const i of INTERVIEWERS) {
      counts[i.email] = {
        name: i.name,
        total: state.interviewers[i.email]?.bookingCount || 0,
      };
    }
    return json({
      me: email,
      interviewers: state.interviewers,
      bookings: [...(state.bookings || [])].sort((a, b) =>
        a.slotKey < b.slotKey ? 1 : -1
      ),
      counts,
      lastSyncAt: state.lastSyncAt,
      updatedAt: state.updatedAt,
      hasServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const state = await getState();
  const action = body.action;

  if (action === "toggle") {
    const key = String(body.slotKey || "");
    const mode = body.mode; // "close" | "open" | "forceOpen"
    const person = state.interviewers[email];
    if (!person || !key) return json({ error: "bad request" }, 400);

    person.closed = person.closed || [];
    person.forceOpen = person.forceOpen || [];
    person.busy = person.busy || [];

    if (mode === "close") {
      if (!person.closed.includes(key)) person.closed.push(key);
      person.forceOpen = person.forceOpen.filter((k) => k !== key);
    } else if (mode === "open") {
      // reopen a manually closed free slot
      person.closed = person.closed.filter((k) => k !== key);
      person.forceOpen = person.forceOpen.filter((k) => k !== key);
    } else if (mode === "forceOpen") {
      // open even if calendar busy — until next sync still finds it busy
      person.closed = person.closed.filter((k) => k !== key);
      if (!person.forceOpen.includes(key)) person.forceOpen.push(key);
    } else {
      return json({ error: "unknown mode" }, 400);
    }

    await saveState(state);
    return json({ ok: true, person: state.interviewers[email] });
  }

  if (action === "pushBusy") {
    // Client-side freebusy push (works without service account)
    const busy = Array.isArray(body.busyKeys) ? body.busyKeys.map(String) : [];
    const busyByEmail = { [email]: busy };
    // only update this interviewer; keep others
    for (const i of INTERVIEWERS) {
      if (i.email !== email) {
        busyByEmail[i.email] = state.interviewers[i.email]?.busy || [];
      }
    }
    applyBusySync(state, busyByEmail);
    await saveState(state);
    return json({ ok: true, lastSyncAt: state.lastSyncAt, person: state.interviewers[email] });
  }

  if (action === "syncAll") {
    const calendar = await getCalendarClient();
    if (!calendar) {
      return json(
        { error: "חסר GOOGLE_SERVICE_ACCOUNT_JSON ב־Netlify" },
        400
      );
    }
    const from = startOfWeek(new Date());
    const to = addDays(from, WEEKS_AHEAD * 7);
    to.setHours(DAY_END, 0, 0, 0);
    const busyByEmail = {};
    for (const i of INTERVIEWERS) {
      const ranges = await freeBusyForEmail(calendar, i.email, from, to);
      busyByEmail[i.email] = busyKeysFromRanges(ranges);
    }
    applyBusySync(state, busyByEmail);
    await saveState(state);
    return json({ ok: true, lastSyncAt: state.lastSyncAt });
  }

  return json({ error: "unknown action" }, 400);
};

export const config = { path: "/api/admin" };
