/**
 * RENDEVO — Psychologie
 * Google Apps Script backend
 * Timezone: Africa/Algiers
 *
 * Script Properties:
 * SPREADSHEET_ID (required)
 * ADMIN_EMAIL (required)
 * CLINIC_NAME (optional)
 * CALENDAR_ID (optional; defaults to the account's primary calendar)
 */

const TZ = "Africa/Algiers";
const APPOINTMENT_HEADERS = [
  "Reference", "Cancellation Token", "Service", "Date", "Time",
  "Duration Minutes", "Patient Name", "Phone", "Email", "Status",
  "Created At", "Calendar Event ID", "Reminder Sent At", "Cancelled At"
];
const SETTINGS_DEFAULTS = [
  ["OPEN_TIME", "09:00"],
  ["CLOSE_TIME", "17:00"],
  ["WORKING_DAYS", "1,2,3,4,5,6"],
  ["SLOT_STEP_MINUTES", "30"],
  ["BUFFER_MINUTES", "10"],
  ["ADVANCE_DAYS", "90"]
];
const SERVICES = {
  "Première consultation": 60,
  "Consultation de suivi": 50,
  "Gestion du stress": 50,
  "Soutien émotionnel": 50,
  "Consultation adolescent": 50,
  "Consultation parentale": 50,
  "Consultation de couple": 60,
  "Autre motif": 50
};

function setup() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Ajoutez d'abord la propriété de script SPREADSHEET_ID.");
  if (!adminEmail_()) throw new Error("Ajoutez la propriété de script ADMIN_EMAIL avant l'initialisation.");
  const ss = SpreadsheetApp.openById(id);
  ensureSheet_(ss, "Appointments", APPOINTMENT_HEADERS);
  ensureSheet_(ss, "Settings", ["Key", "Value"]);
  ensureSheet_(ss, "AuditLog", ["Timestamp", "Action", "Reference", "Details"]);
  const settings = ss.getSheetByName("Settings");
  const existing = settings.getLastRow() > 1
    ? settings.getRange(2, 1, settings.getLastRow() - 1, 2).getValues()
    : [];
  const keys = existing.map(r => String(r[0]));
  SETTINGS_DEFAULTS.forEach(r => {
    if (keys.indexOf(r[0]) === -1) settings.appendRow(r);
  });
  settings.setFrozenRows(1);
  settings.autoResizeColumns(1, 2);
  ensureReminderTrigger_();
  audit_("SETUP", "", "Psychology booking system initialized");
  return "RENDEVO Psychologie prêt. Onglets créés et rappel horaire installé.";
}

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  if (p.action === "cancel") return cancelFromLink_(p.reference, p.token);
  return json_({
    success: true,
    service: "RENDEVO Psychologie",
    message: "Le service de réservation est disponible."
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    if (body.action === "availability") {
      return json_({
        success: true,
        availableSlots: getAvailableSlots_(body.preferredDate, body.service),
        message: "Créneaux disponibles au moment de la vérification."
      });
    }
    return json_(createAppointment_(body));
  } catch (err) {
    return json_({ success: false, message: err && err.message ? err.message : "Une erreur est survenue." });
  }
}

function createAppointment_(data) {
  validateBooking_(data);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const slots = getAvailableSlots_(data.preferredDate, data.service);
    if (slots.indexOf(data.preferredTime) === -1) {
      throw new Error("Ce créneau vient d'être pris ou n'est plus disponible. Choisissez une autre heure.");
    }

    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("Appointments");
    const reference = "PSY-" + Utilities.formatDate(new Date(), TZ, "yyMMdd-HHmmss") +
      "-" + Math.floor(100 + Math.random() * 900);
    const token = Utilities.getUuid().replace(/-/g, "");
    const duration = SERVICES[data.service];
    const created = new Date();
    const start = parseLocalDateTime_(data.preferredDate, data.preferredTime);
    const end = new Date(start.getTime() + duration * 60000);
    const clinic = clinicName_();
    const event = createCalendarEvent_(clinic, data, reference, start, end);

    sheet.appendRow([
      reference, token, data.service, data.preferredDate, data.preferredTime,
      duration, data.fullName, data.phone, data.email, "CONFIRMED",
      created, event ? event.getId() : "", "", ""
    ]);
    audit_("BOOKED", reference, data.service + " " + data.preferredDate + " " + data.preferredTime);

    const cancelUrl = ScriptApp.getService().getUrl() +
      "?action=cancel&reference=" + encodeURIComponent(reference) +
      "&token=" + encodeURIComponent(token);
    sendBookingEmails_(data, reference, cancelUrl, start, duration);

    return {
      success: true,
      reference: reference,
      status: "CONFIRMED",
      message: "Votre rendez-vous est confirmé. Un e-mail récapitulatif vous a été envoyé si vous avez indiqué une adresse valide."
    };
  } finally {
    lock.releaseLock();
  }
}

function validateBooking_(d) {
  if (!d || d.privacyConsent !== true) throw new Error("Veuillez accepter le traitement de vos informations.");
  if (!Object.prototype.hasOwnProperty.call(SERVICES, d.service)) throw new Error("Veuillez choisir un motif de consultation valide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.preferredDate || ""))) throw new Error("Date invalide.");
  if (!/^\d{2}:\d{2}$/.test(String(d.preferredTime || ""))) throw new Error("Horaire invalide.");
  if (String(d.fullName || "").trim().length < 2 || String(d.fullName).length > 100) throw new Error("Nom invalide.");
  const digits = String(d.phone || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("Numéro de téléphone invalide.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email || ""))) throw new Error("Adresse e-mail invalide.");
  if (String(d.notes || "").length > 1000) throw new Error("Message trop long.");
}

function getAvailableSlots_(dateString, service) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ""))) return [];
  if (!Object.prototype.hasOwnProperty.call(SERVICES, service)) return [];
  const date = new Date(dateString + "T12:00:00");
  if (isNaN(date.getTime()) || Utilities.formatDate(date, TZ, "yyyy-MM-dd") !== dateString) return [];
  const today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + Number(setting_("ADVANCE_DAYS", 90)));
  if (dateString < today || date.getTime() > maxDate.getTime()) return [];

  const day = Number(Utilities.formatDate(date, TZ, "u")) % 7;
  const workingDays = setting_("WORKING_DAYS", "1,2,3,4,5,6").split(",").map(Number);
  if (workingDays.indexOf(day) === -1) return [];

  const open = minutes_(setting_("OPEN_TIME", "09:00"));
  const close = minutes_(setting_("CLOSE_TIME", "17:00"));
  const duration = SERVICES[service];
  const step = Math.max(10, Number(setting_("SLOT_STEP_MINUTES", 30)));
  const buffer = Math.max(0, Number(setting_("BUFFER_MINUTES", 10)));
  const booked = getBookedIntervals_(dateString);
  const calendarEvents = getCalendarIntervals_(dateString);
  const intervals = booked.concat(calendarEvents);
  const slots = [];
  const now = new Date();

  for (let start = open; start + duration <= close; start += step) {
    const end = start + duration + buffer;
    const slotDate = parseLocalDateTime_(dateString, timeString_(start));
    if (slotDate.getTime() <= now.getTime()) continue;
    const conflict = intervals.some(x => start < x.end && end > x.start);
    if (!conflict) slots.push(timeString_(start));
  }
  return slots;
}

function getBookedIntervals_(dateString) {
  const sheet = getSpreadsheet_().getSheetByName("Appointments");
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPOINTMENT_HEADERS.length).getValues();
  return values.filter(r => String(r[3]) === dateString && String(r[9]) === "CONFIRMED")
    .map(r => {
      const start = minutes_(String(r[4]));
      return { start: start, end: start + Number(r[5] || 50) + Number(setting_("BUFFER_MINUTES", 10)) };
    });
}

function getCalendarIntervals_(dateString) {
  try {
    const cal = calendar_();
    if (!cal) return [];
    const start = parseLocalDateTime_(dateString, "00:00");
    const end = new Date(start.getTime() + 24 * 60 * 60000);
    return cal.getEvents(start, end).map(ev => {
      const a = Number(Utilities.formatDate(ev.getStartTime(), TZ, "H")) * 60 +
        Number(Utilities.formatDate(ev.getStartTime(), TZ, "m"));
      const b = Number(Utilities.formatDate(ev.getEndTime(), TZ, "H")) * 60 +
        Number(Utilities.formatDate(ev.getEndTime(), TZ, "m"));
      return { start: a, end: b };
    });
  } catch (e) {
    return [];
  }
}

function createCalendarEvent_(clinic, data, reference, start, end) {
  const cal = calendar_();
  if (!cal) return null;
  const title = "Consultation — " + data.fullName + " (" + reference + ")";
  const description = "RENDEVO — " + clinic + "\nMotif : " + data.service +
    "\nTéléphone : " + data.phone + "\nRéférence : " + reference +
    "\n\nNe pas ajouter de notes cliniques dans cet événement.";
  return cal.createEvent(title, start, end, { description: description, guests: data.email, sendInvites: false });
}

function sendBookingEmails_(data, reference, cancelUrl, start, duration) {
  const admin = adminEmail_();
  const dateLabel = Utilities.formatDate(start, TZ, "EEEE d MMMM yyyy");
  const timeLabel = Utilities.formatDate(start, TZ, "HH:mm");
  const clinic = clinicName_();
  const patientBody = "Bonjour " + data.fullName + ",\n\nVotre rendez-vous est confirmé.\n" +
    "Cabinet : " + clinic + "\nMotif : " + data.service + "\nDate : " + dateLabel +
    "\nHeure : " + timeLabel + "\nDurée prévue : " + duration + " minutes\nRéférence : " + reference +
    "\n\nPour annuler ce rendez-vous, ouvrez ce lien :\n" + cancelUrl +
    "\n\nSi vous n'êtes pas à l'origine de cette demande, contactez directement le cabinet.";
  if (data.email) {
    try { MailApp.sendEmail(data.email, "Confirmation de rendez-vous — " + clinic, patientBody); }
    catch (e) { audit_("PATIENT_EMAIL_ERROR", reference, String(e)); }
  }
  if (admin) {
    const adminBody = "Nouveau rendez-vous confirmé.\nPatient : " + data.fullName +
      "\nTéléphone : " + data.phone + "\nE-mail : " + data.email +
      "\nMotif : " + data.service + "\nDate : " + dateLabel + "\nHeure : " + timeLabel +
      "\nRéférence : " + reference + "\nAnnulation : " + cancelUrl;
    try { MailApp.sendEmail(admin, "Nouveau rendez-vous — " + reference, adminBody); }
    catch (e) { audit_("ADMIN_EMAIL_ERROR", reference, String(e)); }
  }
}

function cancelFromLink_(reference, token) {
  if (!reference || !token) return html_("Lien d’annulation invalide.");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSpreadsheet_().getSheetByName("Appointments");
    if (!sheet || sheet.getLastRow() < 2) return html_("Rendez-vous introuvable.");
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPOINTMENT_HEADERS.length).getValues();
    const index = values.findIndex(r => String(r[0]) === String(reference) && String(r[1]) === String(token));
    if (index < 0) return html_("Lien invalide ou rendez-vous introuvable.");
    const rowNumber = index + 2;
    const row = values[index];
    if (String(row[9]) === "CANCELLED") return html_("Ce rendez-vous a déjà été annulé.");
    if (String(row[9]) !== "CONFIRMED") return html_("Ce rendez-vous ne peut pas être annulé depuis ce lien.");
    sheet.getRange(rowNumber, 10).setValue("CANCELLED");
    sheet.getRange(rowNumber, 14).setValue(new Date());
    if (row[11]) {
      try { const ev = calendar_().getEventById(String(row[11])); if (ev) ev.deleteEvent(); } catch (e) {}
    }
    audit_("CANCELLED", reference, "Patient cancellation link");
    const clinic = clinicName_();
    const dateLabel = String(row[3]) + " à " + String(row[4]);
    if (row[8]) {
      try { MailApp.sendEmail(String(row[8]), "Annulation confirmée — " + clinic,
        "Votre rendez-vous du " + dateLabel + " a été annulé.\nRéférence : " + reference); }
      catch (e) { audit_("CANCELLATION_EMAIL_ERROR", reference, String(e)); }
    }
    if (adminEmail_()) {
      try { MailApp.sendEmail(adminEmail_(), "Rendez-vous annulé — " + reference,
        "Le rendez-vous de " + row[6] + " du " + dateLabel + " a été annulé par le lien patient."); }
      catch (e) { audit_("CANCELLATION_ADMIN_EMAIL_ERROR", reference, String(e)); }
    }
    return html_("Votre rendez-vous a bien été annulé. Le cabinet a été informé.");
  } finally {
    lock.releaseLock();
  }
}

function sendDueReminders() {
  const sheet = getSpreadsheet_().getSheetByName("Appointments");
  if (!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPOINTMENT_HEADERS.length).getValues();
  const now = new Date();
  values.forEach((r, i) => {
    if (String(r[9]) !== "CONFIRMED" || r[12]) return;
    const start = parseLocalDateTime_(String(r[3]), String(r[4]));
    const hours = (start.getTime() - now.getTime()) / 3600000;
    if (hours <= 24 && hours > 0) {
      const dateLabel = Utilities.formatDate(start, TZ, "EEEE d MMMM yyyy");
      const clinic = clinicName_();
      const body = "Bonjour " + r[6] + ",\n\nPetit rappel : votre rendez-vous est prévu demain.\n" +
        "Date : " + dateLabel + "\nHeure : " + r[4] + "\nMotif : " + r[2] +
        "\nRéférence : " + r[0] + "\n\nEn cas d'empêchement, utilisez le lien d'annulation reçu dans votre e-mail de confirmation.";
      if (r[8]) MailApp.sendEmail(String(r[8]), "Rappel de rendez-vous — " + clinic, body);
      sheet.getRange(i + 2, 13).setValue(new Date());
      audit_("REMINDER_SENT", String(r[0]), "24-hour reminder");
    }
  });
}

function ensureReminderTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "sendDueReminders");
  if (!exists) ScriptApp.newTrigger("sendDueReminders").timeBased().everyHours(1).create();
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Propriété SPREADSHEET_ID manquante.");
  return SpreadsheetApp.openById(id);
}

function calendar_() {
  const id = PropertiesService.getScriptProperties().getProperty("CALENDAR_ID");
  return id ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
}

function setting_(key, fallback) {
  const sheet = getSpreadsheet_().getSheetByName("Settings");
  if (!sheet || sheet.getLastRow() < 2) return String(fallback);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const row = rows.find(r => String(r[0]) === key);
  return row ? String(row[1]) : String(fallback);
}

function clinicName_() {
  return PropertiesService.getScriptProperties().getProperty("CLINIC_NAME") || "Cabinet de psychologie";
}
function adminEmail_() {
  return PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL") || "";
}
function minutes_(value) {
  const p = String(value).split(":");
  return Number(p[0]) * 60 + Number(p[1] || 0);
}
function timeString_(mins) {
  return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
}
function parseLocalDateTime_(dateString, timeString) {
  const p = String(dateString).split("-").map(Number);
  const t = String(timeString).split(":").map(Number);
  return new Date(p[0], p[1] - 1, p[2], t[0], t[1], 0, 0);
}
function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sheet;
}
function audit_(action, reference, details) {
  const sheet = getSpreadsheet_().getSheetByName("AuditLog");
  if (sheet) sheet.appendRow([new Date(), action, reference, details]);
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function html_(message) {
  return HtmlService.createHtmlOutput(
    "<!doctype html><html lang='fr'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>RENDEVO — Annulation</title><body style='font-family:Arial,sans-serif;background:#f6f8f6;color:#26332e;padding:40px 18px'>" +
    "<main style='max-width:520px;margin:8vh auto;background:white;padding:32px;border-radius:16px;text-align:center;box-shadow:0 8px 30px #0001'>" +
    "<h1 style='font-size:24px'>RENDEVO</h1><p style='line-height:1.7'>" + escapeHtml_(message) + "</p></main></body></html>"
  );
}
function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
