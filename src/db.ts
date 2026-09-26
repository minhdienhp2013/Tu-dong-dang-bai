import path from 'path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import type { AiContentResult, CategoryRecord, ContentDraftRecord, ProductImageRecord, ProductRecord, SocialPostRecord } from './types';

const nowIso = () => new Date().toISOString();

export class AppDb {
  private db: Database.Database;

  constructor() {
    const file = path.join(app.getPath('userData'), 'auto-social.db');
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(parent_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        info_text TEXT NOT NULL DEFAULT '',
        default_hashtags TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(product_id, file_path),
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS content_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL,
        hashtags TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'ai',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS social_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        content_id INTEGER,
        platform TEXT NOT NULL DEFAULT 'facebook',
        image_ids_json TEXT NOT NULL DEFAULT '[]',
        scheduled_at TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        posted_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY(content_id) REFERENCES content_drafts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS post_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        social_post_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        attempted_at TEXT NOT NULL,
        FOREIGN KEY(social_post_id) REFERENCES social_posts(id) ON DELETE CASCADE
      );

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

      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
      CREATE INDEX IF NOT EXISTS idx_content_product ON content_drafts(product_id);
      CREATE INDEX IF NOT EXISTS idx_social_posts_schedule ON social_posts(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_posts_product_folder ON posts(product_folder);
      CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
    `);
  }

  listCategories(): CategoryRecord[] {
    return this.db.prepare('SELECT * FROM categories ORDER BY sort_order, name COLLATE NOCASE').all() as CategoryRecord[];
  }

  createCategory(name: string, parentId: number | null = null): CategoryRecord {
    const now = nowIso();
    const info = this.db.prepare(
      'INSERT INTO categories(parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
    ).run(parentId, name.trim(), now, now);
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) as CategoryRecord;
  }

  updateCategory(id: number, name: string, parentId: number | null): CategoryRecord {
    if (parentId === id) throw new Error('Danh mục không thể là mục con của chính nó.');
    this.db.prepare('UPDATE categories SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?')
      .run(name.trim(), parentId, nowIso(), id);
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRecord;
  }

  deleteCategory(id: number) {
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }

  listProducts(categoryId?: number | null): ProductRecord[] {
    const sql = `
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${categoryId ? 'WHERE p.category_id = ?' : ''}
      ORDER BY p.active DESC, p.name COLLATE NOCASE
    `;
    return (categoryId ? this.db.prepare(sql).all(categoryId) : this.db.prepare(sql).all()) as ProductRecord[];
  }

  getProduct(id: number): ProductRecord | null {
    return (this.db.prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `).get(id) as ProductRecord) || null;
  }

  createProduct(input: { categoryId?: number | null; name: string; description?: string; infoText?: string; defaultHashtags?: string }): ProductRecord {
    const now = nowIso();
    const info = this.db.prepare(`
      INSERT INTO products(category_id, name, description, info_text, default_hashtags, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      input.categoryId || null,
      input.name.trim(),
      input.description?.trim() || '',
      input.infoText?.trim() || '',
      input.defaultHashtags?.trim() || '',
      now, now
    );
    return this.getProduct(Number(info.lastInsertRowid))!;
  }

  updateProduct(id: number, input: { categoryId?: number | null; name: string; description?: string; infoText?: string; defaultHashtags?: string; active?: boolean }): ProductRecord {
    this.db.prepare(`
      UPDATE products
      SET category_id = ?, name = ?, description = ?, info_text = ?, default_hashtags = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.categoryId || null,
      input.name.trim(),
      input.description?.trim() || '',
      input.infoText?.trim() || '',
      input.defaultHashtags?.trim() || '',
      input.active === false ? 0 : 1,
      nowIso(),
      id
    );
    return this.getProduct(id)!;
  }

  deleteProduct(id: number) {
    this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
  }

  listImages(productId: number): ProductImageRecord[] {
    return this.db.prepare(
      'SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id'
    ).all(productId) as ProductImageRecord[];
  }

  addImages(productId: number, filePaths: string[]): ProductImageRecord[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO product_images(product_id, file_path, note, sort_order, active, used_count, created_at)
      VALUES (?, ?, '', ?, 1, 0, ?)
    `);
    const current = this.listImages(productId);
    let order = current.length;
    const tx = this.db.transaction(() => {
      for (const file of filePaths) insert.run(productId, file, order++, nowIso());
    });
    tx();
    return this.listImages(productId);
  }

  updateImage(id: number, input: { note?: string; sortOrder?: number; active?: boolean }): ProductImageRecord {
    const old = this.db.prepare('SELECT * FROM product_images WHERE id = ?').get(id) as ProductImageRecord;
    if (!old) throw new Error('Không tìm thấy ảnh.');
    this.db.prepare('UPDATE product_images SET note = ?, sort_order = ?, active = ? WHERE id = ?')
      .run(input.note ?? old.note, input.sortOrder ?? old.sort_order, input.active === undefined ? old.active : (input.active ? 1 : 0), id);
    return this.db.prepare('SELECT * FROM product_images WHERE id = ?').get(id) as ProductImageRecord;
  }

  deleteImage(id: number) {
    this.db.prepare('DELETE FROM product_images WHERE id = ?').run(id);
  }

  listContents(productId?: number): ContentDraftRecord[] {
    const sql = `
      SELECT d.*, p.name AS product_name
      FROM content_drafts d JOIN products p ON p.id = d.product_id
      ${productId ? 'WHERE d.product_id = ?' : ''}
      ORDER BY d.id DESC
    `;
    return (productId ? this.db.prepare(sql).all(productId) : this.db.prepare(sql).all()) as ContentDraftRecord[];
  }

  createContent(productId: number, result: AiContentResult, source: 'ai' | 'manual' = 'ai'): ContentDraftRecord {
    const now = nowIso();
    const info = this.db.prepare(`
      INSERT INTO content_drafts(product_id, title, caption, hashtags, source, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(productId, result.title.trim(), result.caption.trim(), result.hashtags.trim(), source, now, now);
    return this.db.prepare(`
      SELECT d.*, p.name AS product_name
      FROM content_drafts d JOIN products p ON p.id = d.product_id
      WHERE d.id = ?
    `).get(info.lastInsertRowid) as ContentDraftRecord;
  }

  updateContent(id: number, input: Partial<Pick<ContentDraftRecord, 'title' | 'caption' | 'hashtags' | 'status'>>): ContentDraftRecord {
    const old = this.db.prepare('SELECT * FROM content_drafts WHERE id = ?').get(id) as ContentDraftRecord;
    if (!old) throw new Error('Không tìm thấy nội dung.');
    this.db.prepare(`
      UPDATE content_drafts SET title = ?, caption = ?, hashtags = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(
      input.title ?? old.title,
      input.caption ?? old.caption,
      input.hashtags ?? old.hashtags,
      input.status ?? old.status,
      nowIso(),
      id
    );
    return this.db.prepare(`
      SELECT d.*, p.name AS product_name
      FROM content_drafts d JOIN products p ON p.id = d.product_id
      WHERE d.id = ?
    `).get(id) as ContentDraftRecord;
  }

  deleteContent(id: number) {
    this.db.prepare('DELETE FROM content_drafts WHERE id = ?').run(id);
  }

  createSocialPost(input: { productId: number; contentId: number; imageIds: number[]; scheduledAt?: string | null; status?: 'draft' | 'scheduled' }): SocialPostRecord {
    const now = nowIso();
    const status = input.status || (input.scheduledAt ? 'scheduled' : 'draft');
    const info = this.db.prepare(`
      INSERT INTO social_posts(product_id, content_id, platform, image_ids_json, scheduled_at, status, created_at, updated_at)
      VALUES (?, ?, 'facebook', ?, ?, ?, ?, ?)
    `).run(input.productId, input.contentId, JSON.stringify(input.imageIds), input.scheduledAt || null, status, now, now);
    return this.getSocialPost(Number(info.lastInsertRowid))!;
  }

  getSocialPost(id: number): SocialPostRecord | null {
    return (this.db.prepare(`
      SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags
      FROM social_posts sp
      JOIN products p ON p.id = sp.product_id
      LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.id = ?
    `).get(id) as SocialPostRecord) || null;
  }

  listScheduledPosts(): SocialPostRecord[] {
    return this.db.prepare(`
      SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags
      FROM social_posts sp
      JOIN products p ON p.id = sp.product_id
      LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.status IN ('draft','scheduled','posting','failed')
      ORDER BY CASE WHEN sp.scheduled_at IS NULL THEN 1 ELSE 0 END, sp.scheduled_at, sp.id DESC
    `).all() as SocialPostRecord[];
  }

  getDueScheduledPosts(now: string): SocialPostRecord[] {
    return this.db.prepare(`
      SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags
      FROM social_posts sp
      JOIN products p ON p.id = sp.product_id
      LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.status = 'scheduled' AND sp.scheduled_at IS NOT NULL AND sp.scheduled_at <= ?
      ORDER BY sp.scheduled_at
      LIMIT 5
    `).all(now) as SocialPostRecord[];
  }

  updateSocialPostStatus(id: number, status: SocialPostRecord['status'], errorMessage: string | null = null) {
    const postedAt = status === 'posted' ? nowIso() : null;
    this.db.prepare(`
      UPDATE social_posts
      SET status = ?, error_message = ?, posted_at = COALESCE(?, posted_at), updated_at = ?
      WHERE id = ?
    `).run(status, errorMessage, postedAt, nowIso(), id);
  }

  cancelSocialPost(id: number) {
    this.updateSocialPostStatus(id, 'cancelled', null);
  }

  addPostAttempt(postId: number, status: string, message = '') {
    this.db.prepare(
      'INSERT INTO post_attempts(social_post_id, status, message, attempted_at) VALUES (?, ?, ?, ?)'
    ).run(postId, status, message, nowIso());
  }

  resolveImagePaths(imageIds: number[]): ProductImageRecord[] {
    if (!imageIds.length) return [];
    const q = imageIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM product_images WHERE id IN (${q}) ORDER BY sort_order, id`).all(...imageIds) as ProductImageRecord[];
  }

  markImagesUsed(imageIds: number[]) {
    if (!imageIds.length) return;
    const q = imageIds.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE product_images SET used_count = used_count + 1, last_used_at = ? WHERE id IN (${q})
    `).run(nowIso(), ...imageIds);
  }

  markContentUsed(contentId: number | null) {
    if (!contentId) return;
    this.db.prepare(`UPDATE content_drafts SET status = 'used', updated_at = ? WHERE id = ?`).run(nowIso(), contentId);
  }

  listPostHistory(limit = 100) {
    return this.db.prepare(`
      SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags,
             (SELECT COUNT(*) FROM post_attempts a WHERE a.social_post_id = sp.id) AS attempt_count
      FROM social_posts sp
      JOIN products p ON p.id = sp.product_id
      LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.status IN ('posted','failed','cancelled')
      ORDER BY COALESCE(sp.posted_at, sp.updated_at) DESC
      LIMIT ?
    `).all(limit);
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
    const now = nowIso();
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
