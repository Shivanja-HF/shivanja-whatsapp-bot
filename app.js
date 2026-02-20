// app.js — Minimal WhatsApp Cloud API Webhook (Railway)

const express = require("express");
const { testConnection } = require("./db");

// ✅ Node 18+ hat fetch global; falls nicht vorhanden, fallback
const fetchFn =
  global.fetch ||
  ((...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args)));

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  console.log("REQ:", req.method, req.url);
  next();
});

const PORT = Number(process.env.PORT) || 3000;

// ✅ ENV sauber einmal einlesen
const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || "").trim();
const WHATSAPP_TOKEN = (process.env.WHATSAPP_TOKEN || "").trim();
const PHONE_NUMBER_ID = (process.env.PHONE_NUMBER_ID || "").trim();
const GRAPH_VERSION = (process.env.GRAPH_VERSION || "v21.0").trim();

// ✅ NEU: webhook.site URL optional (darf nie crashen)
const WEBHOOKSITE_URL = (process.env.WEBHOOKSITE_URL || "").trim() || null;

process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));

app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("ok"));

// --- WhatsApp Webhook Verification (GET) ---
app.get("/webhook", (req, res) => {
  console.log("REQ: GET /webhook");

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  } else {
    console.log("Webhook verification failed");
    return res.sendStatus(403);
  }
});
app.get("/health/db", async (req, res) => {
  try {
    const result = await testConnection();
    res.json({ status: "ok", time: result.now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// --- Helpers ---
async function sendTextMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
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
  } else {
    console.log("SEND OK:", data);
  }
}

function extractTextMessage(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return null;

  const text = msg?.text?.body;
  if (!text) return null;

  return {
    from: msg.from,
    text: String(text).trim(),
    id: msg.id,
    timestamp: msg.timestamp,
  };
}

// In-Memory-Dedupe gegen Retries (reicht für Debugging)
const seen = new Set();
function seenBefore(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 5000) {
    // simple cleanup
    seen.clear();
  }
  return false;
}

// --- WhatsApp Webhook Receiver (POST) ---
app.post("/webhook", (req, res) => {
  // Wichtig: immer sofort 200 geben
  res.sendStatus(200);

  // ✅ NEU: Rohdaten an webhook.site weiterleiten (Debug) — darf nie crashen
  if (WEBHOOKSITE_URL) {
    fetchFn(WEBHOOKSITE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        at: new Date().toISOString(),
        headers: req.headers,
        body: req.body,
      }),
    }).catch((e) => console.error("WEBHOOKSITE forward failed:", e));
  } else {
    // optionales Log, damit klar ist warum nichts forwarded wird
    // console.log("WEBHOOKSITE_URL not set; skipping forward.");
  }

  try {
    console.log("POST /webhook HIT");
    console.log("BODY:", JSON.stringify(req.body));

    const incoming = extractTextMessage(req.body);

    // häufig: statuses/reads/delivered -> kein msg
    if (!incoming) {
      console.log("No text message (likely status update).");
      return;
    }

    if (seenBefore(incoming.id)) {
      console.log("Duplicate message ignored:", incoming.id);
      return;
    }

    console.log("INCOMING:", incoming);

    // async fire-and-forget
    sendTextMessage(incoming.from, `Ok, verstanden: "${incoming.text}"`).catch((e) =>
      console.error("sendTextMessage failed:", e)
    );
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
