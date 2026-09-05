/** Google Cloud OAuth Web Client ID — paste yours after setup (see README). */
window.APP_CONFIG = {
  // Create at https://console.cloud.google.com/apis/credentials
  // Enable "Google Calendar API", type: OAuth client → Web application
  clientId: "295297360032-04c8fquht0sg4bhim5pvoc0lth1j27uj.apps.googleusercontent.com",
  allowedEmails: ["lotan.br@gmail.com", "veredpisga@gmail.com"],
  slotMinutes: 15,
  dayStartHour: 9,
  dayEndHour: 21,
  // Sunday=0 … Friday=5 (Saturday closed)
  openWeekdays: [0, 1, 2, 3, 4, 5],
  blockEventPrefix: "⛔ ראיון חסום",
  timezone: "Asia/Jerusalem",
};
