const net = require('net');

const host = '10.1.1.122';
const ports = [993, 587, 465, 143, 25];

console.log(`[${new Date().toLocaleTimeString()}] Admin ochiq dedi — Portlar qayta tekshirilmoqda...`);

ports.forEach(port => {
  const s = net.connect(port, host, () => {
    console.log(`🟢 OCHIQ (CONNECTED)! Port ${port} muvaffaqiyatli ulandi!`);
    s.destroy();
  });
  s.setTimeout(4000);
  s.on('timeout', () => {
    console.log(`🔴 PORT ${port}: Javob bermayapti (Timeout).`);
    s.destroy();
  });
  s.on('error', (e) => {
    console.log(`🔴 PORT ${port}: Xato (${e.message})`);
  });
});
