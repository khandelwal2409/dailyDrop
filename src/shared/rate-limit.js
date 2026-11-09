import { fail } from './http.js';

export function createRateLimiter() {
  const buckets = new Map();

  return {
    limit(max, windowMs) {
      return (req, res, next) => {
        const key = `${req.path}:${req.ip}`;
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
          bucket = { count: 0, resetAt: now + windowMs };
          buckets.set(key, bucket);
        }
        bucket.count += 1;
        res.setHeader('RateLimit-Limit', max);
        res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));
        if (bucket.count > max) return fail(res, 429, 'Too many attempts. Please try again later.');
        next();
      };
    },
    cleanup() {
      if (buckets.size > 10000) {
        const now = Date.now();
        for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      }
    },
  };
}
