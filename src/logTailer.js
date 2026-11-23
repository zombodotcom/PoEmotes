const fs = require('fs');

const BACKFILL_BYTES = 256 * 1024;
const POLL_MS = 200;

/**
 * Follows a growing log file by polling its size (fs.watch is unreliable on
 * Windows for files another process keeps open). Calls onLines(lines, isBackfill).
 */
class LogTailer {
  constructor(file, onLines) {
    this.file = file;
    this.onLines = onLines;
    this.offset = 0;
    this.partial = '';
    this.timer = null;
    this.reading = false;
  }

  start() {
    try {
      const size = fs.statSync(this.file).size;
      const start = Math.max(0, size - BACKFILL_BYTES);
      const text = this.readRange(start, size);
      const lines = text.split(/\r?\n/);
      if (start > 0) lines.shift(); // first line is probably cut in half
      this.offset = size;
      this.onLines(lines.filter(Boolean), true);
    } catch {
      this.offset = 0;
    }
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  readRange(start, end) {
    const len = end - start;
    if (len <= 0) return '';
    const fd = fs.openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  poll() {
    if (this.reading) return;
    this.reading = true;
    try {
      const size = fs.statSync(this.file).size;
      if (size < this.offset) { this.offset = 0; this.partial = ''; } // log was truncated
      if (size === this.offset) return;
      const text = this.partial + this.readRange(this.offset, size);
      this.offset = size;
      const lines = text.split(/\r?\n/);
      this.partial = lines.pop(); // incomplete trailing line
      if (lines.length) this.onLines(lines.filter(Boolean), false);
    } catch {
      /* file temporarily unavailable; try again next tick */
    } finally {
      this.reading = false;
    }
  }
}

module.exports = { LogTailer };
