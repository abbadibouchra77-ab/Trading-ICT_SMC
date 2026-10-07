# Dessine la lecture du bot (POI H4, MSS, OTE, FVG/OB, entrée, stop, cible) pour UN trade du backtest HTF + MSS.
# Usage : python3 backtest/lecture_bot.py <htf_mss_*.json> <dossier CSV> <actif> "<AAAA-MM-JJ HH:MM>" <image.png>
import sys, json, csv, bisect
from datetime import datetime, timezone
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
res, hist, sym, quand, out = sys.argv[1:6]
tr = [x for x in json.load(open(res))['trades'] if x['symbole'] == sym and datetime.fromtimestamp(x['tSignal']/1000, timezone.utc).strftime('%Y-%m-%d %H:%M') == quand][0]
b = []
for r in csv.DictReader(open(f'{hist}/{sym}.csv')):
    b.append((datetime.fromisoformat(r['time'].replace('Z', '+00:00')).timestamp()*1000, float(r['open']), float(r['high']), float(r['low']), float(r['close'])))
ts = [x[0] for x in b]; L = tr['lecture']; z = tr['zoneHtf']
i0 = bisect.bisect_left(ts, L['tPivot']) - 70; i1 = bisect.bisect_left(ts, tr['tFin']) + 8
kx = lambda t: bisect.bisect_left(ts, t) - i0
fig = plt.figure(figsize=(16, 11)); ax = fig.add_axes((0.05, 0.30, 0.9, 0.64))
for k, (t, o, h, l, c) in enumerate(b[i0:i1]):
    col = '#2a78d6' if c >= o else '#e34948'
    ax.plot([k, k], [l, h], color=col, lw=.8, zorder=3); ax.add_patch(Rectangle((k-.35, min(o, c)), .7, max(abs(c-o), 1e-9), color=col, zorder=4))
n = i1 - i0
sell = tr['sens'] == 'sell'
ax.add_patch(Rectangle((max(0, kx(z['dispo'])), z['bas']), n, z['haut']-z['bas'], color='#f0b429', alpha=.22, zorder=1))
ax.text(n-1, z['haut'], '① POI H4 (' + z['genre'] + ')', ha='right', va='bottom', fontsize=10, color='#8a6100')
ax.plot(kx(L['tTouche']), (z['haut'] if not sell else z['bas']), 'o', color='#8a6100', zorder=6)
ax.text(kx(L['tTouche']), (z['haut'] if not sell else z['bas']), ' ② le prix entre dans la POI', fontsize=9, color='#8a6100', va='top' if not sell else 'bottom')
ax.hlines(tr['mss']['niveau'], kx(L['tPivot']), kx(L['tCassure']), color='#7a5ad6', lw=1.6, zorder=5)
ax.text(kx(L['tPivot']), tr['mss']['niveau'], '③ sommet/creux à casser ', ha='right', fontsize=9, color='#7a5ad6', va='bottom' if not sell else 'top')
ax.plot(kx(L['tCassure']), b[i0 + kx(L['tCassure'])][4], 'D', color='#7a5ad6', zorder=7)
ax.text(kx(L['tCassure']), b[i0 + kx(L['tCassure'])][4], '  ④ MSS (clôture au-delà)', fontsize=9, color='#7a5ad6')
hi, lo = L['hautJambe'], L['prixCreux']
a, c2 = (hi, lo)
r = lambda p: (hi - (hi - lo) * p / 100) if not sell else (lo + (hi - lo) * p / 100)  # sell: hautJambe/prixCreux sont déjà remis dans le bon sens
if sell: hi, lo = L['prixCreux'], L['hautJambe']
if not sell: lo_, hi_ = L['prixCreux'], L['hautJambe']
else: lo_, hi_ = L['hautJambe'], L['prixCreux']   # sell : bas de la jambe = hautJambe (prix retourné)
# jambe en prix réels : sell -> sommet = prixCreux, creux = hautJambe
top, bot = (max(L['prixCreux'], L['hautJambe']), min(L['prixCreux'], L['hautJambe']))
h = top - bot
p62, p79 = ((bot + h*.62, bot + h*.79) if sell else (top - h*.62, top - h*.79))
ax.add_patch(Rectangle((kx(L['tCassure']), min(p62, p79)), n, abs(p79-p62), color='#1b9e5a', alpha=.20, zorder=1))
ax.text(n-1, max(p62, p79), '⑤ OTE (62-79 % de la jambe) ', ha='right', va='bottom', fontsize=9, color='#1b6e43')
ax.plot([kx(L['tCreux']), kx(L['tCassure'])], [L['prixCreux'], L['hautJambe']], ':', color='#1b6e43', lw=1)
for nom, zz, col in (('⑥ FVG du MSS', L['fvg'], '#2a78d6'), ('⑥ OB du MSS', L['ob'], '#777777')):
    if zz:
        ax.add_patch(Rectangle((kx(zz['t']), zz['bas']), n, zz['haut']-zz['bas'], color=col, alpha=.25, zorder=2))
        ax.text(n-1, zz['haut'] if nom.endswith('MSS') and 'FVG' in nom else zz['bas'], nom, ha='right', va='bottom' if 'FVG' in nom else 'top', fontsize=9, color=col)
for nom, p, col, ls in (('entrée ' + tr['typeEntree'], tr['entree'], 'k', '-'), ('⑦ stop', tr['stop'], '#e34948', '--'), ('⑧ cible = 1re liquidité', tr['tp1'], '#1b9e5a', '--')):
    ax.axhline(p, color=col, ls=ls, lw=1.2, zorder=5); ax.text(0.5, p, f'{nom}  {p:.2f}', fontsize=9, color=col, va='bottom')
if tr.get('tRempli'): ax.axvline(kx(tr['tRempli']), color='k', lw=1, ls=':')
ax.set_xlim(0, n); ax.set_title(f"Lecture du bot — {sym} {tr['sens']} du {datetime.fromtimestamp(tr['tSignal']/1000, timezone.utc):%d/%m/%Y %H:%M} UTC — résultat {tr['R']:+.2f} R")
txt = [
 f"① POI H4 : {z['genre']} {'baissier' if sell else 'haussier'} de {z['bas']:.2f} à {z['haut']:.2f} → le biais est {'vendeur' if sell else 'acheteur'}.",
 f"② Le prix revient dans la POI ({datetime.fromtimestamp(L['tTouche']/1000, timezone.utc):%d/%m %H:%M}).",
 f"③④ MSS M15 : clôture {'sous' if sell else 'au-dessus de'} {tr['mss']['niveau']:.2f} ({datetime.fromtimestamp(L['tCassure']/1000, timezone.utc):%d/%m %H:%M}).",
 f"⑤⑥ Zone d'entrée : {tr['typeEntree']} à {tr['entree']:.2f} ; OTE entre {min(p62,p79):.2f} et {max(p62,p79):.2f}.",
 f"⑦ Stop {tr['stop']:.2f} (risque {abs(tr['entree']-tr['stop']):.2f}) ; ⑧ cible {tr['tp1']:.2f} (= {tr['f']['rrTp1']} R).",
]
fig.text(0.05, 0.22, '\n'.join(txt), fontsize=11, va='top', family='DejaVu Sans')
fig.savefig(out, dpi=85)
