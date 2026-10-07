// Chargement de l'historique (CSV) et construction des unités de temps.
// Accepte : time/date/datetime/timestamp (ISO, "AAAA-MM-JJ HH:MM[:SS]" en UTC, ou epoch s / ms),
// open, high, low, close, volume (ou tick_volume / tickvolume / vol). Séparateur , ou ; ou tabulation.
// Si les bougies sont en M1 (ou M5), elles sont regroupées en M15.
const fs = require('fs');

function lireCSV(chemin) {
  const texte = fs.readFileSync(chemin, 'utf8').replace(/^﻿/, '');
  const lignes = texte.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
  const sep = (lignes[0].match(/;/g) || []).length > (lignes[0].match(/,/g) || []).length ? ';' : (lignes[0].indexOf('\t') >= 0 ? '\t' : ',');
  const entete = lignes[0].split(sep).map(function (x) { return x.trim().toLowerCase().replace(/[<>"]/g, ''); });
  const col = function (noms) { for (const n of noms) { const k = entete.indexOf(n); if (k >= 0) return k; } return -1; };
  const cT = col(['time', 'date', 'datetime', 'timestamp', 'open_time', 'gmt time', 'local time']);
  const cHeure = col(['hour', 'heure']); // cas « date ; heure » sur deux colonnes
  const cO = col(['open', 'o']), cH = col(['high', 'h']), cL = col(['low', 'l']), cC = col(['close', 'c']);
  const cV = col(['volume', 'tick_volume', 'tickvolume', 'vol', 'v', 'tickvol']);
  if (cT < 0 || cO < 0 || cH < 0 || cL < 0 || cC < 0) throw new Error(chemin + ' : colonnes introuvables (' + entete.join(', ') + ')');
  const out = [];
  for (let k = 1; k < lignes.length; k++) {
    const x = lignes[k].split(sep);
    let brut = x[cT].trim().replace(/"/g, '');
    if (cHeure >= 0) brut += ' ' + x[cHeure].trim();
    const t = lireTemps(brut);
    const b = { time: t, open: +x[cO], high: +x[cH], low: +x[cL], close: +x[cC], volume: cV >= 0 ? +x[cV] || 0 : 0 };
    if (Number.isFinite(t) && [b.open, b.high, b.low, b.close].every(Number.isFinite)) out.push(b);
  }
  out.sort(function (a, b) { return a.time - b.time; });
  return out.filter(function (b, i) { return i === 0 || b.time !== out[i - 1].time; });
}

function lireTemps(s) {
  if (/^\d+(\.\d+)?$/.test(s)) { const n = +s; return n < 1e11 ? n * 1000 : n; } // epoch secondes ou millisecondes
  let x = s.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T'); // 2024.01.02 -> 2024-01-02
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x)) x += ':00';
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(x)) x += 'Z'; // sans fuseau : UTC
  return Date.parse(x);
}

// Regroupe des bougies en paquets de `minutes` (M1 -> M15, M15 -> H1, H4) ou par clé (jour, semaine, mois).
function regrouper(bs, minutes, cle, debut) {
  const out = []; let cur = null, k = null;
  for (const b of bs) {
    const kb = cle ? cle(b.time) : Math.floor(b.time / (minutes * 60000));
    if (kb !== k) {
      if (cur) out.push(cur);
      cur = { time: cle ? (debut ? debut(kb) : b.time) : kb * minutes * 60000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      k = kb;
    } else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; }
  }
  if (cur) out.push(cur);
  return out;
}
function cleJour(t) { return Math.floor(t / 86400000); }
function cleSemaine(t) { const d = new Date(t); return Math.floor((t - ((d.getUTCDay() + 6) % 7) * 86400000) / 86400000); }
function cleMois(t) { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }

// Toutes les unités de temps à partir du M15 (ou du M1).
function unitesDeTemps(brutes) {
  const ecarts = [];
  for (let i = 1; i < Math.min(brutes.length, 2000); i++) ecarts.push(brutes[i].time - brutes[i - 1].time);
  ecarts.sort(function (a, b) { return a - b; });
  const pas = ecarts[Math.floor(ecarts.length / 2)] || 900000;
  const M15 = pas < 900000 ? regrouper(brutes, 15) : brutes;
  return {
    pasOrigine: pas / 60000,
    M15: M15,
    H1: regrouper(M15, 60), H4: regrouper(M15, 240),
    // début de période « propre » (minuit UTC, lundi, 1er du mois) : la bougie est clôturée à la fin de la période
    D1: regrouper(M15, 0, cleJour, function (k) { return k * 86400000; }),
    W1: regrouper(M15, 0, cleSemaine, function (k) { return k * 86400000; }),
    MN: regrouper(M15, 0, cleMois, function (k) { return Date.UTC(Math.floor(k / 12), k % 12, 1); })
  };
}

module.exports = { lireCSV, lireTemps, regrouper, unitesDeTemps };
