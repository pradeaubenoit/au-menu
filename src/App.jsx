import { useState, useMemo } from "react";
import dataIng from "./data/ingredients.json";
import dataRec from "./data/recettes.json";

/* ============================================================
   AU MENU — prototype v2 (quiz → menus midi/soir → courses)
   Structure de données alignée sur ingredients.json / recettes.json :
   - INGREDIENTS : prix de référence + nutrition (copie condensée)
   - PRIX_ENSEIGNES : prix relevés qui PRIMENT sur prixBase × coef
   - RECETTES : références d'ingrédients par id
   Dans le vrai projet, ces constantes seront remplacées par un
   import des JSON puis par des tables Supabase.
   ============================================================ */

const MAGASINS = [
  { id: "lidl", nom: "Lidl", coef: 0.85 },
  { id: "leclerc", nom: "E.Leclerc", coef: 0.9 },
  { id: "inter", nom: "Intermarché", coef: 0.95 },
  { id: "auchan", nom: "Auchan", coef: 0.97 },
  { id: "carrefour", nom: "Carrefour", coef: 1.0 },
  { id: "monoprix", nom: "Monoprix", coef: 1.25 },
];

const INGREDIENTS = Object.fromEntries(
  dataIng.ingredients.map((i) => [i.id, { nom: i.nom, u: i.unite, rayon: i.rayon, prix: i.prixBase, n: i.nutrition }])
);
const PRIX_ENSEIGNES = dataIng.prixEnseignes.map((p) => ({ ing: p.ingredientId, mag: p.enseigne, prix: p.prix }));
const RECETTES = dataRec.recettes.map((r) => ({
  id: r.id, nom: r.nom, famille: r.famille, temps: r.tempsMinutes, saisons: r.saisons, tags: r.tags,
  ing: r.ingredients.map((x) => [x.ingredientId, x.qteParPortion]),
}));

const RAYONS = ["Fruits & légumes", "Boucherie & poisson", "Crèmerie", "Épicerie"];
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/* ---------- couche d'accès prix & nutrition ---------- */
const eur = (n) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// Prix relevé s'il existe, sinon prix de référence × coefficient d'enseigne
const prixIngredient = (ingId, mag) => {
  const releve = PRIX_ENSEIGNES.find((p) => p.ing === ingId && p.mag === mag.id);
  return releve ? releve.prix : INGREDIENTS[ingId].prix * mag.coef;
};
const coutParPersonne = (r, mag) => r.ing.reduce((s, [id, q]) => s + q * prixIngredient(id, mag), 0);
const kcalParPortion = (r) => Math.round(r.ing.reduce((s, [id, q]) => {
  const ing = INGREDIENTS[id];
  return s + (ing.u === "pc" ? q : q * 10) * ing.n.kcal; // nutrition /100g → 1 kg = ×10
}, 0));

function recettesEligibles(regime, sansPoisson) {
  return RECETTES.filter((r) => {
    if (regime === "vege" && r.famille !== "végé") return false;
    if (regime === "sansporc" && r.famille === "porc") return false;
    if (sansPoisson && r.famille === "poisson") return false;
    return true;
  });
}

function composerMenu(eligibles, slots, budget, mag, opts = {}) {
  const { gardes = [], eviter = [] } = opts;
  const n = slots.length;
  const menu = gardes.slice(0, n);
  const dansMenu = (r) => menu.some((m) => m.id === r.id);
  // On privilégie les recettes pas vues la semaine passée, avec repli si besoin
  const frais = shuffle(eligibles.filter((r) => !dansMenu(r) && !eviter.includes(r.id)));
  const secours = shuffle(eligibles.filter((r) => !dansMenu(r) && eviter.includes(r.id)));
  const pool = [...frais, ...secours];

  // Objectifs d'équilibre (esprit des repères PNNS)
  const nb = (f) => menu.filter((r) => r.famille === f).length;
  const rouge = () => nb("bœuf") + nb("porc");
  const ciblePoisson = eligibles.some((r) => r.famille === "poisson") ? (n >= 6 ? 2 : 1) : 0;
  const minVege = Math.ceil(n / 4);
  const maxRouge = Math.max(2, Math.round(n * 0.25));

  const prendre = (test) => {
    const i = pool.findIndex(test);
    if (i < 0) return false;
    menu.push(pool.splice(i, 1)[0]);
    return true;
  };
  while (menu.length < n && nb("poisson") < ciblePoisson) if (!prendre((r) => r.famille === "poisson")) break;
  while (menu.length < n && nb("végé") < minVege) if (!prendre((r) => r.famille === "végé")) break;
  while (menu.length < n) {
    const ok = prendre((r) => (r.famille === "bœuf" || r.famille === "porc" ? rouge() < maxRouge : true));
    if (!ok && !prendre(() => true)) break;
  }
  // Plus de repas que de recettes disponibles : on autorise les répétitions
  const boucle = shuffle(eligibles);
  while (menu.length < n && boucle.length) menu.push(boucle[menu.length % boucle.length]);

  // Budget : on remplace les repas chers — jamais un plat gardé, sans casser l'équilibre
  const gardeIds = gardes.map((g) => g.id);
  const cout = (r, i) => coutParPersonne(r, mag) * slots[i].portions;
  const total = () => menu.reduce((s, r, i) => s + cout(r, i), 0);
  let garde = 0;
  while (total() > budget && garde < 60) {
    garde++;
    let iCher = -1;
    menu.forEach((r, i) => {
      if (gardeIds.includes(r.id)) return;
      if (iCher < 0 || cout(r, i) > cout(menu[iCher], iCher)) iCher = i;
    });
    if (iCher < 0) break;
    const actuel = menu[iCher];
    const dispo = eligibles
      .filter((r) => !dansMenu(r) && coutParPersonne(r, mag) < coutParPersonne(actuel, mag)
        && (r.famille === actuel.famille || r.famille === "végé"))
      .sort((a, b) => coutParPersonne(a, mag) - coutParPersonne(b, mag));
    if (!dispo.length) break;
    menu[iCher] = dispo[0];
  }
  return menu;
}

function listeCourses(menu, slots, mag) {
  const map = {};
  menu.forEach((r, i) => { for (const [id, q] of r.ing) {
    const ing = INGREDIENTS[id];
    if (!map[id]) map[id] = { nom: ing.nom, u: ing.u, rayon: ing.rayon, qte: 0, prix: 0 };
    map[id].qte += q * slots[i].portions;
    map[id].prix += q * slots[i].portions * prixIngredient(id, mag);
  } });
  const fmtQ = (it) => {
    if (it.u === "pc") return `${Math.ceil(it.qte)} pc`;
    if (it.u === "L") return it.qte < 1 ? `${Math.round(it.qte * 100) * 10} ml` : `${(Math.round(it.qte * 10) / 10).toLocaleString("fr-FR")} L`;
    return it.qte < 1 ? `${Math.round(it.qte * 100) * 10} g` : `${(Math.round(it.qte * 20) / 20).toLocaleString("fr-FR")} kg`;
  };
  return RAYONS.map((rayon) => ({
    rayon,
    items: Object.values(map).filter((i) => i.rayon === rayon)
      .sort((a, b) => a.nom.localeCompare(b.nom))
      .map((i) => ({ ...i, qteAff: fmtQ(i) })),
  })).filter((g) => g.items.length);
}

/* ---------- composants ---------- */
function Stepper({ value, onChange, min, max }) {
  return (
    <div className="stepper">
      <button aria-label="moins" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span>{value}</span>
      <button aria-label="plus" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

export default function App() {
  const [ecran, setEcran] = useState("quiz");
  const [etape, setEtape] = useState(0);
  const [adultes, setAdultes] = useState(2);
  const [petits, setPetits] = useState(0);   // 0–3 ans → 0,3 portion
  const [moyens, setMoyens] = useState(1);   // 4–10 ans → 0,6 portion
  const [ados, setAdos] = useState(0);       // 11–17 ans → 1,1 portion
  const [nbMidis, setNbMidis] = useState(2);
  const [nbSoirs, setNbSoirs] = useState(7);
  const [aMidi, setAMidi] = useState(1);   // présents le midi
  const [pMidi, setPMidi] = useState(0);
  const [mMidi, setMMidi] = useState(0);
  const [adMidi, setAdMidi] = useState(0);
  const [budget, setBudget] = useState(60);
  const [regime, setRegime] = useState("tout");
  const [sansPoisson, setSansPoisson] = useState(false);
  const [magasins, setMagasins] = useState(["leclerc", "lidl"]);
  const [magActif, setMagActif] = useState("leclerc");
  const [menu, setMenu] = useState([]);
  const [coches, setCoches] = useState({});
  const [gardeIds, setGardeIds] = useState([]);

  const portionsSoir = adultes + petits * 0.3 + moyens * 0.6 + ados * 1.1;
  const portionsMidi = aMidi + pMidi * 0.3 + mMidi * 0.6 + adMidi * 1.1;
  const bouches = adultes + petits + moyens + ados;
  const nbRepas = nbMidis + nbSoirs;
  const slots = useMemo(() => {
    const s = [];
    for (let d = 0; d < 7; d++) {
      if (d < nbMidis) s.push({ jour: JOURS[d], type: "midi", portions: portionsMidi });
      if (d < nbSoirs) s.push({ jour: JOURS[d], type: "soir", portions: portionsSoir });
    }
    return s;
  }, [nbMidis, nbSoirs, portionsMidi, portionsSoir]);

  const mag = MAGASINS.find((m) => m.id === magActif);
  const magSel = MAGASINS.filter((m) => magasins.includes(m.id));
  const toggleMagasin = (id) => {
    const suiv = magasins.includes(id) ? magasins.filter((x) => x !== id) : [...magasins, id];
    if (!suiv.length) return; // toujours au moins une enseigne
    setMagasins(suiv);
    if (!suiv.includes(magActif)) setMagActif(suiv[0]);
  };
  const totalChez = (m) => menu.reduce((s, r, i) => s + coutParPersonne(r, m) * slots[i].portions, 0);

  const coutPlat = (r, i) => coutParPersonne(r, mag) * slots[i].portions;
  const total = menu.reduce((s, r, i) => s + coutPlat(r, i), 0);
  const eligibles = useMemo(() => recettesEligibles(regime, sansPoisson), [regime, sansPoisson]);

  const generer = () => {
    if (!slots.length) return;
    const moinsCher = [...magSel].sort((a, b) => a.coef - b.coef)[0];
    setMagActif(moinsCher.id);
    setMenu(composerMenu(eligibles, slots, budget, moinsCher));
    setGardeIds([]);
    setCoches({});
    setEcran("menu");
  };

  const toggleGarde = (id) =>
    setGardeIds(gardeIds.includes(id) ? gardeIds.filter((x) => x !== id) : [...gardeIds, id]);

  const semaineSuivante = (toutChanger) => {
    const moinsCher = [...magSel].sort((a, b) => a.coef - b.coef)[0];
    const gardes = toutChanger ? [] : menu.filter((r, i, a) => gardeIds.includes(r.id) && a.findIndex((x) => x.id === r.id) === i);
    const eviter = menu.map((r) => r.id).filter((id) => toutChanger || !gardeIds.includes(id));
    setMagActif(moinsCher.id);
    setMenu(composerMenu(eligibles, slots, budget, moinsCher, { gardes, eviter }));
    if (toutChanger) setGardeIds([]);
    setCoches({});
  };

  const remplacer = (i) => {
    let dispo = eligibles.filter((r) => !menu.some((m) => m.id === r.id));
    if (!dispo.length) dispo = eligibles.filter((r) => r.id !== menu[i].id);
    if (!dispo.length) return;
    const copie = [...menu];
    copie[i] = shuffle(dispo)[0];
    setMenu(copie); setCoches({});
  };

  const groupes = useMemo(() => listeCourses(menu, slots, mag), [menu, slots, mag]);

  const ETAPES = [
    {
      titre: "Qui vit à la maison ?",
      corps: (
        <div className="rangs">
          <div className="rang"><span>Adultes</span><Stepper value={adultes} onChange={setAdultes} min={1} max={8} /></div>
          <div className="rang"><span>Enfants 0–3 ans</span><Stepper value={petits} onChange={setPetits} min={0} max={6} /></div>
          <div className="rang"><span>Enfants 4–10 ans</span><Stepper value={moyens} onChange={setMoyens} min={0} max={6} /></div>
          <div className="rang"><span>Ados 11–17 ans</span><Stepper value={ados} onChange={setAdos} min={0} max={6} /></div>
          <p className="note">Les quantités sont ajustées : 0,3 portion avant 4 ans, 0,6 de 4 à 10 ans, 1,1 pour un ado (oui, un ado mange plus qu'un adulte…).</p>
        </div>
      ),
    },
    {
      titre: "Quels repas planifier cette semaine ?",
      corps: (
        <div className="rangs">
          <div className="rang"><span>Déjeuners (midi)</span><Stepper value={nbMidis} onChange={setNbMidis} min={0} max={7} /></div>
          <div className="rang"><span>Dîners (soir)</span><Stepper value={nbSoirs} onChange={setNbSoirs} min={0} max={7} /></div>
          {nbMidis > 0 && (
            <>
              <p className="sousTitre">Qui est là le midi, en général ?</p>
              <div className="rang"><span>Adultes</span><Stepper value={aMidi} onChange={setAMidi} min={0} max={adultes} /></div>
              {petits > 0 && <div className="rang"><span>Enfants 0–3 ans</span><Stepper value={pMidi} onChange={setPMidi} min={0} max={petits} /></div>}
              {moyens > 0 && <div className="rang"><span>Enfants 4–10 ans</span><Stepper value={mMidi} onChange={setMMidi} min={0} max={moyens} /></div>}
              {ados > 0 && <div className="rang"><span>Ados 11–17 ans</span><Stepper value={adMidi} onChange={setAdMidi} min={0} max={ados} /></div>}
            </>
          )}
          <p className="note">Cantine, travail, invitations… on ne planifie que les repas pris à la maison.</p>
        </div>
      ),
    },
    {
      titre: "Votre budget repas pour la semaine",
      corps: (
        <div className="rangs">
          <div className="budgetAff"><span className="tag">{eur(budget)}</span></div>
          <input type="range" min={25} max={250} step={5} value={budget}
            onChange={(e) => setBudget(+e.target.value)} aria-label="Budget hebdomadaire" />
          <p className="note">Soit environ {eur(budget / Math.max(1, nbRepas))} par repas, pour {nbRepas} repas planifiés.</p>
        </div>
      ),
    },
    {
      titre: "Des habitudes alimentaires ?",
      corps: (
        <div className="rangs">
          <div className="puces">
            {[["tout", "Je mange de tout"], ["sansporc", "Sans porc"], ["vege", "Végétarien"]].map(([v, l]) => (
              <button key={v} className={"puce" + (regime === v ? " on" : "")} onClick={() => setRegime(v)}>{l}</button>
            ))}
          </div>
          {regime !== "vege" && (
            <button className={"puce large" + (sansPoisson ? " on" : "")} onClick={() => setSansPoisson(!sansPoisson)}>
              {sansPoisson ? "✓ " : ""}Pas de poisson
            </button>
          )}
        </div>
      ),
    },
    {
      titre: "Où pouvez-vous faire vos courses ?",
      corps: (
        <div className="rangs">
          <div className="puces">
            {MAGASINS.map((m) => (
              <button key={m.id} className={"puce" + (magasins.includes(m.id) ? " on" : "")} onClick={() => toggleMagasin(m.id)}>
                {magasins.includes(m.id) ? "✓ " : ""}{m.nom}
              </button>
            ))}
          </div>
          <p className="note">Sélectionnez toutes les enseignes accessibles : le panier sera chiffré dans chacune, et la moins chère mise en avant.</p>
        </div>
      ),
    },
  ];

  const derniere = etape === ETAPES.length - 1;

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="entete">
        <div className="logo">AU MENU<span>.</span></div>
        {ecran !== "quiz" && (
          <button className="lien" onClick={() => { setEcran("quiz"); setEtape(0); }}>Modifier mes réponses</button>
        )}
      </header>

      {ecran === "quiz" && (
        <main className="carte quiz">
          <div className="points" role="progressbar" aria-valuenow={etape + 1} aria-valuemax={ETAPES.length}>
            {ETAPES.map((_, i) => <i key={i} className={i <= etape ? "on" : ""} />)}
          </div>
          <h1>{ETAPES[etape].titre}</h1>
          {ETAPES[etape].corps}
          <div className="actions">
            {etape > 0 && <button className="second" onClick={() => setEtape(etape - 1)}>Retour</button>}
            {!derniere && <button className="prim" onClick={() => setEtape(etape + 1)}>Continuer</button>}
            {derniere && <button className="prim" disabled={nbRepas === 0} onClick={generer}>Composer mes menus</button>}
          </div>
        </main>
      )}

      {ecran === "menu" && (
        <main>
          <section className="carte bilan">
            <div className="bilanTxt">
              <h1>Vos {menu.length} repas chez {mag.nom}</h1>
              <p className={total > budget ? "depasse" : "ok"}>
                {eur(total)} <span>/ budget {eur(budget)}</span>
                {total > budget ? " — léger dépassement" : " — dans le budget ✓"}
              </p>
            </div>
            <div className="jauge"><i style={{ width: Math.min(100, (total / budget) * 100) + "%" }} className={total > budget ? "rouge" : ""} /></div>
            <div className="equilibre">
              <span>🥦 {menu.filter((r) => r.famille === "végé").length} végé</span>
              <span>🐟 {menu.filter((r) => r.famille === "poisson").length} poisson</span>
              <span>🍗 {menu.filter((r) => r.famille === "volaille").length} volaille</span>
              <span>🥩 {menu.filter((r) => r.famille === "bœuf" || r.famille === "porc").length} viande rouge</span>
            </div>
            <p className="note">Touchez le ♥ des plats appréciés : ils seront reconduits la semaine prochaine.</p>
          </section>

          {magSel.length > 1 && (
            <section className="carte compare">
              <p className="compareTitre">Votre panier, enseigne par enseigne</p>
              <div className="compareRangs">
                {[...magSel].sort((a, b) => totalChez(a) - totalChez(b)).map((m, idx) => (
                  <button key={m.id} className={"compareRang" + (m.id === magActif ? " actif" : "")} onClick={() => setMagActif(m.id)}>
                    <span>{idx === 0 ? "★ " : ""}{m.nom}</span>
                    <span className="comparePrix">{eur(totalChez(m))}</span>
                  </button>
                ))}
              </div>
              <p className="note">Touchez une enseigne pour basculer les prix et la liste de courses dessus.</p>
            </section>
          )}

          <section className="jours">
            {menu.map((r, i) => (
              <article key={i} className="jour">
                <div className="jourTete">
                  <span className="jourNom">{slots[i].jour} <em className={"moment " + slots[i].type}>{slots[i].type}</em></span>
                  <span className="teteDroite">
                    <span className="cat">{r.famille}</span>
                    <button className={"coeur" + (gardeIds.includes(r.id) ? " on" : "")}
                      onClick={() => toggleGarde(r.id)} aria-label="À refaire la semaine prochaine">♥</button>
                  </span>
                </div>
                <h2>{r.nom}</h2>
                <p className="meta">{r.temps} min · ≈ {kcalParPortion(r)} kcal/portion</p>
                <div className="jourPied">
                  <span className="tag">{eur(coutPlat(r, i))}</span>
                  <button className="lien" onClick={() => remplacer(i)}>↻ Changer de plat</button>
                </div>
              </article>
            ))}
          </section>

          <div className="actions colonne">
            <button className="prim" onClick={() => setEcran("liste")}>Voir la liste de courses</button>
            <button className="second" disabled={!gardeIds.length} onClick={() => semaineSuivante(false)}>
              Semaine suivante — garder mes ♥ ({gardeIds.length})
            </button>
            <button className="second" onClick={() => semaineSuivante(true)}>Semaine suivante — tout changer</button>
          </div>
        </main>
      )}

      {ecran === "liste" && (
        <main>
          <section className="ticket">
            <div className="ticketTete">
              <strong>LISTE DE COURSES</strong>
              <span>{mag.nom} · {menu.length} repas · foyer de {bouches}</span>
            </div>
            {groupes.map((g) => (
              <div key={g.rayon} className="rayon">
                <div className="rayonNom">— {g.rayon} —</div>
                {g.items.map((it) => (
                  <label key={it.nom} className={"ligne" + (coches[it.nom] ? " barre" : "")}>
                    <input type="checkbox" checked={!!coches[it.nom]}
                      onChange={() => setCoches({ ...coches, [it.nom]: !coches[it.nom] })} />
                    <span className="qte">{it.qteAff}</span>
                    <span className="nomI">{it.nom}</span>
                    <span className="prixI">{eur(it.prix)}</span>
                  </label>
                ))}
              </div>
            ))}
            <div className="ticketTotal">
              <span>TOTAL ESTIMÉ</span><span>{eur(total)}</span>
            </div>
            <p className="ticketNote">Prix relevés quand disponibles, sinon estimation (référence × coef. {mag.nom} {mag.coef.toLocaleString("fr-FR")})</p>
          </section>
          <div className="actions colonne">
            <button className="second" onClick={() => setEcran("menu")}>← Retour aux menus</button>
          </div>
        </main>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800;900&family=Space+Mono:wght@400;700&display=swap');
:root{
  --ink:#20241F; --paper:#F2F5EE; --carte:#FFFFFF; --vert:#2E7D4F; --vertF:#1E5C38;
  --tag:#FFCE2E; --ligne:#E1E6DB; --rouge:#C93B2B;
}
*{box-sizing:border-box;margin:0}
.app{min-height:100vh;background:var(--paper);color:var(--ink);
  font-family:'Archivo',system-ui,sans-serif;padding:16px;display:flex;flex-direction:column;gap:16px;
  max-width:640px;margin:0 auto}
.entete{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:900;letter-spacing:.06em;font-size:20px}
.logo span{color:var(--vert)}
.carte{background:var(--carte);border:1px solid var(--ligne);border-radius:16px;padding:24px}
h1{font-size:24px;font-weight:800;line-height:1.15;margin-bottom:20px}
h2{font-size:18px;font-weight:800;margin:6px 0 2px}
.meta{font-size:12px;color:#6B7365;margin:0 0 10px}
.note{font-size:13px;color:#6B7365;margin-top:12px}
.points{display:flex;gap:6px;margin-bottom:18px}
.points i{height:4px;flex:1;background:var(--ligne);border-radius:2px}
.points i.on{background:var(--vert)}
.rangs{display:flex;flex-direction:column;gap:14px}
.rang{display:flex;justify-content:space-between;align-items:center;font-weight:600}
.stepper{display:flex;align-items:center;gap:14px}
.stepper button{width:44px;height:44px;border-radius:12px;border:1px solid var(--ligne);
  background:#fff;font-size:22px;font-weight:700;cursor:pointer}
.stepper button:active{background:var(--paper)}
.stepper span{min-width:24px;text-align:center;font-size:20px;font-weight:800}
input[type=range]{width:100%;accent-color:var(--vert);height:32px}
.budgetAff{text-align:center;margin-bottom:4px}
.tag{display:inline-block;background:var(--tag);font-family:'Space Mono',monospace;font-weight:700;
  padding:4px 10px;border-radius:4px 12px 4px 4px;font-size:15px}
.budgetAff .tag{font-size:26px;padding:6px 16px}
.puces{display:flex;flex-wrap:wrap;gap:10px}
.puce{padding:12px 16px;border-radius:999px;border:1.5px solid var(--ligne);background:#fff;
  font-family:inherit;font-size:15px;font-weight:600;cursor:pointer}
.puce.on{background:var(--vertF);border-color:var(--vertF);color:#fff}
.puce.large{align-self:flex-start;margin-top:4px}
.actions{display:flex;gap:12px;margin-top:24px;justify-content:flex-end}
.actions.colonne{flex-direction:column;margin-top:0}
.prim,.second{padding:14px 22px;border-radius:12px;font-family:inherit;font-size:16px;font-weight:700;cursor:pointer}
.prim{background:var(--vertF);color:#fff;border:none}
.prim:hover{background:var(--vert)}
.prim:disabled{opacity:.45;cursor:default}
.second{background:#fff;border:1.5px solid var(--ligne)}
.second:disabled{opacity:.45;cursor:default}
.lien{background:none;border:none;color:var(--vertF);font-family:inherit;font-weight:600;font-size:14px;
  cursor:pointer;text-decoration:underline;padding:4px}
.bilan{padding:20px 24px}
.bilanTxt h1{margin-bottom:6px;font-size:20px}
.bilanTxt p{font-family:'Space Mono',monospace;font-weight:700;font-size:16px}
.bilanTxt p span{color:#6B7365;font-weight:400;font-size:13px}
.bilanTxt .depasse{color:var(--rouge)}
.jauge{height:8px;background:var(--ligne);border-radius:4px;margin-top:12px;overflow:hidden}
.jauge i{display:block;height:100%;background:var(--vert);border-radius:4px;transition:width .3s}
.jauge i.rouge{background:var(--rouge)}
.equilibre{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.equilibre span{font-size:12px;font-weight:600;border:1px solid var(--ligne);border-radius:999px;padding:3px 10px;background:var(--paper)}
.compare{padding:16px 18px}
.compareTitre{font-weight:800;font-size:14px;margin-bottom:10px}
.compareRangs{display:flex;flex-direction:column;gap:6px}
.compareRang{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;
  border:1.5px solid var(--ligne);border-radius:10px;background:#fff;font-family:inherit;font-size:14px;
  font-weight:600;cursor:pointer}
.compareRang.actif{border-color:var(--vertF);background:#EDF5EF}
.comparePrix{font-family:'Space Mono',monospace;font-weight:700}
.teteDroite{display:flex;align-items:center;gap:8px}
.coeur{background:none;border:1.5px solid var(--ligne);border-radius:999px;width:32px;height:32px;
  font-size:15px;color:#B9C1B3;cursor:pointer;line-height:1}
.coeur.on{color:#fff;background:var(--rouge);border-color:var(--rouge)}
.jours{display:flex;flex-direction:column;gap:10px}
.jour{background:var(--carte);border:1px solid var(--ligne);border-radius:16px;padding:16px 18px}
.jourTete{display:flex;justify-content:space-between;align-items:center}
.jourNom{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--vertF)}
.moment{font-style:normal;font-size:10px;letter-spacing:.08em;padding:2px 6px;border-radius:4px;margin-left:6px;vertical-align:1px}
.moment.midi{background:var(--tag);color:var(--ink)}
.moment.soir{background:var(--vertF);color:#fff}
.sousTitre{font-weight:800;font-size:14px;margin-top:8px}
.cat{font-size:11px;color:#6B7365;border:1px solid var(--ligne);border-radius:999px;padding:2px 8px}
.jourPied{display:flex;justify-content:space-between;align-items:center}
.ticket{background:#fff;border:1px solid var(--ligne);border-radius:4px;padding:20px 16px 28px;
  font-family:'Space Mono',monospace;font-size:13px;
  box-shadow:0 2px 10px rgba(32,36,31,.06)}
.ticketTete{text-align:center;border-bottom:1px dashed var(--ink);padding-bottom:12px;margin-bottom:8px;
  display:flex;flex-direction:column;gap:4px}
.ticketTete strong{letter-spacing:.15em}
.rayonNom{text-align:center;margin:14px 0 6px;color:#6B7365}
.ligne{display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer}
.ligne input{accent-color:var(--vertF);width:16px;height:16px;flex:none}
.qte{color:#6B7365;min-width:64px;flex:none}
.nomI{flex:1}
.prixI{font-weight:700}
.barre .nomI,.barre .qte,.barre .prixI{text-decoration:line-through;opacity:.45}
.ticketTotal{display:flex;justify-content:space-between;border-top:1px dashed var(--ink);
  margin-top:16px;padding-top:12px;font-weight:700;font-size:15px}
.ticketNote{margin-top:10px;font-size:11px;color:#6B7365;text-align:center}
@media (prefers-reduced-motion: reduce){.jauge i{transition:none}}
button:focus-visible,input:focus-visible,.ligne:focus-within{outline:2px solid var(--vertF);outline-offset:2px}
`;
