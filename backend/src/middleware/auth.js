/**
 * Authentication middleware.
 * Checks for CRON_SECRET in Authorization header.
 * Used to protect API and proactive engine endpoints.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  if (token !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Invalid authentication token' });
  }

  next();
}

module.exports = authMiddleware;
