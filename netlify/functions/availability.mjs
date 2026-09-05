import {
  getState,
  json,
  corsOptions,
  publicOpenSlots,
  INTERVIEWERS,
} from "./_lib.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return corsOptions();
  if (req.method !== "GET") return json({ error: "method" }, 405);

  const state = await getState();
  return json({
    slots: publicOpenSlots(state),
    interviewers: INTERVIEWERS,
    lastSyncAt: state.lastSyncAt,
    updatedAt: state.updatedAt,
  });
};

export const config = { path: "/api/availability" };
