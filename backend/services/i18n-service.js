const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../hmi.db'));

// Tabloları oluştur
db.exec(`
  CREATE TABLE IF NOT EXISTS texts (
    id INTEGER PRIMARY KEY,
    tr TEXT NOT NULL,
    en TEXT NOT NULL,
    other TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hmi_parameters (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Varsayılan Dil Parametresini Başlat (Yoksa TR)
const paramLangExists = db.prepare('SELECT value FROM hmi_parameters WHERE key = ?').get('DefaultLanguage');
if (!paramLangExists) {
  db.prepare('INSERT INTO hmi_parameters (key, value) VALUES (?, ?)').run('DefaultLanguage', 'TR');
}

// Varsayılan Kullanıcı Parametresini Başlat (Yoksa operator)
const paramUserExists = db.prepare('SELECT value FROM hmi_parameters WHERE key = ?').get('DefaultUser');
if (!paramUserExists) {
  db.prepare('INSERT INTO hmi_parameters (key, value) VALUES (?, ?)').run('DefaultUser', 'operator');
}

class I18nService {
  getAllTexts() {
    return db.prepare('SELECT * FROM texts ORDER BY id ASC').all();
  }

  getTextDictionary(lang = 'TR') {
    const col = ['TR', 'EN', 'OTHER'].includes(lang.toUpperCase()) ? lang.toLowerCase() : 'tr';
    const rows = db.prepare(`SELECT id, ${col} as txt FROM texts`).all();
    const dict = {};
    for (const r of rows) {
      dict[r.id] = r.txt;
    }
    return dict;
  }

  upsertText(id, tr, en, other) {
    return db.prepare(`
      INSERT INTO texts (id, tr, en, other)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tr = excluded.tr,
        en = excluded.en,
        other = excluded.other
    `).run(Number(id), tr, en, other);
  }

  deleteText(id) {
    return db.prepare('DELETE FROM texts WHERE id = ?').run(Number(id));
  }

  getDefaultLanguage() {
    const row = db.prepare('SELECT value FROM hmi_parameters WHERE key = ?').get('DefaultLanguage');
    return row ? row.value : 'TR';
  }

  setDefaultLanguage(lang) {
    const validLang = ['TR', 'EN', 'OTHER'].includes(lang) ? lang : 'TR';
    db.prepare('INSERT OR REPLACE INTO hmi_parameters (key, value) VALUES (?, ?)').run('DefaultLanguage', validLang);
    return validLang;
  }

  // Varsayılan Kullanıcıyı Oku
  getDefaultUser() {
    const row = db.prepare('SELECT value FROM hmi_parameters WHERE key = ?').get('DefaultUser');
    return row ? row.value : 'operator';
  }

  // Varsayılan Kullanıcıyı Güncelle
  setDefaultUser(username) {
    const validUser = username && username !== 'NoOne' ? username : 'operator';
    db.prepare('INSERT OR REPLACE INTO hmi_parameters (key, value) VALUES (?, ?)').run('DefaultUser', validUser);
    return validUser;
  }
}

module.exports = new I18nService();