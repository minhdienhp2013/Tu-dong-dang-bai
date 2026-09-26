import type { AppConfig } from './types';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private fired = new Set<string>();

  start(getConfig: () => AppConfig, onSlot: (slot: string) => Promise<void>) {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      const cfg = getConfig();
      if (!cfg.autoPostEnabled) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (!cfg.postingTimes.includes(hhmm)) return;
      const key = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}@${hhmm}`;
      if (this.fired.has(key)) return;
      this.fired.add(key);
      try { await onSlot(hhmm); } catch { /* surfaced by caller */ }
      if (this.fired.size > 100) this.fired.clear();
    }, 15_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
