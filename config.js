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
    typ: 'supabase',
    url: 'https://dhzjqxhoiaroauimoepq.supabase.co',                        // np. 'https://dhzjqxhoiaroauimoepq.supabase.co'
    klucz: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoempxeGhvaWFyb2F1aW1vZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTI4MjksImV4cCI6MjEwMDQ2ODgyOX0.NbGtNJfofzyGgoa9Vkq93H7nATrsQivpsJt0fuUS2tU',                      // klucz anon (publiczny)
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
    { klucz: 'nazwa', etykieta: 'Nazwa projektu', typ: 'tekst',
      wymagane: true, wKarcie: false, naLiscie: false },

    { klucz: 'status', etykieta: 'Status', typ: 'lista', filtr: true, wKarcie: true, naLiscie: true,
      domyslna: 'planowany',
      opcje: [
        { wartosc: 'planowany',       kolor: '#6B7A8F' },
        { wartosc: 'w przygotowaniu', kolor: '#A8873E' },
        { wartosc: 'w realizacji',    kolor: '#5F7148' },
        { wartosc: 'zakończony',      kolor: '#3A3E2C' },
        { wartosc: 'wstrzymany',      kolor: '#A14A3C' }
      ] },

    { klucz: 'rodzaj', etykieta: 'Rodzaj przedsięwzięcia', typ: 'lista', filtr: true, wKarcie: true, naLiscie: true,
      opcje: [
        { wartosc: 'fotowoltaika' }, { wartosc: 'elektrownia wiatrowa' },
        { wartosc: 'biogazownia' }, { wartosc: 'magazyn energii' },
        { wartosc: 'pompy ciepła' }, { wartosc: 'kogeneracja' },
        { wartosc: 'sieć ciepłownicza' }, { wartosc: 'termomodernizacja' },
        { wartosc: 'oświetlenie uliczne' }, { wartosc: 'sieć elektroenergetyczna' },
        { wartosc: 'inne' }
      ] },

    { klucz: 'miejscowosc', etykieta: 'Miejscowość', typ: 'tekst', wKarcie: true },
    { klucz: 'adres', etykieta: 'Adres', typ: 'tekst', wKarcie: true },

    { klucz: 'gmina',       etykieta: 'Gmina',        typ: 'tekst', wyliczane: true, wKarcie: true },
    { klucz: 'powiat',      etykieta: 'Powiat',       typ: 'tekst', wyliczane: true },
    { klucz: 'wojewodztwo', etykieta: 'Województwo',  typ: 'tekst', wyliczane: true, filtr: true },
    { klucz: 'teryt',       etykieta: 'TERYT gminy',  typ: 'tekst', wyliczane: true },

    { klucz: 'osoba',   etykieta: 'Osoba zarządzająca', typ: 'tekst', wKarcie: true, naLiscie: true },
    { klucz: 'telefon', etykieta: 'Telefon', typ: 'telefon' },
    { klucz: 'email',   etykieta: 'E-mail',  typ: 'email' },

    { klucz: 'inwestor', etykieta: 'Inwestor', typ: 'tekst', wKarcie: true },
    { klucz: 'moc',      etykieta: 'Moc', typ: 'liczba', jednostka: 'kW', wKarcie: true },
    { klucz: 'budzet',   etykieta: 'Budżet', typ: 'liczba', jednostka: 'zł' },
    { klucz: 'zrodlo',   etykieta: 'Źródło finansowania', typ: 'tekst' },

    { klucz: 'start',  etykieta: 'Rozpoczęcie',  typ: 'data', wKarcie: true },
    { klucz: 'koniec', etykieta: 'Zakończenie',  typ: 'data' },

    { klucz: 'link',     etykieta: 'Odnośnik', typ: 'url', wKarcie: true },
    { klucz: 'notatki',  etykieta: 'Notatki',  typ: 'wielolinijkowy', wKarcie: true }
  ]
};
