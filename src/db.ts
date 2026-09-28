import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import type {
  AiContentResult, CategoryRecord, ContentDraftRecord, DashboardSummary, LearningRecord,
  PostErrorCode, ProductImageRecord, ProductRecord, RunMode, SocialPostRecord, StyleRecord
} from './types';

const nowIso = () => new Date().toISOString();

export class AppDb {
  private db: DatabaseSync;

  constructor() {
    const file = path.join(app.getPath('userData'), 'auto-social.db');
    this.db = new DatabaseSync(file, { timeout: 5000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);

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
        ai_original TEXT,
        style_id INTEGER,
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
        scheduled_local_key TEXT,
        mode TEXT NOT NULL DEFAULT 'test',
        status TEXT NOT NULL DEFAULT 'draft',
        error_code TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
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
        mode TEXT NOT NULL DEFAULT 'auto',
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        ai_original TEXT,
        user_final TEXT,
        job_key TEXT,
        created_at TEXT NOT NULL,
        posted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS image_usage (
        image_path TEXT PRIMARY KEY,
        product_folder TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_key TEXT NOT NULL UNIQUE,
        scheduled_local TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'test',
        status TEXT NOT NULL DEFAULT 'pending',
        product_name TEXT,
        product_folder TEXT,
        caption TEXT,
        images_json TEXT NOT NULL DEFAULT '[]',
        error_code TEXT,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS caption_learning (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        ai_original TEXT NOT NULL,
        user_final TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS styles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
      CREATE INDEX IF NOT EXISTS idx_content_product ON content_drafts(product_id);
      CREATE INDEX IF NOT EXISTS idx_social_posts_schedule ON social_posts(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_posts_product_folder ON posts(product_folder);
      CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_learning_recent ON caption_learning(created_at DESC);
    `);

    this.migrateExistingSchema();
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_local_key
        ON social_posts(scheduled_local_key) WHERE scheduled_local_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_job_key
        ON posts(job_key) WHERE job_key IS NOT NULL;
    `);
    this.seedDefaultStyle();
  }

  private transaction(fn: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  private columns(table: string) {
    return new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(r => String(r.name)));
  }

  private ensureColumn(table: string, name: string, definition: string) {
    if (!this.columns(table).has(name)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }

  private migrateExistingSchema() {
    this.ensureColumn('content_drafts', 'ai_original', 'TEXT');
    this.ensureColumn('content_drafts', 'style_id', 'INTEGER');
    this.ensureColumn('social_posts', 'scheduled_local_key', 'TEXT');
    this.ensureColumn('social_posts', 'mode', "TEXT NOT NULL DEFAULT 'test'");
    this.ensureColumn('social_posts', 'error_code', 'TEXT');
    this.ensureColumn('social_posts', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('social_posts', 'next_retry_at', 'TEXT');
    this.ensureColumn('posts', 'mode', "TEXT NOT NULL DEFAULT 'auto'");
    this.ensureColumn('posts', 'error_code', 'TEXT');
    this.ensureColumn('posts', 'ai_original', 'TEXT');
    this.ensureColumn('posts', 'user_final', 'TEXT');
    this.ensureColumn('posts', 'job_key', 'TEXT');
  }

  private seedDefaultStyle() {
    const count = Number((this.db.prepare('SELECT COUNT(*) c FROM styles').get() as any)?.c || 0);
    if (count) return;
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO styles(name, prompt, enabled, is_default, created_at, updated_at)
      VALUES (?, ?, 1, 1, ?, ?)
    `).run(
      'Bán hàng tự nhiên',
      'Viết như người bán hàng thật trên Facebook cá nhân: câu ngắn, tự nhiên, không khoa trương, không bịa thông tin.',
      now, now
    );
  }

  recoverInterruptedJobs() {
    const now = nowIso();
    this.db.prepare(`
      UPDATE scheduled_jobs
      SET status = 'uncertain',
          error_code = 'UNKNOWN',
          error_message = 'Ứng dụng đã dừng khi job đang posting; không tự đăng lại để tránh trùng bài.',
          updated_at = ?
      WHERE status = 'posting'
    `).run(now);
    this.db.prepare(`
      UPDATE social_posts
      SET status = 'uncertain',
          error_code = 'UNKNOWN',
          error_message = 'Ứng dụng đã dừng khi bài đang posting; cần kiểm tra Facebook thủ công.',
          updated_at = ?
      WHERE status = 'posting'
    `).run(now);
  }

  claimScheduledJob(jobKey: string, scheduledLocal: string, mode: RunMode) {
    const now = nowIso();
    try {
      const info = this.db.prepare(`
        INSERT INTO scheduled_jobs(job_key, scheduled_local, mode, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `).run(jobKey, scheduledLocal, mode, now, now);
      return Number(info.lastInsertRowid);
    } catch (error: any) {
      if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) return null;
      throw error;
    }
  }

  updateScheduledJob(id: number, input: {
    status?: string;
    productName?: string | null;
    productFolder?: string | null;
    caption?: string | null;
    images?: string[];
    errorCode?: PostErrorCode | null;
    errorMessage?: string | null;
    retryCount?: number;
    nextRetryAt?: string | null;
    completed?: boolean;
  }) {
    const old = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as any;
    if (!old) throw new Error('Không tìm thấy scheduled job.');
    this.db.prepare(`
      UPDATE scheduled_jobs SET
        status = ?,
        product_name = ?,
        product_folder = ?,
        caption = ?,
        images_json = ?,
        error_code = ?,
        error_message = ?,
        retry_count = ?,
        next_retry_at = ?,
        updated_at = ?,
        completed_at = ?
      WHERE id = ?
    `).run(
      input.status ?? old.status,
      input.productName ?? old.product_name,
      input.productFolder ?? old.product_folder,
      input.caption ?? old.caption,
      input.images ? JSON.stringify(input.images) : old.images_json,
      input.errorCode === undefined ? old.error_code : input.errorCode,
      input.errorMessage === undefined ? old.error_message : input.errorMessage,
      input.retryCount ?? old.retry_count,
      input.nextRetryAt === undefined ? old.next_retry_at : input.nextRetryAt,
      nowIso(),
      input.completed ? nowIso() : old.completed_at,
      id
    );
  }

  getScheduledJob(id: number) {
    return this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as any;
  }

  getRetryableJobs(now: string) {
    return this.db.prepare(`
      SELECT * FROM scheduled_jobs
      WHERE status = 'failed'
        AND error_code = 'NETWORK_ERROR'
        AND retry_count <= 2
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= ?
      ORDER BY next_retry_at
      LIMIT 1
    `).all(now) as any[];
  }

  listCategories(): CategoryRecord[] {
    return this.db.prepare('SELECT * FROM categories ORDER BY sort_order, name COLLATE NOCASE').all() as CategoryRecord[];
  }

  createCategory(name: string, parentId: number | null = null): CategoryRecord {
    const now = nowIso();
    const info = this.db.prepare('INSERT INTO categories(parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
      .run(parentId, name.trim(), now, now);
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) as CategoryRecord;
  }

  updateCategory(id: number, name: string, parentId: number | null): CategoryRecord {
    if (parentId === id) throw new Error('Danh mục không thể là mục con của chính nó.');
    this.db.prepare('UPDATE categories SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?')
      .run(name.trim(), parentId, nowIso(), id);
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRecord;
  }

  deleteCategory(id: number) { this.db.prepare('DELETE FROM categories WHERE id = ?').run(id); }

  listProducts(categoryId?: number | null): ProductRecord[] {
    const sql = `SELECT p.*, c.name AS category_name FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${categoryId ? 'WHERE p.category_id = ?' : ''}
      ORDER BY p.active DESC, p.name COLLATE NOCASE`;
    return (categoryId ? this.db.prepare(sql).all(categoryId) : this.db.prepare(sql).all()) as ProductRecord[];
  }

  getProduct(id: number): ProductRecord | null {
    return (this.db.prepare(`SELECT p.*, c.name AS category_name FROM products p
      LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(id) as ProductRecord) || null;
  }

  createProduct(input: { categoryId?: number | null; name: string; description?: string; infoText?: string; defaultHashtags?: string }): ProductRecord {
    const now = nowIso();
    const info = this.db.prepare(`INSERT INTO products(category_id, name, description, info_text, default_hashtags, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(
      input.categoryId || null, input.name.trim(), input.description?.trim() || '',
      input.infoText?.trim() || '', input.defaultHashtags?.trim() || '', now, now
    );
    return this.getProduct(Number(info.lastInsertRowid))!;
  }

  updateProduct(id: number, input: { categoryId?: number | null; name: string; description?: string; infoText?: string; defaultHashtags?: string; active?: boolean }): ProductRecord {
    this.db.prepare(`UPDATE products SET category_id = ?, name = ?, description = ?, info_text = ?, default_hashtags = ?, active = ?, updated_at = ? WHERE id = ?`)
      .run(input.categoryId || null, input.name.trim(), input.description?.trim() || '', input.infoText?.trim() || '',
        input.defaultHashtags?.trim() || '', input.active === false ? 0 : 1, nowIso(), id);
    return this.getProduct(id)!;
  }

  deleteProduct(id: number) { this.db.prepare('DELETE FROM products WHERE id = ?').run(id); }

  listImages(productId: number): ProductImageRecord[] {
    return this.db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id').all(productId) as ProductImageRecord[];
  }

  getImage(id: number): ProductImageRecord | null {
    return (this.db.prepare('SELECT * FROM product_images WHERE id = ?').get(id) as ProductImageRecord) || null;
  }

  updateImagePath(id: number, filePath: string): ProductImageRecord {
    this.db.prepare('UPDATE product_images SET file_path = ? WHERE id = ?').run(filePath, id);
    return this.getImage(id)!;
  }

  addImages(productId: number, filePaths: string[]): ProductImageRecord[] {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO product_images(product_id, file_path, note, sort_order, active, used_count, created_at)
      VALUES (?, ?, '', ?, 1, 0, ?)`);
    let order = this.listImages(productId).length;
    this.transaction(() => { for (const file of filePaths) insert.run(productId, file, order++, nowIso()); });
    return this.listImages(productId);
  }

  updateImage(id: number, input: { note?: string; sortOrder?: number; active?: boolean }): ProductImageRecord {
    const old = this.db.prepare('SELECT * FROM product_images WHERE id = ?').get(id) as ProductImageRecord;
    if (!old) throw new Error('Không tìm thấy ảnh.');
    this.db.prepare('UPDATE product_images SET note = ?, sort_order = ?, active = ? WHERE id = ?')
      .run(input.note ?? old.note, input.sortOrder ?? old.sort_order, input.active === undefined ? old.active : (input.active ? 1 : 0), id);
    return this.db.prepare('SELECT * FROM product_images WHERE id = ?').get(id) as ProductImageRecord;
  }

  deleteImage(id: number) { this.db.prepare('DELETE FROM product_images WHERE id = ?').run(id); }

  listContents(productId?: number): ContentDraftRecord[] {
    const sql = `SELECT d.*, p.name AS product_name FROM content_drafts d JOIN products p ON p.id = d.product_id
      ${productId ? 'WHERE d.product_id = ?' : ''} ORDER BY d.id DESC`;
    return (productId ? this.db.prepare(sql).all(productId) : this.db.prepare(sql).all()) as ContentDraftRecord[];
  }

  createContent(productId: number, result: AiContentResult, source: 'ai' | 'manual' = 'ai', aiOriginal?: string, styleId?: number | null): ContentDraftRecord {
    const now = nowIso();
    const info = this.db.prepare(`INSERT INTO content_drafts(product_id, title, caption, hashtags, source, status, ai_original, style_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .run(productId, result.title.trim(), result.caption.trim(), result.hashtags.trim(), source, aiOriginal || result.caption.trim(), styleId || null, now, now);
    return this.db.prepare(`SELECT d.*, p.name AS product_name FROM content_drafts d JOIN products p ON p.id = d.product_id WHERE d.id = ?`)
      .get(info.lastInsertRowid) as ContentDraftRecord;
  }

  updateContent(id: number, input: Partial<Pick<ContentDraftRecord, 'title' | 'caption' | 'hashtags' | 'status'>>): ContentDraftRecord {
    const old = this.db.prepare('SELECT * FROM content_drafts WHERE id = ?').get(id) as ContentDraftRecord;
    if (!old) throw new Error('Không tìm thấy nội dung.');
    this.db.prepare('UPDATE content_drafts SET title = ?, caption = ?, hashtags = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(input.title ?? old.title, input.caption ?? old.caption, input.hashtags ?? old.hashtags, input.status ?? old.status, nowIso(), id);
    return this.db.prepare(`SELECT d.*, p.name AS product_name FROM content_drafts d JOIN products p ON p.id = d.product_id WHERE d.id = ?`)
      .get(id) as ContentDraftRecord;
  }

  deleteContent(id: number) { this.db.prepare('DELETE FROM content_drafts WHERE id = ?').run(id); }

  createSocialPost(input: { productId: number; contentId: number; imageIds: number[]; scheduledAt?: string | null; scheduledLocalKey?: string | null; status?: 'draft' | 'scheduled'; mode?: RunMode }): SocialPostRecord {
    const now = nowIso();
    const status = input.status || (input.scheduledAt ? 'scheduled' : 'draft');
    const info = this.db.prepare(`INSERT INTO social_posts(product_id, content_id, platform, image_ids_json, scheduled_at, scheduled_local_key, mode, status, created_at, updated_at)
      VALUES (?, ?, 'facebook', ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.productId, input.contentId, JSON.stringify(input.imageIds), input.scheduledAt || null, input.scheduledLocalKey || null, input.mode || 'test', status, now, now);
    return this.getSocialPost(Number(info.lastInsertRowid))!;
  }

  getSocialPost(id: number): SocialPostRecord | null {
    return (this.db.prepare(`SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags
      FROM social_posts sp JOIN products p ON p.id = sp.product_id
      LEFT JOIN content_drafts d ON d.id = sp.content_id WHERE sp.id = ?`).get(id) as SocialPostRecord) || null;
  }

  listScheduledPosts(): SocialPostRecord[] {
    return this.db.prepare(`SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags
      FROM social_posts sp JOIN products p ON p.id = sp.product_id LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.status IN ('draft','pending','preparing','scheduled','posting','prepared','failed','uncertain','posted')
      ORDER BY CASE WHEN sp.status = 'posted' THEN 1 ELSE 0 END,
               CASE WHEN sp.scheduled_at IS NULL THEN 1 ELSE 0 END,
               CASE WHEN sp.status = 'posted' THEN sp.scheduled_at END DESC,
               CASE WHEN sp.status <> 'posted' THEN sp.scheduled_at END ASC,
               sp.id DESC LIMIT 100`).all() as SocialPostRecord[];
  }

  getDueScheduledPosts(now: string): SocialPostRecord[] {
    return this.db.prepare(`SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags
      FROM social_posts sp JOIN products p ON p.id = sp.product_id LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.status = 'scheduled' AND sp.scheduled_at IS NOT NULL AND sp.scheduled_at <= ?
      ORDER BY sp.scheduled_at LIMIT 5`).all(now) as SocialPostRecord[];
  }

  getRetryableSocialPosts(now: string): SocialPostRecord[] {
    return this.db.prepare(`SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags
      FROM social_posts sp JOIN products p ON p.id = sp.product_id LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.status = 'failed'
        AND sp.error_code = 'NETWORK_ERROR'
        AND sp.retry_count <= 2
        AND sp.next_retry_at IS NOT NULL
        AND sp.next_retry_at <= ?
      ORDER BY sp.next_retry_at LIMIT 1`).all(now) as SocialPostRecord[];
  }

  updateSocialPostStatus(id: number, status: SocialPostRecord['status'], errorMessage: string | null = null, errorCode: PostErrorCode | null = null) {
    const postedAt = status === 'posted' ? nowIso() : null;
    this.db.prepare(`UPDATE social_posts SET status = ?, error_code = ?, error_message = ?, posted_at = COALESCE(?, posted_at), updated_at = ? WHERE id = ?`)
      .run(status, errorCode, errorMessage, postedAt, nowIso(), id);
  }

  bumpSocialPostRetry(id: number, retryCount: number, nextRetryAt: string | null) {
    this.db.prepare('UPDATE social_posts SET retry_count = ?, next_retry_at = ?, updated_at = ? WHERE id = ?')
      .run(retryCount, nextRetryAt, nowIso(), id);
  }

  cancelSocialPost(id: number) { this.updateSocialPostStatus(id, 'cancelled', null, null); }

  addPostAttempt(postId: number, status: string, message = '') {
    this.db.prepare('INSERT INTO post_attempts(social_post_id, status, message, attempted_at) VALUES (?, ?, ?, ?)')
      .run(postId, status, message, nowIso());
  }

  resolveImagePaths(imageIds: number[]): ProductImageRecord[] {
    if (!imageIds.length) return [];
    const q = imageIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM product_images WHERE id IN (${q}) ORDER BY sort_order, id`).all(...imageIds) as ProductImageRecord[];
  }

  markImagesUsed(imageIds: number[]) {
    if (!imageIds.length) return;
    const q = imageIds.map(() => '?').join(',');
    this.db.prepare(`UPDATE product_images SET used_count = used_count + 1, last_used_at = ? WHERE id IN (${q})`).run(nowIso(), ...imageIds);
  }

  markContentUsed(contentId: number | null) {
    if (contentId) this.db.prepare("UPDATE content_drafts SET status = 'used', updated_at = ? WHERE id = ?").run(nowIso(), contentId);
  }

  listPostHistory(limit = 100) {
    return this.db.prepare(`SELECT sp.*, p.name AS product_name, d.title, d.caption, d.hashtags,
      (SELECT COUNT(*) FROM post_attempts a WHERE a.social_post_id = sp.id) AS attempt_count
      FROM social_posts sp JOIN products p ON p.id = sp.product_id LEFT JOIN content_drafts d ON d.id = sp.content_id
      WHERE sp.status IN ('posted','prepared','failed','uncertain','cancelled')
      ORDER BY COALESCE(sp.posted_at, sp.updated_at) DESC LIMIT ?`).all(limit);
  }

  imageUsed(imagePath: string): boolean {
    const row = this.db.prepare('SELECT used_count FROM image_usage WHERE image_path = ?').get(imagePath) as any;
    return !!row && row.used_count > 0;
  }

  imageReusable(imagePath: string, reuseAfterDays: number): boolean {
    const row = this.db.prepare('SELECT last_used_at FROM image_usage WHERE image_path = ?').get(imagePath) as any;
    if (!row?.last_used_at) return true;
    return new Date(row.last_used_at).getTime() <= Date.now() - reuseAfterDays * 86400000;
  }

  getLastPostedAt(productFolder: string): string | null {
    const row = this.db.prepare("SELECT posted_at FROM posts WHERE product_folder = ? AND status = 'posted' ORDER BY posted_at DESC LIMIT 1")
      .get(productFolder) as any;
    return row?.posted_at || null;
  }

  markPost(productName: string, productFolder: string, caption: string, images: string[], status: 'posted' | 'prepared' | 'failed' | 'uncertain', error?: string, extra?: {
    mode?: RunMode; errorCode?: PostErrorCode | null; aiOriginal?: string; userFinal?: string; jobKey?: string | null;
  }) {
    const now = nowIso();
    this.transaction(() => {
      this.db.prepare(`INSERT OR REPLACE INTO posts(product_name, product_folder, caption, images_json, mode, status, error_code, error_message, ai_original, user_final, job_key, created_at, posted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(productName, productFolder, caption, JSON.stringify(images), extra?.mode || 'auto', status,
          extra?.errorCode || null, error || null, extra?.aiOriginal || null, extra?.userFinal || caption,
          extra?.jobKey || null, now, status === 'posted' ? now : null);
      if (status === 'posted') {
        const stmt = this.db.prepare(`INSERT INTO image_usage(image_path, product_folder, used_count, last_used_at)
          VALUES (?, ?, 1, ?) ON CONFLICT(image_path) DO UPDATE SET used_count = used_count + 1, last_used_at = excluded.last_used_at`);
        for (const image of images) stmt.run(image, productFolder, now);
      }
    });
  }

  recentPosts(limit = 50) {
    return this.db.prepare(`SELECT id, product_name, caption, mode, status, error_code, error_message, created_at, posted_at, images_json
      FROM posts ORDER BY id DESC LIMIT ?`).all(limit);
  }

  addLearning(productName: string, aiOriginal: string, userFinal: string) {
    if (!aiOriginal.trim() || !userFinal.trim() || aiOriginal.trim() === userFinal.trim()) return;
    this.db.prepare('INSERT INTO caption_learning(product_name, ai_original, user_final, created_at) VALUES (?, ?, ?, ?)')
      .run(productName, aiOriginal, userFinal, nowIso());
  }

  recentLearning(limit = 10, productName?: string): LearningRecord[] {
    if (productName) {
      return this.db.prepare(`SELECT * FROM caption_learning
        ORDER BY CASE WHEN product_name = ? THEN 0 ELSE 1 END, created_at DESC LIMIT ?`).all(productName, limit) as LearningRecord[];
    }
    return this.db.prepare('SELECT * FROM caption_learning ORDER BY created_at DESC LIMIT ?').all(limit) as LearningRecord[];
  }

  listStyles(): StyleRecord[] {
    return this.db.prepare('SELECT * FROM styles ORDER BY is_default DESC, enabled DESC, name COLLATE NOCASE').all() as StyleRecord[];
  }

  createStyle(name: string, prompt: string, enabled = true): StyleRecord {
    const now = nowIso();
    const info = this.db.prepare('INSERT INTO styles(name, prompt, enabled, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(name.trim(), prompt.trim(), enabled ? 1 : 0, now, now);
    return this.db.prepare('SELECT * FROM styles WHERE id = ?').get(info.lastInsertRowid) as StyleRecord;
  }

  updateStyle(id: number, input: { name?: string; prompt?: string; enabled?: boolean }) {
    const old = this.db.prepare('SELECT * FROM styles WHERE id = ?').get(id) as StyleRecord;
    if (!old) throw new Error('Không tìm thấy style.');
    this.db.prepare('UPDATE styles SET name = ?, prompt = ?, enabled = ?, updated_at = ? WHERE id = ?')
      .run(input.name?.trim() || old.name, input.prompt?.trim() || old.prompt, input.enabled === undefined ? old.enabled : (input.enabled ? 1 : 0), nowIso(), id);
    return this.db.prepare('SELECT * FROM styles WHERE id = ?').get(id) as StyleRecord;
  }

  deleteStyle(id: number) {
    const row = this.db.prepare('SELECT * FROM styles WHERE id = ?').get(id) as StyleRecord;
    if (!row) return;
    if (row.is_default) throw new Error('Không thể xóa style mặc định. Hãy đặt style khác làm mặc định trước.');
    this.db.prepare('DELETE FROM styles WHERE id = ?').run(id);
  }

  setDefaultStyle(id: number) {
    this.transaction(() => {
      this.db.prepare('UPDATE styles SET is_default = 0').run();
      this.db.prepare('UPDATE styles SET is_default = 1, enabled = 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
    });
  }

  getProductLastPostedAt(productId: number): string | null {
    const legacy = this.db.prepare(
      "SELECT posted_at FROM posts WHERE product_folder = ? AND status = 'posted' ORDER BY posted_at DESC LIMIT 1"
    ).get(`catalog:${productId}`) as any;
    const managed = this.db.prepare(
      "SELECT posted_at FROM social_posts WHERE product_id = ? AND status = 'posted' ORDER BY posted_at DESC LIMIT 1"
    ).get(productId) as any;
    const values = [legacy?.posted_at, managed?.posted_at].filter(Boolean).sort().reverse();
    return values[0] || null;
  }

  catalogInventoryStats() {
    const productCount = Number((this.db.prepare("SELECT COUNT(*) c FROM products WHERE active = 1").get() as any)?.c || 0);
    const imageCount = Number((this.db.prepare(`
      SELECT COUNT(*) c
      FROM product_images i
      JOIN products p ON p.id = i.product_id
      WHERE p.active = 1 AND i.active = 1
    `).get() as any)?.c || 0);
    return { productCount, imageCount };
  }

  dashboardSummary(nextPostAt: string | null = null, nextProduct: string | null = null): DashboardSummary {
    const today = new Date().toISOString().slice(0, 10);
    const legacyPosted = Number((this.db.prepare("SELECT COUNT(*) c FROM posts WHERE status='posted' AND substr(posted_at,1,10)=?").get(today) as any)?.c || 0);
    const managedPosted = Number((this.db.prepare("SELECT COUNT(*) c FROM social_posts WHERE status='posted' AND substr(posted_at,1,10)=?").get(today) as any)?.c || 0);
    const legacyFailed = Number((this.db.prepare("SELECT COUNT(*) c FROM posts WHERE status IN ('failed','uncertain') AND substr(created_at,1,10)=?").get(today) as any)?.c || 0);
    const managedFailed = Number((this.db.prepare("SELECT COUNT(*) c FROM social_posts WHERE status IN ('failed','uncertain') AND substr(updated_at,1,10)=?").get(today) as any)?.c || 0);
    return {
      productCount: 0,
      imageCount: 0,
      postedToday: legacyPosted + managedPosted,
      failedToday: legacyFailed + managedFailed,
      nextPostAt,
      nextProduct
    };
  }
}
