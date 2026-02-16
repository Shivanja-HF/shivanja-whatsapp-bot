// app.js (Railway + WhatsApp Cloud API Webhook-ready)

// Node 18+ hat fetch global; wir lassen dein Pattern trotzdem robust drin:
const fetchFn = global.fetch
  ? global.fetch
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express = require("express");
const path = require("path");
const indexRouter = require("./routes/index");

const app = express();
app.use(express.json());

// --- Robust error logging -------------------------------------------------
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));

// ✅ Railway: IMMER den von Railway gesetzten PORT verwenden
const PORT = Number(process.env.PORT) || 3000;
console.log("BOOT: process.env.PORT =", process.env.PORT, "=> using PORT =", PORT);

// ✅ ENV: akzeptiere GROSS + klein (damit du dich nicht mehr abschießt)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || process.env.verify_token;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || process.env.whatsapp_token;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || process.env.phone_number_id;
const GRAPH_VERSION = process.env.GRAPH_VERSION || process.env.graph_version || "v21.0";

// Middleware: log request method and url
app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Healthcheck (Railway) – MUSS vor allen Routern kommen
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("ok"));

// WhatsApp Webhook verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!VERIFY_TOKEN) {
    console.error("VERIFY_TOKEN missing in Railway Variables (VERIFY_TOKEN / verify_token).");
    return res.sendStatus(500);
  }

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Static files
app.use(express.static(path.resolve(__dirname, "public")));

// Main routes
app.use("/", indexRouter);

// --- Helpers -------------------------------------------------------------

async function sendTextMessage({ to, text }) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("Missing WHATSAPP_TOKEN/whatsapp_token or PHONE_NUMBER_ID/phone_number_id.");
    return { ok: false, error: "missing_env" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };

  const resp = await fetchFn(url, {
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

// WhatsApp Webhook receiver (POST)
app.post("/webhook", async (req, res) => {
  // WhatsApp erwartet schnelle Antwort
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
          "Infos – was brauchst du?\n" +
          "1) Öffnungszeiten\n" +
          "2) Adresse/Anfahrt\n" +
          "3) Preise/Probetraining\n\n" +
          "Antworte mit 1, 2 oder 3.",
      });
      return;
    }

    if (intent === "MARKETING") {
      await sendTextMessage({
        to: from,
        text:
          "Angebote – willst du aktuelle Aktionen & Kurse per WhatsApp bekommen?\n" +
          "Antworte mit JA oder NEIN.",
      });
      return;
    }

    await sendTextMessage({ to: from, text: menuText() });
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.resolve(__dirname, "views", "404.html"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

// ✅ Start server (Railway kompatibel) — NUR EINMAL!
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("LISTEN ERROR:", err);
  process.exit(1);
});
