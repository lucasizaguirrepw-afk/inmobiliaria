-- =====================================================================
-- Esquema para el proyecto Supabase de Jessica Roca Propiedades
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query
-- =====================================================================

-- Extensión necesaria para generar IDs únicos
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Tabla: propiedades
-- ---------------------------------------------------------------------
create table if not exists propiedades (
  id                uuid primary key default gen_random_uuid(),
  titulo            text not null,
  operacion         text not null default 'Venta',        -- Venta | Alquiler | Alquiler Temporal
  tipo_propiedad    text not null default 'Casa',          -- Casa | Departamento | Terreno | Local
  precio            numeric not null default 0,
  moneda            text not null default 'USD',           -- USD | ARS
  ambientes         integer default 0,
  banios            integer default 0,
  metros_cuadrados  numeric default 0,
  descripcion       text,
  imagen_principal  text,          -- URL de Cloudinary
  galeria           jsonb,         -- array de URLs de Cloudinary
  mapa_url          text,
  video_url         text,
  activa            boolean not null default true,
  destacada         boolean not null default false,
  created_at        timestamptz not null default now()
);

alter table propiedades enable row level security;

-- Cualquier visitante puede ver las propiedades activas (catálogo público)
create policy "Lectura pública de propiedades activas"
  on propiedades for select
  using (activa = true);

-- El admin logueado (auth) puede ver TODO, incluidas las inactivas
create policy "Lectura total para usuarios logueados"
  on propiedades for select
  using (auth.role() = 'authenticated');

-- Solo un usuario logueado puede crear / editar / borrar propiedades
create policy "Escritura solo para usuarios logueados"
  on propiedades for insert
  with check (auth.role() = 'authenticated');

create policy "Edición solo para usuarios logueados"
  on propiedades for update
  using (auth.role() = 'authenticated');

create policy "Borrado solo para usuarios logueados"
  on propiedades for delete
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- Tabla: consultas (mensajes del formulario de contacto)
-- ---------------------------------------------------------------------
create table if not exists consultas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  email       text not null,
  mensaje     text not null,
  created_at  timestamptz not null default now()
);

alter table consultas enable row level security;

-- Cualquier visitante puede DEJAR una consulta (formulario público)
create policy "Cualquiera puede enviar una consulta"
  on consultas for insert
  with check (true);

-- Solo el admin logueado puede LEER y BORRAR los mensajes
create policy "Lectura de consultas solo para usuarios logueados"
  on consultas for select
  using (auth.role() = 'authenticated');

create policy "Borrado de consultas solo para usuarios logueados"
  on consultas for delete
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- Después de correr esto:
-- 1. Andá a Authentication > Users > Add user y creá el usuario/contraseña
--    con el que Jessi va a entrar a /admin.
-- 2. Copiá Project URL y anon public key desde Project Settings > API
--    y pegalos en las variables PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY.
-- 3. NO hace falta crear ningún bucket de Storage: las imágenes van a Cloudinary.
-- =====================================================================
