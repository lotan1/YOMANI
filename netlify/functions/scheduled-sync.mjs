import {
  getState,
  saveState,
  applyBusySync,
  getCalendarClient,
  freeBusyForEmail,
  busyKeysFromRanges,
  INTERVIEWERS,
  WEEKS_AHEAD,
  startOfWeek,
  addDays,
  DAY_END,
} from "./_lib.mjs";

export default async () => {
  const calendar = await getCalendarClient();
  if (!calendar) {
    return new Response("no service account", { status: 200 });
  }

  const state = await getState();
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

  return new Response(JSON.stringify({ ok: true, lastSyncAt: state.lastSyncAt }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "@hourly",
};
