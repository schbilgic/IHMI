/**
 * HMI Reçete Yönetim Modülü
 */
class RecipeManager {
  constructor(socketInstance) {
    this.socket = socketInstance;
    this.recipesList = [];
    this.activeFilename = null;
    this.activeRecipe = { name: '', items: [] };

    this.initSocketListeners();
  }

  initSocketListeners() {
    this.socket.on('recipes:listData', (list) => {
      this.recipesList = list || [];
      this.renderMainList();
    });

    this.socket.on('recipes:detail', ({ filename, data }) => {
      this.activeFilename = filename;
      this.activeRecipe = data || { name: '', items: [] };

      if (Array.isArray(this.activeRecipe.items)) {
        this.activeRecipe.items.forEach(i => {
          i.plcVal = i.plcVal !== undefined ? i.plcVal : '-';
        });
      }
      this.openModal();
    });

    // PLC'den okuma tamamlandı
    this.socket.on('recipes:readResult', (itemsWithPlc) => {
      this.activeRecipe.items = itemsWithPlc;
      
      const failedItems = itemsWithPlc.filter(i => i.plcVal === 'HATA' || i.plcVal === 'BULUNAMADI');

      // Başarılı okunan değerleri doğrudan dosya formuna (val) aktar
      itemsWithPlc.forEach(item => {
        if (item.plcVal !== '-' && item.plcVal !== 'HATA' && item.plcVal !== 'BULUNAMADI') {
          item.val = item.plcVal;
        }
      });

      this.renderModalItems();

      if (failedItems.length > 0) {
        alert(`⚠️ ${failedItems.length} adet sembol okunamadı (Path adlarını kontrol edin):\n` + 
              failedItems.map(f => `• ${f.path}`).join('\n'));
      } else {
        alert('✅ Tüm PLC canlı değerleri başarıyla okundu.');
      }
    });

    // PLC'ye yazma tamamlandı
    this.socket.on('recipes:writeResult', (res) => {
      if (res && res.success) {
        alert('✅ Reçete parametreleri PLC\'ye başarıyla aktarıldı.');
      } else {
        const failedList = (res && res.failedPaths) ? res.failedPaths.join('\n• ') : 'Bilinmeyen semboller';
        alert(`⚠️ Bazı parametreler PLC'ye yazılamadı:\n• ${failedList}`);
      }
    });

    // Kayıt tamamlandı
    this.socket.on('recipes:saved', (res) => {
      alert(`💾 Reçete "${res.filename}" olarak başarıyla kaydedildi.`);
      this.activeFilename = res.filename;
      this.closeModal();
    });
  }

  initView() {
    this.bindToolbarEvents();
    this.bindModalEvents();
    this.requestList();
    this.applySecurity();
  }

  bindToolbarEvents() {
    const sortSelect = document.getElementById('recipe-sort-select');
    const btnNew = document.getElementById('btn-new-recipe');
    if (btnNew) {
      btnNew.onclick = () => {
        this.activeFilename = `yeni_recete_${Date.now()}.json`;
        this.activeRecipe = {
          name: 'Yeni Reçete',
          items: [
            // 1. Parametre her zaman Reçete Adı
            { name: 'Reçete Adı', path: 'GVL_HMI.stRecipes.sRecipeName', val: 'Yeni Reçete', plcVal: '-' },
            { name: 'Hız Set', path: 'GVL_HMI.stRecipes.rSpeedSet', val: 100, plcVal: '-' }
          ]
        };
        this.openModal();
      };
    }
  }

  bindModalEvents() {
    const btnClose = document.getElementById('btn-close-recipe-modal');
    const btnAddRow = document.getElementById('btn-recipe-add-row');
    const btnReadPlc = document.getElementById('btn-recipe-read-plc');
    const btnWritePlc = document.getElementById('btn-recipe-write-plc');
    const btnSaveJson = document.getElementById('btn-recipe-save-json');
    const btnSaveAs = document.getElementById('btn-recipe-save-as');
    const nameInput = document.getElementById('modal-recipe-name-input');
   
    if (btnClose) btnClose.onclick = () => this.closeModal();
    if (nameInput) {
      nameInput.oninput = () => {
        const val = nameInput.value.trim();
        this.activeRecipe.name = val;
        if (this.activeRecipe.items.length > 0 && this.activeRecipe.items[0].name.toLowerCase().includes('reçete adı')) {
          this.activeRecipe.items[0].val = val;
          const firstValInput = document.querySelector('#recipe-items-body tr[data-index="0"] .r-val');
          if (firstValInput) firstValInput.value = val;
        }
      };
    }
    if (btnAddRow) {
      btnAddRow.onclick = () => {
        this.collectItemsFromDom();
        this.activeRecipe.items.push({ name: 'Yeni Parametre', path: 'GVL_HMI.', val: '0', plcVal: '-' });
        this.renderModalItems();
      };
    }

    // PLC'den Oku
    if (btnReadPlc) {
      btnReadPlc.onclick = () => {
        this.collectItemsFromDom();
        if (this.activeRecipe.items.length === 0) return alert('Okunacak parametre yok.');
        this.socket.emit('recipes:readFromPlc', this.activeRecipe.items);
      };
    }

    // PLC'ye Yaz:
    if (btnWritePlc) {
      btnWritePlc.onclick = () => {
        this.collectItemsFromDom();
        if (this.activeRecipe.items.length === 0) return alert('Yazılacak parametre yok.');

        if (confirm(`"${this.activeRecipe.name}" reçetesi PLC'ye yazılsın mı?`)) {
          this.socket.emit('recipes:writeToPlc', this.activeRecipe.items);
        }
      };
    }
    

    // Kaydet
    if (btnSaveJson) {
      btnSaveJson.onclick = () => this.handleSave(false);
    }

    // Farklı Kaydet
    if (btnSaveAs) {
      btnSaveAs.onclick = () => this.handleSave(true);
    }
  }
    // Ana Tablodan Doğrudan PLC'ye Yaz (Operatör):
    directLoadPlc(filename) {
        this.socket.emit('recipes:get', filename);
        this.socket.once('recipes:detail', ({ data }) => {
        if (data && data.items) {
            if (confirm(`"${data.name}" reçetesi PLC'ye yüklensin mi?`)) {
                this.socket.emit('recipes:writeToPlc', data.items);
            }
        }
        });
    }
  handleSave(isSaveAs = false) {
    this.collectItemsFromDom();
    const nameInput = document.getElementById('modal-recipe-name-input');
    let rName = nameInput ? nameInput.value.trim() : '';

    if (isSaveAs) {
      const newName = prompt('Yeni Reçete Adını Giriniz:', rName ? `${rName}_kopya` : 'Yeni_Reçete');
      if (!newName || !newName.trim()) return;
      rName = newName.trim();
      this.activeFilename = `${rName}.json`;
    }

    if (!rName) return alert('Reçete adı boş bırakılamaz!');
    this.activeRecipe.name = rName;

    this.socket.emit('recipes:save', {
      filename: this.activeFilename,
      data: this.activeRecipe
    });
  }

  requestList() {
    const sortSelect = document.getElementById('recipe-sort-select');
    const sortVal = sortSelect ? sortSelect.value : 'name_asc';
    const [sortBy, sortOrder] = sortVal.split('_');
    this.socket.emit('recipes:list', { sortBy, sortOrder });
  }

  renderMainList() {
    const tbody = document.getElementById('recipe-table-body');
    const countBadge = document.getElementById('recipe-count-badge');
    if (countBadge) countBadge.textContent = `${this.recipesList.length} Reçete`;
    if (!tbody) return;

    if (this.recipesList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-alarm-msg">Kayıtlı reçete dosyası bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.recipesList.map(r => `
      <tr>
        <td style="padding: 12px 16px;">
          <strong>${r.name}</strong> 
          <span style="font-size: 0.8rem; color: #64748b;">(${r.filename})</span>
        </td>
        <td style="padding: 12px 16px;">
          <span style="background: #334155; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem;">
            ${r.itemCount} Parametre
          </span>
        </td>
        <td style="padding: 12px 16px; color: #94a3b8;">${r.createdDateStr}</td>
        <td style="padding: 12px 16px; color: #94a3b8;">${r.updatedDateStr}</td>
        <td style="padding: 12px 16px; text-align: right;">
          <button class="btn btn-green" style="padding: 0.35rem 0.75rem; font-size: 0.85rem;" onclick="recipeManager.directLoadPlc('${r.filename}')">
            📤 PLC'ye Yaz
          </button>
          <button class="btn btn-blue" data-auth="admin" style="padding: 0.35rem 0.75rem; font-size: 0.85rem;" onclick="recipeManager.editRecipe('${r.filename}')">
            ✏️ Düzenle
          </button>
          <button class="btn btn-red" data-auth="admin" style="padding: 0.35rem 0.75rem; font-size: 0.85rem;" onclick="recipeManager.deleteRecipe('${r.filename}')">
            🗑️ Sil
          </button>
        </td>
      </tr>
    `).join('');

    this.applySecurity();
  }

  renderModalItems() {
    const tbody = document.getElementById('recipe-items-body');
    if (!tbody) return;

    const isAdmin = window.currentUser ? window.currentUser.role === 'admin' : true;

    tbody.innerHTML = this.activeRecipe.items.map((item, idx) => `
      <tr data-index="${idx}">
        <td style="padding: 8px;">
          <input type="text" class="hmi-input r-name" value="${item.name || ''}" ${!isAdmin ? 'disabled' : ''} 
                 style="width: 100%; height: 32px; background: #0f172a; color:#fff; border: 1px solid #334155; border-radius: 4px; padding: 0 8px;">
        </td>
        <td style="padding: 8px;">
          <input type="text" class="hmi-input r-path" value="${item.path || ''}" ${!isAdmin ? 'disabled' : ''} 
                 style="width: 100%; height: 32px; background: #0f172a; color:#38bdf8; font-family: monospace; border: 1px solid #334155; border-radius: 4px; padding: 0 8px;">
        </td>
        <td style="padding: 8px;">
          <input type="text" class="hmi-input r-val" value="${item.val !== undefined ? item.val : ''}" ${!isAdmin ? 'disabled' : ''} 
                 style="width: 100%; height: 32px; background: #0f172a; color:#4ade80; font-weight: bold; border: 1px solid #334155; border-radius: 4px; padding: 0 8px;">
        </td>
        <td style="padding: 8px; color: #38bdf8; font-family: monospace; font-weight: bold;">
          ${item.plcVal !== undefined ? item.plcVal : '-'}
        </td>
        <td style="padding: 8px; text-align: center;" data-auth="admin">
          <button class="btn btn-red" style="padding: 2px 8px; font-size: 0.8rem;" onclick="recipeManager.removeRow(${idx})">Sil</button>
        </td>
      </tr>
    `).join('');

    this.applySecurity();
  }

  collectItemsFromDom() {
    const rows = document.querySelectorAll('#recipe-items-body tr');
    const items = [];
    rows.forEach((r, idx) => {
      const name = r.querySelector('.r-name')?.value.trim() || '';
      const path = r.querySelector('.r-path')?.value.trim() || '';
      const val = r.querySelector('.r-val')?.value.trim() || '';
      const plcVal = this.activeRecipe.items[idx]?.plcVal || '-';

      items.push({ name, path, val, plcVal });
    });
    this.activeRecipe.items = items;
  }

  openModal() {
    const modal = document.getElementById('recipe-modal');
    const nameInput = document.getElementById('modal-recipe-name-input');
    if (nameInput) nameInput.value = this.activeRecipe.name || '';

    this.renderModalItems();
    if (modal) {
      modal.style.display = 'flex'; // hidden class çakışmasını engellemek için doğrudan flex
    }
    this.applySecurity();
  }

  closeModal() {
    const modal = document.getElementById('recipe-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  directLoadPlc(filename) {
    this.socket.emit('recipes:get', filename);
    this.socket.once('recipes:detail', ({ data }) => {
      if (data && data.items) {
        if (confirm(`"${data.name}" reçetesindeki parametreler doğrudan PLC'ye yüklensin mi?`)) {
          this.socket.emit('recipes:writeToPlc', data.items);
        }
      }
    });
  }

  editRecipe(filename) {
    this.socket.emit('recipes:get', filename);
  }

  deleteRecipe(filename) {
    if (confirm(`"${filename}" reçete dosyasını kalıcı olarak silmek istediğinize emin misiniz?`)) {
      this.socket.emit('recipes:delete', filename);
    }
  }

  removeRow(idx) {
    this.collectItemsFromDom();
    this.activeRecipe.items.splice(idx, 1);
    this.renderModalItems();
  }

  applySecurity() {
    if (typeof window.applyPermissions === 'function') {
      window.applyPermissions();
    }
  }
}