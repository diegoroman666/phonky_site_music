-- ============================================================================
-- PHONKY-4-U  ::  ESQUEMA INICIAL
-- Tablas: tracks (música), stats (contador visitas), subscribers (suscriptores)
-- Auth: el manager se autentica vía Supabase Auth con su email
-- ============================================================================

-- ---------- 1. TABLA TRACKS ----------
create table if not exists public.tracks (
    id           bigserial primary key,
    name         text not null,
    song         text,
    album        text,
    img          text,
    bio          text,
    yt_link      text not null,
    created_at   timestamptz default now()
);

-- ---------- 2. TABLA STATS (contador único de visitas) ----------
create table if not exists public.stats (
    id      int primary key default 1,
    visits  bigint default 0,
    constraint stats_single_row check (id = 1)
);

insert into public.stats (id, visits)
values (1, 0)
on conflict (id) do nothing;

-- RPC atómica para incrementar visitas (security definer = bypass RLS)
create or replace function public.increment_visits()
returns bigint
language sql
security definer
set search_path = public
as $$
    update public.stats
    set visits = visits + 1
    where id = 1
    returning visits;
$$;

-- ---------- 3. TABLA SUBSCRIBERS ----------
create table if not exists public.subscribers (
    id          bigserial primary key,
    email       text not null unique,
    created_at  timestamptz default now()
);

-- RPC pública para obtener el conteo (sin exponer la lista de emails)
create or replace function public.subscriber_count()
returns bigint
language sql
security definer
set search_path = public
as $$
    select count(*) from public.subscribers;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.tracks      enable row level security;
alter table public.stats       enable row level security;
alter table public.subscribers enable row level security;

-- ---- TRACKS ----
-- lectura pública
drop policy if exists "tracks_public_read" on public.tracks;
create policy "tracks_public_read"
    on public.tracks for select
    using (true);

-- escritura solo del manager (email match)
drop policy if exists "tracks_manager_insert" on public.tracks;
create policy "tracks_manager_insert"
    on public.tracks for insert
    with check ((auth.jwt() ->> 'email') = '25reid88@gmail.com');

drop policy if exists "tracks_manager_update" on public.tracks;
create policy "tracks_manager_update"
    on public.tracks for update
    using ((auth.jwt() ->> 'email') = '25reid88@gmail.com');

drop policy if exists "tracks_manager_delete" on public.tracks;
create policy "tracks_manager_delete"
    on public.tracks for delete
    using ((auth.jwt() ->> 'email') = '25reid88@gmail.com');

-- ---- STATS ----
-- lectura pública del contador
drop policy if exists "stats_public_read" on public.stats;
create policy "stats_public_read"
    on public.stats for select
    using (true);
-- (sin insert/update/delete públicos: solo se modifica vía RPC increment_visits)

-- ---- SUBSCRIBERS ----
-- cualquiera puede suscribirse
drop policy if exists "subscribers_public_insert" on public.subscribers;
create policy "subscribers_public_insert"
    on public.subscribers for insert
    with check (true);

-- solo el manager ve la lista completa
drop policy if exists "subscribers_manager_read" on public.subscribers;
create policy "subscribers_manager_read"
    on public.subscribers for select
    using ((auth.jwt() ->> 'email') = '25reid88@gmail.com');

-- ============================================================================
-- SEED: cargar los 9 tracks iniciales si la tabla está vacía
-- ============================================================================
insert into public.tracks (name, song, album, img, bio, yt_link)
select * from (values
    ('WINDSMOKE',          'LIKE A 34 w/ GUCCIGARETTE', 'YouTube Release',  'https://i.ytimg.com/vi/8-ey0AnP6Eo/hqdefault.jpg', 'Info...', 'https://www.youtube.com/embed/8-ey0AnP6Eo'),
    ('SOUDIERE & MYRROR',  'KEEP IT 100',               'YouTube Release',  'https://i.ytimg.com/vi/A7vjlJ7XZ9E/hqdefault.jpg', 'Info...', 'https://www.youtube.com/embed/A7vjlJ7XZ9E'),
    ('VSVS ft. SOUDIERE',  'STANDIN ON TOP',            'YouTube Release',  'https://i.ytimg.com/vi/HK5eWubqpUQ/hqdefault.jpg', 'Info...', 'https://www.youtube.com/embed/HK5eWubqpUQ'),
    ('MARKITAN',           'LET ME KNOW',               'YouTube Release',  'https://i.ytimg.com/vi/CU6KV2PRS20/hqdefault.jpg', 'Info...', 'https://www.youtube.com/embed/CU6KV2PRS20'),
    ('Tea 茶',              'ITCHIN'' FOR THAT PAPER',   'YouTube Release',  'https://i.ytimg.com/vi/e9_kZ1rDwAo/hqdefault.jpg', 'Info...', 'https://www.youtube.com/embed/e9_kZ1rDwAo'),
    ('Erickd - Topic',     'Dusk',                      'YouTube Release',  'https://i.ytimg.com/vi/4Y5XtuuM8Q0/hqdefault.jpg', 'Info...', 'https://www.youtube.com/embed/4Y5XtuuM8Q0'),
    ('Roland Jones - Topic', 'Loyalty',                 'Groove Guide EP',  'https://i.ytimg.com/vi/tkjFpSVO01c/hqdefault.jpg', 'Sonido crudo y agresivo. Ritmos pesados que caracterizan el lado oscuro del phonk.', 'https://www.youtube.com/embed/tkjFpSVO01c'),
    ('SOUDIERE',           'ALL IN YOUR DREAMS',        'For Tha Haunt (Álbum)', 'https://i.ytimg.com/vi/LkLgVHTwAZg/hqdefault.jpg', 'Maestro de los samples clásicos de Memphis con bajos distorsionados. Esencial.', 'https://www.youtube.com/embed/LkLgVHTwAZg'),
    ('Roland Jones - Topic', 'Money Conver',            'Cosmic Dust EP',   'https://i.ytimg.com/vi/_LnKpei27tY/hqdefault.jpg', 'Atmósferas espaciales combinadas con percusiones secas. Un viaje al Lightside Music.', 'https://www.youtube.com/embed/_LnKpei27tY')
) as v(name, song, album, img, bio, yt_link)
where not exists (select 1 from public.tracks);
