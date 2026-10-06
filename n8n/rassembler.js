// Prépare la ligne du journal : lecture top-down, zone, liquidité, confirmations, entrée, stop, objectifs.
const t = $('Lecture ICT/SMC').first().json;
const tailles = $('Taille de position').all().map(function (i) { return i.json; });
const entrees = $input.all().map(function (i) { return i.json; });
let statut, ordres = [], volume = 0, erreur = '';
if (tailles.length && tailles[0].volumeValide === false) {
  statut = 'volume_trop_petit'; erreur = tailles[0].raison;
} else {
  for (const r of entrees) {
    const id = r.orderId || r.positionId || r.id;
    if (id && !r.error) ordres.push(String(id)); else erreur += (r.error ? JSON.stringify(r.error).slice(0, 200) : 'réponse sans identifiant') + ' ';
  }
  volume = tailles.reduce(function (s, x) { return s + (Number(x.volume) || 0); }, 0);
  statut = ordres.length ? 'execute' : 'erreur_ordre';
}
return [{ json: {
  horodatage: new Date().toISOString(),
  symbole: t.symbole, sens: t.sens, statut: statut,
  lecture_topdown: String(t.lecture || '').slice(0, 4000),
  zone: t.zone, liquidite: t.liquidite,
  confirmations: (t.confirmations || []).join(' ; ') + ' (note ' + t.note + ', ' + (t.grade || '') + ')',
  mode_entree: 'ordre limite ' + (t.typeEntree || '') + ' (' + (t.killzone || '') + ')',
  note: t.note, expire_a: t.expireA, gestion: '',
  entree: t.entree, stop: t.stop, tp1: t.tp1, tp2: t.tp2, rr1: t.rr1, rr2: t.rr2,
  volume: volume, risque_montant: tailles.length ? tailles[0].risqueMontant : null, solde: t.solde,
  ordres: ordres.join(','), cle_mouvement: t.cleMouvement,
  resultat: statut === 'execute' ? 'ouvert' : ('non passé : ' + erreur).slice(0, 500), resultat_montant: null
} }];
