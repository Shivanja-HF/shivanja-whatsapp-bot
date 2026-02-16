// app.js (Railway + WhatsApp Cloud API Webhook-ready)

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express = require("express");
const path = require("path");
const indexRouter = require("./routes/index");

const app = express();
app.use(express.json());

// --- Robust error logging -------------------------------------------------
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

// ✅ Railway: IMMER den von Railway gesetzten PORT verwenden
const PORT = Number(process.env.PORT) || 3000;
console.log("BOOT: process.env.PORT =", process.env.PORT, "=> using PORT =", PORT);

// ✅ WhatsApp Cloud API config (ENV)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // MUSS in Railway Variables gesetzt sein
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v21.0";

// Middleware: log request method and url
app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Healthcheck (Railway)
app.get("/health", (req, res) => res.status(200).send("ok"));

// ✅ Root (optional)
app.get("/", (req, res) => res.status(200).send("ok"));

// ✅ WhatsApp Webhook verification (GET) — MUSS vor anderen Routern kommen
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Debug (hilft bei falschen Tokens)
  console.log("WEBHOOK VERIFY:", { mode, token, hasVerifyToken: !!VERIFY_TOKEN });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Helpers -------------------------------------------------------------

async function sendTextMessage({ to, text }) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID (Railway Variables).");
    return { ok: false, error: "missing_env" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error("SEND ERROR:", resp.status, data);
    return { ok: false, status: resp.status, data };
  }

  console.log("SEND OK:", data);
  return { ok: true, data };
}

function extractIncomingMessage(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return null;

  return {
    from: msg.from,
    text: msg?.text?.body?.trim() || "",
    type: msg.type || "unknown",
    timestamp: msg.timestamp,
    raw: msg,
  };
}

function detectIntent(text) {
  const t = (text || "").toLowerCase();

  if (/(termin|buch|buchung|zeit|uhr|heute|morgen|woche|datum)/.test(t)) return "APPOINTMENT";
  if (/(adresse|wo|anfahrt|öffnungs|zeiten|preis|kosten|mitglied|tarif|probetraining)/.test(t)) return "INFO";
  if (/(angebot|aktion|kurs|deal|rabatt|special|challenge)/.test(t)) return "MARKETING";

  return "UNKNOWN";
}

function menuText() {
  return (
    "Wobei kann ich dir helfen?\n" +
    "1) Termin\n" +
    "2) Infos\n" +
    "3) Angebote\n\n" +
    "Antworte mit 1, 2 oder 3."
  );
}

// ✅ WhatsApp Webhook receiver (POST)
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    console.log("INCOMING WEBHOOK:", JSON.stringify(req.body, null, 2));

    const incoming = extractIncomingMessage(req.body);
    if (!incoming) return;

    const { from, text } = incoming;
    console.log("PARSED MESSAGE:", { from, text });

    const intent = detectIntent(text);

    if (intent === "APPOINTMENT") {
      await sendTextMessage({
        to: from,
        text:
          "Termin – für welchen Bereich?\n" +
          "1) Training\n" +
          "2) Physio\n" +
          "3) Reha\n\n" +
          "Antworte mit 1, 2 oder 3.",
      });
      return;
    }

    if (intent === "INFO") {
      await sendTextMessage({
        to: from,
        text:
          "Infos – was b
