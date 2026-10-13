// Per-sender flood control: a token bucket per id. Honest players stay below it
// (presence is 10 messages a second, plus the updates of the enemies and bosses
// their game owns); a flooding one is cut off before the game has to decode anything. Senders whose bucket has refilled are forgotten now and then.

const DEFAULTS = { perSecond: 120, burst: 240, sweepEvery: 1024 };

export class RateLimiter {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.buckets = new Map(); // id -> { tokens, at }
    this.calls = 0;
  }

  refill(bucket, now) {
    const { perSecond, burst } = this.options;
    bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * perSecond);
    bucket.at = now;
  }

  allow(id, now = Date.now()) {
    if (++this.calls % this.options.sweepEvery === 0) this.sweep(now);
    let bucket = this.buckets.get(id);
    if (!bucket) { bucket = { tokens: this.options.burst, at: now }; this.buckets.set(id, bucket); }
    this.refill(bucket, now);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  sweep(now) {
    for (const [id, bucket] of this.buckets) {
      this.refill(bucket, now);
      if (bucket.tokens >= this.options.burst) this.buckets.delete(id);
    }
  }
}
