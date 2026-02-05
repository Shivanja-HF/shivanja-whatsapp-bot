
const express = require("express");
const path = require("path");
const indexRouter = require("./routes/index");

const app = express();
app.use(express.json());

// Port (nur 1x!)
const PORT = process.env.PORT;
  console.log(`Server listening on port ${PORT}`);

// Middleware: log request method and url
app.use((req, res, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Static files
app.use(express.static(path.resolve(__dirname, "public")));

// Main routes
app.use("/", indexRouter);

// WhatsApp Webhook verification (GET)
app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verify_token) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// WhatsApp Webhook receiver (POST)  ✅ mit Logging
app.post("/webhook", (req, res) => {
  console.log("INCOMING WEBHOOK:", JSON.stringify(req.body, null, 2));
  return res.sendStatus(200);
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

// Start server (Railway kompatibel)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
