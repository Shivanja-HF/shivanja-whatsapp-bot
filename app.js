// app.js (Railway + WhatsApp Cloud API Webhook-ready, robust)

const express = require("express");
const path = require("path");

// Optional: wenn du weiter deine bisherigen Seiten nutzen willst, lass das drin.
// Wenn nicht vorhanden/gebraucht, kannst du die 2 Zeilen wieder löschen.
let indexRouter = null;
try {
  indexRouter = require("./routes/index");
} catch (_) {
  // ignore
}

const app = express();

// --- Robust error logging -------------------------------------------------
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));

// Railway: immer PORT aus ENV nutzen
const PORT = Number(process.env.PORT) || 3000;
console.log("BOOT: process.env.PORT =", process.env.PORT, "=> using PORT =", PORT);

// Helper: ENV kann bei dir teils lowercase sein (siehe Screenshot), daher beide Varianten lesen.
const envAny = (names) => {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
};

// WhatsApp Cloud API config (ENV required)
const VERIFY_TOKEN = envAny(["VERIFY_TOKEN", "verify_token"]);
const WHATSAPP_TOKEN = envAny(["WHATSAPP_TOKEN", "whatsapp_token"]);
const PHONE_NUMBER_ID = envAny(["PHONE_NUMBER_ID", "phone_number_id"]);
const GRAPH_VERSION = envAny(["GRAPH_VERSION", "graph_version"]) || "v21.0";

// Body parser
app.use(express.json({ limit: "2mb" }));

// Request logger
app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Static files (optional)
app.use(express.static(path.resolve(__dirname, "public")));

// Healthcheck
app.get("/health", (req, res) => res.status(200).send("ok"));

// Root: einfache OK-Antwort (damit nichts “dazwischenfunkt”)
app.get("/", (req, res) => res.status(200).send("ok"));

// Optional UI / alte Routes: bewusst NICHT auf "/" mounten, sonst kollidiert es gern.
if (indexRouter) {
  app.use("/ui", indexRouter); // deine bisherigen Seiten wären dann unter /ui erreichbar
}

// ------------------------------------------------------------------------
// WhatsApp Webhook verification (GET)
// Meta ruft: /webhook?hub.mode=subscribe&hub.challenge=12345&hub.verify_token=...
// Wir müssen exakt "challenge" zurückgeben, wenn verify_token passt.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("WEBHOOK_VERIFY:", { mode, token, hasChallenge: !!challenge });

  if (mode === "subscribe" && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
});

// ------------------------------------------------------------------------
// Helpers

// Node 20+ hat global fetch; fallback nur falls nicht vorhanden.
async function doFetch(url, options) {
  if (typeof fetch === "function") return fetch(url, options);
  const mod = await import("node-fetch");
  return mod.default(url, options);
}

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

  const resp = await doFetch(url, {
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
  if (/(adresse|wo|anfahrt|öffnungs|oeffnungs|zeiten|preis|kosten|mitglied|tarif|probetraining)/.test(t))
    return "INFO";
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

// ------------------------------------------------------------------------
// WhatsApp Webhook receiver (POST)
// Wichtig: Meta erwartet schnell ein 200, daher sofort antworten, dann intern verarbeiten.
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    console.log("INCOMING WEBHOOK:", JSON.stringify(req.body, null, 2));

    const incoming = extractIncomingMessage(req.body);
    if (!incoming) return; // z.B. statuses/read receipts

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

// 404 handler (optional)
app.use((req, res) => {
  const notFoundPath = path.resolve(__dirname, "views", "404.html");
  return res.status(404).sendFile(notFoundPath, (err) => {
    if (err) res.status(404).send("Not Found");
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("EXPRESS ERROR:", err);
  res.status(500).send("Internal Server Error");
});

// ------------------------------------------------------------------------
// Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});

// Railway/Container beendet Deployments mit SIGTERM – das ist normal.
// Wir beenden dann sauber (damit es nicht wie “Crash” aussieht).
function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  // Falls irgendwas hängt:
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.on("error", (err) => {
  console.error("LISTEN ERROR:", err);
  process.exit(1);
});
