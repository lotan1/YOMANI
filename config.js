/** Shared client config — safe to expose (OAuth client ID is public). */
window.APP_CONFIG = {
  clientId: "295297360032-04c8fquht0sg4bhim5pvoc0lth1j27uj.apps.googleusercontent.com",
  publicUrl: "https://yomanmenahalimhonenoshi.netlify.app",
  adminPath: "/admin.html",
  interviewers: [
    { email: "lotan.br@gmail.com", name: "לוטן" },
    { email: "veredpisga@gmail.com", name: "ורד" },
  ],
  allowedEmails: ["lotan.br@gmail.com", "veredpisga@gmail.com"],
  slotMinutes: 15,
  dayStartHour: 9,
  dayEndHour: 21,
  openWeekdays: [0, 1, 2, 3, 4, 5],
  timezone: "Asia/Jerusalem",
  weeksAhead: 2,
};
