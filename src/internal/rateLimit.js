const MAX_TRACKED_KEYS = 10_000;

// Fixed-window counter kept in memory, so limits apply per running instance
function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const windows = new Map();

  function sweep(time) {
    for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
  }

  return {
    take(key) {
      const time = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= time) {
        if (windows.size >= MAX_TRACKED_KEYS) sweep(time);
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }
      if (window.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((window.resetAt - time) / 1000) };
      }
      window.count++;
      return { allowed: true };
    },
  };
}

module.exports = { createRateLimiter };
