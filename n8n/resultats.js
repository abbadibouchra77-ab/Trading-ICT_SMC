// Met à jour le résultat des trades fermés : on retrouve les deals de clôture de leurs positions.
const lignes = liste('Journal SMC Vision').filter(function (r) { return r.statut === 'execute' && r.resultat === 'ouvert' && r.ordres; });
const deals = liste('Deals récents').filter(estCloture);
const ouvertes = liste('Positions ouvertes').map(function (p) { return String(p.positionId || p.id || ''); });
const sorties = [];
for (const l of lignes) {
  const ids = String(l.ordres).split(',').filter(Boolean);
  if (ids.some(function (id) { return ouvertes.indexOf(id) >= 0; })) continue; // encore ouvert
  const ds = deals.filter(function (d) {
    const pid = String(d.positionId || (d.closePositionDetail && d.closePositionDetail.positionId) || d.orderId || '');
    return ids.indexOf(pid) >= 0;
  });
  if (!ds.length) continue; // pas encore retrouvé
  const net = ds.reduce(function (s, d) { return s + (netDeal(d) || 0); }, 0);
  const r = Number(l.risque_montant) > 0 ? net / Number(l.risque_montant) : null;
  sorties.push({ json: { id: l.id, resultat: (net >= 0 ? 'gagnant' : 'perdant') + (r !== null ? ' (' + r.toFixed(2) + 'R)' : ''), resultat_montant: Math.round(net * 100) / 100 } });
}
return sorties;
