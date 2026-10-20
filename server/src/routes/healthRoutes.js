const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;
