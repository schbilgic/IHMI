const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const adsService = require('./services/ads-service');
const userService = require('./services/user-service');
const alarmService = require('./services/alarm-service');
const i18nService = require('./services/i18n-service');
const recipeService = require('./services/recipe-service');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '../frontend')));

let latestDataMap = {};
adsService.setIo(io);

// ==========================================
// SOCKET.IO BAĞLANTI YÖNETİMİ
// ==========================================
io.on('connection', (socket) => {
  console.log('💻 Yeni ekran bağlandı:', socket.id);

  // 1. Canlı PLC verisini hemen yeni bağlanan ekrana fırlat
  if (Object.keys(latestDataMap).length > 0) {
    socket.emit('plc:dataMap', latestDataMap);
  }

  // 2. Mevcut aktif alarmları gönder
  socket.emit('alarms:active', alarmService.getActiveAlarms());

  // 3. Çoklu Dil (i18n) Başlangıç Paketini Gönder
  const activeLang = i18nService.getDefaultLanguage();
  socket.emit('i18n:init', {
    lang: activeLang,
    dictionary: i18nService.getTextDictionary(activeLang)
  });

  // 1. Ekran açıldığında güncel DefaultUser'ı gönder
  socket.emit('auth:defaultUser', i18nService.getDefaultUser());

  // 2. Başarılı login olduğunda DefaultUser'ı güncelle
  socket.on('auth:login', ({ username, password }) => {
    const user = userService.login(username, password);
    if (user) {
      alarmService.setCurrentUser(user.username);

      // hmi_parameters tablosundaki DefaultUser kaydını güncelle
      i18nService.setDefaultUser(user.username);
      io.emit('auth:defaultUser', user.username);

      socket.emit('auth:success', user);
    } else {
      socket.emit('auth:fail', 'Geçersiz kullanıcı adı veya şifre!');
    }
  });

  // ----------------------------------------
  // ÇOKLU DİL (i18n) & TEXTS İŞLEMLERİ
  // ----------------------------------------
  socket.on('i18n:setLanguage', (newLang) => {
    const saved = i18nService.setDefaultLanguage(newLang);
    const dict = i18nService.getTextDictionary(saved);
    io.emit('i18n:changed', { lang: saved, dictionary: dict });
  });

  socket.on('texts:get', () => {
    socket.emit('texts:list', i18nService.getAllTexts());
  });

  socket.on('texts:save', ({ id, tr, en, other }) => {
    try {
      i18nService.upsertText(id, tr, en, other);
      io.emit('texts:list', i18nService.getAllTexts());

      const cur = i18nService.getDefaultLanguage();
      io.emit('i18n:changed', {
        lang: cur,
        dictionary: i18nService.getTextDictionary(cur)
      });
    } catch (err) {
      socket.emit('texts:error', err.message);
    }
  });

  socket.on('texts:delete', (id) => {
    try {
      i18nService.deleteText(id);
      io.emit('texts:list', i18nService.getAllTexts());

      const cur = i18nService.getDefaultLanguage();
      io.emit('i18n:changed', {
        lang: cur,
        dictionary: i18nService.getTextDictionary(cur)
      });
    } catch (err) {
      socket.emit('texts:error', err.message);
    }
  });

  // ----------------------------------------
  // PLC HABERLEŞME İŞLEMLERİ
  // ----------------------------------------
  socket.on('plc:setPageStruct', (structPath) => {
    adsService.setActiveStruct(structPath);
  });

  socket.on('plc:updateActiveSymbols', (symbols) => {
    adsService.setActiveSymbols(symbols);
  });

  socket.on('plc:writeSymbol', (payload) => {
    if (payload && payload.symbol) {
      adsService.writeGenericSymbol(payload.symbol, payload.value);
    }
  });

  // ----------------------------------------
  // ALARM İŞLEMLERİ
  // ----------------------------------------
  socket.on('alarms:getHistory', () => {
    socket.emit('alarms:history', alarmService.getAlarmHistory(100));
  });

  // ----------------------------------------
  // AUTH & KULLANICI İŞLEMLERİ
  // ----------------------------------------
  socket.on('auth:setUser', (username) => {
    alarmService.setCurrentUser(username);
  });

  socket.on('auth:login', ({ username, password }) => {
    const user = userService.login(username, password);
    if (user) {
      alarmService.setCurrentUser(user.username);
      socket.emit('auth:success', user);
    } else {
      socket.emit('auth:fail', 'Geçersiz kullanıcı adı veya şifre!');
    }
  });

  socket.on('users:get', () => {
    socket.emit('users:list', userService.getAllUsers());
  });

  socket.on('users:add', (newUser) => {
    try {
      userService.addUser(newUser.username, newUser.password, newUser.role, newUser.timeout);
      socket.emit('users:list', userService.getAllUsers());
    } catch (err) {
      socket.emit('users:error', 'Kullanıcı eklenemedi.');
    }
  });

  socket.on('users:delete', (id) => {
    userService.deleteUser(id);
    socket.emit('users:list', userService.getAllUsers());
  });

  socket.on('disconnect', () => {
    console.log('Operatör ekranı ayrıldı:', socket.id);
  });

  // 1. Reçete Listesini İste
socket.on('recipes:list', ({ sortBy, sortOrder } = {}) => {
  socket.emit('recipes:listData', recipeService.listRecipes(sortBy, sortOrder));
});

// 2. Belirli bir reçeteyi aç
socket.on('recipes:get', (filename) => {
  const data = recipeService.getRecipe(filename);
  socket.emit('recipes:detail', { filename, data });
});

// 3. Reçete Kaydet (Admin)
socket.on('recipes:save', ({ filename, data }) => {
  const res = recipeService.saveRecipe(filename, data);
  io.emit('recipes:listData', recipeService.listRecipes());
  socket.emit('recipes:saved', res);
});
// 4. Reçete Sil (Admin)
socket.on('recipes:delete', (filename) => {
  recipeService.deleteRecipe(filename);
  io.emit('recipes:listData', recipeService.listRecipes());
});
// 5. Reçeteyi PLC'ye Yaz (Operatör ve Admin kullanabilir)
socket.on('recipes:writeToPlc', async (items) => {
  const res = await recipeService.writeRecipeToPlc(items);
  socket.emit('recipes:writeResult', res);
});

// 6. PLC'den Güncel Değerleri Oku (Admin Düzenleme Modu)
socket.on('recipes:readFromPlc', async (items) => {
  const updatedItems = await recipeService.readRecipeFromPlc(items);
  socket.emit('recipes:readResult', updatedItems);
});
});



// ==========================================
// SUNUCUYU VE ADS SERVİSİNİ BAŞLAT
// ==========================================
const PORT = 3000;
server.listen(PORT, async () => {
  console.log(`🚀 HMI Paneli hazır: http://localhost:${PORT}`);

  await adsService.init((dataMap) => {
    latestDataMap = { ...latestDataMap, ...dataMap };
    io.emit('plc:dataMap', latestDataMap);
  });
});