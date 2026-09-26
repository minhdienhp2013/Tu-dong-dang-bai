export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(onTick: () => Promise<void>, intervalMs = 15_000) {
    if (this.timer) return;

    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await onTick();
      } finally {
        this.running = false;
      }
    };

    this.timer = setInterval(() => { void tick(); }, intervalMs);
    void tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }
}
