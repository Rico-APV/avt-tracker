#!/usr/bin/env node
/**
 * Simula un AVT110 real: arma una trama binaria valida (+HBD o +RPT) y la
 * manda por TCP crudo al servidor, tal como lo haria el dispositivo fisico.
 * No requiere build ni dependencias - solo Node.
 *
 * Uso:
 *   node scripts/simulate-device.js <host> <port> [hbd|rpt] [imei]
 *
 * Ejemplos:
 *   node scripts/simulate-device.js localhost 6001
 *   node scripts/simulate-device.js localhost 6001 rpt
 *   node scripts/simulate-device.js tracker.tudominio.com 6001 hbd 356938035643809
 */
const net = require('net');

const [, , hostArg, portArg, kindArg, imeiArg] = process.argv;
const host = hostArg || 'localhost';
const port = parseInt(portArg || '6001', 10);
const kind = (kindArg || 'hbd').toLowerCase();
const imei = imeiArg || '356938035643809'; // 15 digitos, de prueba

function encodeImei(imeiStr) {
  const bytes = Buffer.alloc(8);
  for (let i = 0; i < 7; i++) {
    bytes[i] = parseInt(imeiStr.substring(i * 2, i * 2 + 2), 10);
  }
  bytes[7] = parseInt(imeiStr.substring(14, 15), 10);
  return bytes;
}

function encodeGTime(date) {
  const buf = Buffer.alloc(7);
  buf.writeUInt16BE(date.getUTCFullYear(), 0);
  buf[2] = date.getUTCMonth() + 1;
  buf[3] = date.getUTCDate();
  buf[4] = date.getUTCHours();
  buf[5] = date.getUTCMinutes();
  buf[6] = date.getUTCSeconds();
  return buf;
}

function buildFrame({ head, imei: imeiStr, deviceId, dataZone, generatedAt, serialNumber }) {
  const headBuf = Buffer.from(head, 'ascii');
  const imeiBuf = encodeImei(imeiStr);
  const deviceIdBuf = Buffer.from([deviceId ?? 0x20]);
  const gTimeBuf = encodeGTime(generatedAt);
  const snBuf = Buffer.alloc(2);
  snBuf.writeUInt16BE(serialNumber, 0);

  const actualLength =
    imeiBuf.length + deviceIdBuf.length + dataZone.length + gTimeBuf.length + snBuf.length;
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16BE(actualLength, 0);

  return Buffer.concat([
    headBuf,
    lengthBuf,
    imeiBuf,
    deviceIdBuf,
    dataZone,
    gTimeBuf,
    snBuf,
    Buffer.from('#', 'ascii'),
  ]);
}

function u8(v) {
  return Buffer.from([v & 0xff]);
}
function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v, 0);
  return b;
}
function i32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v, 0);
  return b;
}

let frame;
const serialNumber = Math.floor(Math.random() * 0xffff);

if (kind === 'hbd') {
  const dataZone = Buffer.from([0x0b, 0x01]); // protocol version 11.01
  frame = buildFrame({
    head: '+HBD:',
    imei,
    dataZone,
    generatedAt: new Date(),
    serialNumber,
  });
} else if (kind === 'rpt') {
  const gnssInfoMask = 0x01 | 0x04 | 0x20 | 0x40; // fix type, speed, lat, lon
  const tail = Buffer.concat([
    u16(4055), // battery voltageMv
    u8(88), // battery levelPercent
    u16(gnssInfoMask),
    u8(1), // one fix
    u8(0x03), // 3D fix
    u16(72), // speedKmh
    i32(40712776), // latitude * 1e6
    i32(-74005974), // longitude * 1e6
  ]);
  const dataZone = Buffer.concat([
    Buffer.from([11, 1]), // protocol version
    Buffer.from([1, 0]), // eventType=1 (Regular Report), eventState=0
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE((1 << 2) | (1 << 3), 0); // battery + GNSS bits
      return b;
    })(),
    tail,
  ]);
  frame = buildFrame({
    head: '+RPT:',
    imei,
    dataZone,
    generatedAt: new Date(),
    serialNumber,
  });
} else {
  console.error(`Tipo desconocido: ${kind} (usa "hbd" o "rpt")`);
  process.exit(1);
}

console.log(`Conectando a ${host}:${port} ...`);
console.log(`Enviando trama ${kind.toUpperCase()} (SN=${serialNumber}, IMEI=${imei}):`);
console.log(frame.toString('hex'));

const socket = net.connect(port, host, () => {
  console.log('TCP conectado, enviando trama...');
  socket.write(frame);
});

socket.on('data', (data) => {
  console.log('Respuesta del servidor:', JSON.stringify(data.toString('ascii')));
  socket.end();
});

socket.on('error', (err) => {
  console.error('Error de conexion:', err.message);
  process.exit(1);
});

socket.on('close', () => {
  console.log('Conexion cerrada.');
});

socket.setTimeout(5000, () => {
  console.error('Timeout esperando respuesta del servidor.');
  socket.destroy();
  process.exit(1);
});
