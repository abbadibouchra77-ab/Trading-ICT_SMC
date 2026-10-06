// Fabrique des graphiques de test (bougies M15) et les regroupe en H4, Daily, Weekly, Monthly.
// Les scénarios sont des « histoires » ICT/SMC écrites à la main.

let graine = 7;
function alea() { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; }

const M15 = 15 * 60000;

function Constructeur(debut, prix) {
  this.t = debut; this.p = prix; this.b = []; graine = 7;
}
// Mouvement en ligne droite vers `cible` en n bougies, avec un peu de bruit.
Constructeur.prototype.vers = function (cible, n, bruit) {
  bruit = bruit === undefined ? 0.6 : bruit;
  const p0 = this.p;
  for (let k = 1; k <= n; k++) {
    const o = this.p;
    const c = p0 + (cible - p0) * k / n + (k < n ? (alea() - 0.5) * 2 * bruit : 0);
    const h = Math.max(o, c) + alea() * bruit * 0.6, l = Math.min(o, c) - alea() * bruit * 0.6;
    this.ajoute(o, h, l, c);
  }
  return this;
};
// Une bougie précise.
Constructeur.prototype.ajoute = function (o, h, l, c, v) {
  this.b.push({ time: new Date(this.t).toISOString(), open: o, high: Math.max(h, o, c), low: Math.min(l, o, c), close: c, volume: v || Math.round(100 + alea() * 50) });
  this.t += M15; this.p = c;
  return this;
};
// Zigzag : une suite de cibles.
Constructeur.prototype.zigzag = function (cibles, n, bruit) { for (const c of cibles) this.vers(c, n, bruit); return this; };

function regrouper(bougies, minutes, cleFn) {
  const out = []; let cur = null, k = null;
  for (const b of bougies) {
    const t = Date.parse(b.time);
    const kb = cleFn ? cleFn(t) : Math.floor(t / (minutes * 60000));
    if (kb !== k) { if (cur) out.push(cur); cur = Object.assign({}, b); k = kb; }
    else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; }
  }
  if (cur) out.push(cur);
  return out;
}
function cleSemaine(t) { const d = new Date(t); return new Date(t - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); }
function cleMois(t) { return new Date(t).toISOString().slice(0, 7); }

// Transforme une liste de bougies M15 en réponse « bridge » pour toutes les unités de temps.
function versBridge(m15) {
  return {
    M15: m15.slice(-500),
    H4: regrouper(m15, 240).slice(-500),
    D1: regrouper(m15, 1440).slice(-300),
    W1: regrouper(m15, 0, cleSemaine).slice(-60),
    MN: regrouper(m15, 0, cleMois).slice(-36)
  };
}
// Le moment « maintenant » : juste après la clôture de la dernière bougie M15.
function maintenantApres(m15) { return Date.parse(m15[m15.length - 1].time) + M15 + 30000; }

// Graphique miroir pour tester la vente : prix' = K - prix.
function inverser(m15, K) {
  return m15.map(function (b) { return { time: b.time, open: K - b.open, high: K - b.low, low: K - b.high, close: K - b.close, volume: b.volume }; });
}

module.exports = { Constructeur, versBridge, maintenantApres, inverser, M15 };
