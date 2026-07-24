/* Mapa projektów: logika aplikacji.

   Punkt to para współrzędnych i karta pól opisanych w config.js. Aplikacja
   nie wie, co to za pola: buduje z nich formularz, filtry, popup i eksport.
   Zmiana schematu nie wymaga ruszania tego pliku.

   Trasowanie i odczyt adresów z obrazu przeniesione z mapy sprzedaży bez zmian
   w istocie: kolejność liczy OSRM, nawigację prowadzi Google Maps. */
(function () {
'use strict';

var OSRM = 'https://router.project-osrm.org';
var NOMINATIM = 'https://nominatim.openstreetmap.org';
var MAX_OSRM = 95;          // publiczny serwer przyjmuje 100 punktów w /table
var GM_WAYPOINTS = 8;       // Google: origin + 8 pośrednich + destination

/* ====================== narzędzia ====================== */

var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 'ł' nie rozkłada się w NFD, więc trzeba je podmienić przed normalizacją */
function norm(s) {
  return String(s || '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function odm(n, a, b, c) {
  n = Math.abs(n);
  if (n === 1) return a;
  var d = n % 10, s = n % 100;
  return (d >= 2 && d <= 4 && (s < 10 || s >= 20)) ? b : c;
}

function fmtMin(min) {
  min = Math.max(0, Math.round(min));
  var h = Math.floor(min / 60), m = min % 60;
  return h ? (h + ' h ' + m + ' min') : (m + ' min');
}

function fmtLiczba(n) {
  var x = Number(n);
  if (!isFinite(x)) return String(n);
  return x.toLocaleString('pl-PL');
}

function fmtCzas(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var dzis = new Date();
  var tenSam = d.toDateString() === dzis.toDateString();
  var g = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  return tenSam ? g : (('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + g);
}

function hav(a, b) {
  var R = 6371, r = Math.PI / 180;
  var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

var ustaw = (function () {
  var ok = false, mem = {};
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); ok = true; } catch (e) {}
  return {
    get: function (k) { try { return ok ? localStorage.getItem(k) : (mem[k] || null); } catch (e) { return mem[k] || null; } },
    set: function (k, v) { try { if (ok) localStorage.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } }
  };
})();

/* ====================== PL-1992 (EPSG:2180) ======================
   Odwzorowanie poprzeczne Merkatora na elipsoidzie GRS80: k0=0.9993,
   południk osiowy 19°E, przesunięcia 500 000 m i -5 300 000 m.
   Sprawdzone względem pyproj, różnice poniżej milimetra. */

var EL_A = 6378137, EL_F = 1 / 298.257222101, EL_E2 = EL_F * (2 - EL_F);
var PL_K0 = 0.9993, PL_L0 = 19 * Math.PI / 180, PL_FE = 500000, PL_FN = -5300000;

function do1992(lat, lng) {
  var r = Math.PI / 180, phi = lat * r, lam = lng * r;
  var e2 = EL_E2, ep2 = e2 / (1 - e2);
  var N = EL_A / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
  var T = Math.tan(phi) * Math.tan(phi);
  var C = ep2 * Math.cos(phi) * Math.cos(phi);
  var A = (lam - PL_L0) * Math.cos(phi);
  var e4 = e2 * e2, e6 = e4 * e2;
  var M = EL_A * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
        - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
        + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
        - (35 * e6 / 3072) * Math.sin(6 * phi));
  var y = PL_FE + PL_K0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 +
          (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120);
  var x = PL_FN + PL_K0 * (M + N * Math.tan(phi) * (A * A / 2 +
          (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 +
          (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
  return [x, y];
}

function z1992(x, y) {
  var e2 = EL_E2, ep2 = e2 / (1 - e2);
  var M = (x - PL_FN) / PL_K0;
  var mu = M / (EL_A * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * Math.pow(e2, 3) / 256));
  var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  var phi1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
           + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
           + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
           + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
  var C1 = ep2 * Math.cos(phi1) * Math.cos(phi1), T1 = Math.tan(phi1) * Math.tan(phi1);
  var N1 = EL_A / Math.sqrt(1 - e2 * Math.sin(phi1) * Math.sin(phi1));
  var R1 = EL_A * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
  var D = (y - PL_FE) / (N1 * PL_K0);
  var lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2
          - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24
          + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
  var lng = PL_L0 + (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
          + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / Math.cos(phi1);
  return [lat * 180 / Math.PI, lng * 180 / Math.PI];
}

/* ====================== konfiguracja i stan ====================== */

var K = window.KONFIG || {};
var POLA = K.pola || [];

function pole(klucz) {
  for (var i = 0; i < POLA.length; i++) if (POLA[i].klucz === klucz) return POLA[i];
  return null;
}

function opcjeKolor(klucz, wartosc) {
  var p = pole(klucz);
  if (!p || !p.opcje) return null;
  for (var i = 0; i < p.opcje.length; i++) {
    if (p.opcje[i].wartosc === wartosc) return p.opcje[i].kolor || null;
  }
  return null;
}

function kolorPunktu(p) {
  return opcjeKolor(K.kolorujWg || 'status', (p.dane || {})[K.kolorujWg || 'status']) || '#A09B81';
}

function tytulPunktu(p) {
  var d = p.dane || {};
  return d[K.etykieta || 'nazwa'] || 'Punkt bez nazwy';
}

function podtytulPunktu(p) {
  var d = p.dane || {};
  var a = d[K.podtytulPunktu || 'miejscowosc'] || '';
  var b = d.gmina && d.gmina !== a ? d.gmina : '';
  return [a, b].filter(Boolean).join(' · ');
}

var S = {
  punkty: [],
  filtrTekst: '',
  filtry: {},                 // klucz pola -> wartość albo null
  trasa: [],                  // identyfikatory punktów w kolejności
  mode: 'loop',
  wynik: null,
  podklad: 'mapa',
  granice: false,
  stawianie: false,
  edytowany: null,
  kolekcja: 'domyslna',
  autor: ''
};

/* ====================== granice ====================== */

var ZBIORY = { powiaty: null, gminy: null, woj: null };
var IDX = {};              // kod TERYT -> jednostka
var LISTA_JEDN = [];
var gminyBbox = null;      // [{k, box:[minLat,minLng,maxLat,maxLng], geom}]

function jednostka(kod, wiersz, typ) {
  var g = typ === 'gmina';
  return {
    kod: kod, typ: typ, nazwa: wiersz[1], woj: wiersz[2],
    labLat: wiersz[3], labLng: wiersz[4],
    lat: wiersz[5], lng: wiersz[6],
    miasto: wiersz[7], urzad: wiersz[8],
    powiat: g ? wiersz[9] : null
  };
}

function zbudujIndeks(db, typ) {
  (db.centers || []).forEach(function (w) {
    var j = jednostka(w[0], w, typ);
    IDX[j.kod] = j;
    LISTA_JEDN.push(j);
  });
}

function initGranice() {
  ZBIORY.powiaty = window.POWIATY_DB || { geo: { type: 'FeatureCollection', features: [] }, centers: [] };
  zbudujIndeks(ZBIORY.powiaty, 'powiat');
}

/* Gminy to 1,9 MB, więc dociągamy je w tle zaraz po starcie. Do czasu wczytania
   działa wyszukiwarka powiatów, a uzupełnianie gminy czeka w kolejce. */
var czekaNaGminy = [];
function wczytajGminy() {
  return new Promise(function (res) {
    if (window.GMINY_DB) return res(true);
    var s = document.createElement('script');
    s.src = 'data/gminy.js';
    s.onload = function () { res(true); };
    s.onerror = function () { res(false); };
    document.head.appendChild(s);
  }).then(function (ok) {
    if (!ok || !window.GMINY_DB) return false;
    ZBIORY.gminy = window.GMINY_DB;
    ZBIORY.woj = window.WOJ_DB || null;
    zbudujIndeks(ZBIORY.gminy, 'gmina');
    zbudujBboxy();
    czekaNaGminy.forEach(function (f) { f(); });
    czekaNaGminy = [];
    if (S.granice) odswiezGranice();
    return true;
  });
}

function zbudujBboxy() {
  gminyBbox = ZBIORY.gminy.geo.features.map(function (f) {
    var minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
    var wsp = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    wsp.forEach(function (poly) {
      poly[0].forEach(function (c) {
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
      });
    });
    return { k: f.properties.k, box: [minLat, minLng, maxLat, maxLng], geom: f.geometry };
  });
}

/* Promień z punktu w prawo. Nieparzysta liczba przecięć znaczy: w środku. */
function wPierscieniu(pierscien, lat, lng) {
  var w = false;
  for (var i = 0, j = pierscien.length - 1; i < pierscien.length; j = i++) {
    var xi = pierscien[i][0], yi = pierscien[i][1];
    var xj = pierscien[j][0], yj = pierscien[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) w = !w;
  }
  return w;
}

function wGeometrii(geom, lat, lng) {
  var wsp = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (var p = 0; p < wsp.length; p++) {
    if (!wPierscieniu(wsp[p][0], lat, lng)) continue;
    var dziura = false;
    for (var h = 1; h < wsp[p].length; h++) {
      if (wPierscieniu(wsp[p][h], lat, lng)) { dziura = true; break; }
    }
    if (!dziura) return true;
  }
  return false;
}

function gminaWPunkcie(lat, lng) {
  if (!gminyBbox) return null;
  for (var i = 0; i < gminyBbox.length; i++) {
    var b = gminyBbox[i].box;
    if (lat < b[0] || lat > b[2] || lng < b[1] || lng > b[3]) continue;
    if (wGeometrii(gminyBbox[i].geom, lat, lng)) return IDX[gminyBbox[i].k] || null;
  }
  return null;
}

/* Uzupełnia gminę, powiat, województwo i TERYT. Woła `gotowe` także wtedy,
   gdy nic nie znaleziono, bo formularz nie może czekać w nieskończoność. */
function uzupelnijJednostki(dane, lat, lng, gotowe) {
  if (K.uzupelniajJednostki === false) return gotowe(dane);
  var zrob = function () {
    var g = gminaWPunkcie(lat, lng);
    if (g) {
      if (!dane.gmina) dane.gmina = g.nazwa;
      if (!dane.powiat) dane.powiat = g.powiat || '';
      if (!dane.wojewodztwo) dane.wojewodztwo = g.woj || '';
      if (!dane.teryt) dane.teryt = g.kod;
      if (!dane.miejscowosc) dane.miejscowosc = g.miasto || '';
    }
    gotowe(dane);
  };
  if (gminyBbox) zrob(); else czekaNaGminy.push(zrob);
}

/* ====================== podkłady ====================== */

var PODGLAD_Z = 12, PODGLAD_X = 2274, PODGLAD_Y = 1388;

function ortoUrl(z, y, x) {
  return 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution' +
    '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA' +
    '&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:' + z + '&TILEROW=' + y + '&TILECOL=' + x;
}

var PODKLADY = [
  { id: 'mapa', nazwa: 'Mapa', zrodlo: 'CARTO Voyager', cieply: true,
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    opcje: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OpenStreetMap, &copy; CARTO' },
    podglad: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/' + PODGLAD_Z + '/' + PODGLAD_X + '/' + PODGLAD_Y + '.png' },
  { id: 'satelita', nazwa: 'Satelita', zrodlo: 'Geoportal GUGiK',
    url: ortoUrl('{z}', '{y}', '{x}'),
    opcje: { maxZoom: 19, maxNativeZoom: 19, attribution: 'Ortofotomapa: <a href="https://www.geoportal.gov.pl/">GUGiK</a>' },
    podglad: ortoUrl(PODGLAD_Z, PODGLAD_Y, PODGLAD_X),
    zapas: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
             opcje: { maxZoom: 19, attribution: 'Zdjęcia: Esri, Maxar, Earthstar Geographics' } } },
  { id: 'osm', nazwa: 'OSM', zrodlo: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opcje: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    podglad: 'https://tile.openstreetmap.org/' + PODGLAD_Z + '/' + PODGLAD_X + '/' + PODGLAD_Y + '.png' },
  { id: 'topo', nazwa: 'Topograficzna', zrodlo: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opcje: { subdomains: 'abc', maxZoom: 17, attribution: '&copy; OpenStreetMap, SRTM · <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)' },
    podglad: 'https://a.tile.opentopomap.org/' + PODGLAD_Z + '/' + PODGLAD_X + '/' + PODGLAD_Y + '.png' }
];

function podkladPoId(id) {
  for (var i = 0; i < PODKLADY.length; i++) if (PODKLADY[i].id === id) return PODKLADY[i];
  return PODKLADY[0];
}

/* ====================== mapa ====================== */

var map, warstwaKafelki, warstwaGranicPow, warstwaGranicGm;
var warstwaPunktow, markery = {}, liniaTrasy = null, markeryDrog = [];
var bledyKafelkow = 0;

function initMapa() {
  var w = K.widok || { lat: 52.05, lng: 19.35, zoom: 6 };
  map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 18, attributionControl: true })
        .setView([w.lat, w.lng], w.zoom);

  L.control.zoom({ position: 'topright' }).addTo(map);

  map.createPane('granicePane'); map.getPane('granicePane').style.zIndex = 410;
  map.createPane('routePane');   map.getPane('routePane').style.zIndex = 620;
  map.createPane('roadsPane');   map.getPane('roadsPane').style.zIndex = 650;

  ustawPodklad(S.podklad, true);

  warstwaGranicPow = L.geoJSON(null, {
    pane: 'granicePane', interactive: false,
    style: { fill: false, color: '#3A3E2C', weight: 1.4, opacity: .55 }
  });
  warstwaGranicGm = L.geoJSON(null, {
    pane: 'granicePane', interactive: false,
    style: { fill: false, color: '#616650', weight: .8, opacity: .42 }
  });
  warstwaPunktow = L.layerGroup().addTo(map);

  map.on('click', function (e) {
    if (!S.stawianie) return;
    trybStawiania(false);
    nowyPunktW(e.latlng.lat, e.latlng.lng);
  });

  map.on('moveend zoomend', function () { if (S.granice) odswiezGranice(); });
}

function ustawPodklad(id, cicho) {
  var p = podkladPoId(id);
  S.podklad = p.id;

  if (warstwaKafelki && map.hasLayer(warstwaKafelki)) map.removeLayer(warstwaKafelki);
  bledyKafelkow = 0;
  warstwaKafelki = L.tileLayer(p.url, p.opcje);

  // Geoportal bywa przeciążony. Zamiast pustej szachownicy wchodzą zdjęcia Esri.
  if (p.zapas) {
    warstwaKafelki.on('tileerror', function () {
      if (++bledyKafelkow < 8 || !p.zapas) return;
      var zapas = p.zapas; p.zapas = null;
      map.removeLayer(warstwaKafelki);
      warstwaKafelki = L.tileLayer(zapas.url, zapas.opcje).addTo(map);
      pokazHint('Geoportal nie odpowiada, pokazuję zdjęcia zapasowe.', 4500);
    });
  }
  warstwaKafelki.addTo(map);

  var el = map.getContainer();
  if (el && el.classList) el.classList.toggle('plain', !p.cieply);

  $$('#bases .base').forEach(function (b) {
    var on = b.getAttribute('data-base') === p.id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  if (!cicho) zapiszUstawienia();
}

function rysujWyborPodkladu() {
  $('#bases').innerHTML = PODKLADY.map(function (p) {
    return '<button class="base' + (p.id === S.podklad ? ' on' : '') + '" data-base="' + p.id + '" ' +
      'aria-pressed="' + (p.id === S.podklad) + '">' +
      '<img src="' + esc(p.podglad) + '" alt="" loading="lazy" width="104" height="66">' +
      '<span class="lab"><b>' + esc(p.nazwa) + '</b><small>' + esc(p.zrodlo) + '</small></span></button>';
  }).join('');
  $$('#bases .base').forEach(function (b) {
    b.onclick = function () { ustawPodklad(b.getAttribute('data-base')); pokazWyborPodkladu(false); };
  });
}

function pokazWyborPodkladu(pokaz) {
  $('#basePanel').hidden = !pokaz;
  $('#baseBtn').hidden = pokaz;
  $('#baseBtn').setAttribute('aria-expanded', pokaz ? 'true' : 'false');
}

/* Granice: powiaty od razu, gminy dopiero od przybliżenia 9 i tylko te
   w kadrze. 2477 obszarów naraz dławi telefon. */
function widocznoscGranic() {
  if (!S.granice) {
    if (map.hasLayer(warstwaGranicPow)) map.removeLayer(warstwaGranicPow);
    if (map.hasLayer(warstwaGranicGm)) map.removeLayer(warstwaGranicGm);
    return false;
  }
  if (!map.hasLayer(warstwaGranicPow)) warstwaGranicPow.addTo(map);
  if (!map.hasLayer(warstwaGranicGm)) warstwaGranicGm.addTo(map);
  return true;
}

function odswiezGranice() {
  if (!widocznoscGranic()) return;
  if (!warstwaGranicPow.getLayers().length && ZBIORY.powiaty) {
    warstwaGranicPow.addData(ZBIORY.powiaty.geo);
  }
  warstwaGranicGm.clearLayers();
  if (map.getZoom() < 9 || !ZBIORY.gminy) return;
  var b = map.getBounds();
  var w = ZBIORY.gminy.geo.features.filter(function (f, i) {
    var box = gminyBbox && gminyBbox[i] ? gminyBbox[i].box : null;
    if (!box) return false;
    return !(box[2] < b.getSouth() || box[0] > b.getNorth() || box[3] < b.getWest() || box[1] > b.getEast());
  });
  if (w.length) warstwaGranicGm.addData({ type: 'FeatureCollection', features: w });
}

/* ====================== znaczniki ====================== */

function ikonaPunktu(p) {
  var wTrasie = S.trasa.indexOf(p.id) >= 0;
  var nr = wTrasie ? (S.trasa.indexOf(p.id) + 1) : 0;
  var kolor = kolorPunktu(p);
  var obwodka = wTrasie ? '#A8873E' : '#FBF5DD';
  var html =
    '<div class="pin-wrap"><span class="pin">' +
      '<svg viewBox="0 0 26 34" width="26" height="34">' +
        '<path d="M13 33S24 20.5 24 13A11 11 0 1 0 2 13c0 7.5 11 20 11 20z" fill="' + kolor + '" stroke="' + obwodka + '" stroke-width="' + (wTrasie ? 3 : 2) + '"/>' +
        '<circle cx="13" cy="12.6" r="4.1" fill="#FBF5DD" fill-opacity=".93"/>' +
      '</svg></span>' +
      (nr ? '<span class="nr">' + nr + '</span>' : '') +
    '</div>';
  return L.divIcon({ className: '', html: html, iconSize: [26, 34], iconAnchor: [13, 33], popupAnchor: [0, -30] });
}

function rysujPunkty() {
  warstwaPunktow.clearLayers();
  markery = {};
  widoczne().forEach(function (p) {
    var m = L.marker([p.lat, p.lng], { icon: ikonaPunktu(p), title: tytulPunktu(p), draggable: false });
    m.bindPopup(kartaHTML(p), { maxWidth: 300, autoPanPadding: [18, 18] });
    m.on('popupopen', function () { podepnijKarte(p); });
    m.addTo(warstwaPunktow);
    markery[p.id] = m;
  });
}

/* ====================== karta punktu (popup) ====================== */

function wartoscHTML(f, v) {
  if (f.typ === 'url') return '<a href="' + esc(v) + '" target="_blank" rel="noopener">' + esc(String(v).replace(/^https?:\/\//, '').slice(0, 38)) + '</a>';
  if (f.typ === 'email') return '<a href="mailto:' + esc(v) + '">' + esc(v) + '</a>';
  if (f.typ === 'telefon') return '<a href="tel:' + esc(String(v).replace(/\s/g, '')) + '">' + esc(v) + '</a>';
  if (f.typ === 'liczba') return esc(fmtLiczba(v) + (f.jednostka ? ' ' + f.jednostka : ''));
  return esc(v);
}

function kartaHTML(p) {
  var d = p.dane || {};
  var wiersze = POLA.filter(function (f) {
    return f.wKarcie && d[f.klucz] !== undefined && d[f.klucz] !== null && String(d[f.klucz]).trim() !== '';
  }).map(function (f) {
    return '<dt>' + esc(f.etykieta) + '</dt><dd>' + wartoscHTML(f, d[f.klucz]) + '</dd>';
  }).join('');

  var podpis = p.autor ? ('zmienił ' + p.autor + ' · ' + fmtCzas(p.zmieniono)) : ('zmieniono ' + fmtCzas(p.zmieniono));
  var wTrasie = S.trasa.indexOf(p.id) >= 0;

  return '<div class="kt">' +
    '<span class="wst" style="background:' + kolorPunktu(p) + '"></span>' +
    '<h3>' + esc(tytulPunktu(p)) + '</h3>' +
    (podtytulPunktu(p) ? '<p class="lok">' + esc(podtytulPunktu(p)) + '</p>' : '') +
    (wiersze ? '<dl>' + wiersze + '</dl>' : '<p class="lok" style="color:var(--ink-3)">Karta bez wypełnionych pól.</p>') +
    '<div class="stopka">' + esc(podpis) + ' · ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</div>' +
    '</div>' +
    '<div class="kt-btns">' +
      '<button class="btn sm" data-akcja="edytuj">Edytuj</button>' +
      '<button class="btn sm' + (wTrasie ? ' on' : '') + '" data-akcja="trasa">' + (wTrasie ? 'W trasie' : 'Do trasy') + '</button>' +
      '<button class="btn sm zly" data-akcja="usun">Usuń</button>' +
    '</div>';
}

function podepnijKarte(p) {
  var box = document.querySelector('.leaflet-popup .kt-btns');
  if (!box) return;
  box.querySelectorAll('[data-akcja]').forEach(function (b) {
    b.onclick = function () {
      var a = b.getAttribute('data-akcja');
      if (a === 'edytuj') { map.closePopup(); otworzKarte(p); }
      if (a === 'usun') usunPunkt(p);
      if (a === 'trasa') { przelaczTrase(p.id); map.closePopup(); }
    };
  });
}

/* ====================== formularz karty ====================== */

function polaHTML(dane) {
  return POLA.map(function (f) {
    var v = dane[f.klucz] == null ? '' : dane[f.klucz];
    var id = 'f_' + f.klucz;
    var lab = '<label for="' + id + '">' + esc(f.etykieta) + (f.wymagane ? ' *' : '') + '</label>';
    var wej;

    if (f.typ === 'wielolinijkowy') {
      wej = '<textarea id="' + id + '" data-pole="' + f.klucz + '">' + esc(v) + '</textarea>';
    } else if (f.typ === 'lista') {
      wej = '<select class="inp" id="' + id + '" data-pole="' + f.klucz + '"><option value="">bez wartości</option>' +
        (f.opcje || []).map(function (o) {
          return '<option value="' + esc(o.wartosc) + '"' + (o.wartosc === v ? ' selected' : '') + '>' + esc(o.wartosc) + '</option>';
        }).join('') + '</select>';
    } else {
      var typHtml = f.typ === 'liczba' ? 'number' : f.typ === 'data' ? 'date' :
                    f.typ === 'email' ? 'email' : f.typ === 'telefon' ? 'tel' :
                    f.typ === 'url' ? 'url' : 'text';
      wej = '<input class="inp" type="' + typHtml + '" id="' + id + '" data-pole="' + f.klucz + '" value="' + esc(v) + '"' +
            (f.typ === 'liczba' ? ' step="any" inputmode="decimal"' : '') + '>';
    }

    var jedn = f.jednostka ? '<span class="tiny">w ' + esc(f.jednostka) + '</span>' : '';
    return '<div class="fld' + (f.wyliczane ? ' wyl' : '') + '">' + lab + wej + jedn + '</div>';
  }).join('') +
  '<div class="fld"><label>Współrzędne WGS 84</label><div class="wsp">' +
    '<input class="inp" id="f_lat" inputmode="decimal"><input class="inp" id="f_lng" inputmode="decimal"></div>' +
    '<span class="tiny" id="f_1992"></span></div>';
}

function otworzKarte(p, lat, lng) {
  var nowy = !p;
  var dane = nowy ? {} : JSON.parse(JSON.stringify(p.dane || {}));

  if (nowy) {
    POLA.forEach(function (f) { if (f.domyslna) dane[f.klucz] = f.domyslna; });
  }

  S.edytowany = { punkt: p || null, lat: nowy ? lat : p.lat, lng: nowy ? lng : p.lng };

  $('#sheetTytul').textContent = nowy ? 'Nowy punkt' : 'Karta punktu';
  $('#sheetUsun').style.display = nowy ? 'none' : '';
  $('#sheetBody').innerHTML = polaHTML(dane);
  $('#f_lat').value = S.edytowany.lat.toFixed(6);
  $('#f_lng').value = S.edytowany.lng.toFixed(6);
  pokaz1992();
  odswiezWstege();

  $('#sheetBody').querySelectorAll('[data-pole]').forEach(function (el) {
    el.addEventListener('input', odswiezWstege);
    el.addEventListener('change', odswiezWstege);
  });
  $('#f_lat').addEventListener('input', pokaz1992);
  $('#f_lng').addEventListener('input', pokaz1992);

  $('#sheet').classList.add('on');

  if (nowy && K.uzupelniajJednostki !== false) {
    uzupelnijJednostki({}, S.edytowany.lat, S.edytowany.lng, function (u) {
      Object.keys(u).forEach(function (k) {
        var el = $('#sheetBody [data-pole="' + k + '"]');
        if (el && !el.value) el.value = u[k];
      });
    });
  }

  var pierwsze = $('#sheetBody .inp, #sheetBody textarea');
  if (pierwsze && window.matchMedia('(min-width:880px)').matches) pierwsze.focus();
}

function odswiezWstege() {
  var el = $('#sheetBody [data-pole="' + (K.kolorujWg || 'status') + '"]');
  var kolor = el ? (opcjeKolor(K.kolorujWg || 'status', el.value) || '#A09B81') : '#A09B81';
  $('#sheetWstega').style.background = kolor;
}

function pokaz1992() {
  var lat = parseFloat($('#f_lat').value), lng = parseFloat($('#f_lng').value);
  if (!isFinite(lat) || !isFinite(lng)) { $('#f_1992').textContent = ''; return; }
  var xy = do1992(lat, lng);
  $('#f_1992').textContent = 'PL-1992: X ' + Math.round(xy[0]) + ' · Y ' + Math.round(xy[1]);
}

function zamknijKarte() {
  $('#sheet').classList.remove('on');
  S.edytowany = null;
}

function zbierzDane() {
  var dane = {};
  $('#sheetBody').querySelectorAll('[data-pole]').forEach(function (el) {
    var v = el.value == null ? '' : String(el.value).trim();
    if (v !== '') dane[el.getAttribute('data-pole')] = el.type === 'number' ? Number(v) : v;
  });
  return dane;
}

function zapiszKarte() {
  if (!S.edytowany) return;
  var dane = zbierzDane();

  var brak = POLA.filter(function (f) { return f.wymagane && !dane[f.klucz]; });
  if (brak.length) {
    var el = $('#sheetBody [data-pole="' + brak[0].klucz + '"]');
    if (el) { el.classList.add('zle'); el.focus(); }
    toast('Uzupełnij pole: ' + brak[0].etykieta, true);
    return;
  }

  var lat = parseFloat($('#f_lat').value), lng = parseFloat($('#f_lng').value);
  if (!isFinite(lat) || !isFinite(lng)) { toast('Współrzędne poza zakresem.', true); return; }

  var stary = S.edytowany.punkt;

  // pola spoza schematu zostają, bo ktoś mógł je wnieść importem
  if (stary) {
    Object.keys(stary.dane || {}).forEach(function (k) {
      if (!pole(k) && dane[k] === undefined) dane[k] = stary.dane[k];
    });
  }

  var akcja;
  if (stary) {
    stary.dane = dane; stary.lat = lat; stary.lng = lng;
    akcja = Baza.zapisz(stary);
  } else {
    akcja = Baza.dodaj(lat, lng, dane).then(wStan);
  }

  zamknijKarte();
  akcja.then(function () {
    rysujWszystko();
    toast(stary ? 'Zapisano zmiany' : 'Punkt dodany');
    odswiezStan();
  }, function (e) { toast(e.message || 'Nie udało się zapisać.', true); });
}

function usunPunkt(p) {
  if (!window.confirm('Usunąć punkt „' + tytulPunktu(p) + '”? Tego nie da się cofnąć.')) return;
  map.closePopup();
  zamknijKarte();
  S.punkty = S.punkty.filter(function (x) { return x.id !== p.id; });
  S.trasa = S.trasa.filter(function (id) { return id !== p.id; });
  Baza.usun(p.id).then(function () {
    rysujWszystko();
    toast('Punkt usunięty');
    odswiezStan();
  }, function (e) { toast(e.message || 'Nie udało się usunąć.', true); });
}

function nowyPunktW(lat, lng) {
  map.setView([lat, lng], Math.max(map.getZoom(), 13));
  otworzKarte(null, lat, lng);
}

/* ====================== lista i filtry ====================== */

/* Odświeżanie w tle potrafi wyprzedzić własny zapis i wstawić ten sam punkt
   drugi raz. Stan aktualizujemy więc po identyfikatorze, nie przez dopisanie. */
function wStan(p) {
  var i = S.punkty.findIndex(function (x) { return x.id === p.id; });
  if (i >= 0) S.punkty[i] = p; else S.punkty.push(p);
  return p;
}

function widoczne() {
  var q = norm(S.filtrTekst);
  return S.punkty.filter(function (p) {
    var d = p.dane || {};
    for (var k in S.filtry) {
      if (S.filtry[k] && d[k] !== S.filtry[k]) return false;
    }
    if (!q) return true;
    var stog = norm(Object.keys(d).map(function (k) { return d[k]; }).join(' '));
    return stog.indexOf(q) >= 0;
  });
}

function rysujFiltry() {
  var box = $('#filtry');
  var html = '';
  POLA.filter(function (f) { return f.filtr; }).forEach(function (f) {
    var wartosci = {};
    S.punkty.forEach(function (p) {
      var v = (p.dane || {})[f.klucz];
      if (v) wartosci[v] = (wartosci[v] || 0) + 1;
    });
    var klucze = Object.keys(wartosci).sort();
    // filtr wskazujący na wartość, której już nie ma, ukrywałby wszystko
    if (S.filtry[f.klucz] && klucze.indexOf(S.filtry[f.klucz]) < 0) S.filtry[f.klucz] = null;
    if (!klucze.length) return;
    html += klucze.map(function (v) {
      var kolor = opcjeKolor(f.klucz, v);
      var on = S.filtry[f.klucz] === v;
      return '<button class="fchip' + (on ? ' on' : '') + '" data-f="' + esc(f.klucz) + '" data-v="' + esc(v) + '">' +
        (kolor ? '<span class="dot" style="background:' + kolor + '"></span>' : '') +
        esc(v) + '<span class="c">' + wartosci[v] + '</span></button>';
    }).join('');
  });
  box.innerHTML = html;
  box.querySelectorAll('.fchip').forEach(function (b) {
    b.onclick = function () {
      var f = b.getAttribute('data-f'), v = b.getAttribute('data-v');
      S.filtry[f] = S.filtry[f] === v ? null : v;
      rysujWszystko();
    };
  });
}

function rysujListe() {
  var lista = widoczne();
  $('#cntPkt').textContent = S.punkty.length;
  $('#cntPkt2').textContent = lista.length === S.punkty.length ? lista.length : (lista.length + ' z ' + S.punkty.length);
  $('#pustaLista').style.display = lista.length ? 'none' : '';

  $('#lista').innerHTML = lista.map(function (p) {
    var d = p.dane || {};
    var opis = POLA.filter(function (f) { return f.naLiscie && d[f.klucz]; })
                   .map(function (f) { return d[f.klucz]; }).join(' · ');
    var wTrasie = S.trasa.indexOf(p.id) >= 0;
    return '<li class="pi" data-id="' + p.id + '">' +
      '<span class="kropka" style="background:' + kolorPunktu(p) + '"></span>' +
      '<span class="t"><b>' + esc(tytulPunktu(p)) + '</b>' +
        (podtytulPunktu(p) ? '<small>' + esc(podtytulPunktu(p)) + '</small>' : '') +
        (opis ? '<small>' + esc(opis) + '</small>' : '') + '</span>' +
      '<span class="akcje">' +
        '<button class="ibtn' + (wTrasie ? ' on' : '') + '" data-a="trasa" title="Do trasy" aria-label="Do trasy">↝</button>' +
        '<button class="ibtn" data-a="edytuj" title="Edytuj" aria-label="Edytuj">✎</button>' +
      '</span></li>';
  }).join('');

  $$('#lista .pi').forEach(function (li) {
    var p = S.punkty.find(function (x) { return x.id === li.getAttribute('data-id'); });
    if (!p) return;
    li.onclick = function (e) {
      var b = e.target.closest('[data-a]');
      if (b) {
        e.stopPropagation();
        if (b.getAttribute('data-a') === 'trasa') przelaczTrase(p.id);
        else otworzKarte(p);
        return;
      }
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 12));
      if (markery[p.id]) markery[p.id].openPopup();
    };
  });
}

/* ====================== trasa ====================== */

var OPISY_TRYBU = {
  loop: 'Wracasz tam, skąd wyjechałeś.',
  ends: 'Ostatni punkt na liście jest metą.',
  open: 'Kończysz tam, gdzie wypada najszybciej.'
};

function przelaczTrase(id) {
  var i = S.trasa.indexOf(id);
  if (i >= 0) S.trasa.splice(i, 1); else S.trasa.push(id);
  S.wynik = null;
  rysujWszystko();
}

function punktyTrasy() {
  return S.trasa.map(function (id) {
    return S.punkty.find(function (p) { return p.id === id; });
  }).filter(Boolean);
}

function rysujTrasePanel() {
  var pts = punktyTrasy();
  $('#cntTrasa').textContent = pts.length;
  $('#cntTrasa2').textContent = pts.length;
  $('#pustaTrasa').style.display = pts.length ? 'none' : '';
  $('#btnOpt').disabled = pts.length < 2;

  $('#stops').innerHTML = pts.map(function (p, i) {
    var kl = 'stop' + (i === 0 ? ' is-start' : '') +
             (i === pts.length - 1 && S.mode === 'ends' ? ' is-end' : '');
    return '<li class="' + kl + '" data-id="' + p.id + '">' +
      '<button class="drag" aria-label="Przesuń">⠿</button>' +
      '<span class="stop-n">' + (i + 1) + '</span>' +
      '<span class="stop-name">' + esc(tytulPunktu(p)) +
        (podtytulPunktu(p) ? '<small>' + esc(podtytulPunktu(p)) + '</small>' : '') + '</span>' +
      '<button class="ibtn zly" data-usun="' + p.id + '" title="Wyjmij z trasy" aria-label="Wyjmij z trasy">✕</button>' +
      '</li>';
  }).join('');

  $$('#stops [data-usun]').forEach(function (b) {
    b.onclick = function () { przelaczTrase(b.getAttribute('data-usun')); };
  });
  wlaczPrzeciaganie($('#stops'));

  renderWynik();
  odswiezGoogle();
}

function renderWynik() {
  var s = $('#resStrip');
  if (!S.wynik) { s.hidden = true; return; }
  s.hidden = false;
  $('#rsDist').textContent = (S.wynik.dystans / 1000).toFixed(0) + ' km';
  $('#rsTime').textContent = fmtMin(S.wynik.czas / 60);
  $('#rsRoads').innerHTML = (S.wynik.drogi || []).slice(0, 4).map(function (d) {
    return '<span class="shield ' + d.klasa + '">' + esc(d.etykieta) + '</span>';
  }).join('');
  $('#rsNote').textContent = S.wynik.przyblizone
    ? (S.wynik.powod === 'limit' ? 'Powyżej 95 punktów liczymy z linii prostej.' : 'Brak połączenia z silnikiem tras, szacunek przybliżony.')
    : 'Szacunek OSRM, bez ruchu drogowego.';
}

function wlaczPrzeciaganie(ul) {
  var ciagniety = null;
  ul.querySelectorAll('.drag').forEach(function (uchwyt) {
    uchwyt.addEventListener('pointerdown', function (e) {
      ciagniety = uchwyt.closest('.stop');
      ciagniety.classList.add('lift');
      uchwyt.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    uchwyt.addEventListener('pointermove', function (e) {
      if (!ciagniety) return;
      var pod = document.elementFromPoint(e.clientX, e.clientY);
      var cel = pod && pod.closest ? pod.closest('.stop') : null;
      if (cel && cel !== ciagniety && cel.parentNode === ul) {
        var r = cel.getBoundingClientRect();
        ul.insertBefore(ciagniety, (e.clientY < r.top + r.height / 2) ? cel : cel.nextSibling);
      }
    });
    uchwyt.addEventListener('pointerup', function () {
      if (!ciagniety) return;
      ciagniety.classList.remove('lift');
      ciagniety = null;
      S.trasa = $$('#stops .stop').map(function (li) { return li.getAttribute('data-id'); });
      S.wynik = null;
      rysujWszystko();
    });
  });
}

/* ---------- solver ---------- */

function macierzHav(pts) {
  var n = pts.length, m = [];
  for (var i = 0; i < n; i++) {
    m[i] = [];
    for (var j = 0; j < n; j++) {
      // linia prosta * 1,30 (krętość dróg) przy średniej 62 km/h
      m[i][j] = i === j ? 0 : hav(pts[i], pts[j]) * 1.30 / 62 * 3600;
    }
  }
  return m;
}

function wspolrzedne(pts) {
  // OSRM przyjmuje lng,lat, czyli odwrotnie niż Leaflet
  return pts.map(function (p) { return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
}

function promienie(pts) {
  return pts.map(function () { return '800'; }).join(';');
}

function osrmTable(pts) {
  return fetch(OSRM + '/table/v1/driving/' + wspolrzedne(pts) + '?annotations=duration&radiuses=' + promienie(pts))
    .then(function (r) { return r.json(); })
    .then(function (d) { return (d && d.code === 'Ok' && d.durations) ? d.durations : null; })
    .catch(function () { return null; });
}

function osrmRoute(pts) {
  return fetch(OSRM + '/route/v1/driving/' + wspolrzedne(pts) +
      '?overview=full&geometries=geojson&steps=true&continue_straight=false&radiuses=' + promienie(pts))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || d.code !== 'Ok' || !d.routes || !d.routes.length) return null;
      var r0 = d.routes[0];
      return { dystans: r0.distance, czas: r0.duration, legs: r0.legs || [],
               linia: r0.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }) };
    })
    .catch(function () { return null; });
}

function odwroc(a, i, k) { while (i < k) { var t = a[i]; a[i] = a[k]; a[k] = t; i++; k--; } }

function najblizszySasiad(cost, od, wezly) {
  var rem = wezly.slice(), sciezka = [], cur = od;
  while (rem.length) {
    var bi = 0;
    for (var i = 1; i < rem.length; i++) if (cost[cur][rem[i]] < cost[cur][rem[bi]]) bi = i;
    cur = rem[bi]; sciezka.push(cur); rem.splice(bi, 1);
  }
  return sciezka;
}

/* 2-opt ograniczone do pozycji od `lo` do `hi`, żeby poprawianie kolejności
   nie wyrzuciło startu ani mety z przypisanego im miejsca. */
function dwaOpt(cost, f, lo, hi) {
  if (hi <= lo) return f;
  var poprawa = true, iter = 0;
  while (poprawa && iter++ < 200) {
    poprawa = false;
    for (var i = lo; i <= hi; i++) {
      for (var k = i + 1; k <= hi; k++) {
        var a = f[i - 1], b = f[i], c = f[k], d = (k + 1 < f.length) ? f[k + 1] : null;
        var przed = cost[a][b] + (d !== null ? cost[c][d] : 0);
        var po    = cost[a][c] + (d !== null ? cost[b][d] : 0);
        if (po < przed - 1e-9) { odwroc(f, i, k); poprawa = true; }
      }
    }
  }
  return f;
}

function ustawKolejnosc(pts, cost) {
  var n = pts.length;
  var meta = (S.mode === 'ends' && n > 2) ? n - 1 : -1;
  var reszta = [];
  for (var i = 1; i < n; i++) if (i !== meta) reszta.push(i);

  var f = [0].concat(najblizszySasiad(cost, 0, reszta));
  var domkniecie = (S.mode === 'loop') ? 0 : meta;
  if (domkniecie >= 0) f.push(domkniecie);

  dwaOpt(cost, f, 1, reszta.length);
  if (S.mode === 'loop') f.pop();
  return f;
}

function optymalizuj() {
  var pts = punktyTrasy();
  if (pts.length < 2) return;

  var btn = $('#btnOpt');
  btn.disabled = true; btn.textContent = 'Liczę…';

  var zaDuzo = pts.length > MAX_OSRM;
  (zaDuzo ? Promise.resolve(null) : osrmTable(pts)).then(function (cost) {
    var powod = null;
    if (!cost) { cost = macierzHav(pts); powod = zaDuzo ? 'limit' : 'siec'; }

    var kolejnosc = ustawKolejnosc(pts, cost);
    S.trasa = kolejnosc.map(function (i) { return pts[i].id; });

    var trasa = kolejnosc.map(function (i) { return pts[i]; });
    if (S.mode === 'loop') trasa.push(trasa[0]);

    return (zaDuzo ? Promise.resolve(null) : osrmRoute(trasa)).then(function (r) {
      if (r) {
        S.wynik = { dystans: r.dystans, czas: r.czas, linia: r.linia,
                    przyblizone: false, drogi: drogiZTrasy(r.legs) };
      } else {
        var czas = 0, km = 0;
        for (var i = 0; i < trasa.length - 1; i++) {
          km += hav(trasa[i], trasa[i + 1]) * 1.30;
          czas += hav(trasa[i], trasa[i + 1]) * 1.30 / 62 * 3600;
        }
        S.wynik = { dystans: km * 1000, czas: czas, linia: null,
                    przyblizone: true, powod: powod || 'siec', drogi: [] };
      }
      rysujTraseNaMapie();
      rysujWszystko();
    });
  }).catch(function (e) {
    console.error(e); S.wynik = null; rysujWszystko();
  }).then(function () {
    btn.textContent = 'Wyznacz kolejność';
    btn.disabled = punktyTrasy().length < 2;
  });
}

/* ---------- drogi ---------- */

function klasaDrogi(ref) {
  if (/^A\d{1,2}$/.test(ref)) return 'A';
  if (/^S\d{1,2}$/.test(ref)) return 'S';
  if (/^(DK\s?)?\d{1,2}$/i.test(ref)) return 'DK';
  return null;
}

function drogiZTrasy(legs) {
  var kolejne = [];
  (legs || []).forEach(function (leg) {
    (leg.steps || []).forEach(function (st) {
      var ref = String(st.ref || '').split(';')[0].trim();
      if (!ref) return;
      var kl = klasaDrogi(ref);
      if (!kl) return;
      var etykieta = kl === 'DK' ? ('DK' + ref.replace(/^DK\s?/i, '')) : ref;
      var loc = st.maneuver && st.maneuver.location;
      var ost = kolejne[kolejne.length - 1];
      if (ost && ost.etykieta === etykieta) {
        ost.metry += st.distance || 0;
        if (loc) ost.punkty.push(loc);
      } else {
        kolejne.push({ etykieta: etykieta, klasa: kl, metry: st.distance || 0, punkty: loc ? [loc] : [] });
      }
    });
  });

  var wg = {};
  kolejne.filter(function (d) { return d.metry >= 4000; }).forEach(function (d) {
    if (!wg[d.etykieta]) wg[d.etykieta] = { etykieta: d.etykieta, klasa: d.klasa, metry: 0, odcinki: [] };
    wg[d.etykieta].metry += d.metry;
    wg[d.etykieta].odcinki.push(d.punkty);
  });
  return Object.keys(wg).map(function (k) { return wg[k]; })
    .sort(function (a, b) { return b.metry - a.metry; });
}

function rysujTraseNaMapie() {
  if (liniaTrasy) { map.removeLayer(liniaTrasy); liniaTrasy = null; }
  markeryDrog.forEach(function (m) { map.removeLayer(m); });
  markeryDrog = [];

  var pts = punktyTrasy();
  if (S.wynik && S.wynik.linia) {
    liniaTrasy = L.polyline(S.wynik.linia, { pane: 'routePane', color: '#3A3E2C', weight: 4, opacity: .9 }).addTo(map);
  } else if (pts.length > 1) {
    var l = pts.map(function (p) { return [p.lat, p.lng]; });
    if (S.mode === 'loop') l.push(l[0]);
    liniaTrasy = L.polyline(l, { pane: 'routePane', color: '#A09B81', weight: 2.5, opacity: .8, dashArray: '5,6' }).addTo(map);
  }

  if (S.wynik && S.wynik.drogi) {
    S.wynik.drogi.forEach(function (d) {
      d.odcinki.forEach(function (punkty) {
        if (!punkty.length) return;
        var p = punkty[Math.floor(punkty.length / 2)];
        markeryDrog.push(L.marker([p[1], p[0]], {
          pane: 'roadsPane', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'road-icon', html: '<div class="road-pin ' + d.klasa + '">' + esc(d.etykieta) + '</div>',
                            iconSize: null, iconAnchor: [0, 0] })
        }).addTo(map));
      });
    });
  }
}

/* ---------- Google Maps ---------- */

function punktGoogle(p) { return encodeURIComponent(p.lat.toFixed(6) + ',' + p.lng.toFixed(6)); }

function etapy(pts) {
  var lista = pts.slice();
  if (S.mode === 'loop' && lista.length > 1) lista.push(lista[0]);
  var krok = GM_WAYPOINTS + 1, out = [];
  for (var i = 0; i < lista.length - 1; i += krok) {
    var kawalek = lista.slice(i, Math.min(i + krok + 1, lista.length));
    if (kawalek.length > 1) out.push(kawalek);
  }
  return out;
}

function urlGoogle(k) {
  var srodek = k.slice(1, -1).map(punktGoogle).join('%7C');
  return 'https://www.google.com/maps/dir/?api=1&origin=' + punktGoogle(k[0]) +
         '&destination=' + punktGoogle(k[k.length - 1]) +
         (srodek ? '&waypoints=' + srodek : '') + '&travelmode=driving&dir_action=navigate';
}

function odswiezGoogle() {
  var a = $('#btnGo'), sub = $('#goSub'), box = $('#segs');
  var pts = punktyTrasy();

  if (pts.length < 2) {
    a.className = 'go off'; a.removeAttribute('href');
    sub.textContent = 'zaznacz co najmniej dwa punkty';
    box.innerHTML = '';
    return;
  }

  var sg = etapy(pts);
  a.className = 'go';
  a.href = urlGoogle(sg[0]);
  sub.textContent = pts.length + ' ' + odm(pts.length, 'punkt', 'punkty', 'punktów') +
                    (sg.length > 1 ? ' · etap 1 z ' + sg.length : '');

  if (sg.length < 2) { box.innerHTML = ''; return; }

  box.innerHTML = '<div class="eyebrow" style="margin:10px 0 4px">Etapy <span class="n">' + sg.length + '</span></div>' +
    sg.map(function (k, i) {
      return '<div class="sg"><div class="sg-n">' + (i + 1) + '</div>' +
        '<div class="sg-b"><b>' + esc(tytulPunktu(k[0])) + ' → ' + esc(tytulPunktu(k[k.length - 1])) + '</b>' +
        '<small>' + k.length + ' ' + odm(k.length, 'punkt', 'punkty', 'punktów') + '</small></div>' +
        '<a class="btn sm" href="' + urlGoogle(k) + '" target="_blank" rel="noopener">Otwórz</a></div>';
    }).join('');
}

/* ====================== wyszukiwanie jednostek i adresów ====================== */

function szukajJednostek(q) {
  var n = norm(q);
  if (n.length < 2) return [];
  var wyniki = [];
  for (var i = 0; i < LISTA_JEDN.length && wyniki.length < 40; i++) {
    var j = LISTA_JEDN[i];
    if (norm(j.nazwa).indexOf(n) === 0 || j.kod.indexOf(n) === 0) wyniki.push(j);
  }
  if (wyniki.length < 12) {
    for (var m = 0; m < LISTA_JEDN.length && wyniki.length < 40; m++) {
      var g = LISTA_JEDN[m];
      if (wyniki.indexOf(g) < 0 && norm(g.nazwa).indexOf(n) > 0) wyniki.push(g);
    }
  }
  return wyniki.sort(function (a, b) {
    if (a.typ !== b.typ) return a.typ === 'gmina' ? -1 : 1;   // gminy wyżej
    return a.nazwa.localeCompare(b.nazwa, 'pl');
  }).slice(0, 14);
}

function rysujWynikiJednostek(q) {
  var box = $('#qres');
  var w = szukajJednostek(q);
  if (!w.length) { box.innerHTML = ''; return; }
  box.innerHTML = w.map(function (j, i) {
    var podpis = j.typ === 'gmina' ? (j.powiat || j.woj) : (j.woj + ' · ' + j.miasto);
    return '<div class="ri" data-i="' + i + '">' +
      '<span class="kind' + (j.typ === 'gmina' ? ' g' : '') + '">' + (j.typ === 'gmina' ? 'gmina' : 'powiat') + '</span>' +
      '<span class="t"><b>' + esc(j.nazwa) + '</b><small>' + esc(podpis) + '</small></span></div>';
  }).join('');
  box.querySelectorAll('.ri').forEach(function (el) {
    el.onclick = function () {
      var j = w[+el.getAttribute('data-i')];
      box.innerHTML = '';
      $('#qAdres').value = '';
      nowyPunktW(j.lat, j.lng);
    };
  });
}

function szukajAdresu(q) {
  if (!q.trim()) return;
  var b = $('#btnSzukajAdres');
  b.disabled = true; b.textContent = 'Szukam…';
  fetch(NOMINATIM + '/search?format=jsonv2&limit=1&countrycodes=pl&q=' + encodeURIComponent(q))
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res || !res.length) { toast('Nie znalazłem takiego adresu.', true); return; }
      var lat = parseFloat(res[0].lat), lng = parseFloat(res[0].lon);
      $('#qres').innerHTML = '';
      nowyPunktW(lat, lng);
      var el = $('#sheetBody [data-pole="adres"]');
      if (el && !el.value) el.value = res[0].display_name.split(',').slice(0, 3).join(',').trim();
    })
    .catch(function () { toast('Brak połączenia z wyszukiwarką adresów.', true); })
    .then(function () { b.disabled = false; b.textContent = 'Szukaj adresu'; });
}

/* ====================== import listy adresów i OCR ====================== */

var doWeryfikacji = [];

function pokazWeryfikacje(linie) {
  doWeryfikacji = linie.map(function (a, i) {
    return { id: 'v' + i, wpis: a, nazwa: a, lat: null, lng: null, stan: 'czeka' };
  });

  $('#verifyCard').style.display = '';
  $('#vCnt').textContent = doWeryfikacji.length;
  $('#verifyBox').innerHTML = '<table class="vt"><thead><tr><th style="width:16px"></th><th>Adres</th><th style="width:84px">Stan</th></tr></thead><tbody>' +
    doWeryfikacji.map(function (r) {
      return '<tr id="row-' + r.id + '"><td><span class="vs wait"></span></td>' +
        '<td><input value="' + esc(r.wpis) + '" data-id="' + r.id + '"></td>' +
        '<td id="st-' + r.id + '" class="tiny">czeka…</td></tr>';
    }).join('') + '</tbody></table>';

  $('#verifyBox').querySelectorAll('input[data-id]').forEach(function (inp) {
    inp.onchange = function () {
      var r = doWeryfikacji.find(function (x) { return x.id === inp.getAttribute('data-id'); });
      if (r) { r.wpis = inp.value; geokoduj(r); }
    };
  });

  (function kolejno(i) {
    if (i >= doWeryfikacji.length) return;
    geokoduj(doWeryfikacji[i])
      .then(function () { return sleep(1100); })   // Nominatim: jedno zapytanie na sekundę
      .then(function () { kolejno(i + 1); });
  })(0);
}

function geokoduj(r) {
  var st = document.getElementById('st-' + r.id);
  var row = document.getElementById('row-' + r.id);
  if (st) st.textContent = 'szukam…';

  return fetch(NOMINATIM + '/search?format=jsonv2&limit=1&countrycodes=pl&q=' + encodeURIComponent(r.wpis))
    .then(function (x) { return x.json(); })
    .then(function (res) {
      if (res && res.length) {
        r.lat = parseFloat(res[0].lat); r.lng = parseFloat(res[0].lon);
        r.nazwa = res[0].display_name.split(',').slice(0, 2).join(', ');
        r.stan = 'ok';
        if (st) st.textContent = 'znaleziono';
        if (row) { row.className = 'ok'; row.querySelector('.vs').className = 'vs ok'; }
      } else {
        r.stan = 'blad';
        if (st) st.textContent = 'brak wyniku';
        if (row) { row.className = 'err'; row.querySelector('.vs').className = 'vs err'; }
      }
    })
    .catch(function () {
      r.stan = 'blad';
      if (st) st.textContent = 'błąd sieci';
      if (row) { row.className = 'err'; row.querySelector('.vs').className = 'vs err'; }
    });
}

function utworzZWeryfikacji() {
  var gotowe = doWeryfikacji.filter(function (r) { return r.stan === 'ok'; });
  if (!gotowe.length) { toast('Nic nie znalazłem pod tymi adresami.', true); return; }

  var domyslne = {};
  POLA.forEach(function (f) { if (f.domyslna) domyslne[f.klucz] = f.domyslna; });

  var lancuch = gotowe.reduce(function (l, r) {
    return l.then(function () {
      return new Promise(function (res) {
        var dane = Object.assign({}, domyslne);
        dane[K.etykieta || 'nazwa'] = r.nazwa;
        dane.adres = r.wpis;
        uzupelnijJednostki(dane, r.lat, r.lng, function (d) {
          Baza.dodaj(r.lat, r.lng, d).then(function (p) { wStan(p); res(); }, res);
        });
      });
    });
  }, Promise.resolve());

  lancuch.then(function () {
    $('#verifyCard').style.display = 'none';
    $('#listIn').value = '';
    doWeryfikacji = [];
    rysujWszystko();
    dopasujWidok();
    toast('Utworzono ' + gotowe.length + ' ' + odm(gotowe.length, 'punkt', 'punkty', 'punktów'));
  });
}

var tess = null;
function initTess() {
  if (tess) return Promise.resolve(tess);
  return new Promise(function (res, rej) {
    if (window.Tesseract) return res(window.Tesseract);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = function () { res(window.Tesseract); };
    s.onerror = function () { rej(new Error('Nie udało się wczytać biblioteki OCR.')); };
    document.head.appendChild(s);
  }).then(function (T) { return T.createWorker(['pol', 'eng']); })
    .then(function (w) { tess = w; return w; });
}

function odczytajZObrazu(plik) {
  var b = $('#btnOCR');
  b.disabled = true; b.textContent = 'Wczytuję słownik…';
  initTess().then(function (w) {
    b.textContent = 'Czytam obraz…';
    return w.recognize(plik);
  }).then(function (wynik) {
    var linie = String(wynik.data.text || '').split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 4 && /[a-ząćęłńóśźż]/i.test(s); });
    if (!linie.length) { toast('Nic nie odczytałem z tego obrazu.', true); return; }
    pokazWeryfikacje(linie.slice(0, 40));
  }).catch(function (e) {
    toast(e.message || 'Odczyt nie powiódł się.', true);
  }).then(function () {
    b.disabled = false; b.textContent = 'Odczytaj adresy z obrazu';
  });
}

/* ====================== import i eksport ====================== */

function pobierz(nazwa, tresc, typ) {
  var blob = new Blob([tresc], { type: typ + ';charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nazwa;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function nazwaPliku(rozsz) {
  var d = new Date();
  return 'punkty-' + S.kolekcja + '-' + d.toISOString().slice(0, 10) + '.' + rozsz;
}

function eksportGeoJSON() {
  var fc = {
    type: 'FeatureCollection',
    name: 'Mapa projektów: ' + S.kolekcja,
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features: S.punkty.map(function (p) {
      var props = Object.assign({}, p.dane);
      props._id = p.id; props._autor = p.autor;
      props._utworzono = p.utworzono; props._zmieniono = p.zmieniono;
      var xy = do1992(p.lat, p.lng);
      props._x_1992 = Math.round(xy[0] * 100) / 100;
      props._y_1992 = Math.round(xy[1] * 100) / 100;
      return { type: 'Feature', properties: props,
               geometry: { type: 'Point', coordinates: [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))] } };
    })
  };
  pobierz(nazwaPliku('geojson'), JSON.stringify(fc, null, 1), 'application/geo+json');
}

function csvPole(v) {
  var s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function eksportCSV() {
  var klucze = POLA.map(function (f) { return f.klucz; });
  S.punkty.forEach(function (p) {
    Object.keys(p.dane || {}).forEach(function (k) { if (klucze.indexOf(k) < 0) klucze.push(k); });
  });
  var naglowek = klucze.concat(['lat', 'lng', 'x_1992', 'y_1992', 'autor', 'zmieniono']);
  var wiersze = S.punkty.map(function (p) {
    var xy = do1992(p.lat, p.lng);
    return klucze.map(function (k) { return csvPole((p.dane || {})[k]); })
      .concat([p.lat.toFixed(6), p.lng.toFixed(6), Math.round(xy[0] * 100) / 100, Math.round(xy[1] * 100) / 100,
               csvPole(p.autor), csvPole(p.zmieniono)]).join(';');
  });
  pobierz(nazwaPliku('csv'), '\ufeff' + naglowek.join(';') + '\n' + wiersze.join('\n'), 'text/csv');
}

function podzielCsv(linia, sep) {
  var out = [], biezacy = '', cudzyslow = false;
  for (var i = 0; i < linia.length; i++) {
    var z = linia[i];
    if (cudzyslow) {
      if (z === '"' && linia[i + 1] === '"') { biezacy += '"'; i++; }
      else if (z === '"') cudzyslow = false;
      else biezacy += z;
    } else if (z === '"') cudzyslow = true;
    else if (z === sep) { out.push(biezacy); biezacy = ''; }
    else biezacy += z;
  }
  out.push(biezacy);
  return out;
}

function importujTekst(nazwa, tekst) {
  var nowe = [];

  if (/\.(geo)?json$/i.test(nazwa) || tekst.trim()[0] === '{') {
    var g;
    try { g = JSON.parse(tekst); } catch (e) { toast('To nie jest poprawny JSON.', true); return; }
    var cechy = g.type === 'FeatureCollection' ? (g.features || []) : (g.type === 'Feature' ? [g] : []);
    cechy.forEach(function (f) {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      var props = Object.assign({}, f.properties || {});
      var meta = { autor: props._autor, utworzono: props._utworzono };
      ['_id', '_autor', '_utworzono', '_zmieniono', '_x_1992', '_y_1992'].forEach(function (k) { delete props[k]; });
      nowe.push({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
                  dane: props, autor: meta.autor || '', utworzono: meta.utworzono });
    });
  } else {
    var linie = tekst.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (linie.length < 2) { toast('Plik CSV nie ma wierszy z danymi.', true); return; }
    var sep = (linie[0].split(';').length > linie[0].split(',').length) ? ';' : ',';
    var glowa = podzielCsv(linie[0], sep).map(function (s) { return s.replace(/^\ufeff/, '').trim(); });
    var iLat = glowa.findIndex(function (h) { return /^(lat|szerokosc|szerokość|y_wgs)$/i.test(h); });
    var iLng = glowa.findIndex(function (h) { return /^(lng|lon|długość|dlugosc|x_wgs)$/i.test(h); });
    var iX = glowa.findIndex(function (h) { return /^x(_1992)?$/i.test(h); });
    var iY = glowa.findIndex(function (h) { return /^y(_1992)?$/i.test(h); });

    if (iLat < 0 && iX < 0) { toast('Brak kolumny lat/lng albo x/y w PL-1992.', true); return; }

    linie.slice(1).forEach(function (l) {
      var c = podzielCsv(l, sep);
      var lat, lng;
      if (iLat >= 0 && iLng >= 0) {
        lat = parseFloat(String(c[iLat]).replace(',', '.'));
        lng = parseFloat(String(c[iLng]).replace(',', '.'));
      } else {
        var ll = z1992(parseFloat(String(c[iX]).replace(',', '.')), parseFloat(String(c[iY]).replace(',', '.')));
        lat = ll[0]; lng = ll[1];
      }
      if (!isFinite(lat) || !isFinite(lng)) return;
      var dane = {};
      glowa.forEach(function (h, i) {
        if ([iLat, iLng, iX, iY].indexOf(i) >= 0) return;
        if (!h || !c[i] || !String(c[i]).trim()) return;
        var f = POLA.find(function (x) { return x.klucz === h || norm(x.etykieta) === norm(h); });
        dane[f ? f.klucz : h] = String(c[i]).trim();
      });
      nowe.push({ lat: lat, lng: lng, dane: dane });
    });
  }

  if (!nowe.length) { toast('Nie znalazłem punktów w tym pliku.', true); return; }

  nowe.reduce(function (l, p) {
    return l.then(function () {
      return Baza.wstaw(p).then(wStan);
    });
  }, Promise.resolve()).then(function () {
    rysujWszystko(); dopasujWidok();
    toast('Wczytano ' + nowe.length + ' ' + odm(nowe.length, 'punkt', 'punkty', 'punktów'));
  });
}

function dopasujWidok() {
  if (!S.punkty.length) return;
  var b = L.latLngBounds(S.punkty.map(function (p) { return [p.lat, p.lng]; }));
  map.fitBounds(b.pad(0.15), { maxZoom: 14 });
}

/* ====================== zbiór, synchronizacja, stan ====================== */

function linkZbioru() {
  var u = new URL(window.location.href);
  u.searchParams.set('zbior', S.kolekcja);
  u.hash = '';
  return u.toString();
}

function kopiujLink() {
  var url = linkZbioru();
  var ok = function () { toast('Link skopiowany'); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, function () { window.prompt('Skopiuj link:', url); });
  else window.prompt('Skopiuj link:', url);
}

function odswiezStan() {
  var el = $('#stan'), txt = $('#stanTxt');
  var n = S.punkty.length;
  var opis = n + ' ' + odm(n, 'punkt', 'punkty', 'punktów');

  if (Baza.tryb === 'lokalny') {
    el.className = '';
    txt.textContent = 'Tryb lokalny · ' + opis + ' · dane tylko w tej przeglądarce';
  } else {
    var zalegle = Baza.wZalegloscich();
    if (Baza.ostatniBlad) {
      el.className = 'err';
      txt.textContent = 'Baza nie odpowiada · ' + opis + (zalegle ? ' · ' + zalegle + ' do wysłania' : '');
    } else if (zalegle) {
      el.className = 'wait';
      txt.textContent = 'Wysyłam zaległe zmiany (' + zalegle + ') · ' + opis;
    } else {
      el.className = 'ok';
      txt.textContent = 'Wspólna baza · ' + opis +
        (Baza.ostatniaSync ? ' · zgrane ' + fmtCzas(Baza.ostatniaSync.toISOString()) : '');
    }
  }
  $('#opisBazy').textContent = Baza.tryb === 'lokalny'
    ? 'Tryb lokalny: link otwiera pustą mapę u innej osoby. Żeby wszyscy widzieli te same punkty, wpisz adres bazy w config.js (instrukcja w README).'
    : 'Każdy, kto otworzy ten link, widzi i edytuje te same punkty.';
}

function wczytajZBazy(cicho) {
  return Baza.lista().then(function (arr) {
    S.punkty = arr;
    S.trasa = S.trasa.filter(function (id) {
      return arr.some(function (p) { return p.id === id; });
    });
    rysujWszystko();
    odswiezStan();
    return arr;
  }, function (e) {
    odswiezStan();
    if (!cicho) toast(e.message || 'Nie udało się pobrać punktów.', true);
  });
}

/* ====================== render zbiorczy ====================== */

function rysujWszystko() {
  var otwarty = null;
  Object.keys(markery).forEach(function (id) {
    if (markery[id].isPopupOpen && markery[id].isPopupOpen()) otwarty = id;
  });
  rysujPunkty();
  rysujFiltry();
  rysujListe();
  rysujTrasePanel();
  rysujTraseNaMapie();
  if (otwarty && markery[otwarty]) markery[otwarty].openPopup();
}

/* ====================== komunikaty ====================== */

var timerToast = null;
function toast(tekst, zly) {
  var t = $('#toast');
  t.textContent = tekst;
  t.className = 'on' + (zly ? ' zly' : '');
  clearTimeout(timerToast);
  timerToast = setTimeout(function () { t.className = ''; }, zly ? 4200 : 2400);
}

var timerHint = null;
function pokazHint(tekst, ms, zAnuluj) {
  $('#hintTxt').textContent = tekst;
  $('#hintX').hidden = !zAnuluj;
  $('#hint').hidden = false;
  clearTimeout(timerHint);
  if (ms) timerHint = setTimeout(function () { $('#hint').hidden = true; }, ms);
}
function schowajHint() { clearTimeout(timerHint); $('#hint').hidden = true; }

function trybStawiania(wlacz) {
  S.stawianie = wlacz;
  $('#map').classList.toggle('stawiam', wlacz);
  $('#btnNowy').classList.toggle('on', wlacz);
  $('#btnStaw').classList.toggle('on', wlacz);
  $('#btnNowyTxt').textContent = wlacz ? 'Kliknij na mapie' : 'Nowy punkt';
  if (wlacz) {
    pokazHint('Kliknij miejsce na mapie', 0, true);
    if (window.innerWidth < 880) $('#panel').classList.add('min');
  } else schowajHint();
}

/* ====================== zakładki ====================== */

function pokazStrone(id) {
  $$('.page').forEach(function (p) { p.classList.toggle('on', p.id === id); });
  $$('.tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-page') === id); });
  var trasa = id === 'pgTrasa';
  $('#dockDodaj').hidden = trasa;
  $('#btnGo').hidden = !trasa;
}

/* ====================== ustawienia ====================== */

function zapiszUstawienia() {
  ustaw.set('mp:ustawienia', JSON.stringify({ podklad: S.podklad, granice: S.granice, mode: S.mode, autor: S.autor }));
}

function wczytajUstawienia() {
  try {
    var u = JSON.parse(ustaw.get('mp:ustawienia') || '{}');
    if (u.podklad) S.podklad = u.podklad;
    if (u.mode) S.mode = u.mode;
    if (typeof u.granice === 'boolean') S.granice = u.granice;
    S.autor = u.autor || '';
  } catch (e) {}
}

/* ====================== zdarzenia ====================== */

function podlacz() {
  $('#handle').onclick = function () {
    var p = $('#panel');
    p.classList.toggle('min');
    $('#handle').title = p.classList.contains('min') ? 'Rozwiń panel' : 'Zwiń panel';
  };

  $$('.tab').forEach(function (t) {
    t.onclick = function () { pokazStrone(t.getAttribute('data-page')); };
  });

  $('#baseBtn').onclick = function () { pokazWyborPodkladu(true); };
  document.addEventListener('click', function (e) {
    if (!$('#basePanel').hidden && !e.target.closest('#basePanel') && !e.target.closest('#baseBtn')) {
      pokazWyborPodkladu(false);
    }
  });

  /* --- dodawanie --- */
  $('#btnNowy').onclick = function () { trybStawiania(!S.stawianie); };
  $('#btnStaw').onclick = function () { trybStawiania(!S.stawianie); };
  $('#hintX').onclick = function () { trybStawiania(false); };

  $('#qAdres').addEventListener('input', function () { rysujWynikiJednostek(this.value); });
  $('#qAdres').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); szukajAdresu(this.value); }
  });
  $('#btnSzukajAdres').onclick = function () { szukajAdresu($('#qAdres').value); };

  $('#btnGeo').onclick = function () {
    if (!navigator.geolocation) { toast('Przeglądarka nie udostępnia lokalizacji.', true); return; }
    toast('Ustalam położenie…');
    navigator.geolocation.getCurrentPosition(function (poz) {
      nowyPunktW(poz.coords.latitude, poz.coords.longitude);
    }, function () {
      toast('Nie udało się ustalić położenia. Lokalizacja działa tylko po HTTPS.', true);
    }, { enableHighAccuracy: true, timeout: 12000 });
  };

  $('#btnWsp').onclick = function () {
    var a = parseFloat(String($('#wsp1').value).replace(',', '.'));
    var b = parseFloat(String($('#wsp2').value).replace(',', '.'));
    if (!isFinite(a) || !isFinite(b)) { toast('Wpisz dwie liczby.', true); return; }
    var lat, lng;
    if ($('#uklad').value === 'pl1992') {
      var ll = z1992(a, b); lat = ll[0]; lng = ll[1];
    } else { lat = a; lng = b; }
    if (lat < 47 || lat > 56 || lng < 13 || lng > 25) {
      if (!window.confirm('Ten punkt wypada poza Polską. Postawić mimo to?')) return;
    }
    $('#wsp1').value = ''; $('#wsp2').value = '';
    nowyPunktW(lat, lng);
  };

  $('#uklad').onchange = function () {
    var pl = this.value === 'pl1992';
    $('#wsp1').placeholder = pl ? '201195 (X, północ)' : '49.6853';
    $('#wsp2').placeholder = pl ? '513559 (Y, wschód)' : '19.1922';
  };

  $('#btnList').onclick = function () {
    var linie = $('#listIn').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!linie.length) { toast('Wklej najpierw listę adresów.', true); return; }
    pokazWeryfikacje(linie.slice(0, 40));
  };
  $('#btnAddVerified').onclick = utworzZWeryfikacji;

  $('#btnOCR').onclick = function () { $('#photo').click(); };
  $('#photo').onchange = function () {
    if (this.files && this.files[0]) odczytajZObrazu(this.files[0]);
    this.value = '';
  };

  /* --- lista --- */
  $('#szukaj').addEventListener('input', function () {
    S.filtrTekst = this.value;
    rysujListe(); rysujPunkty();
  });

  /* --- formularz --- */
  $('#sheetX').onclick = zamknijKarte;
  $('#sheet').onclick = function (e) { if (e.target === this) zamknijKarte(); };
  $('#sheetZapisz').onclick = zapiszKarte;
  $('#sheetUsun').onclick = function () {
    if (S.edytowany && S.edytowany.punkt) usunPunkt(S.edytowany.punkt);
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if ($('#sheet').classList.contains('on')) zamknijKarte();
      else if (S.stawianie) trybStawiania(false);
    }
  });

  /* --- trasa --- */
  $$('#modeSeg .mode').forEach(function (b) {
    b.onclick = function () {
      S.mode = b.getAttribute('data-mode');
      $$('#modeSeg .mode').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('#modeHint').textContent = OPISY_TRYBU[S.mode];
      S.wynik = null;
      zapiszUstawienia();
      rysujWszystko();
    };
  });
  $('#btnOpt').onclick = optymalizuj;

  /* --- baza --- */
  $('#btnKopiuj').onclick = kopiujLink;
  $('#btnUdostepnij').onclick = kopiujLink;

  $('#btnNowaKolekcja').onclick = function () {
    var id = 'z' + Math.random().toString(36).slice(2, 9);
    var u = new URL(window.location.href);
    u.searchParams.set('zbior', id);
    window.location.href = u.toString();
  };

  $('#btnOdswiez').onclick = function () { wczytajZBazy(); toast('Odświeżam…'); };

  $('#autorIn').addEventListener('change', function () {
    S.autor = this.value.trim();
    Baza.ustawAutora(S.autor);
    zapiszUstawienia();
    toast(S.autor ? 'Zmiany będą podpisane: ' + S.autor : 'Podpis wyłączony');
  });

  $('#btnExpGeo').onclick = eksportGeoJSON;
  $('#btnExpCsv').onclick = eksportCSV;
  $('#btnImp').onclick = function () { $('#plik').click(); };
  $('#plik').onchange = function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { importujTekst(f.name, String(r.result)); };
    r.readAsText(f, 'utf-8');
    this.value = '';
  };

  $('#btnGranice').onclick = function () {
    S.granice = !S.granice;
    this.classList.toggle('on', S.granice);
    this.textContent = S.granice ? 'Ukryj granice' : 'Pokaż granice';
    zapiszUstawienia();
    odswiezGranice();
  };

  $('#btnKasuj').onclick = function () {
    if (!S.punkty.length) { toast('Nie ma czego kasować.'); return; }
    if (!window.confirm('Usunąć wszystkie punkty ze zbioru „' + S.kolekcja + '”? ' +
        'W trybie wspólnym znikną też innym osobom.')) return;
    Baza.wyczysc().then(function () {
      S.punkty = []; S.trasa = []; S.wynik = null;
      rysujWszystko(); odswiezStan();
      toast('Zbiór wyczyszczony');
    });
  };

  /* odświeżanie w tle */
  var co = Math.max(5, (K.baza && K.baza.odswiezanieSek) || 15) * 1000;
  setInterval(function () {
    if (Baza.tryb === 'supabase' && !document.hidden && !$('#sheet').classList.contains('on')) {
      wczytajZBazy(true);
    }
  }, co);

  window.addEventListener('focus', function () {
    if (Baza.tryb === 'supabase' && !$('#sheet').classList.contains('on')) wczytajZBazy(true);
  });
}

/* ====================== start ====================== */

function start() {
  document.title = K.tytul || 'Mapa projektów';
  $('#hTytul').textContent = K.tytul || 'Mapa projektów';
  $('#hSub').textContent = K.podtytul || '';

  wczytajUstawienia();

  var par = new URLSearchParams(window.location.search);
  S.kolekcja = (par.get('zbior') || 'domyslna').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'domyslna';

  initGranice();
  initMapa();
  rysujWyborPodkladu();
  podlacz();

  $('#kolekcjaIn').value = linkZbioru();
  $('#autorIn').value = S.autor;
  $('#modeHint').textContent = OPISY_TRYBU[S.mode];
  $$('#modeSeg .mode').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === S.mode); });
  $('#btnGranice').classList.toggle('on', S.granice);
  $('#btnGranice').textContent = S.granice ? 'Ukryj granice' : 'Pokaż granice';
  pokazStrone('pgPunkty');

  odswiezGranice();

  Baza.init(K.baza, S.kolekcja, S.autor).then(function () {
    return wczytajZBazy(true);
  }).then(function () {
    if (S.punkty.length) dopasujWidok();
    odswiezStan();
  });

  wczytajGminy();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();

/* na potrzeby testów bez przeglądarki */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { do1992: do1992, z1992: z1992, norm: norm, odm: odm, podzielCsv: podzielCsv,
                     wGeometrii: wGeometrii, dwaOpt: dwaOpt, najblizszySasiad: najblizszySasiad };
}

})();
