// Lecture complète du graphique pour l'actif en cours (Monthly -> M15) avec le moteur ci-dessus.
const actif = $('Actif en cours').first().json;
const cfg = $('Configuration').first().json;
const brut = {
  MN: liste('Bougies Monthly'), W1: liste('Bougies Weekly'), D1: liste('Bougies Daily'),
  H4: liste('Bougies H4'), H1: liste('Bougies H1'), M15: liste('Bougies M15')
};
// Actif corrélé pour la SMT (rien si l'actif n'en a pas)
const correle = actif.correle ? { M15: liste('Bougies M15 corrélées') } : null;
let r;
try {
  r = analyserActif(actif.symbol, brut, correle, Date.now(), { legsDejaTradees: actif.legsDejaTradees || [] },
    { crypto: !!actif.crypto, correle: actif.correle || '', reglages: { rrMin: Math.max(2, Number(cfg.rrMin) || 2) } });
} catch (e) {
  r = { symbole: actif.symbol, action: 'attendre', raison: 'Erreur du moteur : ' + String(e && e.message || e).slice(0, 300) };
}
return [{ json: Object.assign({ devise: actif.devise, nom: actif.nom, solde: actif.solde, risquePct: actif.risquePct }, r) }];
