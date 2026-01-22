
const express = require('express');
const path = require('path');
const router = express.Router();

// Home route: serve index.html
router.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../views/index.html'));
});

// Example: health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
