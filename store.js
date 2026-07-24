/* Warstwa danych. Dwa tryby, jedno API.

   lokalny  : punkty leżą w przeglądarce. Zero konfiguracji, ale link niczego
              nie współdzieli: każdy widzi swoje.
   supabase : punkty leżą w bazie. Każdy z linkiem czyta i zapisuje.

   Zapisy w trybie wspólnym idą przez skrzynkę nadawczą: kiedy sieć padnie
   w połowie edycji, zmiana czeka w przeglądarce i wychodzi przy najbliższej
   udanej synchronizacji. Bez tego edycja z telefonu w terenie potrafi zniknąć.

   Rozstrzyganie konfliktów: wygrywa późniejszy zapis (pole `zmieniono`).
   Przy dwóch osobach edytujących ten sam punkt w tej samej minucie ktoś
   straci swoją wersję, dlatego panel pokazuje, kto zmieniał ostatni. */

window.Baza = (function () {
  'use strict';

  var KLUCZ_PUNKTY = 'mp:punkty:';
  var KLUCZ_OUTBOX = 'mp:outbox:';

  var mem = {};
  var trwaly = (function () {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
    catch (e) { return false; }
  })();

  function czytaj(k) {
    try { return trwaly ? localStorage.getItem(k) : (mem[k] || null); }
    catch (e) { return mem[k] || null; }
  }
  function pisz(k, v) {
    try { if (trwaly) localStorage.setItem(k, v); else mem[k] = v; }
    catch (e) { mem[k] = v; }
  }

  function teraz() { return new Date().toISOString(); }

  function nowyId() {
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 8);
    return 'p' + t + r;
  }

  var cfg = { typ: 'lokalny', url: '', klucz: '', tabela: 'punkty' };
  var kolekcja = 'domyslna';
  var autor = '';

  /* ====================== tryb lokalny ====================== */

  var lokalny = {
    lista: function () {
      var s = czytaj(KLUCZ_PUNKTY + kolekcja);
      var arr = [];
      try { arr = s ? JSON.parse(s) : []; } catch (e) { arr = []; }
      return Promise.resolve(arr);
    },
    zapiszWszystko: function (arr) {
      pisz(KLUCZ_PUNKTY + kolekcja, JSON.stringify(arr));
      return Promise.resolve(arr);
    },
    dodaj: function (p) {
      return lokalny.lista().then(function (arr) {
        arr.push(p);
        return lokalny.zapiszWszystko(arr).then(function () { return p; });
      });
    },
    zapisz: function (p) {
      return lokalny.lista().then(function (arr) {
        var i = arr.findIndex(function (x) { return x.id === p.id; });
        if (i < 0) arr.push(p); else arr[i] = p;
        return lokalny.zapiszWszystko(arr).then(function () { return p; });
      });
    },
    usun: function (id) {
      return lokalny.lista().then(function (arr) {
        return lokalny.zapiszWszystko(arr.filter(function (x) { return x.id !== id; }));
      });
    }
  };

  /* ====================== tryb wspólny (Supabase) ====================== */

  function naglowki(extra) {
    /* `x-zbior` jest po to, żeby dało się zamknąć bazę zasadą, która wpuszcza
       wyłącznie do zbioru podanego w nagłówku. Bez tego każdy z kluczem anon
       może wylistować wszystkie zbiory naraz. Szczegóły w supabase/schema.sql. */
    var h = {
      'apikey': cfg.klucz,
      'Authorization': 'Bearer ' + cfg.klucz,
      'Content-Type': 'application/json',
      'x-zbior': kolekcja
    };
    for (var k in (extra || {})) h[k] = extra[k];
    return h;
  }

  function rest(sciezka, opcje) {
    var url = cfg.url.replace(/\/+$/, '') + '/rest/v1/' + cfg.tabela + sciezka;
    return fetch(url, opcje).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error(blad(r.status, t));
        });
      }
      return r.status === 204 ? null : r.json();
    });
  }

  function blad(kod, tresc) {
    if (kod === 401 || kod === 403) return 'Baza odrzuciła zapytanie (' + kod + '). Sprawdź klucz anon i zasady dostępu w supabase/schema.sql.';
    if (kod === 404) return 'Nie ma takiej tabeli w bazie. Wykonaj supabase/schema.sql.';
    if (kod === 409) return 'Konflikt zapisu w bazie.';
    return 'Baza odpowiedziała błędem ' + kod + '. ' + String(tresc || '').slice(0, 160);
  }

  var zdalny = {
    lista: function () {
      return rest('?kolekcja=eq.' + encodeURIComponent(kolekcja) + '&select=*&order=utworzono.asc', {
        headers: naglowki()
      }).then(function (rows) { return (rows || []).map(zWiersza); });
    },
    dodaj: function (p) {
      return rest('', {
        method: 'POST',
        headers: naglowki({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(doWiersza(p))
      }).then(function (rows) { return rows && rows[0] ? zWiersza(rows[0]) : p; });
    },
    zapisz: function (p) {
      return rest('?id=eq.' + encodeURIComponent(p.id), {
        method: 'PATCH',
        headers: naglowki({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(doWiersza(p))
      }).then(function (rows) { return rows && rows[0] ? zWiersza(rows[0]) : p; });
    },
    usun: function (id) {
      return rest('?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: naglowki() });
    }
  };

  function doWiersza(p) {
    return {
      id: p.id, kolekcja: kolekcja,
      lat: p.lat, lng: p.lng, dane: p.dane || {},
      autor: p.autor || '', utworzono: p.utworzono || teraz(), zmieniono: p.zmieniono || teraz()
    };
  }

  function zWiersza(r) {
    return {
      id: r.id, lat: Number(r.lat), lng: Number(r.lng),
      dane: r.dane || {}, autor: r.autor || '',
      utworzono: r.utworzono, zmieniono: r.zmieniono
    };
  }

  /* ====================== skrzynka nadawcza ====================== */

  function outbox() {
    var s = czytaj(KLUCZ_OUTBOX + kolekcja);
    try { return s ? JSON.parse(s) : []; } catch (e) { return []; }
  }
  function zapiszOutbox(arr) { pisz(KLUCZ_OUTBOX + kolekcja, JSON.stringify(arr)); }
  function doSkrzynki(wpis) { var a = outbox(); a.push(wpis); zapiszOutbox(a); }

  /* Wysyła zaległości po kolei. Wpis, który przeszedł, znika ze skrzynki;
     na pierwszym błędzie przerywamy i próbujemy przy następnej synchronizacji. */
  function opriznijSkrzynke() {
    var a = outbox();
    if (!a.length) return Promise.resolve(0);

    var wyslane = 0;
    return a.reduce(function (lancuch, w) {
      return lancuch.then(function (przerwane) {
        if (przerwane) return true;
        var akcja = w.op === 'usun' ? zdalny.usun(w.id) : (w.op === 'dodaj' ? zdalny.dodaj(w.punkt) : zdalny.zapisz(w.punkt));
        return akcja.then(function () { wyslane++; return false; }, function () { return true; });
      });
    }, Promise.resolve(false)).then(function () {
      zapiszOutbox(a.slice(wyslane));
      return wyslane;
    });
  }

  /* ====================== API ====================== */

  var api = {
    tryb: 'lokalny',
    kolekcja: 'domyslna',
    ostatniaSync: null,
    ostatniBlad: null,
    trwaly: trwaly,

    init: function (konfig, nazwaKolekcji, podpis) {
      cfg = Object.assign({ typ: 'lokalny', url: '', klucz: '', tabela: 'punkty' }, konfig || {});
      kolekcja = nazwaKolekcji || 'domyslna';
      autor = podpis || '';
      var wspolny = cfg.typ === 'supabase' && cfg.url && cfg.klucz;
      api.tryb = wspolny ? 'supabase' : 'lokalny';
      api.kolekcja = kolekcja;
      return Promise.resolve(api.tryb);
    },

    ustawAutora: function (a) { autor = a || ''; },

    wZalegloscich: function () { return api.tryb === 'supabase' ? outbox().length : 0; },

    lista: function () {
      if (api.tryb === 'lokalny') return lokalny.lista();
      return opriznijSkrzynke().then(zdalny.lista).then(function (arr) {
        api.ostatniaSync = new Date();
        api.ostatniBlad = null;
        return arr;
      }, function (e) {
        api.ostatniBlad = e.message || 'Brak połączenia z bazą.';
        throw e;
      });
    },

    dodaj: function (lat, lng, dane) {
      var p = {
        id: nowyId(), lat: lat, lng: lng, dane: dane || {},
        autor: autor, utworzono: teraz(), zmieniono: teraz()
      };
      if (api.tryb === 'lokalny') return lokalny.dodaj(p);
      return zdalny.dodaj(p).catch(function (e) {
        api.ostatniBlad = e.message; doSkrzynki({ op: 'dodaj', punkt: p }); return p;
      });
    },

    /* Wstawia punkt z gotowym identyfikatorem, na potrzeby importu. */
    wstaw: function (p) {
      p.id = p.id || nowyId();
      p.autor = p.autor || autor;
      p.utworzono = p.utworzono || teraz();
      p.zmieniono = teraz();
      if (api.tryb === 'lokalny') return lokalny.dodaj(p);
      return zdalny.dodaj(p).catch(function (e) {
        api.ostatniBlad = e.message; doSkrzynki({ op: 'dodaj', punkt: p }); return p;
      });
    },

    zapisz: function (p) {
      p.zmieniono = teraz();
      p.autor = autor || p.autor || '';
      if (api.tryb === 'lokalny') return lokalny.zapisz(p);
      return zdalny.zapisz(p).catch(function (e) {
        api.ostatniBlad = e.message; doSkrzynki({ op: 'zapisz', punkt: p }); return p;
      });
    },

    usun: function (id) {
      if (api.tryb === 'lokalny') return lokalny.usun(id);
      return zdalny.usun(id).catch(function (e) {
        api.ostatniBlad = e.message; doSkrzynki({ op: 'usun', id: id }); return null;
      });
    },

    /* Podmienia całą zawartość kolekcji, na potrzeby importu z zamianą. */
    wyczysc: function () {
      if (api.tryb === 'lokalny') return lokalny.zapiszWszystko([]);
      return api.lista().then(function (arr) {
        return arr.reduce(function (l, p) {
          return l.then(function () { return api.usun(p.id); });
        }, Promise.resolve());
      });
    }
  };

  return api;
})();
