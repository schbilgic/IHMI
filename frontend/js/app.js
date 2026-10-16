const socket = io();

// --- UI REFERANSLARI ---
const elPlcStatus = document.getElementById('plc-status');
const elStateBadge = document.getElementById('state-badge');
const elAlarmBadge = document.getElementById('alarm-badge');
const userRoleBadge = document.getElementById('user-role-badge');
const btnLoginDialog = document.getElementById('btn-login-dialog');
const btnNavSystem = document.getElementById('btn-nav-system');

// Login Modal Elemanları
const loginModal = document.getElementById('login-modal');
const btnDoLogin = document.getElementById('btn-do-login');
const btnCloseLogin = document.getElementById('btn-close-login');
const btnDoLogout = document.getElementById('btn-do-logout');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginErrorMsg = document.getElementById('login-error');
//
const recipeManager = new RecipeManager(socket);
window.recipeManager = recipeManager; // HTML içi onclick'lerin erişebilmesi için window'a bağla
// --- YETKİ SEVİYELERİ VE OTURUM DURUMU ---
const ROLES = { NoOne: 0, operator: 1, technician: 2, admin: 3 };
let currentUser = { username: 'NoOne', role: 'NoOne', timeout: 0 };
let inactivityTimer = null;

// Numpad ve Dokunmatik Klavye Bileşenleri
let hmiNumpad = typeof HmiNumpad !== 'undefined' ? new HmiNumpad(socket) : null;
let hmiKeyboard = typeof HmiKeyboard !== 'undefined' ? new HmiKeyboard(socket) : null;

// --- ÇOKLU DİL (i18n) VE SÖZLÜK DURUMU ---
let currentLang = 'TR';
let i18nDict = {};

function applyTranslations(container = document) {
  if (!i18nDict || Object.keys(i18nDict).length === 0) return;

  container.querySelectorAll('[data-i18n]').forEach((el) => {
    const id = el.dataset.i18n;
    if (i18nDict[id] !== undefined && i18nDict[id] !== null) {
      if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
        el.setAttribute('placeholder', i18nDict[id]);
      } else {
        el.textContent = i18nDict[id];
      }
    }
  });
}

socket.on('i18n:init', ({ lang, dictionary }) => {
  currentLang = lang || 'TR';
  i18nDict = dictionary || {};
  applyTranslations();

  const selLang = document.getElementById('select-default-language');
  if (selLang) selLang.value = currentLang;

  if (router && router.currentView === 'alarms') {
    if (alarmViewMode === 'active') renderActiveAlarmsTable();
    else renderHistoryAlarmsTable();
  }
});

socket.on('i18n:changed', ({ lang, dictionary }) => {
  currentLang = lang || 'TR';
  i18nDict = dictionary || {};
  applyTranslations();

  const selLang = document.getElementById('select-default-language');
  if (selLang) selLang.value = currentLang;

  // Dil değiştiğinde alarm tablolarını anında yeni dille çiz
  if (router && router.currentView === 'alarms') {
    if (alarmViewMode === 'active') renderActiveAlarmsTable();
    else renderHistoryAlarmsTable();
  }
});

// --- SAYFA - PLC STRUCT EŞLEME TABLOSU ---
const PAGE_STRUCT_MAP = {
  dashboard: 'GVL_HMI.stDashboard',
  carriage: 'GVL_HMI.stCarriage',
  mold: 'GVL_HMI.stMold',
  auxilaries: 'GVL_HMI.stAux',
  alarms: null,
  recipes: 'GVL_HMI.stRecipes',
  settings: null,
  texts: null,
  controls: null
};

// --- ALARM MODÜLÜ STATE YÖNETİMİ ---
let currentActiveAlarms = [];
let currentAlarmHistory = [];
let alarmViewMode = 'active'; // 'active' veya 'history'
let alarmSearchFilter = '';

const alarmSortState = {
  active: { col: 'id', order: 'asc', type: 'num' },
  history: { col: 'alarm_id', order: 'desc', type: 'num' }
};

// --- VIEW ROUTER BAŞLATMA ---
const router = new ViewRouter('app-content', (viewName) => {
  updateNavButtons(viewName);
  applyPermissions();
  bindHmiButtons();
  applyTranslations();

  // Aktif sayfa struct senkronizasyonu
  const targetStruct = PAGE_STRUCT_MAP[viewName];
  if (socket.connected) {
    socket.emit('plc:setPageStruct', targetStruct || null);
  }

  // Sayfa özel başlatıcıları
  if (viewName === 'settings') {
    initSettingsView();
  } else if (viewName === 'alarms') {
    initAlarmsView();
  } else if (viewName === 'texts') {
    initTextsView();
  } 
    if (viewName === 'recipes') {
    if (window.recipeManager) window.recipeManager.initView();
  } else if (viewName === 'controls') {
    // 👈 Controls sayfası açıldığında buton ve kart tıklamalarını hazırla
    bindHmiButtons();
    applyPermissions();
    
  }



  
});

// Alt Navigasyon Çubuğu Buton Vurgusu
function updateNavButtons(activeViewName) {
  document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('nav-btn-active', btn.dataset.page === activeViewName);
  });
}

// --- BUTON ETKİLEŞİMLERİ (MOMENTARY & TOGGLE) ---
function bindHmiButtons() {
  // Momentary Butonlar (Basılı tutunca TRUE, bırakınca FALSE)
  document.querySelectorAll('.hmi-btn[data-type="momentary"]').forEach((btn) => {
    const symbol = btn.dataset.symbol;
    if (!symbol) return;

    const sendState = (val) => {
      if (!btn.classList.contains('hmi-disabled')) {
        socket.emit('plc:writeSymbol', { symbol, value: val });
      }
    };

    btn.onmousedown = () => sendState(true);
    btn.onmouseup = () => sendState(false);
    btn.onmouseleave = () => sendState(false);
    btn.ontouchstart = (e) => { e.preventDefault(); sendState(true); };
    btn.ontouchend = (e) => { e.preventDefault(); sendState(false); };
  });

  // Toggle Butonlar
  document.querySelectorAll('.hmi-btn[data-type="toggle"]').forEach((btn) => {
    const symbol = btn.dataset.symbol;
    if (!symbol) return;

    btn.onclick = (e) => {
      e.preventDefault();
      if (btn.classList.contains('hmi-disabled')) return;

      const isCurrentlyActive = btn.classList.contains('btn-active');
      socket.emit('plc:writeSymbol', { symbol, value: !isCurrentlyActive });
    };
  });
}

// --- PLC CANLI VERİ DİNLEYİCİSİ VE KART GÜNCELLEME ---
socket.on('plc:dataMap', (dataMap) => {
  // Kartları Güncelle
  document.querySelectorAll('#app-content [data-symbol]').forEach((card) => {
    if (hmiNumpad && hmiNumpad.isOpen && hmiNumpad.isOpen() && hmiNumpad.activeContext.element === card) {
      return;
    }

    const symbolPath = card.dataset.symbol;
    if (!symbolPath) return;

    let rawVal = dataMap[symbolPath];
    if (rawVal === undefined) {
      const propName = symbolPath.includes('.') ? symbolPath.split('.').pop() : symbolPath;
      rawVal = dataMap[propName];
    }

    if (rawVal !== undefined && rawVal !== null) {
      const valSpan = card.querySelector('.metric-value');
      if (valSpan) {
        const decimals = card.dataset.format !== undefined ? parseInt(card.dataset.format, 10) : 1;
        valSpan.textContent = typeof rawVal === 'number' ? rawVal.toFixed(decimals) : rawVal;
      }
      updateHmiBars(data);
    }
  });

  // Toggle & Feedback Buton Durumları
  document.querySelectorAll('#app-content .hmi-btn[data-type="toggle"], #app-content .hmi-btn[data-feedback]').forEach((btn) => {
    const path = btn.dataset.feedback || btn.dataset.symbol;
    if (!path) return;

    let val = dataMap[path];
    if (val === undefined) {
      const prop = path.includes('.') ? path.split('.').pop() : path;
      val = dataMap[prop];
    }

    if (val !== undefined) {
      btn.classList.toggle('btn-active', Boolean(val));
    }
  });

    /**
   * Sayfadaki tüm dinamik bar göstergelerini PLC verisine göre günceller
   * @param {Object} payload - Socket'ten gelen sembol-değer haritası
   */
  function updateHmiBars(payload) {
    if (!payload || typeof payload !== 'object') return;

    const barCards = document.querySelectorAll('.hmi-bar-card');

    barCards.forEach(card => {
      const symbol = card.getAttribute('data-symbol');
      if (!symbol || payload[symbol] === undefined) return;

      const rawVal = payload[symbol];
      const numVal = Number(rawVal);
      if (isNaN(numVal)) return;

      // Skala Değerleri
      const min = parseFloat(card.getAttribute('data-min')) || 0;
      const max = parseFloat(card.getAttribute('data-max')) || 100;
      const decimals = parseInt(card.getAttribute('data-format') || '1', 10);

      // 1. Yüzde Hesaplama (0% ile 100% arasına sınırla)
      let percent = ((numVal - min) / (max - min)) * 100;
      percent = Math.max(0, Math.min(100, percent));

      // 2. Bar Genişliğini Güncelle
      const fillBar = card.querySelector('.bar-fill');
      if (fillBar) {
        fillBar.style.width = `${percent.toFixed(1)}%`;

        // İsteğe Bağlı: %90 üzerine çıkınca uyarı rengi (Kırmızı/Turuncu)
        if (percent >= 90) {
          fillBar.style.background = 'linear-gradient(90deg, #f87171, #ef4444)';
        } else if (percent >= 75) {
          fillBar.style.background = 'linear-gradient(90deg, #fbbf24, #d97706)';
        } else {
          // Varsayılan gradyan (Örnek: Mavi veya Yeşil)
          fillBar.style.background = card.getAttribute('data-bar-color') || '';
        }
      }

      // 3. Rakam Metnini Güncelle
      const textVal = card.querySelector('.bar-value');
      if (textVal) {
        textVal.textContent = numVal.toFixed(decimals);
      }
    });
  }

  // Genel Makine Durum Rozeti
  const isAlarm = Boolean(dataMap['GVL_HMI.stGlobal.bAlarmActive'] || dataMap['bAlarmActive']);
  const isRunning = Boolean(dataMap['GVL_HMI.stGlobal.bRunning'] || dataMap['bRunning']);

  if (elStateBadge) {
    if (isAlarm) {
      elStateBadge.textContent = (i18nDict && i18nDict[5]) ? i18nDict[5] : 'ALARM / ARIZA';
      elStateBadge.style.background = 'var(--red)';
    } else if (isRunning) {
      elStateBadge.textContent = (i18nDict && i18nDict[4]) ? i18nDict[4] : 'ÜRETİMDE';
      elStateBadge.style.background = 'var(--green)';
    } else {
      elStateBadge.textContent = (i18nDict && i18nDict[3]) ? i18nDict[3] : 'DURDU';
      elStateBadge.style.background = '#334155';
    }
  }
});

// --- ALARM YÖNETİMİ, SIRALAMA VE FİLTRELEME MOTORU ---

// Tarih Ayrıştırıcı (DD.MM.YYYY HH:MM:SS formatı)
function parseDateForSort(valStr) {
  if (!valStr) return 0;
  const parts = valStr.split(/[\s,]+/);
  if (parts.length >= 2) {
    const dmy = parts[0].split(/[./-]/);
    const hms = parts[1].split(':');
    if (dmy.length === 3 && hms.length >= 2) {
      return new Date(
        parseInt(dmy[2], 10),
        parseInt(dmy[1], 10) - 1,
        parseInt(dmy[0], 10),
        parseInt(hms[0], 10),
        parseInt(hms[1], 10),
        parseInt(hms[2] || 0, 10)
      ).getTime();
    }
  }
  const fallback = Date.parse(valStr);
  return isNaN(fallback) ? 0 : fallback;
}

// Veri Tipine Göre Sıralama (Sayı, Tarih, Metin)
function sortAlarmList(list, col, order, type) {
  return [...list].sort((a, b) => {
    let valA = a[col] !== undefined ? a[col] : '';
    let valB = b[col] !== undefined ? b[col] : '';

    let diff = 0;
    if (type === 'num') {
      diff = Number(valA) - Number(valB);
    } else if (type === 'date') {
      diff = parseDateForSort(valA) - parseDateForSort(valB);
    } else {
      diff = String(valA).localeCompare(String(valB), 'tr');
    }

    return order === 'asc' ? diff : -diff;
  });
}

// Sadece Geçmiş Tablosunda Çalışan Filtreleme
function filterHistoryList(list) {
  if (!alarmSearchFilter) return list;
  const q = alarmSearchFilter.toLowerCase();

  return list.filter(item => {
    const id = String(item.alarm_id !== undefined ? item.alarm_id : item.id || '');
    const desc = String(item.displayDescription || item.description || '').toLowerCase();
    const user = String(item.user_at_raise || item.activeUser || '').toLowerCase();
    const raised = String(item.raised_at || item.raisedAt || '').toLowerCase();
    const cleared = String(item.cleared_at || '').toLowerCase();

    return id.includes(q) || desc.includes(q) || user.includes(q) || raised.includes(q) || cleared.includes(q);
  });
}

// 1. Aktif Alarmlar Tablosu (Filtresiz)
function renderActiveAlarmsTable() {
  const tbody = document.getElementById('active-alarm-body');
  const countEl = document.getElementById('active-alarm-count');
  if (!tbody) return;

  // Açıklamayı i18n sözlüğünden çöz (yoksa varsayılan açıklamayı kullan)
  const preparedList = currentActiveAlarms.map((a) => {
    const tId = a.textId !== undefined ? a.textId : (1000 + Number(a.id));
    return {
      ...a,
      displayDescription: (i18nDict && i18nDict[tId]) ? i18nDict[tId] : (a.description || `Alarm #${a.id}`)
    };
  });

  const cfg = alarmSortState.active;
  const sorted = sortAlarmList(preparedList, cfg.col, cfg.order, cfg.type);

  if (countEl) countEl.textContent = sorted.length;

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-alarm-msg">Şu anda aktif bir alarm bulunmuyor. Sistem normal.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((a) => `
    <tr class="alarm-row-active">
      <td><strong>#${a.id}</strong></td>
      <td>${a.displayDescription}</td>
      <td>${a.raisedAt}</td>
      <td><span class="role-badge role-${a.activeUser ? a.activeUser.toLowerCase() : 'none'}">${a.activeUser}</span></td>
    </tr>
  `).join('');
}

// 2. Geçmiş Alarmlar Tablosu (Filtreli)
function renderHistoryAlarmsTable() {
  const tbody = document.getElementById('history-alarm-body');
  const countEl = document.getElementById('history-alarm-count');
  if (!tbody) return;

  const preparedList = currentAlarmHistory.map((h) => {
    const tId = h.textId !== undefined ? h.textId : (1000 + Number(h.alarm_id));
    return {
      ...h,
      displayDescription: (i18nDict && i18nDict[tId]) ? i18nDict[tId] : (h.description || `Alarm #${h.alarm_id}`)
    };
  });

  const filtered = filterHistoryList(preparedList);
  const cfg = alarmSortState.history;
  const sorted = sortAlarmList(filtered, cfg.col, cfg.order, cfg.type);

  if (countEl) countEl.textContent = sorted.length;

  if (sorted.length === 0) {
    const msg = alarmSearchFilter ? 'Aramanıza uygun geçmiş kayıt bulunamadı.' : 'Kayıtlı alarm geçmişi bulunamadı.';
    tbody.innerHTML = `<tr><td colspan="5" class="empty-alarm-msg">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((h) => `
    <tr>
      <td>#${h.alarm_id}</td>
      <td>${h.displayDescription}</td>
      <td>${h.raised_at}</td>
      <td style="color: var(--green);">${h.cleared_at || '-'}</td>
      <td>${h.user_at_raise}</td>
    </tr>
  `).join('');
}

// 3. Alarms Sayfası Başlatıcı
function initAlarmsView() {
  const tabActive = document.getElementById('alarm-tab-active');
  const tabHistory = document.getElementById('alarm-tab-history');
  const activeActions = document.getElementById('alarm-active-actions');
  const historySearch = document.getElementById('alarm-history-search');

  const btnToggleView = document.getElementById('btn-toggle-alarm-view');
  const switchText = document.getElementById('alarm-switch-text');

  const filterInput = document.getElementById('alarm-filter-input');
  const btnSearch = document.getElementById('btn-alarm-search');
  const btnClear = document.getElementById('btn-alarm-clear-filter');

  function setViewMode(mode) {
    alarmViewMode = mode;
    const switchSvgUse = document.querySelector('#alarm-switch-svg use');

    if (mode === 'active') {
      if (tabActive) tabActive.classList.remove('hidden');
      if (tabHistory) tabHistory.classList.add('hidden');
      if (activeActions) activeActions.classList.remove('hidden');
      if (historySearch) historySearch.classList.add('hidden');
      if (switchSvgUse) switchSvgUse.setAttribute('href', '#icon-calendar');
      if (switchText) switchText.textContent = (i18nDict && i18nDict[8]) ? i18nDict[8] : 'Alarm Geçmişi';
      renderActiveAlarmsTable();
    } else {
      if (tabActive) tabActive.classList.add('hidden');
      if (tabHistory) tabHistory.classList.remove('hidden');
      if (activeActions) activeActions.classList.add('hidden');
      if (historySearch) historySearch.classList.remove('hidden');
      if (switchSvgUse) switchSvgUse.setAttribute('href', '#icon-alarm');
      if (switchText) switchText.textContent = (i18nDict && i18nDict[7]) ? i18nDict[7] : 'Aktif Alarmlar';
      socket.emit('alarms:getHistory');
      renderHistoryAlarmsTable();
    }
  }

  if (btnToggleView) {
    btnToggleView.onclick = () => {
      setViewMode(alarmViewMode === 'active' ? 'history' : 'active');
    };
  }

  const applyFilter = () => {
    alarmSearchFilter = (filterInput ? filterInput.value : '').trim();
    renderHistoryAlarmsTable();
  };

  if (btnSearch) btnSearch.onclick = applyFilter;
  if (filterInput) {
    filterInput.onkeydown = (e) => {
      if (e.key === 'Enter') applyFilter();
    };
  }

  if (btnClear) {
    btnClear.onclick = () => {
      if (filterInput) filterInput.value = '';
      alarmSearchFilter = '';
      applyFilter();
    };
  }

  document.querySelectorAll('.alarm-table th.sortable').forEach(th => {
    th.onclick = () => {
      const tableKey = th.dataset.table;
      const col = th.dataset.col;
      const type = th.dataset.type;
      const state = alarmSortState[tableKey];

      if (state.col === col) {
        state.order = state.order === 'asc' ? 'desc' : 'asc';
      } else {
        state.col = col;
        state.order = 'asc';
        state.type = type;
      }

      th.closest('tr').querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        const ind = h.querySelector('.sort-indicator');
        if (ind) ind.textContent = '↕';
      });

      th.classList.add(state.order === 'asc' ? 'sort-asc' : 'sort-desc');
      const curInd = th.querySelector('.sort-indicator');
      if (curInd) curInd.textContent = state.order === 'asc' ? '▲' : '▼';

      if (tableKey === 'active') {
        renderActiveAlarmsTable();
      } else {
        renderHistoryAlarmsTable();
      }
    };
  });

  const btnRefresh = document.getElementById('btn-refresh-history');
  if (btnRefresh) {
    btnRefresh.onclick = () => socket.emit('alarms:getHistory');
  }

  bindHmiButtons();
  applyPermissions();
  setViewMode(alarmViewMode);
}

// Alarm Soket Dinleyicileri
socket.on('alarms:active', (alarms) => {
  currentActiveAlarms = alarms || [];

  if (elAlarmBadge) {
    if (currentActiveAlarms.length > 0) {
      elAlarmBadge.textContent = currentActiveAlarms.length;
      elAlarmBadge.classList.remove('hidden');
    } else {
      elAlarmBadge.classList.add('hidden');
    }
  }

  if (router.currentView === 'alarms' && alarmViewMode === 'active') {
    renderActiveAlarmsTable();
  }
});

socket.on('alarms:history', (historyList) => {
  currentAlarmHistory = historyList || [];
  if (router.currentView === 'alarms' && alarmViewMode === 'history') {
    renderHistoryAlarmsTable();
  }
});

// --- YETKİLENDİRME VE GÜVENLİK ---
function setSession(user) {
  currentUser = user || { username: 'NoOne', role: 'NoOne', timeout: 0 };
  window.currentUser = currentUser;

  userRoleBadge.textContent = `${currentUser.role.toUpperCase()}`;
  userRoleBadge.className = `role-badge role-${currentUser.role.toLowerCase()}`;

  socket.emit('auth:setUser', currentUser.username);

  if (currentUser.role === 'admin') {
    btnNavSystem.classList.remove('hidden');
  } else {
    btnNavSystem.classList.add('hidden');
    if (router.currentView === 'settings' || router.currentView === 'texts') {
      router.navigate('dashboard');
    }
  }

  applyPermissions();
  resetInactivityTimer();
}

function applyPermissions() {
  const currentLevel = ROLES[currentUser.role] || 0;
  document.querySelectorAll('[data-auth]').forEach((el) => {
    const requiredRole = el.dataset.auth;
    const requiredLevel = ROLES[requiredRole] || 0;
    el.classList.toggle('hmi-disabled', currentLevel < requiredLevel);
  });
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (currentUser.role !== 'NoOne' && currentUser.timeout > 0) {
    inactivityTimer = setTimeout(() => {
      setSession(null);
    }, currentUser.timeout * 1000);
  }
}

['click', 'touchstart', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => resetInactivityTimer(), { passive: true });
});

// Login Dialog Olayları
btnLoginDialog.addEventListener('click', () => {
  loginErrorMsg.classList.add('hidden');

  // Kullanıcı adı alanını hmi_parameters'tan gelen değerle doldur
  loginUsernameInput.value = cachedDefaultUser;
  loginPasswordInput.value = '';

  btnDoLogout.classList.toggle('hidden', currentUser.role === 'NoOne');
  btnDoLogin.classList.toggle('hidden', currentUser.role !== 'NoOne');
  loginModal.classList.remove('hidden');

  // Dokunmatik ekranda operatör doğrudan şifreye odaklansın
  setTimeout(() => {
    loginPasswordInput.focus();
  }, 100);
});

btnCloseLogin.addEventListener('click', () => loginModal.classList.add('hidden'));

btnDoLogin.addEventListener('click', () => {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value.trim();
  socket.emit('auth:login', { username, password });
});

btnDoLogout.addEventListener('click', () => {
  setSession(null);
  loginModal.classList.add('hidden');
});

socket.on('auth:success', (user) => {
  setSession(user);
  loginModal.classList.add('hidden');
});

socket.on('auth:fail', (msg) => {
  loginErrorMsg.textContent = msg;
  loginErrorMsg.classList.remove('hidden');
});

// 1. Üst kısımlara değişkeni ve soket dinleyicisini ekleyin:
let cachedDefaultUser = 'operator';

socket.on('auth:defaultUser', (user) => {
  cachedDefaultUser = user || 'operator';
});

// --- SETTINGS (KULLANICI YÖNETİMİ & DİL SEÇİMİ) ---
function initSettingsView() {
  const selLang = document.getElementById('select-default-language');
  if (selLang) {
    selLang.value = currentLang;
    selLang.onchange = () => {
      socket.emit('i18n:setLanguage', selLang.value);
    };
  }

  const btnGotoTexts = document.getElementById('btn-goto-texts');
  if (btnGotoTexts) {
    btnGotoTexts.onclick = (e) => {
      e.preventDefault();
      router.navigate('texts');
    };
  }

  const btnSaveUser = document.getElementById('btn-save-user');
  if (btnSaveUser) {
    btnSaveUser.onclick = () => {
      const username = document.getElementById('new-user-name').value.trim();
      const password = document.getElementById('new-user-pass').value.trim();
      const role = document.getElementById('new-user-role').value;
      const timeout = parseInt(document.getElementById('new-user-timeout').value, 10);

      if (!username || !password) return alert('Kullanıcı adı ve şifre zorunludur!');
      socket.emit('users:add', { username, password, role, timeout });
    };
  }
  socket.emit('users:get');
}

socket.on('users:list', (users) => {
  const userTableBody = document.getElementById('user-table-body');
  if (!userTableBody) return;

  userTableBody.innerHTML = '';
  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.username}</td>
      <td><span class="role-badge role-${u.role}">${u.role}</span></td>
      <td>${u.timeout}</td>
      <td>
        ${u.username !== 'admin' ? `<button class="btn btn-red" style="padding:0.2rem 0.5rem;font-size:0.8rem;" onclick="deleteUser(${u.id})">Sil</button>` : '<em>Kilitli</em>'}
      </td>
    `;
    userTableBody.appendChild(tr);
  });
});

window.deleteUser = (id) => {
  if (confirm('Kullanıcıyı silmek istediğinize emin misiniz?')) {
    socket.emit('users:delete', id);
  }
};

// --- TEXTS (METİN VERİTABANI EDİTÖRÜ) ---
let localTextsList = [];

function initTextsView() {
  const btnSave = document.getElementById('btn-save-text');
  const btnClear = document.getElementById('btn-clear-text-form');
  const txtId = document.getElementById('txt-id');
  const txtTr = document.getElementById('txt-tr');
  const txtEn = document.getElementById('txt-en');
  const txtOther = document.getElementById('txt-other');

  if (btnSave) {
    btnSave.onclick = () => {
      const id = parseInt(txtId.value, 10);
      const tr = txtTr.value.trim();
      const en = txtEn.value.trim();
      const other = txtOther.value.trim();

      if (isNaN(id) || !tr) {
        return alert('ID (Sayısal) ve Türkçe metin zorunludur!');
      }

      socket.emit('texts:save', { id, tr, en: en || tr, other: other || tr });
      txtId.value = '';
      txtTr.value = '';
      txtEn.value = '';
      txtOther.value = '';
    };
  }

  if (btnClear) {
    btnClear.onclick = () => {
      txtId.value = '';
      txtTr.value = '';
      txtEn.value = '';
      txtOther.value = '';
    };
  }

  socket.emit('texts:get');
}

socket.on('texts:list', (list) => {
  localTextsList = list || [];
  const tbody = document.getElementById('texts-table-body');
  const countEl = document.getElementById('texts-count');
  if (countEl) countEl.textContent = localTextsList.length;
  if (!tbody) return;

  if (localTextsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-alarm-msg">Metin kaydı bulunamadı.</td></tr>`;
    return;
  }

  tbody.innerHTML = localTextsList.map((t) => `
    <tr>
      <td><strong>#${t.id}</strong></td>
      <td>${t.tr}</td>
      <td>${t.en}</td>
      <td>${t.other}</td>
      <td style="text-align: center;">
        <button class="btn btn-blue" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;" onclick="editText(${t.id})">Düzenle</button>
        <button class="btn btn-red" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;" onclick="deleteText(${t.id})">Sil</button>
      </td>
    </tr>
  `).join('');
});

window.editText = (id) => {
  const item = localTextsList.find((t) => t.id === id);
  if (!item) return;
  document.getElementById('txt-id').value = item.id;
  document.getElementById('txt-tr').value = item.tr;
  document.getElementById('txt-en').value = item.en;
  document.getElementById('txt-other').value = item.other;
};

window.deleteText = (id) => {
  if (confirm(`#${id} numaralı metni silmek istediğinize emin misiniz?`)) {
    socket.emit('texts:delete', id);
  }
};

// --- SOKET BAĞLANTI DURUMU ---
socket.on('connect', () => {
  if (elPlcStatus) {
    elPlcStatus.textContent = 'ONLINE';
    elPlcStatus.style.borderColor = 'var(--green)';
    elPlcStatus.style.color = 'var(--green)';
  }
  const currentStruct = PAGE_STRUCT_MAP[router.currentView || 'dashboard'];
  socket.emit('plc:setPageStruct', currentStruct || null);
});

socket.on('disconnect', () => {
  if (elPlcStatus) {
    elPlcStatus.textContent = 'OFFLINE';
    elPlcStatus.style.borderColor = 'var(--red)';
    elPlcStatus.style.color = 'var(--red)';
  }
});

// --- SVG İKON SPRITE'INI ASENKRON YÜKLE ---
async function loadSvgIcons() {
  try {
    const res = await fetch('icons.html');
    if (res.ok) {
      const svgText = await res.text();
      const container = document.getElementById('svg-sprite-container');
      if (container) {
        container.innerHTML = svgText;
      }
    }
  } catch (err) {
    console.error('İkonlar yüklenemedi:', err);
  }
}

loadSvgIcons();

// --- BAŞLANGIÇ ÇAĞRISI ---
setSession(null);
router.navigate('dashboard');