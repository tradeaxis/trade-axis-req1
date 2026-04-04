// backend/src/config/dbQueue.js
// Simple queue to limit concurrent Supabase operations

class DBQueue {
  constructor(maxConcurrent = 10) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async run(operation) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      if (this.running < this.maxConcurrent) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  processQueue() {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      next();
    }
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      max: this.maxConcurrent,
    };
  }
}

// Single instance — max 10 concurrent DB operations
const dbQueue = new DBQueue(10);

module.exports = { dbQueue };