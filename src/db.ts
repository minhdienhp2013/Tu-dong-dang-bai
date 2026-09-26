import path from 'path';
import Database from 'better-sqlite3';
import { app } from 'electron';

export class AppDb {
  private db: Database.Database;

  constructor() {
    const file = path.join(app.getPath('userData'), 'auto-social.db');
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        product_folder TEXT NOT NULL,
        caption TEXT NOT NULL,
        images_json TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        posted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS image_usage (
        image_path TEXT PRIMARY KEY,
        product_folder TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_posts_product_folder ON posts(product_folder);
      CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
    `);
  }

  imageUsed(imagePath: string): boolean {
    const row = this.db.prepare('SELECT used_count FROM image_usage WHERE image_path = ?').get(imagePath) as any;
    return !!row && row.used_count > 0;
  }

  getLastPostedAt(productFolder: string): string | null {
    const row = this.db.prepare(
      `SELECT posted_at FROM posts WHERE product_folder = ? AND status = 'posted' ORDER BY posted_at DESC LIMIT 1`
    ).get(productFolder) as any;
    return row?.posted_at || null;
  }

  markPost(productName: string, productFolder: string, caption: string, images: string[], status: 'posted' | 'failed', error?: string) {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO posts(product_name, product_folder, caption, images_json, status, error_message, created_at, posted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(productName, productFolder, caption, JSON.stringify(images), status, error || null, now, status === 'posted' ? now : null);

      if (status === 'posted') {
        const stmt = this.db.prepare(`INSERT INTO image_usage(image_path, product_folder, used_count, last_used_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(image_path) DO UPDATE SET used_count = used_count + 1, last_used_at = excluded.last_used_at`);
        for (const image of images) stmt.run(image, productFolder, now);
      }
    });
    tx();
  }

  recentPosts(limit = 50) {
    return this.db.prepare(`SELECT id, product_name, caption, status, error_message, created_at, posted_at, images_json
      FROM posts ORDER BY id DESC LIMIT ?`).all(limit);
  }
}
