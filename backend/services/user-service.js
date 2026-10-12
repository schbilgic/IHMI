const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../hmi.db'));

// Tabloyu oluştur
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,          -- 'admin', 'technician', 'operator'
    timeout INTEGER DEFAULT 300  -- saniye cinsinden
  )
`);

// Varsayılan admin kullanıcısını oluştur (Eğer yoksa)
const checkAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!checkAdmin) {
  db.prepare('INSERT INTO users (username, password, role, timeout) VALUES (?, ?, ?, ?)').run(
    'admin',
    '649050',
    'admin',
    600
  );
  console.log('👤 Varsayılan kullanıcı oluşturuldu: admin / 649050');
}

module.exports = {
  login(username, password) {
    return db.prepare('SELECT id, username, role, timeout FROM users WHERE username = ? AND password = ?').get(username, password);
  },
  getAllUsers() {
    return db.prepare('SELECT id, username, role, timeout FROM users').all();
  },
  addUser(username, password, role, timeout) {
    return db.prepare('INSERT INTO users (username, password, role, timeout) VALUES (?, ?, ?, ?)').run(username, password, role, timeout || 300);
  },
  deleteUser(id) {
    return db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
};