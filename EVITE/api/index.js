// Vercel serverless entry point.
// Wraps the Express app so Vercel can invoke it as a function. All /api/*
// routes are forwarded here via vercel.json rewrites.
module.exports = require('../backend/server');
