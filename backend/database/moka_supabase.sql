-- =====================================================================
--  MOKA · Plataforma Web de Ventas para Cafetería
--  Script NATIVO PARA SUPABASE (Auth + RLS + Storage + Realtime)
--  Materia: Tecnología Web II
--
--  Pasos:
--  1) Supabase > SQL Editor > New query > pega este archivo > Run.
--  2) Authentication > Users > Add user (crea admin, cajero, etc.).
--  3) Ejecuta la sección 9 para asignar el rol y la sucursal a cada usuario.
--
--  Diferencia con un esquema tradicional: las contraseñas las gestiona
--  Supabase Auth (almacenadas mediante hash seguro), por eso la tabla "usuarios"
--  es el PERFIL del usuario y se enlaza con auth.users mediante el id.
--  Se puede ejecutar varias veces sin errores.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS
-- ---------------------------------------------------------------------
do $$ begin create type public.rol_usuario     as enum ('ADMIN','MENU_STAFF','CASHIER','BARISTA','CUSTOMER'); exception when duplicate_object then null; end $$;
do $$ begin create type public.tipo_pedido     as enum ('PARA_LLEVAR','EN_MESA');                              exception when duplicate_object then null; end $$;
do $$ begin create type public.estado_pedido   as enum ('PENDIENTE','PAGADO','EN_PREPARACION','LISTO','ENTREGADO','CANCELADO'); exception when duplicate_object then null; end $$;
do $$ begin create type public.metodo_pago     as enum ('EFECTIVO','QR','TARJETA');                            exception when duplicate_object then null; end $$;
do $$ begin create type public.estado_pago     as enum ('PENDIENTE','CONFIRMADO','RECHAZADO');                 exception when duplicate_object then null; end $$;
do $$ begin create type public.tamano_producto as enum ('UNICO','P','M','G');                                   exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. TABLAS
-- ---------------------------------------------------------------------
create table if not exists public.sucursales (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  direccion  text,
  logo_url   text,
  activa     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Perfil del usuario: el id es el MISMO de auth.users
create table if not exists public.usuarios (
  id           uuid primary key references auth.users(id) on delete cascade,
  sucursal_id  uuid references public.sucursales(id) on delete restrict,
  nombre       text not null,
  correo       text not null unique,
  rol          public.rol_usuario not null default 'CUSTOMER',
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  constraint ck_personal_con_sucursal
    check (rol in ('ADMIN','CUSTOMER') or sucursal_id is not null)
);

create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text
);

create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references public.categorias(id) on delete restrict,
  nombre       text not null,
  descripcion  text,
  imagen_url   text,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  unique (categoria_id, nombre)
);

create table if not exists public.variantes_producto (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  tamano      public.tamano_producto not null default 'UNICO',
  precio      numeric(10,2) not null check (precio >= 0),
  activo      boolean not null default true,
  unique (producto_id, tamano)
);

create table if not exists public.insumos (
  id              uuid primary key default gen_random_uuid(),
  sucursal_id     uuid not null references public.sucursales(id) on delete cascade,
  nombre          text not null,
  unidad          text not null default 'unidad',
  stock           numeric(12,3) not null default 0 check (stock >= 0),
  stock_minimo    numeric(12,3) not null default 0 check (stock_minimo >= 0),
  actualizado_en  timestamptz not null default now(),
  unique (sucursal_id, nombre)
);

create table if not exists public.pedidos (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete restrict,
  usuario_id  uuid references public.usuarios(id) on delete set null,
  tipo        public.tipo_pedido   not null default 'PARA_LLEVAR',
  estado      public.estado_pedido not null default 'PENDIENTE',
  total       numeric(10,2) not null default 0 check (total >= 0),
  fecha       timestamptz not null default now()
);

create table if not exists public.detalle_pedido (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos(id) on delete cascade,
  variante_id     uuid not null references public.variantes_producto(id) on delete restrict,
  cantidad        integer not null check (cantidad > 0),
  precio_unitario numeric(10,2) not null default 0 check (precio_unitario >= 0),
  subtotal        numeric(10,2) generated always as (cantidad * precio_unitario) stored
);

create table if not exists public.pagos (
  id        uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  metodo    public.metodo_pago not null,
  monto     numeric(10,2) not null check (monto > 0),
  estado    public.estado_pago not null default 'PENDIENTE',
  fecha     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. ÍNDICES
-- ---------------------------------------------------------------------
create index if not exists idx_usuarios_sucursal   on public.usuarios(sucursal_id);
create index if not exists idx_productos_categoria on public.productos(categoria_id);
create index if not exists idx_variantes_producto  on public.variantes_producto(producto_id);
create index if not exists idx_insumos_sucursal    on public.insumos(sucursal_id);
create index if not exists idx_pedidos_sucursal    on public.pedidos(sucursal_id, estado, fecha);
create index if not exists idx_pedidos_usuario     on public.pedidos(usuario_id);
create index if not exists idx_detalle_pedido      on public.detalle_pedido(pedido_id);
create index if not exists idx_pagos_pedido        on public.pagos(pedido_id);

-- ---------------------------------------------------------------------
-- 4. FUNCIONES AUXILIARES DE SEGURIDAD
--    SECURITY DEFINER evita la recursión de RLS al consultar "usuarios".
-- ---------------------------------------------------------------------
create or replace function public.app_rol() returns public.rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from public.usuarios where id = auth.uid() and activo
$$;

create or replace function public.app_sucursal() returns uuid
language sql stable security definer set search_path = public as $$
  select sucursal_id from public.usuarios where id = auth.uid() and activo
$$;

-- ¿Es el backend (service_role) o un usuario con uno de estos roles?
create or replace function public.es_staff(roles public.rol_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_rol() = any(roles), false)
$$;

-- ---------------------------------------------------------------------
-- 5. TRIGGERS Y LÓGICA TRANSACCIONAL
-- ---------------------------------------------------------------------

-- 5.1 Al registrarse en Supabase Auth se crea el perfil (siempre como CUSTOMER)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, nombre, correo, rol)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
          new.email,
          'CUSTOMER')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5.2 Nadie (salvo ADMIN o el backend) puede cambiar su propio rol o sucursal
create or replace function public.proteger_rol() returns trigger
language plpgsql as $$
begin
  if (new.rol is distinct from old.rol or new.sucursal_id is distinct from old.sucursal_id)
     and coalesce(public.app_rol() <> 'ADMIN', true)
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Solo un administrador puede cambiar el rol o la sucursal';
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_rol on public.usuarios;
create trigger trg_proteger_rol
before update on public.usuarios
for each row execute function public.proteger_rol();

-- 5.3 El precio SIEMPRE se toma de la variante (el cliente no puede manipularlo)
create or replace function public.fn_precio_desde_variante() returns trigger
language plpgsql as $$
begin
  select precio into new.precio_unitario
    from public.variantes_producto where id = new.variante_id and activo;
  if new.precio_unitario is null then
    raise exception 'La variante no existe o no está activa';
  end if;
  return new;
end $$;

drop trigger if exists trg_precio_variante on public.detalle_pedido;
create trigger trg_precio_variante
before insert or update of variante_id on public.detalle_pedido
for each row execute function public.fn_precio_desde_variante();

-- 5.4 El total del pedido nace en 0 y solo lo calcula el detalle
create or replace function public.fn_pedido_total_cero() returns trigger
language plpgsql as $$
begin
  new.total  := 0;
  new.fecha  := now();
  return new;
end $$;

drop trigger if exists trg_pedido_total_cero on public.pedidos;
create trigger trg_pedido_total_cero
before insert on public.pedidos
for each row execute function public.fn_pedido_total_cero();

create or replace function public.fn_recalcular_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pedido uuid := coalesce(new.pedido_id, old.pedido_id);
begin
  update public.pedidos
     set total = coalesce((select sum(subtotal) from public.detalle_pedido where pedido_id = v_pedido), 0)
   where id = v_pedido;
  return null;
end $$;

drop trigger if exists trg_recalcular_total on public.detalle_pedido;
create trigger trg_recalcular_total
after insert or update or delete on public.detalle_pedido
for each row execute function public.fn_recalcular_total();

-- 5.5 Fecha de actualización de insumos
create or replace function public.fn_touch_insumo() returns trigger
language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;

drop trigger if exists trg_touch_insumo on public.insumos;
create trigger trg_touch_insumo
before update on public.insumos
for each row execute function public.fn_touch_insumo();

-- 5.6 Registrar pago + pasar el pedido a PAGADO (una sola transacción)
--     Solo caja/administración o el backend (service_role, por ejemplo
--     al recibir el webhook de la pasarela de pagos QR).
create or replace function public.registrar_pago(p_pedido uuid, p_metodo public.metodo_pago)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric(10,2);
  v_pago  uuid;
begin
  if not (public.es_staff(array['ADMIN','CASHIER']::public.rol_usuario[])
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'No autorizado para registrar pagos';
  end if;

  select total into v_total from public.pedidos
   where id = p_pedido and estado = 'PENDIENTE'
   for update;                                     -- evita doble cobro

  if v_total is null then raise exception 'El pedido no existe o ya no está pendiente de pago'; end if;
  if v_total <= 0   then raise exception 'El pedido no tiene productos'; end if;

  insert into public.pagos (pedido_id, metodo, monto, estado)
  values (p_pedido, p_metodo, v_total, 'CONFIRMADO')
  returning id into v_pago;

  update public.pedidos set estado = 'PAGADO' where id = p_pedido;
  return v_pago;
end $$;

-- Crea el pedido y sus detalles en una sola transacción.
create or replace function public.crear_pedido(p_items jsonb, p_tipo public.tipo_pedido default 'PARA_LLEVAR')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pedido uuid;
  v_sucursal uuid;
  v_item jsonb;
  v_variante uuid;
  v_cantidad integer;
begin
  if not coalesce(public.app_rol() in ('ADMIN','CASHIER'), false) then
    raise exception 'No autorizado para crear pedidos';
  end if;
  if p_tipo not in ('PARA_LLEVAR','EN_MESA') then
    raise exception 'Tipo de pedido no válido';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los productos del pedido deben enviarse como una lista';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'El pedido debe incluir entre 1 y 50 productos';
  end if;

  v_sucursal := public.app_sucursal();
  if v_sucursal is null and public.app_rol() = 'ADMIN' then
    select id into v_sucursal from public.sucursales where activa order by nombre limit 1;
  end if;
  if v_sucursal is null then raise exception 'El perfil no tiene sucursal asignada'; end if;

  insert into public.pedidos (sucursal_id, usuario_id, tipo, estado)
  values (v_sucursal, auth.uid(), p_tipo, 'PENDIENTE')
  returning id into v_pedido;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_variante := (v_item ->> 'varianteId')::uuid;
    v_cantidad := (v_item ->> 'cantidad')::integer;
    if v_cantidad is null or v_cantidad < 1 or v_cantidad > 99 then
      raise exception 'La cantidad de cada producto debe estar entre 1 y 99';
    end if;
    if not exists (
      select 1 from public.variantes_producto v
      join public.productos p on p.id = v.producto_id
      where v.id = v_variante and v.activo and p.activo
    ) then
      raise exception 'Una variante no existe o no está activa';
    end if;

    insert into public.detalle_pedido (pedido_id, variante_id, cantidad)
    values (v_pedido, v_variante, v_cantidad);
  end loop;

  return v_pedido;
end $$;

-- Una sola operación para que el pedido y el pago se confirmen juntos.
create or replace function public.crear_pedido_y_cobrar(
  p_items jsonb,
  p_metodo public.metodo_pago,
  p_tipo public.tipo_pedido default 'PARA_LLEVAR'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pedido uuid;
  v_pago uuid;
begin
  if p_metodo not in ('EFECTIVO','QR','TARJETA') then
    raise exception 'Método de pago no válido';
  end if;

  v_pedido := public.crear_pedido(p_items, p_tipo);
  v_pago := public.registrar_pago(v_pedido, p_metodo);
  return jsonb_build_object('pedido_id', v_pedido, 'pago_id', v_pago);
end $$;

-- 5.7 Cambiar estado respetando el flujo (barra / caja / admin)
create or replace function public.cambiar_estado_pedido(p_pedido uuid, p_nuevo public.estado_pedido)
returns void
language plpgsql security definer set search_path = public as $$
declare v_actual public.estado_pedido; v_suc uuid;
begin
  select estado, sucursal_id into v_actual, v_suc from public.pedidos where id = p_pedido for update;
  if v_actual is null then raise exception 'Pedido no encontrado'; end if;

  if not (
       coalesce(auth.role() = 'service_role', false)
    or coalesce(public.app_rol() = 'ADMIN', false)
    or (coalesce(public.app_rol() in ('CASHIER','BARISTA'), false) and public.app_sucursal() = v_suc)
  ) then
    raise exception 'No autorizado para cambiar el estado de este pedido';
  end if;

  if not (
       (v_actual = 'PAGADO'         and p_nuevo = 'EN_PREPARACION')
    or (v_actual = 'EN_PREPARACION' and p_nuevo = 'LISTO')
    or (v_actual = 'LISTO'          and p_nuevo = 'ENTREGADO')
    or (v_actual in ('PENDIENTE','PAGADO') and p_nuevo = 'CANCELADO')
  ) then
    raise exception 'Transición no permitida: % -> %', v_actual, p_nuevo;
  end if;

  update public.pedidos set estado = p_nuevo where id = p_pedido;
end $$;

-- 5.8 Cancelar pedidos sin pago pasados 10 minutos (HU-09)
create or replace function public.cancelar_pedidos_sin_pago() returns integer
language plpgsql security definer set search_path = public as $$
declare v_filas integer;
begin
  update public.pedidos set estado = 'CANCELADO'
   where estado = 'PENDIENTE' and fecha < now() - interval '10 minutes';
  get diagnostics v_filas = row_count;
  return v_filas;
end $$;
revoke execute on function public.cancelar_pedidos_sin_pago() from public, anon, authenticated;

-- 5.9 Registrar compra de insumos (incrementa stock)
create or replace function public.registrar_compra_insumo(p_insumo uuid, p_cantidad numeric)
returns void
language plpgsql as $$
begin
  if p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if not coalesce(public.app_rol() in ('ADMIN','MENU_STAFF'), false) then
    raise exception 'No autorizado para registrar compras de insumos';
  end if;
  update public.insumos set stock = stock + p_cantidad where id = p_insumo;
  if not found then raise exception 'Insumo no encontrado o fuera de la sucursal'; end if;
end $$;

-- Permisos SQL además de las políticas RLS.
grant usage on schema public to anon, authenticated;
grant usage on type public.rol_usuario, public.tipo_pedido, public.estado_pedido, public.metodo_pago to authenticated;
grant usage on type public.tamano_producto to anon, authenticated;
grant select on public.sucursales to authenticated;
grant select on public.usuarios to authenticated;
grant select on public.categorias, public.productos, public.variantes_producto to anon, authenticated;
grant select, insert, update, delete on public.categorias, public.productos, public.variantes_producto, public.insumos to authenticated;
grant select on public.pedidos, public.detalle_pedido, public.pagos to authenticated;
grant insert on public.pedidos, public.detalle_pedido to authenticated;
revoke all on function public.crear_pedido(jsonb, public.tipo_pedido) from public, anon;
revoke all on function public.crear_pedido_y_cobrar(jsonb, public.metodo_pago, public.tipo_pedido) from public, anon;
revoke all on function public.registrar_pago(uuid, public.metodo_pago) from public, anon;
revoke all on function public.cambiar_estado_pedido(uuid, public.estado_pedido) from public, anon;
revoke all on function public.registrar_compra_insumo(uuid, numeric) from public, anon;
grant execute on function public.crear_pedido(jsonb, public.tipo_pedido) to authenticated;
grant execute on function public.crear_pedido_y_cobrar(jsonb, public.metodo_pago, public.tipo_pedido) to authenticated;
grant execute on function public.registrar_pago(uuid, public.metodo_pago) to authenticated;
grant execute on function public.cambiar_estado_pedido(uuid, public.estado_pedido) to authenticated;
grant execute on function public.registrar_compra_insumo(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 6. VISTAS (security_invoker: respetan RLS del usuario que consulta)
-- ---------------------------------------------------------------------
create or replace view public.vw_insumos_stock_bajo with (security_invoker = true) as
select i.id, i.sucursal_id, i.nombre, i.unidad, i.stock, i.stock_minimo
  from public.insumos i where i.stock <= i.stock_minimo;

create or replace view public.vw_ventas_diarias with (security_invoker = true) as
select p.sucursal_id, date_trunc('day', p.fecha)::date as dia,
       count(*) as pedidos, sum(p.total) as total_vendido
  from public.pedidos p
 where p.estado in ('PAGADO','EN_PREPARACION','LISTO','ENTREGADO')
 group by p.sucursal_id, date_trunc('day', p.fecha);

create or replace view public.vw_productos_mas_vendidos with (security_invoker = true) as
select p.sucursal_id, pr.id as producto_id, pr.nombre as producto,
       sum(d.cantidad) as unidades, sum(d.subtotal) as ingresos
  from public.detalle_pedido d
  join public.pedidos p            on p.id  = d.pedido_id
  join public.variantes_producto v on v.id  = d.variante_id
  join public.productos pr         on pr.id = v.producto_id
 where p.estado in ('PAGADO','EN_PREPARACION','LISTO','ENTREGADO')
 group by p.sucursal_id, pr.id, pr.nombre;

grant select on public.vw_insumos_stock_bajo, public.vw_ventas_diarias, public.vw_productos_mas_vendidos to authenticated;

-- ---------------------------------------------------------------------
-- 7. ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.sucursales         enable row level security;
alter table public.usuarios           enable row level security;
alter table public.categorias         enable row level security;
alter table public.productos          enable row level security;
alter table public.variantes_producto enable row level security;
alter table public.insumos            enable row level security;
alter table public.pedidos            enable row level security;
alter table public.detalle_pedido     enable row level security;
alter table public.pagos              enable row level security;

-- Sucursales: públicas si están activas; ADMIN gestiona
drop policy if exists p_suc_select on public.sucursales;
create policy p_suc_select on public.sucursales for select
  using (activa or public.app_rol() = 'ADMIN');
drop policy if exists p_suc_admin on public.sucursales;
create policy p_suc_admin on public.sucursales for all to authenticated
  using (public.app_rol() = 'ADMIN') with check (public.app_rol() = 'ADMIN');

-- Usuarios: cada uno ve y edita su perfil; el personal ve a su sucursal; ADMIN todo
drop policy if exists p_usr_select on public.usuarios;
create policy p_usr_select on public.usuarios for select to authenticated
  using (id = auth.uid()
         or public.app_rol() = 'ADMIN'
         or (public.app_rol() in ('MENU_STAFF','CASHIER','BARISTA') and sucursal_id = public.app_sucursal()));
drop policy if exists p_usr_update_self on public.usuarios;
create policy p_usr_update_self on public.usuarios for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists p_usr_admin on public.usuarios;
create policy p_usr_admin on public.usuarios for all to authenticated
  using (public.app_rol() = 'ADMIN') with check (public.app_rol() = 'ADMIN');

-- Menú: lectura pública; escritura ADMIN y MENU_STAFF
drop policy if exists p_cat_select on public.categorias;
create policy p_cat_select on public.categorias for select using (true);
drop policy if exists p_cat_write on public.categorias;
create policy p_cat_write on public.categorias for all to authenticated
  using (public.app_rol() in ('ADMIN','MENU_STAFF')) with check (public.app_rol() in ('ADMIN','MENU_STAFF'));

drop policy if exists p_prod_select on public.productos;
create policy p_prod_select on public.productos for select
  using (activo or public.app_rol() in ('ADMIN','MENU_STAFF'));
drop policy if exists p_prod_write on public.productos;
create policy p_prod_write on public.productos for all to authenticated
  using (public.app_rol() in ('ADMIN','MENU_STAFF')) with check (public.app_rol() in ('ADMIN','MENU_STAFF'));

drop policy if exists p_var_select on public.variantes_producto;
create policy p_var_select on public.variantes_producto for select
  using (activo or public.app_rol() in ('ADMIN','MENU_STAFF'));
drop policy if exists p_var_write on public.variantes_producto;
create policy p_var_write on public.variantes_producto for all to authenticated
  using (public.app_rol() in ('ADMIN','MENU_STAFF')) with check (public.app_rol() in ('ADMIN','MENU_STAFF'));

-- Insumos: ADMIN y MENU_STAFF de su sucursal
drop policy if exists p_ins_all on public.insumos;
create policy p_ins_all on public.insumos for all to authenticated
  using (public.app_rol() = 'ADMIN' or (public.app_rol() = 'MENU_STAFF' and sucursal_id = public.app_sucursal()))
  with check (public.app_rol() = 'ADMIN' or (public.app_rol() = 'MENU_STAFF' and sucursal_id = public.app_sucursal()));

-- Pedidos
drop policy if exists p_ped_select on public.pedidos;
create policy p_ped_select on public.pedidos for select to authenticated
  using (public.app_rol() = 'ADMIN'
         or (public.app_rol() in ('CASHIER','BARISTA','MENU_STAFF') and sucursal_id = public.app_sucursal())
         or usuario_id = auth.uid());

drop policy if exists p_ped_insert on public.pedidos;
create policy p_ped_insert on public.pedidos for insert to authenticated
  with check (estado = 'PENDIENTE'
              and (public.app_rol() = 'ADMIN'
                   or (public.app_rol() = 'CASHIER' and sucursal_id = public.app_sucursal())
                   or (usuario_id = auth.uid() and public.app_rol() = 'CUSTOMER')));

-- El estado se cambia con las funciones (registrar_pago / cambiar_estado_pedido)
drop policy if exists p_ped_update on public.pedidos;
create policy p_ped_update on public.pedidos for update to authenticated
  using (public.app_rol() = 'ADMIN') with check (public.app_rol() = 'ADMIN');

-- Detalle: se ve lo que se ve del pedido; se edita solo mientras esté PENDIENTE
drop policy if exists p_det_select on public.detalle_pedido;
create policy p_det_select on public.detalle_pedido for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id));

drop policy if exists p_det_insert on public.detalle_pedido;
create policy p_det_insert on public.detalle_pedido for insert to authenticated
  with check (exists (select 1 from public.pedidos p
                       where p.id = pedido_id and p.estado = 'PENDIENTE'
                         and (public.app_rol() in ('ADMIN','CASHIER') or p.usuario_id = auth.uid())));

drop policy if exists p_det_update on public.detalle_pedido;
create policy p_det_update on public.detalle_pedido for update to authenticated
  using (exists (select 1 from public.pedidos p
                  where p.id = pedido_id and p.estado = 'PENDIENTE'
                    and (public.app_rol() in ('ADMIN','CASHIER') or p.usuario_id = auth.uid())))
  with check (true);

drop policy if exists p_det_delete on public.detalle_pedido;
create policy p_det_delete on public.detalle_pedido for delete to authenticated
  using (exists (select 1 from public.pedidos p
                  where p.id = pedido_id and p.estado = 'PENDIENTE'
                    and (public.app_rol() in ('ADMIN','CASHIER') or p.usuario_id = auth.uid())));

-- Pagos: solo lectura para quien ve el pedido (el cobro lo hace registrar_pago)
drop policy if exists p_pag_select on public.pagos;
create policy p_pag_select on public.pagos for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id));

-- ---------------------------------------------------------------------
-- 8. STORAGE (imágenes de productos y logos) + REALTIME
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('productos', 'productos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('logos',     'logos',     true) on conflict (id) do nothing;

drop policy if exists "moka_img_lectura" on storage.objects;
create policy "moka_img_lectura" on storage.objects for select
  using (bucket_id in ('productos','logos'));

drop policy if exists "moka_img_insert" on storage.objects;
create policy "moka_img_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('productos','logos') and public.app_rol() in ('ADMIN','MENU_STAFF'));

drop policy if exists "moka_img_update" on storage.objects;
create policy "moka_img_update" on storage.objects for update to authenticated
  using (bucket_id in ('productos','logos') and public.app_rol() in ('ADMIN','MENU_STAFF'));

drop policy if exists "moka_img_delete" on storage.objects;
create policy "moka_img_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('productos','logos') and public.app_rol() in ('ADMIN','MENU_STAFF'));

-- Realtime: la pantalla de barra recibe los pedidos en vivo
do $$ begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------
-- 9. DATOS INICIALES
-- ---------------------------------------------------------------------
insert into public.sucursales (id, nombre, direccion)
values ('00000000-0000-0000-0000-000000000001', 'Moka Central', 'Av. Heroínas, Cochabamba')
on conflict (id) do nothing;

insert into public.categorias (nombre, descripcion) values
  ('Cafés',      'Bebidas calientes y frías a base de café'),
  ('Postres',    'Repostería y dulces'),
  ('Sándwiches', 'Opciones saladas')
on conflict (nombre) do nothing;

insert into public.productos (categoria_id, nombre, descripcion)
select c.id, x.nombre, x.descripcion
  from (values
    ('Cafés',   'Espresso',  'Café corto e intenso'),
    ('Cafés',   'Capuchino', 'Espresso con leche vaporizada y espuma'),
    ('Cafés',   'Latte',     'Espresso con abundante leche'),
    ('Postres', 'Brownie',   'Brownie de chocolate')
  ) as x(categoria, nombre, descripcion)
  join public.categorias c on c.nombre = x.categoria
on conflict (categoria_id, nombre) do nothing;

insert into public.variantes_producto (producto_id, tamano, precio)
select p.id, x.tamano::public.tamano_producto, x.precio
  from (values
    ('Espresso','P',10), ('Espresso','M',12), ('Espresso','G',14),
    ('Capuchino','P',15), ('Capuchino','M',17), ('Capuchino','G',19),
    ('Latte','P',16), ('Latte','M',18), ('Latte','G',20),
    ('Brownie','UNICO',12)
  ) as x(producto, tamano, precio)
  join public.productos p on p.nombre = x.producto
on conflict (producto_id, tamano) do nothing;

insert into public.insumos (sucursal_id, nombre, unidad, stock, stock_minimo) values
  ('00000000-0000-0000-0000-000000000001', 'Café en grano', 'kg',    20, 5),
  ('00000000-0000-0000-0000-000000000001', 'Leche',         'litro', 40, 10),
  ('00000000-0000-0000-0000-000000000001', 'Azúcar',        'kg',    15, 3),
  ('00000000-0000-0000-0000-000000000001', 'Chocolate',     'kg',     8, 2)
on conflict (sucursal_id, nombre) do nothing;

-- ---------------------------------------------------------------------
-- 10. ASIGNAR ROLES (ejecutar DESPUÉS de crear los usuarios en
--     Authentication > Users). Quita los "--" y cambia los correos.
-- ---------------------------------------------------------------------
-- update public.usuarios set rol = 'ADMIN'                                         where correo = 'admin@moka.com';
-- update public.usuarios set rol = 'MENU_STAFF', sucursal_id = '00000000-0000-0000-0000-000000000001' where correo = 'menu@moka.com';
-- update public.usuarios set rol = 'CASHIER',    sucursal_id = '00000000-0000-0000-0000-000000000001' where correo = 'cajero@moka.com';
-- update public.usuarios set rol = 'BARISTA',    sucursal_id = '00000000-0000-0000-0000-000000000001' where correo = 'barista@moka.com';

-- ---------------------------------------------------------------------
-- 11. (OPCIONAL) CANCELACIÓN AUTOMÁTICA CADA MINUTO CON pg_cron
--     Activa antes la extensión en Database > Extensions > pg_cron.
-- ---------------------------------------------------------------------
-- select cron.schedule('moka-cancelar-pedidos', '* * * * *',
--                      $$ select public.cancelar_pedidos_sin_pago(); $$);

-- ---------------------------------------------------------------------
-- 12. EJEMPLOS DE USO DESDE EL FRONTEND (supabase-js)
-- ---------------------------------------------------------------------
-- Menú público:
--   const { data } = await supabase.from('productos')
--       .select('id,nombre,imagen_url,variantes_producto(tamano,precio)')
--   // Cobro desde caja:
--   await supabase.rpc('registrar_pago', { p_pedido: pedidoId, p_metodo: 'EFECTIVO' })
--   // Barra marca pedido listo:
--   await supabase.rpc('cambiar_estado_pedido', { p_pedido: pedidoId, p_nuevo: 'LISTO' })
--   // Barra en vivo:
--   supabase.channel('barra').on('postgres_changes',
--       { event: '*', schema: 'public', table: 'pedidos' }, payload => {...}).subscribe()
