# Husholdningsøkonomi

En enkel app for husholdningsbudsjett og regnskap. Målet er minst mulig administrasjon: last inn kortfakturaene, svar på det appen ikke kan avgjøre selv, og se hvor mye som skal overføres per budsjettpost.

## Slik bruker du den

1. **Legg inn** – eksporter transaksjonene fra nettbanken (CSV eller Excel) for Amex, SAS Mastercard eller Trumf, og slipp filene i appen. Overlappende fakturaer går fint, transaksjoner som allerede er lagt inn hoppes over.
2. **Trenger svar** – appen plasserer kjente butikker automatisk ut fra det dere har valgt før. Det den ikke vet, havner her. Ruter, Flytoget og lignende spør den alltid om (privat eller jobb).
3. **Overføring** – viser beløpet per budsjettpost og kort for hver faktura. Kryss av når pengene er overført.
4. **Oversikt** – forbruk mot budsjett denne måneden, personlig 15 %-ramme og måned for måned. Appen sier fra når en faktura mangler.
5. **Kvitteringer** – trykk 📎 på en transaksjon for å ta bilde av kvitteringen. Den lagres sammen med transaksjonen, så dere slipper å lete etterpå.

## App på telefonen

Åpne siden i Safari på iPhone → Del-knappen → **Legg til på Hjem-skjerm**. Da åpner den som en vanlig app og virker uten nett. Det du gjør uten nett lagres på telefonen og deles når nettet er tilbake.

## Hvor ligger dataene?

I nettleseren der appen brukes, og – hvis dere kobler til **felles lagring** – i et eget privat GitHub-repo (`mediakit-data`) som bare dere har tilgang til. Da ser alle telefonene de samme tallene og kvitteringene, og appen synkroniserer når den åpnes og når noe endres. Endringer fra to telefoner samtidig slås sammen.

**Koble til første gang:** Innstillinger → Felles lagring → følg stegene for å lage en GitHub-nøkkel som bare har tilgang til `mediakit-data`.
**Koble til den andre telefonen:** På den første telefonen: «Koble til en annen telefon» → kopier oppsettkoden → lim den inn på den andre telefonen.

Under **Innstillinger** kan du også laste ned en backup-fil.

Private tall ligger aldri i dette repoet. Startdataene (budsjett og transaksjoner fra 2026) lastes inn fra en egen fil via **Innstillinger → Last inn backup / startdata**.

## Teknisk

Ren HTML/CSS/JavaScript uten byggesteg. Excel-filer leses med SheetJS fra cdnjs. `sw.js` lagrer appen på enheten så den virker uten nett. Publiseres med GitHub Pages.
