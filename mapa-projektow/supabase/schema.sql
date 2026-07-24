-- Mapa projektów: tabela punktów dla trybu wspólnego.
--
-- Wykonaj ten plik w swoim projekcie Supabase: SQL Editor, wklej, Run.
-- Potem przepisz adres projektu i klucz anon do config.js.
--
-- UWAGA, TO JEST OTWARTY DOSTĘP. Zasady poniżej pozwalają każdemu, kto zna
-- adres projektu i klucz anon, czytać, dodawać, zmieniać i kasować punkty.
-- Tego właśnie chcemy przy "każdy z linkiem może edytować", ale trzeba
-- rozumieć konsekwencję: klucz anon jest widoczny w kodzie strony, więc
-- w praktyce zbiór jest publiczny dla każdego, kto zajrzy do źródła.
-- Jeżeli to za dużo, na końcu pliku są dwa łagodniejsze warianty.

create table if not exists public.punkty (
  id         text primary key,
  kolekcja   text        not null default 'domyslna',
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  dane       jsonb       not null default '{}'::jsonb,
  autor      text        not null default '',
  utworzono  timestamptz not null default now(),
  zmieniono  timestamptz not null default now(),

  -- zapora na przypadkowe wklejenie całego dokumentu w pole notatek
  constraint dane_rozmiar check (pg_column_size(dane) < 64000)
);

create index if not exists punkty_kolekcja_idx  on public.punkty (kolekcja);
create index if not exists punkty_zmieniono_idx on public.punkty (kolekcja, zmieniono desc);

alter table public.punkty enable row level security;

drop policy if exists punkty_czytanie  on public.punkty;
drop policy if exists punkty_dodawanie on public.punkty;
drop policy if exists punkty_zmiana    on public.punkty;
drop policy if exists punkty_usuwanie  on public.punkty;

create policy punkty_czytanie  on public.punkty for select using (true);
create policy punkty_dodawanie on public.punkty for insert with check (true);
create policy punkty_zmiana    on public.punkty for update using (true) with check (true);
create policy punkty_usuwanie  on public.punkty for delete using (true);

-- Serwer pilnuje znacznika zmiany. Bez tego zegar telefonu z błędną datą
-- potrafi cofnąć czas edycji i pomieszać kolejność wersji.
create or replace function public.punkty_znacznik()
returns trigger language plpgsql as $$
begin
  new.zmieniono := now();
  if tg_op = 'INSERT' then new.utworzono := coalesce(new.utworzono, now()); end if;
  return new;
end $$;

drop trigger if exists punkty_znacznik_trg on public.punkty;
create trigger punkty_znacznik_trg
  before insert or update on public.punkty
  for each row execute function public.punkty_znacznik();


-- ---------------------------------------------------------------------------
-- Wariant 1: wszyscy czytają, piszą tylko zalogowani.
-- Zdejmij komentarz i usuń trzy zasady zapisu powyżej.
--
-- create policy punkty_dodawanie on public.punkty for insert to authenticated with check (true);
-- create policy punkty_zmiana    on public.punkty for update to authenticated using (true) with check (true);
-- create policy punkty_usuwanie  on public.punkty for delete to authenticated using (true);
--
-- ---------------------------------------------------------------------------
-- Wariant 2: dostęp wyłącznie do zbioru podanego w nagłówku żądania.
-- Aplikacja wysyła przy każdym zapytaniu nagłówek `x-zbior` z nazwą zbioru
-- z adresu. Poniższe zasady wpuszczają tylko do tego jednego zbioru, więc
-- nikt nie wylistuje cudzych punktów, nawet mając klucz anon. Link z długą,
-- losową nazwą zbioru działa wtedy jak hasło.
--
-- Samo `length(kolekcja) >= 10` by nie wystarczyło: bez filtra w zapytaniu
-- PostgREST zwróciłby wszystkie wiersze, które przechodzą zasadę.
--
-- drop policy if exists punkty_czytanie  on public.punkty;
-- drop policy if exists punkty_dodawanie on public.punkty;
-- drop policy if exists punkty_zmiana    on public.punkty;
-- drop policy if exists punkty_usuwanie  on public.punkty;
--
-- create or replace function public.zbior_z_naglowka() returns text
--   language sql stable as $$
--     select nullif(current_setting('request.headers', true)::json ->> 'x-zbior', '')
--   $$;
--
-- create policy punkty_czytanie  on public.punkty for select
--   using (kolekcja = public.zbior_z_naglowka() and length(kolekcja) >= 10);
-- create policy punkty_dodawanie on public.punkty for insert
--   with check (kolekcja = public.zbior_z_naglowka() and length(kolekcja) >= 10);
-- create policy punkty_zmiana    on public.punkty for update
--   using (kolekcja = public.zbior_z_naglowka())
--   with check (kolekcja = public.zbior_z_naglowka());
-- create policy punkty_usuwanie  on public.punkty for delete
--   using (kolekcja = public.zbior_z_naglowka());
--
-- ---------------------------------------------------------------------------
-- Sprzątanie zbiorów porzuconych po pół roku (uruchom ręcznie albo z pg_cron):
--
-- delete from public.punkty where zmieniono < now() - interval '180 days';
