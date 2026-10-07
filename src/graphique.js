// =====================================================================================
// Graphiques en PNG, en JavaScript pur (sans bibliothèque) : ils sont dessinés de la même façon
// dans le backtest (Node) et dans n8n (nœud Code), puis envoyés à Claude, qui regarde et décide.
// Bougies bleues (haussières) / rouges (baissières) ; lignes horizontales (entrée, stop, objectifs,
// points A / B) ; bandes colorées (FVG, OTE) ; trait vertical = maintenant. Pas de texte dans l'image :
// les prix des lignes et l'échelle sont donnés à Claude dans le message.
// =====================================================================================

const COULEURS = {
  fond: [252, 252, 251], grille: [225, 224, 217], hausse: [42, 120, 214], baisse: [227, 73, 72],
  entree: [11, 11, 11], stop: [227, 73, 72], objectif: [0, 131, 0], pointA: [74, 58, 167], pointB: [235, 104, 52],
  zone: [237, 161, 0], ote: [27, 175, 122], maintenant: [137, 135, 129]
};

// ---------- encodage PNG ----------
const TABLE_CRC = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function adler32(buf) { let a = 1, b = 0; for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
function u32(n) { return Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function bloc(type, data) {
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), td, u32(crc32(td))]);
}
// zlib : compression si le module est disponible (Node), sinon blocs « stockés » (n8n sans zlib)
function compresser(brut) {
  try { return require('zlib').deflateSync(brut); } catch (e) { /* pas de zlib : blocs stockés */ }
  const morceaux = [Buffer.from([0x78, 0x01])];
  for (let i = 0; i < brut.length; i += 65535) {
    const part = brut.subarray(i, Math.min(brut.length, i + 65535)), fin = i + 65535 >= brut.length ? 1 : 0;
    morceaux.push(Buffer.from([fin, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255]), part);
  }
  morceaux.push(u32(adler32(brut)));
  return Buffer.concat(morceaux);
}
function png(largeur, hauteur, px) {
  const brut = Buffer.alloc((largeur * 3 + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) { brut[y * (largeur * 3 + 1)] = 0; px.copy(brut, y * (largeur * 3 + 1) + 1, y * largeur * 3, (y + 1) * largeur * 3); }
  const ihdr = Buffer.concat([u32(largeur), u32(hauteur), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', ihdr), bloc('IDAT', compresser(brut)), bloc('IEND', Buffer.alloc(0))]);
}

// ---------- dessin ----------
function Toile(l, h) { this.l = l; this.h = h; this.px = Buffer.alloc(l * h * 3); this.rect(0, 0, l, h, COULEURS.fond); }
Toile.prototype.point = function (x, y, c, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= this.l || y >= this.h) return;
  const i = (y * this.l + x) * 3;
  if (a === undefined || a >= 1) { this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; return; }
  for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a);
};
Toile.prototype.rect = function (x0, y0, x1, y1, c, a) {
  const xa = Math.max(0, Math.round(Math.min(x0, x1))), xb = Math.min(this.l - 1, Math.round(Math.max(x0, x1)));
  const ya = Math.max(0, Math.round(Math.min(y0, y1))), yb = Math.min(this.h - 1, Math.round(Math.max(y0, y1)));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) this.point(x, y, c, a);
};
Toile.prototype.horizontale = function (y, c, tirets, epaisseur) {
  for (let x = 0; x < this.l; x++) if (!tirets || Math.floor(x / tirets) % 2 === 0) for (let e = 0; e < (epaisseur || 1); e++) this.point(x, y + e, c);
};

// bougies = [{ t, o, h, l, c }] ; options : largeur, hauteur, lignes [{ prix, couleur, tirets, epaisseur }],
// bandes [{ bas, haut, couleur, alpha }], maintenant (heure en ms : trait vertical),
// rsi (valeurs alignées sur les bougies : panneau du bas, lignes 30 / 50 / 70)
// Renvoie { png (Buffer), base64, haut, bas, debut, fin } : l'échelle de prix est à donner à Claude.
function dessiner(bougies, options) {
  options = options || {};
  const L = options.largeur || 960, H = options.hauteur || 540, marge = 12;
  const lignes = options.lignes || [], bandes = options.bandes || [];
  let hi = -Infinity, lo = Infinity;
  bougies.forEach(function (b) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); });
  lignes.forEach(function (x) { if (Number.isFinite(x.prix)) { hi = Math.max(hi, x.prix); lo = Math.min(lo, x.prix); } });
  const pad = (hi - lo) * 0.04 || 1; hi += pad; lo -= pad;
  const toile = new Toile(L, H);
  const rsi = options.rsi || null, Hp = rsi ? Math.round(H * 0.76) : H; // hauteur du panneau des prix
  const y = function (p) { return marge + (hi - p) / (hi - lo) * (Hp - 2 * marge); };
  // grille : 8 lignes horizontales régulières
  for (let k = 0; k <= 8; k++) toile.horizontale(Math.round(marge + k * (Hp - 2 * marge) / 8), COULEURS.grille, 0, 1);
  bandes.forEach(function (z) { toile.rect(0, y(z.haut), L - 1, y(z.bas), COULEURS[z.couleur] || z.couleur || COULEURS.zone, z.alpha || 0.18); });
  const n = bougies.length, pas = (L - 2 * marge) / Math.max(1, n), corpsL = Math.max(1, pas * 0.6);
  bougies.forEach(function (b, i) {
    const xc = marge + (i + 0.5) * pas, c = b.c >= b.o ? COULEURS.hausse : COULEURS.baisse;
    toile.rect(xc, y(b.h), xc, y(b.l), c);
    toile.rect(xc - corpsL / 2, y(Math.max(b.o, b.c)), xc + corpsL / 2, Math.max(y(Math.min(b.o, b.c)), y(Math.max(b.o, b.c)) + 1), c);
  });
  if (options.maintenant) {
    let k = bougies.findIndex(function (b) { return b.t >= options.maintenant; }); if (k < 0) k = n;
    const x = marge + k * pas; for (let yy = 0; yy < H; yy += 2) toile.point(x, yy, COULEURS.maintenant);
  }
  lignes.forEach(function (x) { if (Number.isFinite(x.prix)) toile.horizontale(Math.round(y(x.prix)), COULEURS[x.couleur] || x.couleur || COULEURS.entree, x.tirets || 0, x.epaisseur || 2); });
  if (rsi) {
    const y0 = Hp + 4, y1 = H - 4, yr = function (v) { return y1 - (v / 100) * (y1 - y0); };
    toile.rect(0, Hp, L - 1, Hp + 1, COULEURS.grille);
    toile.horizontale(Math.round(yr(70)), COULEURS.grille, 0, 1); toile.horizontale(Math.round(yr(30)), COULEURS.grille, 0, 1);
    toile.horizontale(Math.round(yr(50)), COULEURS.maintenant, 6, 1);
    let px = null, py = null;
    rsi.forEach(function (v, i) {
      if (!Number.isFinite(v)) return;
      const x = marge + (i + 0.5) * pas, yy = yr(v);
      if (px !== null) { const pasN = Math.max(1, Math.ceil(Math.abs(x - px) + Math.abs(yy - py))); for (let k = 0; k <= pasN; k++) toile.point(px + (x - px) * k / pasN, py + (yy - py) * k / pasN, COULEURS.pointA); }
      px = x; py = yy;
    });
  }
  const image = png(L, H, toile.px);
  return { png: image, base64: image.toString('base64'), haut: hi, bas: lo, debut: n ? bougies[0].t : null, fin: n ? bougies[n - 1].t : null, bougies: n };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { dessiner, COULEURS };
