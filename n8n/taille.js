// Taille de position : risque dégressif selon le solde (calculé dans 'Préparer le cycle', au plus 5 %),
// stop derrière la mèche du balayage.
// Deux ordres si possible : moitié à l'objectif 1, moitié à l'objectif 2. Sinon un seul ordre à l'objectif 1.
const t = $('Lecture ICT/SMC').first().json;
const cfg = $('Configuration').first().json;
const spec = $('Spécification du symbole').first().json;
const solde = nombre(t.solde);
const risquePct = Math.min(nombre(t.risquePct) || 1, 5);
const risqueMontant = solde * risquePct / 100;
const distanceStop = Math.abs(t.entree - t.stop);
const tickSize = nombre(spec.tickSize), contractSize = nombre(spec.contractSize);
const pas = nombre(spec.volumeStep), minVol = nombre(spec.minVolume), maxVol = nombre(spec.maxVolume);
// Perte en devise de cotation pour 1 lot, convertie en dollars.
// JPY : on divise par le prix. EUR (GER40) : on compte large (x1,25) pour ne jamais dépasser le risque.
let conversion = 1;
if (t.devise === 'JPY') conversion = 1 / t.entree;
if (t.devise === 'EUR') conversion = 1.25;
const pertePourUnLot = distanceStop * contractSize * conversion;
let volume = pertePourUnLot > 0 ? risqueMontant / pertePourUnLot : 0;
function arrondir(v) { return Math.round(Math.floor(v / pas + 1e-9) * pas * 1e8) / 1e8; }
volume = Math.min(arrondir(volume), maxVol);
const base = { symbole: t.symbole, sens: t.sens, entree: t.entree, stop: t.stop, risqueMontant: risqueMontant, solde: solde, minVolume: minVol };
if (!(volume >= minVol) || !Number.isFinite(tickSize)) {
  return [{ json: Object.assign(base, { volumeValide: false, volume: volume, raison: 'Volume calculé (' + volume + ') sous le minimum du broker (' + minVol + ') : trade non passé.' }) }];
}
const v1 = arrondir(volume / 2), v2 = arrondir(volume - v1);
if (t.tp2 !== null && t.tp2 !== undefined && v1 >= minVol && v2 >= minVol) {
  return [
    { json: Object.assign({}, base, { volumeValide: true, volume: v1, objectif: t.tp1, partie: 'TP1' }) },
    { json: Object.assign({}, base, { volumeValide: true, volume: v2, objectif: t.tp2, partie: 'TP2' }) }
  ];
}
return [{ json: Object.assign(base, { volumeValide: true, volume: volume, objectif: t.tp1, partie: 'TP1' }) }];
