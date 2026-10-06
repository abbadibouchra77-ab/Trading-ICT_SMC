// Lecture complète du graphique pour l'actif en cours (Monthly -> M15) avec le moteur ci-dessus.
const actif = $('Actif en cours').first().json;
const cfg = $('Configuration').first().json;
const brut = {
  MN: liste('Bougies Monthly'), W1: liste('Bougies Weekly'), D1: liste('Bougies Daily'),
  H4: liste('Bougies H4'), M15: liste('Bougies M15')
};
let r;
try {
  r = analyserActif(actif.symbol, brut, Date.now(), { legsDejaTradees: actif.legsDejaTradees || [] }, { rrMin: Math.max(2, Number(cfg.rrMin) || 2) });
} catch (e) {
  r = { symbole: actif.symbol, action: 'attendre', raison: 'Erreur du moteur : ' + String(e && e.message || e).slice(0, 300) };
}
return [{ json: Object.assign({ devise: actif.devise, nom: actif.nom, solde: actif.solde, risquePct: actif.risquePct }, r) }];
