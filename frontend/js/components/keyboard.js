class HmiKeyboard {
  constructor(socketInstance) {
    this.socket = socketInstance;

    this.modal = document.getElementById('keyboard-modal');
    this.screen = document.getElementById('keyboard-screen');
    this.title = document.getElementById('keyboard-title');
    this.toggleEyeBtn = document.getElementById('keyboard-toggle-mask');

    this.activeTarget = null;
    this.currentInput = '';
    this.isFirstKeyAfterOpen = true;
    this.isShiftActive = false;
    this.isCapsLock = false;
    
    this.isPasswordTarget = false;
    this.maskActive = false;

    this.init();
  }

  init() {
    if (!this.modal) return;

    document.addEventListener('click', (e) => {
      const target = e.target.closest('.hmi-keyboard-target');
      if (!target) return;

      e.preventDefault();
      this.open(target);
    });

    this.modal.querySelectorAll('.kb-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleInput(btn.dataset.key);
      });
    });

    if (this.toggleEyeBtn) {
      this.toggleEyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.maskActive = !this.maskActive;
        this.toggleEyeBtn.textContent = this.maskActive ? '👁️' : '🔒';
        this.updateScreen();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this.handleInput('BACK');
      } else if (e.key === 'CapsLock') {
        e.preventDefault();
        this.toggleCapsLock();
      } else if (e.key.length === 1) {
        e.preventDefault();
        this.handleInput(e.key);
      }
    });
  }

  isOpen() {
    return this.modal && !this.modal.classList.contains('hidden');
  }

  open(targetElement) {
    this.activeTarget = targetElement;

    this.isPasswordTarget = (targetElement.tagName === 'INPUT' && targetElement.type === 'password') || 
                            targetElement.dataset.type === 'password';
    
    this.maskActive = this.isPasswordTarget;

    if (this.toggleEyeBtn) {
      if (this.isPasswordTarget) {
        this.toggleEyeBtn.classList.remove('hidden');
        this.toggleEyeBtn.textContent = '👁️';
      } else {
        this.toggleEyeBtn.classList.add('hidden');
      }
    }

    const titleText = targetElement.dataset.title || targetElement.getAttribute('placeholder') || 'Metin Girin';
    this.title.textContent = this.isPasswordTarget ? `${titleText} (Gizli)` : titleText;

    if (targetElement.tagName === 'INPUT') {
      this.currentInput = targetElement.value || '';
    } else {
      const valSpan = targetElement.querySelector('.metric-value');
      this.currentInput = valSpan && valSpan.textContent !== '--' ? valSpan.textContent.trim() : '';
    }

    this.isFirstKeyAfterOpen = true;
    this.isShiftActive = false;
    this.updateKeyCase();
    this.updateScreen();

    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
    this.activeTarget = null;
  }

  updateScreen() {
    this.screen.classList.remove('error');

    if (this.currentInput === '') {
      this.screen.textContent = '';
    } else {
      if (this.isPasswordTarget && this.maskActive) {
        this.screen.textContent = '*'.repeat(this.currentInput.length);
      } else {
        this.screen.textContent = this.currentInput;
      }
    }

    if (this.isFirstKeyAfterOpen) {
      this.screen.classList.add('dimmed');
    } else {
      this.screen.classList.remove('dimmed');
    }
  }

  toggleCapsLock() {
    this.isCapsLock = !this.isCapsLock;
    this.updateKeyCase();
  }

  toggleShift() {
    this.isShiftActive = !this.isShiftActive;
    this.updateKeyCase();
  }

  updateKeyCase() {
    const isUpper = this.isCapsLock !== this.isShiftActive;
    const capsBtn = this.modal.querySelector('.kb-btn[data-key="CAPS"]');
    const shiftBtn = this.modal.querySelector('.kb-btn[data-key="SHIFT"]');

    if (capsBtn) capsBtn.classList.toggle('kb-btn-active', this.isCapsLock);
    if (shiftBtn) shiftBtn.classList.toggle('kb-btn-active', this.isShiftActive);

    this.modal.querySelectorAll('.kb-btn[data-char]').forEach((btn) => {
      const char = btn.dataset.char;
      btn.textContent = isUpper ? char.toUpperCase() : char.toLowerCase();
    });
  }

  handleInput(key) {
    if (key === 'BACK') {
      this.isFirstKeyAfterOpen = false;
      this.currentInput = this.currentInput.slice(0, -1);
      this.updateScreen();
    } else if (key === 'CLR') {
      this.isFirstKeyAfterOpen = false;
      this.currentInput = '';
      this.updateScreen();
    } else if (key === 'ESC') {
      this.close();
    } else if (key === 'ENTER') {
      this.submit();
    } else if (key === 'CAPS') {
      this.toggleCapsLock();
    } else if (key === 'SHIFT') {
      this.toggleShift();
    } else if (key === 'SPACE') {
      this.insertChar(' ');
    } else {
      let charToAdd = key;
      if (key.length === 1) {
        const isUpper = this.isCapsLock !== this.isShiftActive;
        charToAdd = isUpper ? key.toUpperCase() : key.toLowerCase();
      }
      this.insertChar(charToAdd);

      if (this.isShiftActive) {
        this.isShiftActive = false;
        this.updateKeyCase();
      }
    }
  }

  insertChar(char) {
    if (this.isFirstKeyAfterOpen) {
      this.currentInput = char;
      this.isFirstKeyAfterOpen = false;
    } else {
      this.currentInput += char;
    }
    this.updateScreen();
  }

  submit() {
    if (!this.activeTarget) {
      this.close();
      return;
    }

    const value = this.currentInput;

    if (this.activeTarget.tagName === 'INPUT') {
      this.activeTarget.value = value;
      this.activeTarget.dispatchEvent(new Event('input', { bubbles: true }));
      this.activeTarget.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const valSpan = this.activeTarget.querySelector('.metric-value');
      if (valSpan) {
        valSpan.textContent = this.isPasswordTarget ? '*'.repeat(value.length) : value;
      }

      const symbol = this.activeTarget.dataset.symbol;
      if (symbol && this.socket) {
        this.socket.emit('plc:writeSymbol', { symbol, value });
      }
    }

    this.close();
  }
}