/* Testy bez przeglądarki: jsdom, zaślepiony Leaflet, zaślepiona sieć.
   Uruchomienie: npm test                                                  */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const KATALOG = path.join(__dirname, '..');
let zaliczone = 0, oblane = 0;

function sprawdz(opis, warunek, szczegol) {
  if (warunek) { zaliczone++; console.log('  ✓ ' + opis); }
  else { oblane++; console.log('  ✗ ' + opis + (szczegol ? '  → ' + szczegol : '')); }
}

function rowne(opis, a, b) {
  sprawdz(opis, a === b, 'dostałem ' + JSON.stringify(a) + ', spodziewałem się ' + JSON.stringify(b));
}

/* ---------- zaślepka Leafleta ---------- */

function leaflet(win) {
  const warstwa = () => ({
    addTo() { return this; }, addData() { return this; }, clearLayers() { return this; },
    getLayers() { return []; }, on() { return this; }, remove() {}
  });

  win.__markery = [];
  const marker = (ll, opcje) => ({
    _ll: ll, options: opcje || {},
    bindPopup(t) { this._popup = t; win.__markery.push(this); return this; },
    on() { return this; }, addTo() { return this; },
    openPopup() { this._otwarty = true; return this; },
    isPopupOpen() { return !!this._otwarty; },
    getPopup() { return { getContent: () => this._popup }; }
  });

  const L = {
    map() {
      return {
        _z: 6, _zdarzenia: {},
        setView() { return this; }, getZoom() { return this._z; },
        on(nazwy, fn) { String(nazwy).split(' ').forEach(n => { this._zdarzenia[n] = fn; }); return this; },
        fire(n, e) { if (this._zdarzenia[n]) this._zdarzenia[n](e); },
        createPane() { return {}; }, getPane() { return { style: {} }; },
        getContainer() { return win.document.getElementById('map'); },
        hasLayer() { return false; }, removeLayer() {}, addLayer() {}, closePopup() {},
        fitBounds() {}, getBounds() { return { getSouth: () => 49, getNorth: () => 55, getWest: () => 14, getEast: () => 24 }; }
      };
    },
    control: { zoom: () => ({ addTo() { return this; } }) },
    tileLayer: () => ({ addTo() { return this; }, on() { return this; } }),
    geoJSON: () => warstwa(),
    layerGroup: () => {
      const l = warstwa();
      l._dzieci = [];
      return l;
    },
    marker, divIcon: (o) => o, polyline: () => ({ addTo() { return this; } }),
    latLngBounds: (a) => ({ pad: () => a }),
    svg: () => ({})
  };
  return L;
}

/* ---------- środowisko ---------- */

function srodowisko(opcje) {
  opcje = opcje || {};
  const html = fs.readFileSync(path.join(KATALOG, 'index.html'), 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.log('    [błąd strony] ' + (e.detail || e.message)); });
  vc.on('error', (...a) => console.log('    [console.error] ' + a.join(' ')));
  const dom = new JSDOM(html, { url: opcje.url || 'https://przyklad.pl/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;

  win.L = leaflet(win);
  win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  win.confirm = () => true;
  win.alert = () => {};
  win.scrollTo = () => {};
  win.fetch = opcje.fetch || (() => Promise.reject(new Error('sieć wyłączona w testach')));
  win.URL.createObjectURL = () => 'blob:test';
  win.URL.revokeObjectURL = () => {};

  const wczytaj = (plik) => win.eval(fs.readFileSync(path.join(KATALOG, plik), 'utf8'));

  wczytaj('config.js');
  if (opcje.konfig) opcje.konfig(win.KONFIG);
  wczytaj('store.js');

  // zamiast 400 kB granic: trzy powiaty i jedna gmina wystarczą do testów
  win.POWIATY_DB = {
    wersja: 3,
    geo: { type: 'FeatureCollection', features: [] },
    centers: [
      ['2417', 'powiat żywiecki', 'śląskie', 49.61, 19.20, 49.678, 19.188, 'Żywiec', 'Starostwo Powiatowe'],
      ['0201', 'powiat bolesławiecki', 'dolnośląskie', 51.33, 15.53, 51.263, 15.564, 'Bolesławiec', 'Starostwo Powiatowe']
    ]
  };
  win.GMINY_DB = {
    wersja: 2,
    geo: { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { k: '2417011' },
      geometry: { type: 'Polygon', coordinates: [[[19.0, 49.5], [19.4, 49.5], [19.4, 49.8], [19.0, 49.8], [19.0, 49.5]]] }
    }] },
    centers: [['2417011', 'Żywiec', 'śląskie', 49.685, 19.192, 49.685, 19.192, 'Żywiec', 'Urząd Miejski', 'powiat żywiecki']]
  };
  win.WOJ_DB = { type: 'FeatureCollection', features: [] };

  wczytaj('app.js');
  // jsdom nie kończy wczytywania strony (nie ściągamy Leafleta ani stylów),
  // więc zdarzenie startowe wywołujemy sami
  if (win.document.readyState === 'loading') {
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  }
  return win;
}

const czekaj = (ms) => new Promise(r => setTimeout(r, ms));

/* ====================== testy ====================== */

(async function () {

  console.log('\nPrzeliczanie współrzędnych');
  {
    const win = srodowisko();
    // wartości odniesienia z pyproj, EPSG:4326 → EPSG:2180
    const odniesienie = [
      [52.2297, 21.0122, 486757.209, 637382.204],
      [49.678, 19.188, 201195.720, 513559.110],
      [54.35, 18.65, 720712.953, 477257.412]
    ];
    // wchodzimy przez publiczne wejście: pole współrzędnych w formularzu
    for (const [lat, lng, x, y] of odniesienie) {
      win.document.getElementById('uklad').value = 'wgs';
      win.document.getElementById('wsp1').value = String(lat);
      win.document.getElementById('wsp2').value = String(lng);
      win.document.getElementById('btnWsp').click();
      const podpis = win.document.getElementById('f_1992').textContent;
      const m = podpis.match(/X (-?\d+) · Y (-?\d+)/);
      sprawdz('PL-1992 dla ' + lat + ', ' + lng,
        m && Math.abs(+m[1] - x) < 1 && Math.abs(+m[2] - y) < 1, podpis);
      win.document.getElementById('sheetX').click();
    }

    // droga powrotna: PL-1992 → punkt w tym samym miejscu
    win.document.getElementById('uklad').value = 'pl1992';
    win.document.getElementById('wsp1').value = '201195.72';
    win.document.getElementById('wsp2').value = '513559.11';
    win.document.getElementById('btnWsp').click();
    const lat = parseFloat(win.document.getElementById('f_lat').value);
    const lng = parseFloat(win.document.getElementById('f_lng').value);
    sprawdz('PL-1992 z powrotem na WGS 84', Math.abs(lat - 49.678) < 1e-5 && Math.abs(lng - 19.188) < 1e-5,
      lat + ', ' + lng);
    win.document.getElementById('sheetX').click();
  }

  console.log('\nDodawanie i edycja punktu');
  {
    const win = srodowisko();
    const d = win.document;

    d.getElementById('uklad').value = 'wgs';
    d.getElementById('wsp1').value = '49.68';
    d.getElementById('wsp2').value = '19.19';
    d.getElementById('btnWsp').click();

    sprawdz('formularz się otworzył', d.getElementById('sheet').classList.contains('on'));
    sprawdz('status ma wartość domyślną', d.querySelector('[data-pole="status"]').value === 'planowany');

    // zapis bez nazwy nie przechodzi
    d.getElementById('sheetZapisz').click();
    await czekaj(10);
    sprawdz('pusta nazwa blokuje zapis', d.getElementById('sheet').classList.contains('on'));
    sprawdz('komunikat o brakującym polu', /Nazwa projektu/.test(d.getElementById('toast').textContent));

    d.querySelector('[data-pole="nazwa"]').value = 'PV Moszczanica';
    d.querySelector('[data-pole="osoba"]').value = 'Kamil';
    d.querySelector('[data-pole="moc"]').value = '499';
    d.getElementById('sheetZapisz').click();
    await czekaj(30);

    sprawdz('formularz się zamknął', !d.getElementById('sheet').classList.contains('on'));
    rowne('punkt jest na liście', d.querySelectorAll('#lista .pi').length, 1);
    sprawdz('nazwa w liście', /PV Moszczanica/.test(d.getElementById('lista').textContent));
    sprawdz('gmina uzupełniona z granic', /Żywiec/.test(d.getElementById('lista').textContent));

    const zapis = JSON.parse(win.localStorage.getItem('mp:punkty:domyslna'));
    rowne('punkt trafił do pamięci przeglądarki', zapis.length, 1);
    rowne('moc zapisana jako liczba', typeof zapis[0].dane.moc, 'number');
    rowne('powiat z granic', zapis[0].dane.powiat, 'powiat żywiecki');
    rowne('TERYT z granic', zapis[0].dane.teryt, '2417011');

    // edycja
    d.querySelector('#lista .pi [data-a="edytuj"]').click();
    sprawdz('formularz otwarty do edycji', d.getElementById('sheet').classList.contains('on'));
    rowne('formularz pokazuje zapisaną nazwę', d.querySelector('[data-pole="nazwa"]').value, 'PV Moszczanica');
    d.querySelector('[data-pole="status"]').value = 'w realizacji';
    d.getElementById('sheetZapisz').click();
    await czekaj(30);

    const po = JSON.parse(win.localStorage.getItem('mp:punkty:domyslna'));
    rowne('status po edycji', po[0].dane.status, 'w realizacji');
    rowne('liczba punktów bez zmian', po.length, 1);

    // usuwanie
    d.querySelector('#lista .pi [data-a="edytuj"]').click();
    d.getElementById('sheetUsun').click();
    await czekaj(30);
    rowne('po usunięciu lista pusta', JSON.parse(win.localStorage.getItem('mp:punkty:domyslna')).length, 0);
  }

  console.log('\nFiltry i szukanie');
  {
    const win = srodowisko();
    const d = win.document;
    const dodaj = async (nazwa, status, miejsc) => {
      d.getElementById('uklad').value = 'wgs';
      d.getElementById('wsp1').value = '49.68'; d.getElementById('wsp2').value = '19.19';
      d.getElementById('btnWsp').click();
      d.querySelector('[data-pole="nazwa"]').value = nazwa;
      d.querySelector('[data-pole="status"]').value = status;
      d.querySelector('[data-pole="miejscowosc"]').value = miejsc;
      d.getElementById('sheetZapisz').click();
      await czekaj(20);
    };
    await dodaj('Kotłownia', 'w realizacji', 'Milówka');
    await dodaj('Farma PV', 'planowany', 'Rajcza');
    await dodaj('Magazyn', 'planowany', 'Węgierska Górka');

    rowne('trzy punkty', d.querySelectorAll('#lista .pi').length, 3);

    const chipy = Array.from(d.querySelectorAll('#filtry .fchip'));
    const planowany = chipy.find(c => c.getAttribute('data-v') === 'planowany');
    sprawdz('filtr statusu ma licznik', /2/.test(planowany.querySelector('.c').textContent));
    planowany.click();
    rowne('filtr zawęża listę', d.querySelectorAll('#lista .pi').length, 2);
    planowany.click();
    rowne('drugie kliknięcie zdejmuje filtr', d.querySelectorAll('#lista .pi').length, 3);

    const szukaj = d.getElementById('szukaj');
    szukaj.value = 'wegierska';                       // bez ogonków
    szukaj.dispatchEvent(new win.Event('input'));
    rowne('szukanie ignoruje polskie znaki', d.querySelectorAll('#lista .pi').length, 1);
    szukaj.value = '';
    szukaj.dispatchEvent(new win.Event('input'));
    rowne('puste szukanie pokazuje wszystko', d.querySelectorAll('#lista .pi').length, 3);
  }

  console.log('\nTrasa');
  {
    const win = srodowisko();
    const d = win.document;
    const punkty = [['A', 49.6, 19.1], ['B', 50.1, 19.9], ['C', 52.2, 21.0], ['D', 49.7, 19.2]];
    for (const [n, lat, lng] of punkty) {
      d.getElementById('uklad').value = 'wgs';
      d.getElementById('wsp1').value = String(lat); d.getElementById('wsp2').value = String(lng);
      d.getElementById('btnWsp').click();
      d.querySelector('[data-pole="nazwa"]').value = n;
      d.getElementById('sheetZapisz').click();
      await czekaj(20);
    }

    rowne('cztery punkty', d.querySelectorAll('#lista .pi').length, 4);
    for (let i = 0; i < 4; i++) d.querySelectorAll('#lista .pi [data-a="trasa"]')[i].click();
    rowne('wszystkie w trasie', d.querySelectorAll('#stops .stop').length, 4);
    rowne('licznik w zakładce', d.getElementById('cntTrasa').textContent, '4');

    d.getElementById('btnOpt').click();
    await czekaj(60);

    const kolejnosc = Array.from(d.querySelectorAll('#stops .stop-name')).map(e => e.textContent.trim().slice(0, 1));
    rowne('start zostaje pierwszy', kolejnosc[0], 'A');
    sprawdz('najdalszy punkt nie jest drugi', kolejnosc[1] !== 'C', kolejnosc.join(''));
    sprawdz('bez sieci liczymy przybliżenie', /przybliż/i.test(d.getElementById('rsNote').textContent),
      d.getElementById('rsNote').textContent);

    const go = d.getElementById('btnGo');
    sprawdz('odnośnik do Google gotowy', /google\.com\/maps\/dir/.test(go.getAttribute('href') || ''));
    sprawdz('pętla wraca do startu', (go.getAttribute('href') || '').split('49.600000').length > 2,
      go.getAttribute('href'));

    // wyjęcie punktu z trasy
    d.querySelector('#stops [data-usun]').click();
    rowne('po wyjęciu zostają trzy', d.querySelectorAll('#stops .stop').length, 3);
  }

  console.log('\nEksport i import');
  {
    const win = srodowisko();
    const d = win.document;
    let pobrane = null;
    win.HTMLAnchorElement.prototype.click = function () { pobrane = this; };

    d.getElementById('uklad').value = 'wgs';
    d.getElementById('wsp1').value = '49.68'; d.getElementById('wsp2').value = '19.19';
    d.getElementById('btnWsp').click();
    d.querySelector('[data-pole="nazwa"]').value = 'Punkt „testowy”; z separatorem';
    d.getElementById('sheetZapisz').click();
    await czekaj(20);

    // import GeoJSON dokłada punkty
    const geo = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { nazwa: 'Z importu', status: 'zakończony' },
                   geometry: { type: 'Point', coordinates: [19.5, 50.0] } }]
    });
    const inp = d.getElementById('plik');
    Object.defineProperty(inp, 'files', { value: [new win.File([geo], 'punkty.geojson', { type: 'application/json' })], configurable: true });
    inp.onchange.call(inp);
    await czekaj(80);

    rowne('import dołożył punkt', d.querySelectorAll('#lista .pi').length, 2);
    sprawdz('nazwa z importu', /Z importu/.test(d.getElementById('lista').textContent));
  }

  console.log('\nZbiory i link');
  {
    const win = srodowisko({ url: 'https://przyklad.pl/?zbior=zywiec2026' });
    const d = win.document;
    await czekaj(20);
    sprawdz('link zawiera nazwę zbioru', /zbior=zywiec2026/.test(d.getElementById('kolekcjaIn').value));
    sprawdz('opis mówi o trybie lokalnym', /lokalny/i.test(d.getElementById('opisBazy').textContent));

    d.getElementById('uklad').value = 'wgs';
    d.getElementById('wsp1').value = '49.68'; d.getElementById('wsp2').value = '19.19';
    d.getElementById('btnWsp').click();
    d.querySelector('[data-pole="nazwa"]').value = 'W innym zbiorze';
    d.getElementById('sheetZapisz').click();
    await czekaj(20);

    sprawdz('dane osobno dla zbioru', !!win.localStorage.getItem('mp:punkty:zywiec2026'));
    sprawdz('zbiór domyślny nietknięty', !win.localStorage.getItem('mp:punkty:domyslna'));
  }

  console.log('\nWspólna baza');
  {
    const zapytania = [];
    const win = srodowisko({
      konfig: (k) => { k.baza.typ = 'supabase'; k.baza.url = 'https://x.supabase.co'; k.baza.klucz = 'anon-klucz'; },
      fetch: (url, opcje) => {
        zapytania.push({ url: String(url), opcje: opcje || {} });
        if ((opcje || {}).method === 'POST') {
          return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve([JSON.parse(opcje.body)]) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
    });
    await czekaj(40);

    sprawdz('odpytuje właściwą tabelę', zapytania.some(z => /\/rest\/v1\/punkty\?kolekcja=eq\.domyslna/.test(z.url)),
      zapytania.map(z => z.url).join(' | '));
    sprawdz('podaje klucz w nagłówku', zapytania.some(z => (z.opcje.headers || {}).apikey === 'anon-klucz'));
    sprawdz('pasek stanu mówi o wspólnej bazie', /wspóln/i.test(win.document.getElementById('stanTxt').textContent),
      win.document.getElementById('stanTxt').textContent);

    const d = win.document;
    d.getElementById('uklad').value = 'wgs';
    d.getElementById('wsp1').value = '49.68'; d.getElementById('wsp2').value = '19.19';
    d.getElementById('btnWsp').click();
    d.querySelector('[data-pole="nazwa"]').value = 'Do bazy';
    d.getElementById('sheetZapisz').click();
    await czekaj(40);

    const wyslane = zapytania.find(z => (z.opcje.method === 'POST'));
    sprawdz('nowy punkt poszedł do bazy', !!wyslane);
    if (wyslane) {
      const ciało = JSON.parse(wyslane.opcje.body);
      rowne('z nazwą zbioru', ciało.kolekcja, 'domyslna');
      rowne('z nazwą projektu', ciało.dane.nazwa, 'Do bazy');
    }
  }

  console.log('\nBaza nie odpowiada');
  {
    const win = srodowisko({
      konfig: (k) => { k.baza.typ = 'supabase'; k.baza.url = 'https://x.supabase.co'; k.baza.klucz = 'k'; },
      fetch: () => Promise.reject(new Error('brak sieci'))
    });
    await czekaj(40);
    const d = win.document;
    sprawdz('pasek stanu ostrzega', /nie odpowiada/i.test(d.getElementById('stanTxt').textContent),
      d.getElementById('stanTxt').textContent);

    d.getElementById('uklad').value = 'wgs';
    d.getElementById('wsp1').value = '49.68'; d.getElementById('wsp2').value = '19.19';
    d.getElementById('btnWsp').click();
    d.querySelector('[data-pole="nazwa"]').value = 'Zapis mimo awarii';
    d.getElementById('sheetZapisz').click();
    await czekaj(40);

    rowne('punkt widać mimo awarii', d.querySelectorAll('#lista .pi').length, 1);
    const skrzynka = JSON.parse(win.localStorage.getItem('mp:outbox:domyslna') || '[]');
    rowne('zmiana czeka w skrzynce', skrzynka.length, 1);
    sprawdz('pasek liczy zaległości', /do wysłania|zaległ/i.test(d.getElementById('stanTxt').textContent),
      d.getElementById('stanTxt').textContent);
  }

  console.log('\nKarta na mapie');
  {
    const win = srodowisko();
    const d = win.document;
    d.getElementById('uklad').value = 'wgs';
    d.getElementById('wsp1').value = '49.68'; d.getElementById('wsp2').value = '19.19';
    d.getElementById('btnWsp').click();
    d.querySelector('[data-pole="nazwa"]').value = 'Karta';
    d.querySelector('[data-pole="osoba"]').value = 'Jakub';
    d.querySelector('[data-pole="link"]').value = 'https://przyklad.pl/projekt';
    d.getElementById('sheetZapisz').click();
    await czekaj(30);

    sprawdz('lista pokazuje osobę zarządzającą', /Jakub/.test(d.getElementById('lista').textContent));
    sprawdz('kolor punktu bierze się ze statusu', /#6B7A8F/.test(d.getElementById('lista').innerHTML),
      'brak koloru statusu planowany');

    const karta = win.__markery[win.__markery.length - 1]._popup;
    sprawdz('karta ma nazwę projektu', /Karta/.test(karta));
    sprawdz('karta ma etykietę pola', /Osoba zarządzająca/.test(karta));
    sprawdz('karta robi z odnośnika link', /<a href="https:\/\/przyklad\.pl\/projekt"/.test(karta));
    sprawdz('karta ma przyciski edycji i usuwania',
      /data-akcja="edytuj"/.test(karta) && /data-akcja="usun"/.test(karta));
    sprawdz('karta nie pokazuje pustych pól', !/Budżet/.test(karta));
    sprawdz('karta podaje współrzędne', /49\.68000, 19\.19000/.test(karta), karta.slice(0, 400));

  }

  console.log('\nPunkt poza granicami gmin');
  {
    const win = srodowisko();
    const d = win.document;
    d.getElementById('uklad').value = 'wgs';
    d.getElementById('wsp1').value = '54.9'; d.getElementById('wsp2').value = '18.4';   // Bałtyk
    d.getElementById('btnWsp').click();
    d.querySelector('[data-pole="nazwa"]').value = 'Morska farma wiatrowa';
    d.getElementById('sheetZapisz').click();
    await czekaj(30);
    rowne('punkt bez gminy też się zapisuje', d.querySelectorAll('#lista .pi').length, 1);
    const zapis = JSON.parse(win.localStorage.getItem('mp:punkty:domyslna'));
    sprawdz('pole gminy zostaje puste', !zapis[0].dane.gmina);
  }

  console.log('\n' + (oblane ? '✗' : '✓') + ' zaliczone: ' + zaliczone + ', oblane: ' + oblane + '\n');
  process.exit(oblane ? 1 : 0);
})();
