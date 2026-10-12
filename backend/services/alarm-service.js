const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../hmi.db'));

// Kalıcı Alarm Geçmiş Tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS alarm_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alarm_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    raised_at TEXT NOT NULL,
    cleared_at TEXT NOT NULL,
    user_at_raise TEXT NOT NULL
  )
`);

// 0..250 Arası Alarm Açıklama Sözlüğü (TEXTS tablosunda yoksa devreye girecek yedek liste)
const ALARM_DEFINITIONS = {
  0: 'Acil Stop Butonuna Basıldı (E-Stop)',
  1: 'Güvenlik Kapısı Emniyet Şalteri Açık',
  2: 'Ana Motor Termik Röle Attı (Overload)',
  3: 'Hidrolik Basınç Düşük (Min Limit Hatası)',
  4: 'Fırın Bölgesi Aşırı Sıcaklık (Termokupl)',
  5: 'Kalıp Kapatma Zaman Aşımı (Timeout)',
  6: 'Hava Basıncı Yetersiz (< 5.5 Bar)',
  7: 'Taşıyıcı Eksen Sürücü Hatası (Drive Fault)',
  8: 'Soğutma Suyu Akış Hatası',
  9: 'Hammadde Seviyesi Kritik Düşük'
};

class AlarmService {
  constructor() {
    this.previousStates = new Array(251).fill(false);
    this.activeAlarms = new Map();
    this.currentUser = 'NoOne';
    this.ALARM_TEXT_OFFSET = 1000; // Alarm ID -> TEXTS tablosunda 1000 + ID
  }

  setCurrentUser(username) {
    this.currentUser = username || 'NoOne';
  }

  getAlarmDescription(id) {
    return ALARM_DEFINITIONS[id] || `Sistem Alarmı (AL_${id})`;
  }

  // ads-client tipini (Buffer, Array, Object) standart boolean değere çevirir
  extractBoolValue(rawContainer, index) {
    if (!rawContainer) return false;

    if (Buffer.isBuffer(rawContainer)) {
      return index < rawContainer.length ? rawContainer[index] !== 0 : false;
    }

    if (Array.isArray(rawContainer)) {
      return Boolean(rawContainer[index]);
    }

    if (typeof rawContainer === 'object') {
      return Boolean(rawContainer[index] !== undefined ? rawContainer[index] : rawContainer[String(index)]);
    }

    return false;
  }

  processAlarmArray(rawAlarms) {
    if (!rawAlarms) return false;

    let hasChange = false;
    const nowStr = new Date().toLocaleString('tr-TR', { hour12: false });

    for (let id = 0; id <= 250; id++) {
      const currentState = this.extractBoolValue(rawAlarms, id);
      const prevState = this.previousStates[id];

      // 1. YÜKSELEN KENAR: Alarm Aktifleşti
      if (currentState && !prevState) {
        hasChange = true;
        const desc = this.getAlarmDescription(id);
        const textId = this.ALARM_TEXT_OFFSET + id;

        this.activeAlarms.set(id, {
          id: id,
          textId: textId, // Çoklu dil için TEXTS ID eşleşmesi
          description: desc,
          raisedAt: nowStr,
          activeUser: this.currentUser
        });
        console.log(`🚨 [ALARM AKTİF] #${id} (TextId: ${textId}): ${desc} | Kullanıcı: ${this.currentUser}`);
      }
      // 2. DÜŞEN KENAR: Alarm Pasife Düştü -> SQLite'a Yaz
      else if (!currentState && prevState) {
        hasChange = true;
        const activeItem = this.activeAlarms.get(id);
        const clearedAtStr = nowStr;

        if (activeItem) {
          try {
            db.prepare(`
              INSERT INTO alarm_history (alarm_id, description, raised_at, cleared_at, user_at_raise)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              id,
              activeItem.description,
              activeItem.raisedAt,
              clearedAtStr,
              activeItem.activeUser
            );
            console.log(`💾 [ALARM LOGLANDI] #${id} | Başlangıç: ${activeItem.raisedAt} -> Bitiş: ${clearedAtStr}`);
          } catch (dbErr) {
            console.error('❌ Alarm SQLite Kayıt Hatası:', dbErr.message);
          }
          this.activeAlarms.delete(id);
        }
      }

      this.previousStates[id] = currentState;
    }

    return hasChange;
  }

  getActiveAlarms() {
    return Array.from(this.activeAlarms.values());
  }

  getAlarmHistory(limit = 100) {
    const rows = db.prepare(`
      SELECT id, alarm_id, (alarm_id + ?) AS textId, description, raised_at, cleared_at, user_at_raise 
      FROM alarm_history 
      ORDER BY id DESC 
      LIMIT ?
    `).all(this.ALARM_TEXT_OFFSET, limit);

    return rows;
  }
}

module.exports = new AlarmService();