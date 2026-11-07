# Husholdningsøkonomi

En enkel app for husholdningsbudsjett og regnskap. Målet er minst mulig administrasjon: last inn kortfakturaene, svar på det appen ikke kan avgjøre selv, og se hvor mye som skal overføres per budsjettpost.

## Slik bruker du den

1. **Legg inn** – eksporter transaksjonene fra nettbanken (CSV eller Excel) for Amex, SAS Mastercard eller Trumf, og slipp filene i appen. Overlappende fakturaer går fint, transaksjoner som allerede er lagt inn hoppes over.
2. **Trenger svar** – appen plasserer kjente butikker automatisk ut fra det dere har valgt før. Det den ikke vet, havner her. Ruter, Flytoget og lignende spør den alltid om (privat eller jobb).
3. **Overføring** – viser beløpet per budsjettpost og kort for hver faktura. Kryss av når pengene er overført.
4. **Oversikt** – forbruk mot budsjett denne måneden, personlig 15 %-ramme og måned for måned. Appen sier fra når en faktura mangler.
5. **Kvitteringer** – trykk 📎 på en transaksjon for å ta bilde av kvitteringen. Den lagres sammen med transaksjonen, så dere slipper å lete etterpå.

## Hvor ligger dataene?

Bare i nettleseren der appen brukes (ingenting sendes til noen server). Under **Innstillinger** kan du laste ned en backup og laste den inn igjen, også på en annen maskin eller telefon. Ta backup jevnlig, appen minner deg på det.

Private tall ligger aldri i dette repoet. Startdataene (budsjett og transaksjoner fra 2026) lastes inn fra en egen fil via **Innstillinger → Last inn backup / startdata**.

## Teknisk

Ren HTML/CSS/JavaScript uten byggesteg. Excel-filer leses med SheetJS fra cdnjs. Publiseres med GitHub Pages.
