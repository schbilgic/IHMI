const fs = require('fs');
const path = require('path');
const adsService = require('./ads-service');

const RECIPES_DIR = path.join(__dirname, '../recipes');

if (!fs.existsSync(RECIPES_DIR)) {
  fs.mkdirSync(RECIPES_DIR, { recursive: true });
}

// Dosya adını güvenli hale getirme yardımcısı
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-ığüşöçİĞÜŞÖÇ]/g, '_');
}

class RecipeService {
  listRecipes(sortBy = 'name', sortOrder = 'asc') {
    if (!fs.existsSync(RECIPES_DIR)) return [];
    const files = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.json'));

    let list = files.map(filename => {
      const filePath = path.join(RECIPES_DIR, filename);
      const stat = fs.statSync(filePath);
      let content = { name: filename.replace('.json', ''), items: [] };
      try {
        content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {}

      return {
        filename,
        name: content.name || filename.replace('.json', ''),
        itemCount: Array.isArray(content.items) ? content.items.length : 0,
        createdAt: stat.birthtimeMs || stat.ctimeMs,
        updatedAt: stat.mtimeMs,
        createdDateStr: new Date(stat.birthtimeMs || stat.ctimeMs).toLocaleString('tr-TR'),
        updatedDateStr: new Date(stat.mtimeMs).toLocaleString('tr-TR')
      };
    });

    list.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === 'string') {
        const cmp = valA.localeCompare(valB, 'tr');
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      return sortOrder === 'asc' ? (valA - valB) : (valB - valA);
    });

    return list;
  }

  getRecipe(filename) {
    const safeName = path.basename(filename);
    const filePath = path.join(RECIPES_DIR, safeName);
    if (!fs.existsSync(filePath)) return null;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data;
    } catch (e) {
      return null;
    }
  }

  // Kaydet / Farklı Kaydet
  saveRecipe(filename, data) {
    let cleanBase = sanitizeFilename(data.name || filename.replace('.json', ''));
    if (!cleanBase) cleanBase = `recipe_${Date.now()}`;
    const targetFilename = `${cleanBase}.json`;
    const filePath = path.join(RECIPES_DIR, targetFilename);

    const payload = {
      name: data.name || cleanBase,
      updatedAt: new Date().toISOString(),
      items: Array.isArray(data.items) ? data.items.map(it => ({
        name: String(it.name || ''),
        path: String(it.path || ''),
        val: it.val !== undefined ? it.val : ''
      })) : []
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { success: true, filename: targetFilename };
  }

  deleteRecipe(filename) {
    const safeName = path.basename(filename);
    const filePath = path.join(RECIPES_DIR, safeName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  // PLC'den Canlı Değer Oku
async readRecipeFromPlc(items) {
    if (!Array.isArray(items)) return [];

    const updated = [];
    for (const item of items) {
      const cleanPath = (item.path || '').trim();
      let readVal = '-';

      if (cleanPath) {
        try {
          const val = await adsService.safeRead(cleanPath);
          readVal = (val !== null && val !== undefined) ? val : '-';
        } catch (e) {
          readVal = 'HATA';
        }
      }

      updated.push({
        name: item.name || '',
        path: cleanPath,
        val: item.val !== undefined ? item.val : '',
        plcVal: readVal
      });
    }

    return updated;
  }

  // PLC'ye Yaz (Listenin ilk elemanı dahil tüm parametreleri yazar)
  async writeRecipeToPlc(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: 'Parametre listesi boş' };
    }

    const errors = [];
    const results = [];

    for (const item of items) {
      const cleanPath = (item.path || '').trim();
      if (!cleanPath) continue;

      let valToWrite = item.val;

      // Tip Dönüşümü (Ham hassasiyet korunur)
      if (typeof valToWrite === 'string') {
        const trimmed = valToWrite.trim();
        if (trimmed.toLowerCase() === 'true') {
          valToWrite = true;
        } else if (trimmed.toLowerCase() === 'false') {
          valToWrite = false;
        } else if (!isNaN(trimmed) && trimmed !== '') {
          // Sayısal değer (FLOAT, INT vb.)
          valToWrite = Number(trimmed);
        } else {
          // Metin değeri (STRING)
          valToWrite = String(trimmed);
        }
      }

      const ok = await adsService.writeGenericSymbol(cleanPath, valToWrite);
      results.push({ path: cleanPath, success: ok });
      if (!ok) {
        errors.push(cleanPath);
      }
    }

    return {
      success: errors.length === 0,
      total: items.length,
      failures: errors.length,
      failedPaths: errors,
      results
    };
  }
}

module.exports = new RecipeService();