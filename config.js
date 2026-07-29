/* Mapa projektów: konfiguracja.
   To jedyny plik, który zwykle trzeba zmienić. Pola punktu, kolory statusów
   i adres bazy siedzą tutaj, żeby nie grzebać w logice aplikacji.

   Po zmianie pól starsze punkty nie znikają: wartości nieopisane w schemacie
   są przechowywane dalej i wracają przy eksporcie, tylko nie mają formularza. */

window.KONFIG = {

  /* ---------- nagłówek ---------- */
  tytul: 'Mapa projektów',
  podtytul: 'Punkty · karty · trasy',

  /* ---------- baza ----------
     'lokalny'  : dane w przeglądarce, każdy ma swoje, żadnej konfiguracji
     'supabase' : dane wspólne, każdy z linkiem edytuje

     Żeby włączyć tryb wspólny: wykonaj supabase/schema.sql w swoim projekcie
     Supabase, potem wklej poniżej adres projektu i klucz `anon`.
     Klucz `anon` jest publiczny z założenia, bo zasady dostępu ustawia SQL,
     nie tajność klucza. Nigdy nie wklejaj tu klucza `service_role`. */
  baza: {
    typ: 'lokalny',
    url: '',                        // np. 'https://abcdefgh.supabase.co'
    klucz: '',                      // klucz anon (publiczny)
    tabela: 'punkty',
    odswiezanieSek: 15              // co ile sekund dociągać zmiany innych osób
  },

  /* ---------- mapa ---------- */
  widok: { lat: 52.05, lng: 19.35, zoom: 6 },
  granice: true,                    // rysuj granice gmin i powiatów pod punktami
  uzupelniajJednostki: true,        // po postawieniu punktu wpisz gminę, powiat i województwo

  /* ---------- wygląd punktów ---------- */
  kolorujWg: 'status',              // klucz pola typu 'lista' z kolorami
  etykieta: 'nazwa',                // pole na podpis punktu w liście i popupie
  podtytulPunktu: 'miejscowosc',

  /* ---------- pola karty ----------
     typ:  tekst | wielolinijkowy | lista | liczba | data | telefon | email | url
     wKarcie: pokazać w popupie na mapie
     naLiscie: pokazać w liście punktów w panelu
     filtr: dorzucić do filtrów nad listą (tylko dla typu 'lista')
     wyliczane: pole uzupełniane automatycznie z granic, edytowalne ręcznie   */
  pola: [
    { klucz: 'nazwa', etykieta: 'Nazwa', typ: 'tekst',
      wymagane: true, wKarcie: false, naLiscie: false },

    { klucz: 'status', etykieta: 'Status', typ: 'lista', filtr: true, wKarcie: true, naLiscie: true,
      domyslna: 'planowany',
      opcje: [
        { wartosc: 'planowany',    kolor: '#6B7A8F' },
        { wartosc: 'w realizacji', kolor: '#5F7148' },
        { wartosc: 'zakończony',   kolor: '#3A3E2C' },
        { wartosc: 'wstrzymany',   kolor: '#A14A3C' }
      ] },

    // Podmień wartości pakietu na własne. Kolor jest opcjonalny.
    { klucz: 'pakiet', etykieta: 'Pakiet', typ: 'lista', filtr: true, wKarcie: true, naLiscie: true,
      opcje: [
        { wartosc: 'P1' }, { wartosc: 'P2' }, { wartosc: 'P3' }, { wartosc: 'P4' }
      ] },

    { klucz: 'miejscowosc',  etykieta: 'Miejscowość',  typ: 'tekst', wyliczane: true, wKarcie: true, naLiscie: true },
    { klucz: 'adres',        etykieta: 'Adres',        typ: 'tekst', wKarcie: true },
    { klucz: 'podwykonawca', etykieta: 'Podwykonawca', typ: 'tekst', wKarcie: true },
    { klucz: 'zakres',       etykieta: 'Zakres',       typ: 'wielolinijkowy', wKarcie: true },
    { klucz: 'notatki',      etykieta: 'Notatki',      typ: 'wielolinijkowy', wKarcie: true }
  ]
};
