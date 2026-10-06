// Positions à gérer : les positions ouvertes du bot SMC Vision, reliées à leur ligne du journal.
const cfg = $('Configuration gestion').first().json;
function estDuBot(x) { const t = texteEtiquette(x) + ' ' + String(x.comment || ''); return t.indexOf(cfg.label) >= 0 || t.indexOf(cfg.commentaire) >= 0; }
const lignes = liste('Journal SMC Vision').filter(function (r) { return r.statut === 'execute' && r.resultat === 'ouvert'; });
const sorties = [];
for (const p of liste('Positions ouvertes')) {
  if (!p.positionId || !p.symbol) continue;
  const side = String(p.side || p.direction || p.tradeSide || '').toLowerCase().indexOf('sell') >= 0 ? 'sell' : 'buy';
  const open = nombre(p.openPrice);
  // la ligne du journal : même actif, même sens, prix d'ouverture proche de l'entrée prévue
  const l = lignes.filter(function (r) {
    if (r.symbole !== p.symbol || r.sens !== side) return false;
    const R = Math.abs(nombre(r.entree) - nombre(r.stop));
    return Number.isFinite(open) && Math.abs(open - nombre(r.entree)) <= 0.5 * R;
  }).sort(function (a, b) { return String(b.horodatage).localeCompare(String(a.horodatage)); })[0];
  if (!l) continue;                         // pas un trade SMC Vision connu : on n'y touche pas
  if (texteEtiquette(p) && !estDuBot(p)) continue; // étiquette d'un autre bot : on n'y touche pas
  sorties.push({ json: { positionId: p.positionId, symbol: p.symbol, side: side, openPrice: open, stopLoss: nombre(p.stopLoss), takeProfit: nombre(p.takeProfit),
    ligne: { id: l.id, entree: nombre(l.entree), stop: nombre(l.stop), tp1: nombre(l.tp1), horodatage: l.horodatage, gestion: l.gestion || '' } } });
}
return sorties;
