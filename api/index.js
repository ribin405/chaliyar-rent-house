// Vercel serverless entrypoint. server/app.js only calls .listen() when run
// directly (require.main === module), so requiring it here just hands Vercel
// the Express app to invoke per-request — no separate server-for-Vercel code.
module.exports = require('../server/app');
