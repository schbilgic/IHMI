const ads = require('ads-client');
const config = require('../config/plc-config');
const alarmService = require('./alarm-service');

class AdsService {
  constructor() {
    this.client = new ads.Client({
      targetAmsNetId: config.amsNetId,
      targetAdsPort: config.adsPort,
    });
    this.isConnected = false;

    this.globalStructPath = 'GVL_HMI.stGlobal';
    this.activePageStructPath = 'GVL_HMI.stDashboard';

    this.cachedGlobalSym = null;
    this.cachedPageSym = null;
    this.symbolCache = new Map();
    this.ioRef = null;
  }

  setIo(ioInstance) {
    this.ioRef = ioInstance;
  }

  async init(onDataCallback) {
    try {
      await this.client.connect();
      this.isConnected = true;
      console.log('✅ TwinCAT ADS Bağlantısı sağlandı.');
      // PLC'deki stRecipes sembollerini terminale dök:
      if (this.client.symbols) {
        const recipeSyms = Object.keys(this.client.symbols).filter(s => s.toLowerCase().includes('recipes'));
        console.log('🔍 PLC\'de Bulunan Reçete Sembolleri:\n', recipeSyms);
      }
      const pollLoop = async () => {
        if (this.isConnected) {
          const combinedPayload = {};

          // 1. Sabit GVL_HMI.stGlobal Okuma
          try {
            if (!this.cachedGlobalSym) {
              this.cachedGlobalSym = await this.client.getSymbol(this.globalStructPath);
            }
            if (this.cachedGlobalSym) {
              const res = await this.client.readValueBySymbol(this.cachedGlobalSym);
              const data = res && typeof res === 'object' && 'value' in res ? res.value : res;

              if (data) {
                // Alarms / alarms dizisini yakala
                const rawAlarms = data.Alarms !== undefined ? data.Alarms : data.alarms;
                if (rawAlarms) {
                  const stateChanged = alarmService.processAlarmArray(rawAlarms);
                  if (stateChanged && this.ioRef) {
                    this.ioRef.emit('alarms:active', alarmService.getActiveAlarms());
                  }
                }
                this.flattenToPayload(combinedPayload, this.globalStructPath, data);
              }
            }
          } catch (err) {
            this.cachedGlobalSym = null;
          }

          // 2. Dinamik Aktif Sayfa Struct Okuma
          if (this.activePageStructPath) {
            try {
              if (!this.cachedPageSym) {
                this.cachedPageSym = await this.client.getSymbol(this.activePageStructPath);
              }
              if (this.cachedPageSym) {
                const res = await this.client.readValueBySymbol(this.cachedPageSym);
                const data = res && typeof res === 'object' && 'value' in res ? res.value : res;
                this.flattenToPayload(combinedPayload, this.activePageStructPath, data);
              }
            } catch (err) {
              this.cachedPageSym = null;
            }
          }

          if (Object.keys(combinedPayload).length > 0 && onDataCallback) {
            onDataCallback(combinedPayload);
          }
        }

        setTimeout(pollLoop, config.cycleTimeMs || 100);
      };

      pollLoop();

    } catch (err) {
      console.error('❌ ADS Servis Hatası:', err.message);
      this.isConnected = false;
    }
  }

  flattenToPayload(targetObj, structPrefix, dataObj) {
    if (!dataObj || typeof dataObj !== 'object') return;
    for (const [key, val] of Object.entries(dataObj)) {
      targetObj[`${structPrefix}.${key}`] = val;
      targetObj[key] = val;
    }
  }

  setActiveStruct(structPath) {
    if (structPath === this.activePageStructPath) return;

    console.log(`\n🔄 [SAYFA GEÇİŞİ]`);
    console.log(`   Sabit Blok : ${this.globalStructPath}`);
    console.log(`   Yeni Sayfa : ${structPath || 'Yok (Settings)'}`);

    this.activePageStructPath = structPath;
    this.cachedPageSym = null;
  }

  setActiveSymbols(symbols) {
    if (typeof symbols === 'string') {
      this.setActiveStruct(symbols);
    }
  }

  // backend/services/ads-service.js içindeki safeRead ve writeGenericSymbol:

  async safeRead(symbolPath) {
    if (!this.client || !this.client.connection || !this.client.connection.connected) {
      console.error('❌ safeRead: ADS istemcisi bağlı değil.');
      return null;
    }

    const cleanPath = symbolPath.trim();

    try {
      const res = await this.client.readValue(cleanPath);

      // readValue { value: ..., rawValue: ..., dataType: ... } nesnesi döner
      if (res !== null && res !== undefined && typeof res === 'object' && res.value !== undefined) {
        return res.value;
      }
      return res;
    } catch (err) {
      console.error(`❌ safeRead Hatası [${cleanPath}]:`, err.message || err);
      throw err;
    }
  }

  async writeGenericSymbol(symbolPath, value) {
    if (!this.client || !this.client.connection || !this.client.connection.connected) {
      console.error('❌ writeGenericSymbol: ADS istemcisi bağlı değil.');
      return false;
    }

    const cleanPath = symbolPath.trim();

    try {
      // Doğrudan writeValue kullanılır
      await this.client.writeValue(cleanPath, value);
      console.log(`✅ [ADS YAZILDI] ${cleanPath} =`, value);
      return true;
    } catch (err) {
      console.error(`❌ writeGenericSymbol Hatası [${cleanPath}]:`, err.message || err);
      return false;
    }
  }

  // Sembol tablosunu PLC'den yeniden yükle
  async refreshSymbols() {
    if (!this.client) return;
    try {
      console.log('🔄 ADS Sembol tablosu PLC\'den yeniden çekiliyor...');
      if (typeof this.client.readAndCacheSymbols === 'function') {
        await this.client.readAndCacheSymbols();
      } else if (typeof this.client.getSymbols === 'function') {
        await this.client.getSymbols();
      }
      console.log('✅ Sembol tablosu güncellendi.');
    } catch (err) {
      console.warn('⚠️ Sembol tablosu yenilenemedi:', err.message);
    }
  }

  
}

module.exports = new AdsService();