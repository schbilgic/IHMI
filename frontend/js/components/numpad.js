/**
 * Industrial HMI Virtual Numpad Component
 * Handles touch/click and physical keyboard events with automatic range validation.
 */
class HmiNumpad {
  constructor(socketInstance) {
    this.socket = socketInstance;

    // DOM Elemanları
    this.modal = document.getElementById('numpad-modal');
    this.screen = document.getElementById('numpad-screen');
    this.title = document.getElementById('numpad-title');
    this.limits = document.getElementById('numpad-limits');

    // Çalışma Durumu
    this.activeContext = {
      element: null,
      valueDisplay: null,
      min: 0,
      max: 9999,
      unit: '',
      symbol: '',
      format: 1,
    };

    this.currentInput = '';
    this.isFirstKeyAfterOpen = true;

    this.init();
  }

  init() {
    if (!this.modal) {
      console.warn('⚠️ Numpad modal DOM içerisinde bulunamadı.');
      return;
    }

    // 1. .card-editable öğelerine tıklandığında numpad'i aç (Event Delegation)
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.card-editable');
      if (!card) return;

      this.open(card);
    });

    // 2. Ekrandaki Numpad buton tıklamaları
    this.modal.querySelectorAll('.np-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleInput(btn.dataset.key);
      });
    });

    // 3. Fiziksel Klavye Dinleyicisi
    window.addEventListener('keydown', (e) => {
      if (this.isOpen()) {
        const allowedKeys = ['Enter', 'Escape', 'Backspace', 'Delete', '.'];
        const isNumeric = e.key >= '0' && e.key <= '9';

        if (allowedKeys.includes(e.key) || isNumeric) {
          e.preventDefault();
          this.handleInput(e.key);
        }
      }
    });
  }

  isOpen() {
    return this.modal && !this.modal.classList.contains('hidden');
  }

  open(card) {
    const valueSpan = card.querySelector('.metric-value');

    this.activeContext = {
      element: card,
      valueDisplay: valueSpan,
      min: parseFloat(card.dataset.min) || 0,
      max: parseFloat(card.dataset.max) || 9999,
      unit: card.dataset.unit || '',
      symbol: card.dataset.symbol || '',
      title: card.dataset.title || 'Değer Girin',
      format: card.dataset.format !== undefined ? parseInt(card.dataset.format, 10) : 1,
    };

    this.title.textContent = `${this.activeContext.title} (${this.activeContext.unit})`;
    this.limits.textContent = `Min: ${this.activeContext.min} | Max: ${this.activeContext.max}`;

    // Mevcut değeri al
    this.currentInput = valueSpan && valueSpan.textContent !== '--' ? valueSpan.textContent.trim() : '0';
    
    // Açılışta ilk tuşa basılmadı olarak işaretle
    this.isFirstKeyAfterOpen = true;

    this.updateScreen();
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  updateScreen() {
    this.screen.classList.remove('error');
    this.screen.textContent = this.currentInput === '' ? '0' : this.currentInput;

    // Eğer henüz ilk tuşa basılmadıysa (eski değer gösteriliyorsa) koyu/soluk yap
    if (this.isFirstKeyAfterOpen) {
      this.screen.classList.add('dimmed');
    } else {
      this.screen.classList.remove('dimmed');
    }
  }

  handleInput(key) {
      // 1. Rakamlar (0-9)
      if (key >= '0' && key <= '9') {
        if (this.isFirstKeyAfterOpen) {
          this.currentInput = key;
          this.isFirstKeyAfterOpen = false; // Artık yeni değer giriliyor -> parlak renge döner
        } else {
          if (this.currentInput === '0') this.currentInput = '';
          this.currentInput += key;
        }
        this.updateScreen();
      }
      // 2. Ondalık Noktası (.)
      else if (key === '.') {
        if (this.isFirstKeyAfterOpen) {
          this.currentInput = '0.';
          this.isFirstKeyAfterOpen = false;
        } else if (!this.currentInput.includes('.')) {
          this.currentInput = this.currentInput === '' ? '0.' : this.currentInput + '.';
        }
        this.updateScreen();
      }
      // 3. Silme (Backspace)
      else if (key === 'BACK' || key === 'Backspace') {
        // Backspace'e basıldığında da kullanıcının düzenleme yaptığı kabul edilir
        this.isFirstKeyAfterOpen = false;
        this.currentInput = this.currentInput.slice(0, -1);
        this.updateScreen();
      }
      // 4. Temizleme (Clear)
      else if (key === 'CLR' || key === 'Delete') {
        this.currentInput = '';
        this.isFirstKeyAfterOpen = false;
        this.updateScreen();
      }
      // 5. Kapatma (Escape)
      else if (key === 'ESC' || key === 'Escape') {
        this.close();
      }
      // 6. Onay (Enter)
      else if (key === 'ENTER' || key === 'Enter') {
        this.submit();
      }
  }

  submit() {
    const parsed = parseFloat(this.currentInput);

    // Limit Doğrulama
    if (isNaN(parsed) || parsed < this.activeContext.min || parsed > this.activeContext.max) {
      this.screen.classList.add('error');
      this.screen.textContent = 'Limit Dışı!';
      setTimeout(() => this.updateScreen(), 900);
      return;
    }

    // Arayüzü anında güncelle
    if (this.activeContext.valueDisplay) {
      this.activeContext.valueDisplay.textContent = parsed.toFixed(this.activeContext.format);
    }

    // PLC'ye gönder
    if (this.socket && this.activeContext.symbol) {
      this.socket.emit('plc:writeSymbol', {
        symbol: this.activeContext.symbol,
        value: parsed,
      });
    }

    this.close();
  }
}