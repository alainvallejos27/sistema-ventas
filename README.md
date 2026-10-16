# Moka | Sistema de ventas para cafetería

Aplicación web académica para organizar productos, pedidos y ventas de la cafetería ficticia Moka, en Cochabamba. Este repositorio está en desarrollo: el backend ofrece rutas iniciales y un catálogo de demostración; el esquema de datos de Supabase ya está preparado, pero aún no existe conexión activa desde la aplicación.

## Objetivo

Reemplazar registros manuales de caja y pedidos por una herramienta web que permita mantener el menú, tomar pedidos, gestionar su preparación, registrar pagos y consultar reportes. La aplicación está pensada para computadora, tableta y celular.

## Usuarios

| Actor | Uso previsto |
| --- | --- |
| Administrador | Gestionar catálogo, personal y reportes. |
| Cajero | Crear pedidos y registrar pagos. |
| Barista | Consultar pedidos y avanzar su estado de preparación. |
| Cliente | Consultar el menú y, en una etapa posterior, realizar pedidos. |
| Personal de menú | Mantener categorías, productos e imágenes. |

## Funcionalidades del documento

- Inicio de sesión y autorización por roles.
- Gestión de categorías, productos, variantes y precios.
- Creación de pedidos y cálculo de subtotales y total.
- Registro de pagos en efectivo, QR o tarjeta.
- Flujo de preparación: pendiente, pagado, en preparación, listo, entregado o cancelado.
- Gestión de clientes e inventario de insumos con alertas de stock bajo.
- Reportes de ventas diarias y productos más vendidos.
- Menú público y actualizaciones de pedidos en tiempo real.

Las funciones de esta lista describen el alcance esperado; no todas están implementadas todavía. El estado comprobable se detalla en **Estado del proyecto**.

## Tecnologías y arquitectura

- Node.js y Express para el servidor HTTP y la API REST.
- JavaScript, HTML y CSS para la aplicación web (frontend pendiente).
- Supabase Auth para autenticación, PostgreSQL para persistencia, Row-Level Security (RLS) para permisos, Storage para imágenes y Realtime para pedidos (integración pendiente).
- Git y GitHub para control de versiones.

Flujo propuesto: navegador → rutas → middlewares → controladores → servicios → Supabase/PostgreSQL. El esquema utiliza claves UUID, restricciones, índices, funciones y triggers para proteger precios, calcular totales y controlar transiciones de estado.

## Estructura actual

```text
sistema-ventas/
├── backend/
│   ├── database/
│   │   └── moka_supabase.sql
│   ├── public/
│   │   ├── app.js
│   │   ├── index.html
│   │   └── styles.css
│   ├── routes/
│   │   └── apiRoutes.js
│   ├── package-lock.json
│   ├── package.json
│   └── server.js
├── README.md
└── .gitignore
```

## Requisitos

- Node.js LTS y npm.
- Una cuenta/proyecto Supabase para habilitar la base de datos cuando se implemente la conexión.

## Ejecutar el backend

Desde la carpeta `backend`:

```bash
npm install
npm start
```

El servidor escucha por defecto en `http://localhost:3001`. Se puede cambiar el puerto definiendo la variable de entorno `PORT`.

Rutas base disponibles:

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | `/` | Interfaz web del punto de venta. |
| GET | `/info` | Descripción de Moka. |
| GET | `/contacto` | Contacto ficticio del sistema. |
| GET | `/productos` | Descripción del módulo de productos. |
| GET | `/api` | Nombre, versión y estado de la API en JSON. |
| GET | `/api/estado` | Estado del backend en JSON. |
| GET | `/api/productos` | Catálogo de demostración de Moka (datos estáticos). |
| GET | `/api/productos/:id` | Busca un producto en el catálogo de demostración. |

El catálogo actual es solo de ejemplo y no guarda cambios. Los endpoints previstos para autenticación, pedidos, pagos, reportes y operaciones CRUD dependerán de la integración de Supabase.

## Preparar Supabase

1. Crear un proyecto en Supabase.
2. Abrir **SQL Editor → New query**.
3. Copiar y ejecutar el contenido de [`backend/database/moka_supabase.sql`](backend/database/moka_supabase.sql).
4. En **Authentication → Users**, crear los usuarios internos.
5. Editar la sección 10 del SQL para asignar los correos y roles reales (`ADMIN`, `MENU_STAFF`, `CASHIER` y `BARISTA`), y ejecutar esas sentencias después de crear los usuarios.
6. No publicar claves `service_role` en el frontend ni subir secretos al repositorio. La conexión de la aplicación y sus credenciales todavía deben configurarse.

El script crea sucursal y catálogo inicial, perfiles enlazados a Supabase Auth, variantes de producto, insumos, pedidos, detalles y pagos. También configura roles, políticas RLS, funciones transaccionales, vistas de reportes, buckets de Storage y publicación Realtime. Es un SQL pensado para Supabase, no para ejecutarse en una instalación PostgreSQL genérica.

### Reglas de negocio incluidas en el esquema

- Las contraseñas son responsabilidad de Supabase Auth; `usuarios` almacena perfiles, no hashes.
- Los usuarios nuevos se crean como `CUSTOMER`; el rol y la sucursal se asignan desde administración.
- El precio de cada línea se toma de la variante activa en la base de datos, no del valor enviado por el cliente.
- El total del pedido se recalcula desde sus detalles.
- El pago bloquea el pedido durante el cobro para prevenir doble registro.
- Los cambios de estado se validan contra el flujo permitido.
- RLS separa permisos por rol y sucursal.

La cancelación automática a los 10 minutos requiere habilitar `pg_cron` y activar la sección opcional del script.

## API REST prevista

Los endpoints siguientes están definidos en el documento de solución, pero aún no deben considerarse implementados:

| Método | Endpoint | Propósito |
| --- | --- | --- |
| POST | `/api/auth/login` | Iniciar sesión. |
| GET, POST | `/api/productos` | Listar y crear productos. |
| GET, PUT, DELETE | `/api/productos/:id` | Consultar, actualizar o desactivar un producto. |
| GET | `/api/categorias` | Listar categorías. |
| POST, GET | `/api/pedidos` | Crear y consultar pedidos. |
| PATCH | `/api/pedidos/:id/estado` | Cambiar el estado del pedido. |
| POST | `/api/ventas` | Registrar un pago/venta. |
| GET | `/api/reportes/ventas-dia` | Consultar ventas diarias. |
| GET | `/api/reportes/mas-vendidos` | Consultar productos más vendidos. |

El esquema también contiene `registrar_pago` y `cambiar_estado_pedido` como funciones RPC para realizar operaciones protegidas dentro de la base de datos.

## Estado del proyecto

- **Listo:** servidor Express, interfaz de caja de demostración, búsqueda y filtros de menú, carrito, flujo de cobro simulado, rutas introductorias, catálogo estático de ejemplo y esquema SQL Supabase versionado.
- **Pendiente:** conexión backend/frontend con Supabase, autenticación de la aplicación, autorización HTTP, persistencia real del catálogo, endpoints REST de pedidos y pagos, interfaz de caja/barra/administración, pruebas y despliegue.
- **No incluido aún:** clientes asociados a pedidos y descuento automático de insumos por venta. El SQL entregado contiene insumos y compras, pero no una receta producto-insumo ni una función de consumo.

## Requerimientos de calidad

- Respuestas JSON con códigos HTTP apropiados en la API.
- Rutas administrativas protegidas por autenticación y rol.
- Variables sensibles fuera del repositorio.
- Interfaz responsiva y código organizado por responsabilidades.
- Objetivo de respuesta menor a dos segundos en condiciones normales.

## Registro de cambios

- Se incorporó `backend/database/moka_supabase.sql` con el esquema compartido para Supabase; se verificó que la copia coincide con el archivo original.
- Se amplió este README con el alcance de la solución, actores, arquitectura, instrucciones SQL, rutas disponibles y pendientes reales.
- Se alineó el puerto documentado con el servidor (`3001`) y se contextualizó el catálogo de demostración a Moka.
- Se agregó una interfaz de punto de venta servida desde `/`, con estilos adaptables a móvil y tablet, búsqueda, filtros, cantidades y confirmación de cobro local.

## Información académica

- Materia: Tecnología Web II.
- Estudiante: Alain Vallejos Maire.
- Docente: Vladimir Wilmar Rojas Condor.
- Ubicación: Cochabamba, Bolivia.
