export function fail(res, status, message) {
  return res.status(status).json({ error: message });
}
