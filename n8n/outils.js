// Petits outils communs : lire la réponse d'un nœud du bridge sous forme de liste.
function liste(nom) {
  let a = [];
  try { a = $(nom).all().map(function (i) { return i.json; }); } catch (e) { return []; }
  // le bridge peut renvoyer soit une liste, soit un objet qui contient la liste
  if (a.length === 1 && a[0] && typeof a[0] === 'object') {
    const cles = Object.keys(a[0]);
    const k = cles.find(function (c) { return Array.isArray(a[0][c]); });
    if (k && cles.length <= 3) a = a[0][k];
  }
  return a.filter(function (x) { return x && typeof x === 'object' && !x.error && Object.keys(x).length > 0; });
}
function nombre(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
// Résultat net d'un deal de clôture (mêmes champs que le bot principal)
function netDeal(d) {
  const c = d.closePositionDetail;
  if (d.netProfit !== undefined && d.netProfit !== null) return nombre(d.netProfit);
  if (c) return (nombre(c.grossProfit) || 0) + (nombre(c.swap) || 0) + (nombre(c.commission) || 0);
  if (d.grossProfit !== undefined) return (nombre(d.grossProfit) || 0) + (nombre(d.swap) || 0) + (nombre(d.commission) || 0);
  if (d.profit !== undefined) return nombre(d.profit);
  return NaN;
}
function estCloture(d) { return d.type === 'close' || !!d.closePositionDetail; }
function texteEtiquette(x) { return String(x.label || x.comment || ''); }
