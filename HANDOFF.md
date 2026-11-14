# Overlevering: Husholdningsøkonomi-appen

Les denne før du gjør endringer. Den beskriver hva som er bygget, hvorfor, og hva som gjenstår.

## Mål (fra brukeren)

En app som holder orden på husholdningsbudsjett og regnskap med **minst mulig administrering**. Suksess = paret holder seg oppdatert uten å lete i historikken hver måned etter kvitteringer og skjermbilder. Brukes av to personer (Hiep og kona), først og fremst på **iPhone**.

Brukeren koder ikke og vil ikke lære det. Gjør alt selv, spør minst mulig, forklar på norsk i enkle steg.

## Hvor ting ligger

| Hva | Hvor |
|---|---|
| App (live) | https://hiephurra.github.io/mediakit-website/ |
| Kode-repo (offentlig, bare kode) | https://github.com/Hiephurra/mediakit-website – lokalt i `/Users/hieptran/Claude/mediakit-website` |
| Data-repo (privat) | https://github.com/Hiephurra/mediakit-data – `data.json` + `kvitteringer/<id>.txt` |
| Utgangspunkt | Claude-dashbordet «Rotvollen økonomi 2027»: https://claude.ai/artifact/SKa57vwDeJiEpPJcQWJ9xV |
| GitHub CLI | `~/.local/bin/gh` (innlogget som Hiephurra) |

Repo-navnet «mediakit-website» ble valgt av brukeren selv, selv om det ikke passer innholdet.

## Arkitektur

Ren statisk side, ingen byggesteg: `index.html`, `style.css`, `app.js` (~980 linjer), `sw.js`, `manifest.webmanifest`, `ikon.svg` + `ikon-180/192/512.png`. Excel leses med SheetJS 0.18.5 fra cdnjs.

**Faner:** Oversikt · Trenger svar · Legg inn · Overføring · Transaksjoner · Budsjett · Arkiv · Innstillinger.

**Datamodell** (`S` i app.js, lagres i localStorage `husholdningsokonomi-v1`):
- `poster` [{navn, budsjett, snitt2026?}] – variable kortbetalte poster
- `faste` [{gruppe: Inntekt|Fast kostnad|Sparing, post, belop, merknad}]
- `personer` [{navn, lonn}] – 15 %-ramme = lønn × 15/85
- `transaksjoner` [{id, kort, dato, tekst, belop, status: fort|privat|utelatt|bekreft, post, fort?, eier?, grunn?, merknad, kvittering?, endret?}]
- `historikk` (2026-måneder fra regnearket), `ekstra` (arkivtabeller: strøm, SAS-voucher, ferie …), `overfort`, `innstillinger` (kort med fakturastartdag: Amex 20., øvrige 1.)
- `endret` (tidsstempel per del) og `slettet` (gravsteiner) – brukes av synkroniseringen

**Automatisk plassering** (`klassifiser`): innbetalinger → utelatt; «spør alltid»-ord (Ruter, Flytoget, Vy, Skyss) → spør; ellers flertall fra tidligere transaksjoner i samme butikk (`nokkel()` = to første ord). Én-gangs-utfall (utlegg for andre, refusjon, svindel) teller ikke. Privat krever minst 2 like tidligere. Så nøkkelordliste. Ellers «Trenger svar».

**Import:** CSV/XLSX, finner kolonner for dato/tekst/beløp ut fra overskrifter, snur fortegn hvis kjøp er negative, gjetter kort fra filnavn. Duplikater (overlappende fakturaer) telles per nøkkel kort|dato|beløp|tekst.

**Felles lagring:** GitHub Contents API mot `mediakit-data` med en fine-grained token som brukeren lager selv (Contents read/write, bare det repoet). Tokenet ligger i localStorage `husholdningsokonomi-synk` på hver enhet. Den andre telefonen kobles til med en «oppsettkode» (base64 av repo+token). Sammenslåing: per transaksjon (nyeste `endret` vinner) og per del (nyeste `endret[del]` vinner). Slettinger via gravsteiner. Konflikt (409/422) → hent, slå sammen og prøv igjen. Synkroniserer ved oppstart, når appen blir synlig, hvert minutt og 1,5 s etter en endring. Testet mot en simulert GitHub: sammenslåing, sletting og samtidige skrivinger virker.

## PWA (trinn 1, versjon 7)

- `sw.js` lagrer appfilene og SheetJS på enheten, så appen åpner uten nett. Strategi: nett først med 2,5 s tidsfrist, ellers lagret kopi. Kall til api.github.com går alltid rett på nett.
- Data ligger som før i localStorage + IndexedDB. Uten nett viser statusen «Uten nett – lagret på enheten», og appen synker selv når nettet er tilbake (`online`-hendelsen).
- Innstillinger har panelet «App på telefonen» med installasjonssteg og «Se etter ny versjon».
- **iPhone:** appen på Hjem-skjermen har eget lager, adskilt fra Safari. Den starter tom og må kobles til med oppsettkoden på nytt.
- Testet lokalt: appen laster og virker med serveren slått av. Ikke bekreftet på ekte iPhone.
- Lokal test: `/Users/hieptran/Claude/.claude/launch.json` (server «budsjett», port 8765).

## Publisering

1. Endre filene og commit (forfatter: Hiep Tran).
2. **Øk versjonsnummeret tre steder, likt:** `?v=N` i `index.html`, `VERSJON` + fillisten i `sw.js`, og `APP_VERSJON` i `app.js` (nå `7`). Ellers viser telefonen gammel kopi.
3. `git push`. Pages oppdateres på 1–2 minutter.

## Viktige beslutninger og begrensninger

- **Ingen private tall i kode-repoet.** Det er offentlig (gratis Pages). Startdataene ligger i det private data-repoet. Sjekk med `git grep` før commit.
- Claude skal aldri skrive inn eller håndtere tokens. Brukeren lager og limer inn nøkkelen selv.
- Auto-modusen blokkerer det som publiserer offentlig (offentlig repo, Pages). Brukeren må si eksplisitt ja.
- Startdataene (2026-budsjett, 182 Amex-transaksjoner + Hieps private, arkiv) er lagt inn i `mediakit-data/data.json`. Brukerens telefon er koblet til og synker.

## Åpne punkter

0. **Trinn 2 (innlogging) er droppet** etter brukerens valg 14.11.2026: han vil ikke ha Supabase. Dagens deling med GitHub-nøkkel + oppsettkode beholdes som synkronisering. Ikke foreslå innloggingstjeneste på nytt uten at han ber om det.

1. **Kanten kuttes på iPhone.** Siden var litt for bred i Safari (høyre kant kuttet). Rettingen i `v=6` (menyen brytes på flere linjer på mobil, `overflow-x: clip`) er ikke bekreftet på telefonen. Feilen vises ikke i Chromium-emulering. Be om skjermbilde.
2. Konas telefon er sannsynligvis ikke koblet til ennå (Innstillinger → Koble til en annen telefon → oppsettkode).
3. Posten **Alkohol** har budsjett 0. I regnearket lå den inne i Husholdning. Brukeren bør bestemme beløpet.
4. **SAS Mastercard** oktober-faktura er ikke lagt inn. Ingen ekte SAS- eller Trumf-eksport er testet ennå, bare en syntetisk Amex-CSV. Første ekte fil kan avsløre kolonneformater som må håndteres.
5. Mulige forbedringer: bilde- eller PDF-import av kvitteringer med tolkning, påminnelse når fakturadato passerer, budsjett 2027 måned for måned.
