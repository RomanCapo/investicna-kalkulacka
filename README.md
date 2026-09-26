# Investičná kalkulačka

Jednoduchá single-page kalkulačka (React cez CDN + Tailwind CSS, žiadny build krok) na porovnanie nákladov a výnosu investície pri zloženom úročení s pravidelným mesačným vkladom, priebežnými aj jednorazovým poplatkom.

## Funkcie

- Zložené úročenie s jednorazovou aj mesačnou investíciou
- Priebežné ročné náklady a jednorazový vstupný poplatok rozložený do zvoleného počtu mesiacov
- Koláčový graf rozdelenia hrubej hodnoty a graf vývoja investície v čase
- Porovnanie dvoch investičných ponúk vedľa seba
- Export prehľadu do PDF

## Dôchodková kalkulačka

`dochodkova-kalkulacka.html` — odhad štátneho dôchodku a renty z investícií v rovnakom dizajne.

- Odhad štátneho dôchodku (1. pilier) zo mzdy, odpracovaných rokov, priemernej mzdy a ADH, alebo ručné zadanie sumy
- 2. pilier: zostatok, príspevok z hrubej mzdy, výnos; krátenie štátneho dôchodku za roky sporenia a čistý prínos 2. piliera
- 3. pilier (DDS): zostatok, príspevok klienta aj zamestnávateľa, ročné navýšenie, výnos; daňová úľava a renta z 3. piliera
- Voliteľné investovanie: súčasné úspory, mesačný vklad s ročnou dynamizáciou, výnos a náklady
- Renta s čerpaním istiny do zvoleného veku alebo len z výnosov; indexovaná infláciou
- Porovnanie s cieľovým príjmom a výpočet potrebnej mesačnej investície na jeho dosiahnutie
- Graf portfólia počas sporenia aj výplaty (v dnešných cenách alebo nominálne), ročný prehľad
- Export prehľadu do PDF

## Životná kalkulačka

`zivotna-kalkulacka.html` — minimálne odporúčané poistné sumy životného poistenia v rovnakom dizajne.

- Čistý príjem vypočítaný z hrubej mzdy (dá sa prepísať), suma úverov, vek a odpracované roky
- Dávky Sociálnej poisťovne: nemocenská, invalidný dôchodok (podľa % invalidity), sirotský a vdovský dôchodok
- Strata príjmu pri invalidite a PN, aj celková strata do dôchodku
- Odporúčané sumy pripoistení (smrť, invalidita jednorazová / renta / s klesajúcou sumou, závažné ochorenia, trvalé následky, PN…), dajú sa upraviť a obnoviť
- Grafy pokrytia čistého príjmu štátom a poistením pri PN a invalidite 40 % / 70 %
- Potreba rodiny pri úmrtí živiteľa, rozpočet na poistné (5–10 % netto), porovnanie s aktuálnou zmluvou
- Režim pre dieťa, export do PDF

## Finančný plán (prepojenie kalkulačiek)

Vstupný bod je `plan.html`:

1. **Parametre klienta** — osoba, domácnosť (partner, deti), príjmy a výdavky, majetok, rezerva, úvery, poradca. Ukladá sa automaticky v prehliadači (localStorage); zálohu klienta si môžete stiahnuť a nahrať ako JSON.
2. **Existujúce zmluvy** — 24 typov poistenia (životné, úrazové, majetok, zodpovednosť, PZP, havarijné, GAP, cestovné…). Poistné sa premietne do cashflow, sumy pripoistení zo životných a úrazových zmlúv sa v kalkulačke Životné poistenie doplnia do stĺpca „Aktuálna zmluva“, blížiace sa výročia a chýbajúce poistenie nehnuteľnosti k hypotéke sa objavia v akčnom pláne.
3. **Ciele a kalkulačky** — otvárajú sa s `?plan=1`: prevezmú spoločné údaje z profilu (vek, mzda, úvery, rodina…), zmeny sa automaticky ukladajú do plánu a spoločné údaje zmenené v kalkulačke sa zapíšu späť do profilu. Bez `?plan=1` (napr. vložené vo WordPresse) fungujú kalkulačky samostatne ako doteraz. Bývanie a Rast príjmu pripravujeme.
4. **Súhrn a PDF** — `financny-plan.html`: cashflow dnes a po realizácii plánu, oblasti plánu, akčný plán a stiahnutie PDF s vlastným brandingom.

Súbory:

- `js/plan-store.js` — spoločný profil klienta a prepojenie s kalkulačkami
- `js/plan-engine.js` — prepočet naprieč oblasťami: úvery → odporúčané poistné sumy a rezerva, nová investícia a dorovnanie dôchodku → cashflow po pláne, akčný plán
- `js/plan-pdf.js` — PDF cez [pdfmake](https://pdfmake.github.io/docs/) (vektorový text); sekcie bez údajov sa vynechajú
- `types/financial-plan.d.ts` — štruktúra údajov pre súhrn a PDF
- `js/sample-plan.js` — ukážkový klient (tlačidlo „Načítať ukážkového klienta“)

Údaje sa ukladajú v prehliadači — plán treba používať na rovnakej adrese (napr. GitHub Pages alebo lokálny server). Pri otvorení súborov priamo z disku (`file://`) niektoré prehliadače (Firefox) nezdieľajú úložisko medzi stránkami.

## Vloženie na web

1. Nahrajte na hosting (alebo GitHub Pages) súbory `plan.html`, `financny-plan.html`, `index.html`, `dochodkova-kalkulacka.html`, `zivotna-kalkulacka.html` a celý priečinok `js/` — spolu, v rovnakej štruktúre.
2. Na stránku (WordPress: blok „Vlastné HTML“) vložte kód nižšie a upravte adresu v `src`. Iframe sa sám prispôsobí výške obsahu, pri prechode medzi plánom, kalkulačkami a súhrnom posunie stránku na začiatok plánu a odkazy na kroky (#ciele…) posunú stránku na správne miesto. `headerOffset` = výška prilepenej hlavičky webu.

```html
<iframe id="fincoach-plan" src="https://www.fincoach.sk/financny-plan/plan.html" title="Finančný plán"
  style="width:100%;height:900px;border:0;display:block;border-radius:16px"></iframe>
<script>
(function () {
  var frame = document.getElementById("fincoach-plan");
  var headerOffset = 90;
  var loads = 0;
  function scrollToFrame(offsetInside) {
    var top = frame.getBoundingClientRect().top + window.pageYOffset + (offsetInside || 0) - headerOffset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }
  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data.type !== "string") return;
    if (/:height$/.test(e.data.type)) frame.style.height = Math.ceil(e.data.height) + "px";
    if (e.data.type === "financny-plan:scroll") scrollToFrame(e.data.top);
  });
  frame.addEventListener("load", function () { if (loads++ > 0) scrollToFrame(0); });
})();
</script>
```

## Spustenie

Stačí otvoriť `plan.html` (finančný plán) alebo samostatnú kalkulačku `index.html`, `dochodkova-kalkulacka.html`, `zivotna-kalkulacka.html` v prehliadači — nie je potrebný žiadny build krok.
