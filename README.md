# Mapa projektów

Punkty na mapie Polski, każdy z kartą pól (nazwa projektu, miejscowość, osoba zarządzająca i kilkanaście innych), do wspólnej edycji przez link. Jedna strona statyczna, bez budowania, bez kluczy API po stronie mapy. Trasy i odczyt adresów z obrazu zostały z poprzedniej wersji, przypisania handlowców zniknęły.

**Demo:** `https://TWOJA-NAZWA.github.io/mapa-projektow/`

---

## Co robi

Klikasz w mapę, wypełniasz kartę, punkt zostaje. Kto dostanie link, ten widzi to samo i może poprawić.

| Rzecz | Jak działa |
|---|---|
| Dodawanie | kliknięciem w mapę, z adresu, z nazwy gminy, ze współrzędnych, z listy adresów, ze zdjęcia |
| Karta punktu | pola z `config.js`, popup na mapie z przyciskami edycji i usuwania |
| Wspólna edycja | każdy z linkiem czyta i zapisuje, zmiany dociągają się co kilkanaście sekund |
| Filtry | po statusie, rodzaju i województwie, plus szukanie po całej treści kart |
| Trasa | zaznaczasz punkty, OSRM układa kolejność, Google Maps prowadzi |
| Wymiana danych | eksport i import GeoJSON oraz CSV, ze współrzędnymi w PL-1992 |

Jedna rzecz, która wygląda jak magia, a jest zwykłym punktem w wielokącie: po postawieniu punktu gmina, powiat, województwo i TERYT wpisują się same z granic GUGiK. Pola zostają edytowalne, bo granica gminy nie zawsze rozstrzyga, do kogo należy projekt.

---

## Uruchomienie w pięć minut

Skrypt robi wszystko poza jednym kliknięciem w ustawieniach repozytorium:

```bash
bash tools/publikuj.sh TWOJA-NAZWA mapa-projektow
```

Ręcznie, gdyby coś poszło nie tak:

```bash
git init
git add .
git commit -m "Mapa projektów"
git branch -M main
git remote add origin https://github.com/TWOJA-NAZWA/mapa-projektow.git
git push -u origin main
```

Następnie: **Settings → Pages → Source: Deploy from a branch → `main` → `/ (root)` → Save**.

Po kilku minutach strona stoi pod `https://twoja-nazwa.github.io/mapa-projektow/` i działa w trybie lokalnym: punkty siedzą w przeglądarce osoby, która je wpisała. Do wspólnej pracy trzeba jeszcze bazy, patrz niżej.

Plik `.nojekyll` jest w repozytorium celowo. Bez niego Jekyll potrafi pominąć część plików.

### HTTPS jest wymagany

Geolokalizacja i odczyt tekstu ze zdjęcia działają wyłącznie po HTTPS. GitHub Pages daje HTTPS sam z siebie. Otwarcie `index.html` prosto z dysku wyłączy te dwie funkcje, reszta działa.

---

## Wspólna edycja przez link

Statyczna strona nie ma gdzie trzymać cudzych danych, więc potrzebna jest baza. Tu wchodzi Supabase: darmowy plan wystarcza na dziesiątki tysięcy punktów, a dostęp opisuje jeden plik SQL.

1. Załóż projekt na [supabase.com](https://supabase.com).
2. **SQL Editor**, wklej całą zawartość `supabase/schema.sql`, **Run**.
3. **Project Settings → API**, skopiuj *Project URL* i klucz *anon public*.
4. Wpisz oba do `config.js`:

```js
baza: {
  typ: 'supabase',
  url: 'https://abcdefgh.supabase.co',
  klucz: 'eyJhbGciOi...',
  tabela: 'punkty',
  odswiezanieSek: 15
}
```

5. Wypchnij zmianę na GitHub. Od tej chwili każdy z linkiem edytuje ten sam zbiór.

**Klucz anon jest publiczny z założenia.** Nie jest hasłem, tylko identyfikatorem projektu: siedzi w kodzie strony i każdy go zobaczy. O tym, co wolno, decyduje wyłącznie SQL. Klucza `service_role` nie wolno tu wkleić nigdy, bo omija wszystkie zasady dostępu.

Domyślne zasady z `schema.sql` wpuszczają każdego do wszystkiego, bo o to prosi założenie „każdy z linkiem może edytować". W pliku są dwa łagodniejsze warianty: zapis tylko dla zalogowanych albo dostęp wyłącznie do zbioru podanego w nagłówku, gdzie długa losowa nazwa zbioru pracuje jak hasło.

### Zbiory

Adres `?zbior=nazwa` rozdziela niezależne komplety punktów w jednej bazie. Osobny zbiór na projekt, na gminę albo na rok:

```
https://twoja-nazwa.github.io/mapa-projektow/?zbior=zywiec2026
https://twoja-nazwa.github.io/mapa-projektow/?zbior=mpa-zyrardow
```

Przycisk **Nowy, pusty zbiór** w zakładce *Baza* losuje nazwę i przenosi do świeżej mapy. Przycisk z ogniwami łańcucha w doku kopiuje link do bieżącego zbioru.

### Co się dzieje przy dwóch osobach naraz

Aplikacja dociąga zmiany co kilkanaście sekund i przy powrocie do karty przeglądarki. Nie ma blokad edycji: wygrywa późniejszy zapis, a karta pokazuje, kto zmieniał ostatni i kiedy. Przy dwóch osobach poprawiających ten sam punkt w tej samej minucie ktoś straci swoją wersję. Przy pracy na różnych punktach, czyli w praktyce zawsze, nie ma to znaczenia.

Zapis wykonany bez zasięgu nie przepada: czeka w skrzynce nadawczej w przeglądarce i wychodzi przy najbliższym udanym połączeniu. Pasek stanu nad przyciskami liczy zaległości.

---

## Pola karty

Wszystko opisuje tablica `pola` w `config.js`. Aplikacja nie zna nazw pól: buduje z nich formularz, popup, filtry, listę i nagłówki eksportu.

```js
{ klucz: 'moc', etykieta: 'Moc', typ: 'liczba', jednostka: 'kW', wKarcie: true }
```

| Właściwość | Do czego |
|---|---|
| `typ` | `tekst`, `wielolinijkowy`, `lista`, `liczba`, `data`, `telefon`, `email`, `url` |
| `opcje` | wartości pola typu `lista`, każda może mieć `kolor` |
| `wymagane` | bez tego pola formularz nie pozwoli zapisać |
| `wKarcie` | pokaż w popupie na mapie |
| `naLiscie` | pokaż w liście punktów w panelu |
| `filtr` | dorzuć wartości do filtrów nad listą |
| `wyliczane` | pole uzupełniane z granic, dalej edytowalne ręcznie |
| `domyslna` | wartość wstawiana do nowej karty |

Dwa ustawienia sterują wyglądem punktów:

```js
kolorujWg: 'status',   // z którego pola brać kolor pinezki
etykieta:  'nazwa'     // które pole jest podpisem punktu
```

Zmiana schematu nie kasuje starych punktów. Wartości pól, których już nie ma w `config.js`, leżą dalej w bazie i wracają przy eksporcie, tylko nie mają formularza.

---

## Sposoby dodawania punktu

**Kliknięciem.** Przycisk *Nowy punkt* w doku, potem kliknięcie w mapę. Na telefonie panel zwija się sam, żeby było widać, w co się celuje.

**Z adresu.** Pole w zakładce *Dodaj* obsługuje dwie rzeczy naraz. Wpisywanie podpowiada gminy i powiaty z bazy granic, klik w podpowiedź stawia punkt na siedzibie urzędu. Enter albo przycisk *Szukaj adresu* pyta Nominatim o konkretny adres.

**Ze współrzędnych.** WGS 84 w stopniach dziesiętnych albo PL-1992 w metrach. Przeliczenie jest liczone na miejscu, bez proj4, i zgadza się z pyproj poniżej milimetra. Formularz pod spodem pokazuje drugą parę współrzędnych na bieżąco.

**Z listy adresów.** Wklejone wiersze idą po kolei do geokodera. Tabelka pokazuje, co się znalazło, a co nie, i pozwala poprawić wpis przed utworzeniem punktów.

**Ze zdjęcia.** Tesseract.js czyta tekst z fotografii albo zrzutu ekranu, wyciąga wiersze i wpuszcza je do tej samej tabelki weryfikacji. Przy pierwszym użyciu pobiera około 15 MB słownika.

---

## Trasa

Zaznaczasz punkty ikoną `↝` w liście albo przyciskiem w karcie na mapie, wybierasz zakończenie trasy i klikasz *Wyznacz kolejność*.

| Tryb | Co znaczy |
|---|---|
| Pętla | wracasz tam, skąd wyjechałeś |
| Start → meta | ostatni przystanek na liście jest metą |
| Otwarta | kończysz tam, gdzie wypada najszybciej |

Kolejność liczy OSRM, bo do ustalenia, w jakiej kolejności objechać punkty, wystarczą względne koszty przejazdu. Bezwzględny czas przyjazdu jest domeną Google, które liczy go z historycznych śladów GPS, i stąd przycisk nawigacji jako główna akcja zakładki. Aplikacja nie mnoży wyniku OSRM przez żaden współczynnik korygujący i podpisuje go wprost: szacunek bez ruchu drogowego.

Google przyjmuje najwyżej dziesięć punktów w jednym odnośniku, więc dłuższe trasy dzielą się na zazębiające się etapy: meta etapu jest startem następnego.

---

## Wymiana danych

**Eksport GeoJSON** zachowuje wszystkie pola, także te spoza schematu, i dokłada do każdego punktu współrzędne w PL-1992 jako `_x_1992` i `_y_1992`. Wchodzi wprost do QGIS.

**Eksport CSV** ma średnik jako separator i BOM na początku, więc Excel otwiera go bez kreatora importu.

**Import** przyjmuje jedno i drugie. W CSV szuka kolumn `lat`/`lng` albo `x`/`y` (te drugie traktuje jako PL-1992), pozostałe kolumny dopasowuje po kluczu pola albo po etykiecie, bez ogonków i wielkości liter. Czego nie rozpozna, to i tak zachowa. Import dokłada punkty do zbioru, nie podmienia go.

---

## Struktura

```
index.html            interfejs i style
config.js             pola karty, kolory, adres bazy      ← to się zmienia
store.js              warstwa danych: lokalna i Supabase
app.js                mapa, formularze, filtry, trasa, import
data/granice.js       380 powiatów z siedzibami (~400 kB)
data/gminy.js         2477 gmin i granice województw (~1,9 MB, wczytywane w tle)
supabase/schema.sql   tabela i zasady dostępu
tools/test.js         testy bez przeglądarki
tools/publikuj.sh     testy i wypchnięcie na GitHub
```

Pliki w `data/` są generowane. Granice pochodzą z Geoportalu i GUGiK, siedziby urzędów z rejestru PRNG. Punktem gminy jest siedziba władz, nie środek geometryczny obszaru, bo środek ciężkości gminy wypada zwykle w polu.

---

## Testy

```bash
npm install
npm test
```

Sześćdziesiąt kilka sprawdzeń w jsdom z zaślepionym Leafletem i wyłączoną siecią. Pilnują między innymi: przeliczania PL-1992 wobec wartości z pyproj, uzupełniania gminy z granic, blokady zapisu bez wymaganego pola, rozdzielności zbiorów, tego, że start trasy zostaje pierwszy, i tego, że awaria bazy nie gubi zapisanej zmiany.

---

## Ograniczenia

- **Klucz anon jest publiczny.** Domyślne zasady RLS oznaczają zbiór otwarty dla każdego, kto zajrzy w kod strony. Do danych, które nie mogą wyciec, użyj wariantu z logowaniem z `supabase/schema.sql`.
- **Brak historii zmian.** Poprawiona wartość nadpisuje poprzednią. Kto i kiedy, wiadomo; co było wcześniej, już nie. Kopie rób eksportem.
- **Brak natychmiastowej synchronizacji.** Aplikacja odpytuje bazę co kilkanaście sekund zamiast trzymać otwarte połączenie realtime. Prościej, taniej i wystarczy przy kilku osobach.
- **Nominatim przyjmuje jedno zapytanie na sekundę.** Import czterdziestu adresów trwa około minuty. To nie jest zawieszenie.
- **Publiczny serwer OSRM obsługuje do stu punktów naraz.** Powyżej dziewięćdziesięciu pięciu przystanków aplikacja przechodzi na szacunek z linii prostej i mówi o tym wprost.
- **Szacunki OSRM bywają dłuższe niż w Google.** Publiczny serwer pracuje na starszym wycinku OSM i nie zna części nowych ekspresówek. Przy poważniejszym użyciu postaw własny i zmień stałą `OSRM` na początku `app.js`.
- **Ortofotomapa Geoportalu** bywa przeciążona. Po ośmiu nieudanych kafelkach aplikacja przechodzi na zdjęcia Esri i mówi o tym w podpowiedzi nad mapą.
- **Granice gmin rysują się od przybliżenia 9** i tylko w kadrze. 2477 obszarów naraz dławi telefon.

---

## Źródła danych i usługi

| Co | Skąd |
|---|---|
| Granice powiatów | Geoportal |
| Granice gmin i województw | [jusuff/PolandGeoJson](https://github.com/jusuff/PolandGeoJson) (GUGiK, domena publiczna) |
| Siedziby urzędów | [PRNG przez jjbartek/polskie-miejscowosci](https://github.com/jjbartek/polskie-miejscowosci) |
| Mapa | [Leaflet](https://leafletjs.com/), kafelki [CARTO](https://carto.com/) na danych [OpenStreetMap](https://www.openstreetmap.org/copyright) |
| Podkłady | [Geoportal GUGiK](https://www.geoportal.gov.pl/) z zapasem Esri, OpenStreetMap, [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA) |
| Baza | [Supabase](https://supabase.com/) (PostgreSQL i PostgREST) |
| Trasowanie | [OSRM](https://project-osrm.org/) |
| Geokodowanie | [Nominatim](https://nominatim.org/) |
| Odczyt z obrazu | [Tesseract.js](https://tesseract.projectnaptha.com/) |

Serwery OSRM i Nominatim są udostępniane publicznie na zasadzie dobrej woli. Przy poważniejszym użyciu postaw własne.

---

## Licencja

MIT, patrz `LICENSE`. Dane OpenStreetMap na licencji ODbL.
