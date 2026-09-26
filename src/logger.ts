import fs from 'fs';
import path from 'path';
import { app } from 'electron';

function redact(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/cookie\s*[:=].*/gi, 'cookie=[REDACTED]');
}

export class AppLogger {
  private filePath: string;

  constructor() {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, 'app.log');
  }

  write(event: string, details: Record<string, unknown> = {}) {
    const safe = Object.fromEntries(Object.entries(details).filter(([k]) =>
      !/api.?key|password|cookie|token|session/i.test(k)
    ));
    const line = redact(`${new Date().toISOString()} ${event} ${JSON.stringify(safe)}\n`);
    fs.appendFileSync(this.filePath, line, 'utf8');
  }

  getPath() {
    return this.filePath;
  }
}
