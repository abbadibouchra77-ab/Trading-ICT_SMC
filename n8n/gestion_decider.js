// Décide s'il faut déplacer le stop d'une position.
//  1) TP1 pas encore atteint : on ne touche à rien.
//  2) TP1 atteint et stop encore côté perte : break-even (entrée + petite marge).
//  3) Break-even fait : le stop suit la structure M15 (dernier creux confirmé pour un achat,
//     dernier sommet confirmé pour une vente), sans jamais reculer.
const cfg = $('Configuration gestion').first().json;
const pos = $('Position en cours').first().json;
const bs = liste('Bougies M15 gestion').map(function (b) { return { t: Date.parse(b.time), o: +b.open, h: +b.high, l: +b.low, c: +b.close }; })
  .filter(function (b) { return Number.isFinite(b.t) && Number.isFinite(b.c) && b.t + 15 * 60000 <= Date.now(); })
  .sort(function (a, b) { return a.t - b.t; });
const dir = pos.side === 'sell' ? -1 : 1;
const l = pos.ligne;
const R = Math.abs(l.entree - l.stop);
const sl = pos.stopLoss, open = pos.openPrice;
const depuis = Date.parse(l.horodatage);
const apres = bs.filter(function (b) { return b.t >= depuis; });
const rien = function (raison) { return [{ json: { changer: false, positionId: pos.positionId, symbol: pos.symbol, raison: raison } }]; };
if (!(R > 0) || !apres.length) return rien('pas assez de données');
const prix = bs[bs.length - 1].c;
const tp1Atteint = apres.some(function (b) { return dir > 0 ? b.h >= l.tp1 : b.l <= l.tp1; });
if (!tp1Atteint) return rien('TP1 pas encore atteint');
const beFait = Number.isFinite(sl) && dir * (sl - open) >= 0;
let nouveau = null, etape = '';
if (!beFait) { nouveau = open + dir * cfg.margeBeR * R; etape = 'break-even (TP1 atteint)'; }
else {
  // ATR M15 et pivots (2 bougies de chaque côté) depuis l'entrée
  let s = 0, k = 0; for (let i = Math.max(1, bs.length - 14); i < bs.length; i++) { s += Math.max(bs[i].h - bs[i].l, Math.abs(bs[i].h - bs[i - 1].c), Math.abs(bs[i].l - bs[i - 1].c)); k++; }
  const atr = k ? s / k : 0;
  let pivot = null;
  for (let i = bs.length - 3; i >= 2 && bs[i].t >= depuis; i--) {
    const x = dir > 0 ? bs[i].l : bs[i].h;
    let ok = true;
    for (let q = 1; q <= 2; q++) {
      const a = dir > 0 ? bs[i - q].l : bs[i - q].h, b = dir > 0 ? bs[i + q].l : bs[i + q].h;
      if (dir > 0 ? (a <= x || b < x) : (a >= x || b > x)) ok = false;
    }
    if (ok) { pivot = x; break; }
  }
  if (pivot === null) return rien('break-even fait, pas encore de nouveau ' + (dir > 0 ? 'creux' : 'sommet') + ' M15');
  nouveau = pivot - dir * cfg.margeStopAtr * atr; etape = 'stop suiveur (structure M15)';
}
// le stop doit avancer d'au moins pasMinR, rester du bon côté du prix et ne jamais reculer
if (Number.isFinite(sl) && dir * (nouveau - sl) < cfg.pasMinR * R) return rien('stop déjà à jour (' + sl + ')');
if (dir * (prix - nouveau) <= 0) return rien('nouveau stop au-delà du prix actuel');
nouveau = +nouveau.toFixed(6);
const texte = new Date().toISOString().slice(0, 16) + ' ' + etape + ' : stop ' + sl + ' -> ' + nouveau + ' (' + (dir * (nouveau - open) / R).toFixed(2) + 'R verrouillé)';
return [{ json: { changer: true, positionId: pos.positionId, symbol: pos.symbol, stopLoss: nouveau, takeProfit: Number.isFinite(pos.takeProfit) ? pos.takeProfit : null,
  idJournal: l.id, gestion: (texte + (l.gestion ? ' | ' + l.gestion : '')).slice(0, 1000) } }];
