import {
  getState,
  saveState,
  json,
  corsOptions,
  pickInterviewer,
  isOfferable,
  parseSlotKey,
  SLOT_MINUTES,
  TIMEZONE,
  INTERVIEWERS,
  getCalendarClient,
} from "./_lib.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return corsOptions();
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const slotKey = String(body.slotKey || "").trim();

  if (!name || !email || !slotKey || !email.includes("@")) {
    return json({ error: "נא למלא שם, אימייל ומשבצת" }, 400);
  }

  const state = await getState();
  if ((state.bookings || []).some((b) => b.slotKey === slotKey)) {
    return json({ error: "המשבצת כבר תפוסה. בחרו שעה אחרת." }, 409);
  }

  const assignee = pickInterviewer(state, slotKey);
  if (!assignee || !isOfferable(state.interviewers[assignee], slotKey)) {
    return json({ error: "המשבצת אינה זמינה יותר." }, 409);
  }

  const start = parseSlotKey(slotKey);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
  const interviewer = INTERVIEWERS.find((i) => i.email === assignee);

  let eventId = null;
  let meetLink = null;
  const calendar = await getCalendarClient();
  if (calendar) {
    try {
      const created = await calendar.events.insert({
        calendarId: assignee,
        conferenceDataVersion: 1,
        sendUpdates: "all",
        requestBody: {
          summary: `ריאיון — ${name}`,
          description: `ריאיון עם ${interviewer?.name || assignee}\nנרשם/ה: ${name} <${email}>`,
          start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
          end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
          attendees: [
            { email: assignee },
            { email, displayName: name },
          ],
          transparency: "opaque",
          status: "confirmed",
          conferenceData: {
            createRequest: {
              requestId: `yomani-${slotKey}-${Date.now()}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        },
      });
      eventId = created.data.id;
      meetLink =
        created.data.hangoutLink ||
        created.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
          ?.uri ||
        null;
    } catch (err) {
      console.error("calendar insert failed", err);
      return json(
        {
          error:
            "שמירת הפגישה ביומן נכשלה. ודאו שחשבון השירות משותף ליומנים עם הרשאת עריכה.",
        },
        502
      );
    }
  }

  const booking = {
    id: `b_${Date.now()}`,
    slotKey,
    name,
    email,
    interviewerEmail: assignee,
    interviewerName: interviewer?.name || assignee,
    eventId,
    meetLink,
    createdAt: new Date().toISOString(),
    calendarSynced: !!eventId,
  };

  state.bookings.push(booking);
  state.interviewers[assignee].bookingCount =
    (state.interviewers[assignee].bookingCount || 0) + 1;
  // block this slot for everyone by treating as booked (publicOpenSlots already excludes bookings)
  await saveState(state);

  return json({
    ok: true,
    booking: {
      slotKey,
      interviewerName: booking.interviewerName,
      meetLink,
      calendarSynced: booking.calendarSynced,
    },
  });
};

export const config = { path: "/api/book" };
