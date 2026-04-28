// backend/src/config/dbQueue.js
// Pro plan: can handle more concurrent connections
// Increased from 8 → 15 concurrent operations

class DBQueue {
  constructor(maxConcurrent = 3) {  // Nano: 15 total conns, leave room for auth/trades
    this.maxConcurrent = maxConcurrent;
    this.running       = 0;
    this.queue         = [];
    this._total        = 0;
    this._timeouts     = 0;
    this._errors       = 0;

    // Log stats every 60s
    const statsInterval = setInterval(() => this._logStats(), 60_000);
    if (statsInterval.unref) statsInterval.unref();
  }

  run(operation, priority = 0, timeoutMs = 30_000) {
    this._total++;

    return new Promise((resolve, reject) => {
      let timedOut = false;
      const taskId = this._total;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        const idx = this.queue.findIndex((t) => t.id === taskId);
        if (idx !== -1) this.queue.splice(idx, 1);
        this._timeouts++;
        reject(new Error(`DBQueue: operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const execute = async () => {
        if (timedOut) {
          this.running--;
          this._next();
          return;
        }

        clearTimeout(timeoutId);
        this.running++;

        try {
          resolve(await operation());
        } catch (err) {
          this._errors++;
          reject(err);
        } finally {
          this.running--;
          this._next();
        }
      };

      const task = { id: taskId, execute, priority };

      // Insert in priority order (higher priority first)
      const insertAt = this.queue.findIndex((t) => t.priority < priority);
      if (insertAt === -1) this.queue.push(task);
      else                 this.queue.splice(insertAt, 0, task);

      this._next();
    });
  }

  _next() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      task.execute();
    }
  }

  _logStats() {
    if (this._total > 0) {
      const successRate = (
        ((this._total - this._errors - this._timeouts) / this._total) * 100
      ).toFixed(1);

      console.log(
        `[DBQueue] running=${this.running} queued=${this.queue.length} ` +
        `total=${this._total} errors=${this._errors} ` +
        `timeouts=${this._timeouts} successRate=${successRate}% ` +
        `max=${this.maxConcurrent}`
      );
    }
  }

  getStats() {
    return {
      running:     this.running,
      queued:      this.queue.length,
      max:         this.maxConcurrent,
      total:       this._total,
      errors:      this._errors,
      timeouts:    this._timeouts,
      successRate: this._total > 0
        ? (((this._total - this._errors - this._timeouts) / this._total) * 100).toFixed(1) + '%'
        : '100%',
    };
  }

  drain(maxWaitMs = 15_000) {
    return new Promise((resolve) => {
      if (this.running === 0 && this.queue.length === 0) return resolve();
      const deadline = Date.now() + maxWaitMs;
      const check    = setInterval(() => {
        if (
          (this.running === 0 && this.queue.length === 0) ||
          Date.now() > deadline
        ) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
// Pro plan: 15 concurrent is safe (well within 120 connection limit)
const dbQueue = new DBQueue(
  parseInt(process.env.DB_QUEUE_CONCURRENCY, 10) || 3  // override via env on Pro plan
);

const queueDB = (operation, priority = 0) => dbQueue.run(operation, priority);

module.exports = { dbQueue, queueDB };