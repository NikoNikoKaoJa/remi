# Remi — multiplayer web igra

Web igra karata koja implementira specifičnu srpsku varijantu remija. Igra se
preko interneta — svaki igrač se pridružuje sa svog uređaja preko deljenog linka,
a stanje partije se sinhronizuje kroz besplatnu Firebase Realtime Database.

Nije potreban nikakav build alat — igra su obični statični fajlovi koje servira
GitHub Pages.

## Za igrače

1. Otvori link koji ti je host poslao (izgleda kao
   `https://<korisnik>.github.io/remi/?db=...&room=XXXX`).
2. Unesi ime i pridruži se sobi.
3. Kad se svi pridruže, host klikne „Započni igru".

Nije potreban nikakav nalog.

## Za hosta — podešavanje (radi se jednom)

### 1. Firebase baza (besplatno)

1. Idi na https://console.firebase.google.com i napravi projekat
   (Google Analytics nije potreban).
2. `Build > Realtime Database` → `Create Database` → izaberi region → **Start in
   test mode**.
3. Otvori tab **Rules**, zameni sadržaj sa:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   pa klikni **Publish**.
   > Ovo čini bazu javno čitljivom/pisivom. U redu je za igru sa društvom —
   > u bazi se čuva samo stanje partije, ništa osetljivo.
4. Na tabu **Data** kopiraj Database URL (npr.
   `https://<projekat>-default-rtdb.firebaseio.com`).

### 2. Hostovanje (GitHub Pages)

1. Fork-uj ili napravi repo sa ovim fajlovima (`index.html` u korenu).
2. `Settings > Pages` → Source: `Deploy from a branch` → branch `main`,
   folder `/ (root)` → Save.
3. Za par minuta dobiješ link `https://<korisnik>.github.io/<repo>/`.

### 3. Prvo pokretanje

Otvori svoj Pages link, nalepi Firebase Database URL kad te aplikacija pita
(samo prvi put — čuva se lokalno). Napravi sobu; aplikacija ti da gotov link
(sa već ugrađenom bazom i kodom sobe) koji prosleđuješ ostalim igračima.

## Struktura projekta

```
index.html          # HTML skeleton + CSS + <script type="module" src="js/main.js">
js/
  cards.js           # prikaz karata (simboli, DOM elementi)
  engine.js           # cista pravila igre (bez DOM-a): melds, bodovanje, deljenje
  state.js            # deljeno mutabilno stanje aplikacije + APP_VERSION
  storage.js          # Firebase REST (loadRoom/saveRoom/hydrateRoom)
  ui.js                # toast/modal pomocne DOM funkcije
  room.js              # zivotni ciklus sobe (create/join/leave/rejoin/poll)
  actions.js           # sve akcije u potezu (vuci, spusti, hand, ...)
  render.js            # sve render* funkcije
  main.js              # boot ulazna tacka
CLAUDE.md           # kontekst projekta za Claude Code
README.md           # ovaj fajl
```

Napomena: `<script type="module">` ne radi preko `file://` (CORS) — za lokalno
testiranje pokreni jednostavan HTTP server (npr. `python3 -m http.server`) i
otvori `http://localhost:8000/`. Preko GitHub Pages radi bez ikakvog dodatnog
koraka.

## Pravila igre (ukratko)

- 2 špila (108 karata), 14 karata po igraču (prvi igrač 15).
- Izlaganje traži 51+ poena u kombinacijama u tom potezu.
- Dve vrste „handa": mali (zbir ruke < 51), veliki (cela ruka odjednom).
- Bodovanje: pobednik −10, neizložen +100, izložen = zbir karata u ruci
  (As=10, Džoker=20); množi se ×2 ako je pobednik izašao handom (mali/veliki).

Kompletna pravila su u `CLAUDE.md`.

## Tehnički detalji

- Vanilla JavaScript, bez frameworka, bez build koraka.
- Stanje: Firebase Realtime Database (deljeno) + `localStorage` (sesija po
  browseru).
- Napomena: Firebase pretvara prazne `{}`/`[]` u `null` pri čuvanju; `hydrateRoom()`
  vraća podrazumevane vrednosti pri svakom učitavanju.
