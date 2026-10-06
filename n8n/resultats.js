// Met à jour le résultat des trades du journal encore « ouverts ».
//  - ordre limite encore en attente ou position encore ouverte sur l'actif : on attend ;
//  - deals de clôture du bot sur l'actif depuis l'ordre : gagnant / perdant (en R) ;
//  - rien de tout ça après l'heure d'expiration : l'ordre n'a pas été déclenché (expiré).
const cfg = $('Configuration').first().json;
function estDuBot(x) { const t = texteEtiquette(x) + ' ' + String(x.comment || ''); return t.indexOf(cfg.label) >= 0 || t.indexOf(cfg.commentaire) >= 0; }
const lignes = liste('Journal SMC Vision').filter(function (r) { return r.statut === 'execute' && r.resultat === 'ouvert'; });
const deals = liste('Deals récents').filter(estCloture);
const avecEtiquette = deals.some(function (d) { return texteEtiquette(d) !== '' || d.comment; });
const positions = liste('Positions ouvertes'), ordres = liste('Ordres en attente');
const sorties = [];
for (const l of lignes) {
  const depuis = Date.parse(l.horodatage);
  const ids = String(l.ordres || '').split(',').filter(Boolean);
  const encore = positions.concat(ordres).some(function (p) { return p.symbol === l.symbole && (ids.indexOf(String(p.orderId || '')) >= 0 || ids.indexOf(String(p.positionId || '')) >= 0 || estDuBot(p) || !texteEtiquette(p)); });
  if (encore) continue;
  const ds = deals.filter(function (d) {
    const t = Date.parse(d.time || d.executionTime || d.timestamp || '');
    return d.symbol === l.symbole && (!Number.isFinite(t) || t >= depuis) && (!avecEtiquette || estDuBot(d));
  }).slice(0, Math.max(1, ids.length));
  if (ds.length) {
    const net = ds.reduce(function (s, d) { return s + (netDeal(d) || 0); }, 0);
    const r = Number(l.risque_montant) > 0 ? net / Number(l.risque_montant) : null;
    sorties.push({ json: { id: l.id, resultat: (net >= 0 ? 'gagnant' : 'perdant') + (r !== null ? ' (' + r.toFixed(2) + 'R)' : ''), resultat_montant: Math.round(net * 100) / 100 } });
  } else if (Date.now() > Date.parse(l.expire_a || '') + 10 * 60000) {
    sorties.push({ json: { id: l.id, resultat: 'expiré (ordre limite non déclenché)', resultat_montant: 0 } });
  }
}
return sorties;
