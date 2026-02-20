// app.js — WhatsApp Cloud API Webhook (Railway) + Menü-Logik + Session-State in Postgres

const express = require("express");
const {
  testConnection,
  initDb,
  ensureUser,
  getSession,
  setSession,
  createLead,
} = require("./db");

// Node 18+ hat fetch global; fallback für ältere Umgebungen
const fetchFn =
  global.fetch ||
  ((...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args)));

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  console.log("REQ:", req.method, req.url);
  next();
});

// Railway PORT
const PORT = Number(process.env.PORT) || 3000;

// ENV
const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || "").trim();
const WHATSAPP_TOKEN = (process.env.WHATSAPP_TOKEN || "").trim();
const PHONE_NUMBER_ID = (process.env.PHONE_NUMBER_ID || "").trim();
const GRAPH_VERSION = (process.env.GRAPH_VERSION || "v21.0").trim();
const WEBHOOKSITE_URL = (process.env.WEBHOOKSITE_URL || "").trim() || null;

process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));

// Menütext
const MAIN_MENU_TEXT =
  `Willkommen bei SHIVANJA.\n` +
  `Bitte antworte mit einer Zahl:\n\n` +
  `1 = Fitness & Gesundheit\n` +
  `2 = Physiotherapie\n` +
  `3 = Rehasport\n` +
  `4 = Termin\n\n` +
  `Tipp: „menü“ oder „0“ bringt dich zurück.`;

// Health
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("ok"));

app.get("/health/db", async (req, res) => {
  try {
    const result = await testConnection();
    res.json({ status: "ok", time: result.now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Webhook Verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  console.log("Webhook verification failed");
  return res.sendStatus(403);
});

// Helpers
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
  if (!resp.ok) console.error("SEND ERROR:", resp.status, data);
  else console.log("SEND OK:", data);
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

// In-memory dedupe (gegen Retries)
const seen = new Set();
function seenBefore(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 5000) seen.clear();
  return false;
}

// Webhook Receiver (POST)
app.post("/webhook", (req, res) => {
  // WhatsApp erwartet sofort 200
  res.sendStatus(200);

  // optional Debug-Forward
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
  }

  const incoming = extractTextMessage(req.body);

  if (!incoming) {
    console.log("No text message (likely status update).");
    return;
  }
  if (seenBefore(incoming.id)) {
    console.log("Duplicate message ignored:", incoming.id);
    return;
  }

  console.log("INCOMING:", incoming);

  (async () => {
    const wa_id = incoming.from;
    const text = incoming.text.trim();
    const t = text.toLowerCase();

    await ensureUser(wa_id);

    // globale Rücksprünge
    if (t === "0" || t === "menü" || t === "menu" || t === "start") {
      await setSession(wa_id, "MAIN_MENU", {});
      await sendTextMessage(wa_id, MAIN_MENU_TEXT);
      return;
    }

    let session = await getSession(wa_id);

    // Erstkontakt: Menü zeigen
    if (!session) {
      await setSession(wa_id, "MAIN_MENU", {});
      await sendTextMessage(wa_id, MAIN_MENU_TEXT);
      return;
    }

    // Hauptmenü
    if (session.state === "MAIN_MENU") {
      if (text === "1") {
        await setSession(wa_id, "FITNESS", {});
        await sendTextMessage(
          wa_id,
          `Fitness & Gesundheit – kurz:\nWas ist dein Ziel?\n` +
            `A) Abnehmen\nB) Kraft/Training\nC) Rücken/Gelenke\n\n` +
            `Antworte mit A, B oder C (oder „menü“).`
        );
        return;
      }

      if (text === "2") {
        await setSession(wa_id, "PHYSIO", {});
        await sendTextMessage(
          wa_id,
          `Physio – kurz:\nHast du ein Rezept?\n` +
            `1 = Ja\n2 = Nein\n\n` +
            `Antworte mit 1 oder 2 (oder „menü“).`
        );
        return;
      }

      if (text === "3") {
        await setSession(wa_id, "REHA", {});
        await sendTextMessage(
          wa_id,
          `Rehasport – welcher Bereich?\n` +
            `1 = Orthopädie\n2 = Herzsport\n3 = Diabetes\n\n` +
            `Antworte mit 1–3 (oder „menü“).`
        );
        return;
      }

      if (text === "4") {
        await setSession(wa_id, "TERMIN", {});
        await sendTextMessage(
          wa_id,
          `Termin – bitte sende mir in 1 Nachricht:\n` +
            `1) Vor- und Nachname\n` +
            `2) Worum geht’s (Fitness/Physio/Reha)?\n` +
            `3) Wunschzeit (z. B. Mo/Di vormittags)\n`
        );
        return;
      }

      await sendTextMessage(wa_id, `Bitte antworte mit 1–4.\n\n${MAIN_MENU_TEXT}`);
      return;
    }

    // Untermenü: FITNESS
    if (session.state === "FITNESS") {
      const map = { a: "Abnehmen", b: "Kraft/Training", c: "Rücken/Gelenke" };
      const key = t;
      if (map[key]) {
        await createLead(wa_id, "FITNESS", { ziel: map[key], raw: text });
        await setSession(wa_id, "MAIN_MENU", {});
        await sendTextMessage(
          wa_id,
          `Alles klar: ${map[key]}.\nBitte sende für Rückruf deine Telefonnummer.\n\nOder „menü“.`
        );
        return;
      }
      await sendTextMessage(wa_id, `Bitte antworte mit A, B oder C (oder „menü“).`);
      return;
    }

    // Untermenü: PHYSIO
    if (session.state === "PHYSIO") {
      if (text === "1" || text === "2") {
        await createLead(wa_id, "PHYSIO", { rezept: text === "1" ? "ja" : "nein", raw: text });
        await setSession(wa_id, "MAIN_MENU", {});
        await sendTextMessage(
          wa_id,
          `Verstanden.\nBitte sende kurz:\n- Beschwerde (1 Satz)\n- Telefonnummer\n- Wunschzeit\n\nOder „menü“.`
        );
        return;
      }
      await sendTextMessage(wa_id, `Bitte antworte mit 1 = Ja oder 2 = Nein (oder „menü“).`);
      return;
    }

    // Untermenü: REHA
    if (session.state === "REHA") {
      const map = { "1": "Orthopädie", "2": "Herzsport", "3": "Diabetes" };
      if (map[text]) {
        await createLead(wa_id, "REHA", { bereich: map[text], raw: text });
        await setSession(wa_id, "MAIN_MENU", {});
        await sendTextMessage(
          wa_id,
          `Alles klar: ${map[text]}.\nBitte sende:\n- Name\n- Telefonnummer\n- Wunschzeit\n\nOder „menü“.`
        );
        return;
      }
      await sendTextMessage(wa_id, `Bitte antworte mit 1–3 (oder „menü“).`);
      return;
    }

    // Untermenü: TERMIN
    if (session.state === "TERMIN") {
      await createLead(wa_id, "TERMIN", { nachricht: text });
      await setSession(wa_id, "MAIN_MENU", {});
      await sendTextMessage(wa_id, `Danke. Wir melden uns schnellstmöglich.\n\n${MAIN_MENU_TEXT}`);
      return;
    }

    // Fallback: Session reset
    await setSession(wa_id, "MAIN_MENU", {});
    await sendTextMessage(wa_id, MAIN_MENU_TEXT);
  })().catch((e) => console.error("BOT FLOW ERROR:", e));
});

// Stabiler Start: erst DB, dann Server
async function startServer() {
  try {
    console.log("ENV PORT =", process.env.PORT);
    console.log("Using PORT =", PORT);

    await initDb();
    console.log("Database initialized");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
}

startServer();
