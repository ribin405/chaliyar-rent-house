const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');

// Load env before requiring modules that read process.env at import time (e.g. the DB pool).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const errorHandler = require('./middleware/errorHandler');
const { ready } = require('./config/database');

// Express 4 doesn't forward a rejected promise from an async route to the
// error middleware — the rejection goes unhandled and takes the process down.
// Route every handler's rejection to next() so errorHandler answers instead.
const Layer = require('express/lib/router/layer');
Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // error-handling middleware, not a route
  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === 'function') result.catch(next);
  } catch (err) {
    next(err);
  }
};

const app = express();
const DEFAULT_PORT = 5000;
const requestedPort = Number(process.env.PORT);
const candidatePorts = [requestedPort || DEFAULT_PORT, DEFAULT_PORT, 5001].filter((port, index, ports) => port && ports.indexOf(port) === index);

app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Generous enough to cover multiple staff polling the dashboard/rentals views concurrently
// (each open page re-fetches every few seconds), while still bounding runaway abuse.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Schema/seed setup is now async (networked Turso/libSQL client). Memoized in
// database.js, so this only does real work once per warm process/container.
app.use(async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running' });
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/customers', require('./routes/customers.routes'));
app.use('/api/categories', require('./routes/categories.routes'));
app.use('/api/equipment', require('./routes/equipment.routes'));
app.use('/api/rentals', require('./routes/rentals.routes'));
app.use('/api/payments', require('./routes/payments.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/search', require('./routes/search.routes'));
app.use('/api/users', require('./routes/users.routes'));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(errorHandler);

if (require.main === module) {
  const tryListen = (index = 0) => {
    const port = candidatePorts[index];
    const server = app.listen(port, () => {
      console.log(`[SERVER] Running on http://localhost:${port}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && index + 1 < candidatePorts.length) {
        console.warn(`[SERVER] Port ${port} is busy. Trying ${candidatePorts[index + 1]} instead.`);
        server.close(() => tryListen(index + 1));
      } else {
        throw error;
      }
    });
  };

  tryListen();
}

module.exports = app;
