// app.js (Railway + WhatsApp Cloud API Webhook-ready)

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const express = require("express");
const path = require("path");
const indexRouter = require("./routes/index");

const app = express();
app.use(express.json());
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

// ✅ Railway: IMMER den von Railway gesetzten PORT verwenden
const PORT = process.env.PORT || 3000;

// ✅ Optional: Boot-Log, damit du im Railway-Log sofort siehst, ob PORT gesetzt ist
console.log("BOOT: process.env.PORT =", PORT);

// ✅ WhatsApp Cloud API config (ENV required)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // <-- unbedingt in Railway Variables setzen
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v21.0";

// Middleware: log request method and url
app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Static files
app.use(express.static(path.resolve(__dirname, "public")));

// Main routes
app.use("/", indexRouter);

// ✅ Healthcheck (hilft bei Plattform-Checks)
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("ok"));

// WhatsApp Webhook verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Helpers -------------------------------------------------------------

/**
 * Send a WhatsApp text message via Cloud API
 * Requires: WHATSAPP_TOKEN, PHONE_NUMBER_ID
 */
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

/**
 * Extract first incoming message (text) from WhatsApp webhook payload
 */
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

/**
 * Simple intent router: Termin / Info / Marketing
 */
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

// WhatsApp Webhook receiver (POST) ✅ mit Parsing + Echo/Auto-Reply
app.post("/webhook", async (req, res) => {
  // Wichtig: sofort 200 zurückgeben (WhatsApp erwartet schnelle Antwort)
  res.sendStatus(200);

  try {
    console.log("INCOMING WEBHOOK:", JSON.stringify(req.body, null, 2));

    const incoming = extractIncomingMessage(req.body);
    if (!incoming) {
      // z.B. statuses/read receipts/others
      return;
    }

    const { from, text } = incoming;
    console.log("PARSED MESSAGE:", { from, text });

    // ✅ Proof-of-life: Echo (kannst du später entfernen)
    // await sendTextMessage({ to: from, text: `Echo: ${text || "(leer)"}` });

    // ✅ Minimaler produktiver Flow: Menü + Routing
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

    // UNKNOWN → Menü
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

// ✅ Sauberer Shutdown (Railway killt bei Deploys alte Container)
let server;
process.on("SIGTERM", () => {
  console.log("SIGTERM received - closing server");
  if (server) {
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Start server (Railway kompatibel)
server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
