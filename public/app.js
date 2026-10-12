const socket = io();
const speedEl = document.getElementById('speed-val');
const connStatusEl = document.getElementById('conn-status');
const btnStart = document.getElementById('btn-start');

// Bağlantı Durumu
socket.on('connect', () => {
  connStatusEl.textContent = 'PLC ÇEVRİMİÇİ';
  connStatusEl.style.backgroundColor = '#16a34a';
});

socket.on('disconnect', () => {
  connStatusEl.textContent = 'BAĞLANTI KOPTU';
  connStatusEl.style.backgroundColor = '#dc2626';
});

// PLC'den canlı veri okuma
socket.on('plc:speedUpdate', (speed) => {
  speedEl.textContent = speed;
});

// PLC'ye anlık sinyal gönderme (Momentary Push Button)
btnStart.addEventListener('mousedown', () => {
  socket.emit('plc:writeStartButton', true);
});

btnStart.addEventListener('mouseup', () => {
  socket.emit('plc:writeStartButton', false);
});

// Dokunmatik ekran desteği (Touch events)
btnStart.addEventListener('touchstart', (e) => {
  e.preventDefault();
  socket.emit('plc:writeStartButton', true);
});
btnStart.addEventListener('touchend', (e) => {
  e.preventDefault();
  socket.emit('plc:writeStartButton', false);
});