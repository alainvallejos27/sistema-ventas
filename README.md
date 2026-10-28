# Moka | Sistema de ventas para cafetería

Aplicación web académica para organizar productos, pedidos y ventas de la cafetería ficticia Moka, en Cochabamba. El inicio de sesión usa Supabase Auth y los perfiles/roles del esquema; los productos, pedidos e inventario de la interfaz siguen siendo datos de demostración en memoria.

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
- JavaScript, HTML y CSS para la interfaz web.
- Supabase Auth para autenticación, PostgreSQL para persistencia, Row-Level Security (RLS) para permisos, Storage para imágenes y Realtime para pedidos. La autenticación está integrada; la persistencia de los módulos de ventas sigue pendiente.
- Git y GitHub para control de versiones.

Flujo propuesto: navegador → rutas → middlewares → controladores → servicios → Supabase/PostgreSQL. El esquema utiliza claves UUID, restricciones, índices, funciones y triggers para proteger precios, calcular totales y controlar transiciones de estado.

## Estructura actual

```text
sistema-ventas/
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
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
├── docker-compose.yml
├── README.md
└── .gitignore
```

## Requisitos

- Node.js LTS y npm.
- Un proyecto Supabase con el esquema aplicado y cuentas de personal creadas en Supabase Auth.

## Ejecutar el backend

Desde la carpeta `backend`:

```bash
Copy-Item .env.example .env
# Configura SUPABASE_URL y SUPABASE_ANON_KEY en .env antes de iniciar sesión.
npm ci
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
| GET | `/api/estado` | Estado del backend en JSON (requiere personal autenticado). |
| POST | `/api/auth/login` | Valida credenciales con Supabase Auth y crea una sesión segura. |
| GET | `/api/auth/session` | Consulta el perfil asociado a la sesión actual. |
| POST | `/api/auth/logout` | Invalida la sesión y elimina sus cookies. |
| GET | `/api/productos` | Catálogo de demostración de Moka (datos estáticos). |
| GET | `/api/productos/:id` | Busca un producto en el catálogo de demostración. |

El catálogo actual es solo de ejemplo y no guarda cambios. La autenticación se conecta a Supabase; pedidos, pagos, reportes e inventario siguen en memoria y no deben usarse como persistencia de producción.

Para ejecutar las pruebas de autenticación y seguridad desde `backend`:

```bash
npm test
```

## Ejecutar con Docker

Se necesita Docker Desktop (o Docker Engine) con Docker Compose v2 en ejecución. Antes de iniciar, copia `backend/.env.example` a `backend/.env` y configura la URL de Supabase y su clave pública `anon`/publishable. Compose carga ese archivo al contenedor en tiempo de ejecución; no se copia dentro de la imagen.

Desde la raíz del repositorio:

```bash
docker compose up --build -d
docker compose ps
```

Abre `http://localhost:3001` para usar la interfaz. La API también está disponible en `http://localhost:3001/api`, y `http://localhost:3001/api/health` devuelve `{"estado":"ok"}` cuando el servidor está disponible. El puerto se publica solo en la interfaz local de la computadora.

Para consultar los registros o detener el contenedor:

```bash
docker compose logs -f backend
docker compose down
```

La imagen usa Node.js 22 Alpine, instala las dependencias de producción con `npm ci`, ejecuta el proceso como el usuario sin privilegios `node`, cierra ordenadamente las conexiones HTTP al detenerse y comprueba su estado mediante `/api/health`. Compose añade un sistema de archivos raíz de solo lectura, elimina capacidades de Linux y desactiva la escalada de privilegios. No publiques el archivo `.env` ni uses una clave `service_role`.

**Límite de la versión actual:** los datos de productos, pedidos e inventario son de demostración y se guardan en memoria del proceso; no hay persistencia conectada. Reiniciar o recrear el contenedor restablece esos datos. La autenticación sí depende de Supabase y necesita conectividad saliente.

## Preparar Supabase

1. Crear un proyecto en Supabase.
2. Abrir **SQL Editor → New query**.
3. Copiar y ejecutar el contenido de [`backend/database/moka_supabase.sql`](backend/database/moka_supabase.sql).
4. En **Authentication → Users**, crear los usuarios internos y asignarles contraseñas seguras.
5. Editar la sección 10 del SQL para asignar los correos y roles reales (`ADMIN`, `MENU_STAFF`, `CASHIER` y `BARISTA`), y ejecutar esas sentencias después de crear los usuarios.
6. Copiar `backend/.env.example` a `backend/.env` y configurar `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los datos del proyecto. La aplicación usa la clave pública `anon`/publishable; nunca necesita la clave `service_role`. Si ya existe una variable `SUPABASE_KEY`, confirma en Supabase que sea la clave pública antes de asignarla a `SUPABASE_ANON_KEY`; no reutilices una clave `service_role`.
7. En producción, servir la aplicación únicamente por HTTPS para que las cookies de sesión lleven el atributo `Secure`.

El script crea sucursal y catálogo inicial, perfiles enlazados a Supabase Auth, variantes de producto, insumos, pedidos, detalles y pagos. También configura roles, políticas RLS, funciones transaccionales, vistas de reportes, buckets de Storage y publicación Realtime. Es un SQL pensado para Supabase, no para ejecutarse en una instalación PostgreSQL genérica.

### Reglas de negocio incluidas en el esquema

- Supabase Auth valida y almacena las contraseñas mediante hash seguro; `usuarios` almacena perfiles, no contraseñas ni hashes.
- Los usuarios nuevos se crean como `CUSTOMER`; el rol y la sucursal se asignan desde administración.
- El backend verifica la sesión y el perfil activo/rol en cada solicitud protegida. Las sesiones usan cookies `HttpOnly`, `SameSite=Strict`, se renuevan con el refresh token y no se guardan en `localStorage`.
- Hay límite de cinco intentos de inicio de sesión por IP observada por el servidor cada 15 minutos, cabeceras de seguridad HTTP y comprobación de origen en solicitudes que modifican datos.
- El backend no usa `service_role`; las políticas RLS de Supabase continúan aplicándose a la consulta del perfil con la sesión del usuario.
- Roles de acceso del personal: `ADMIN`, `MENU_STAFF`, `CASHIER` y `BARISTA`; un perfil inactivo o `CUSTOMER` no puede entrar al punto de venta.
- El precio de cada línea se toma de la variante activa en la base de datos, no del valor enviado por el cliente.
- El total del pedido se recalcula desde sus detalles.
- El pago bloquea el pedido durante el cobro para prevenir doble registro.
- Los cambios de estado se validan contra el flujo permitido.
- RLS separa permisos por rol y sucursal.

La cancelación automática a los 10 minutos requiere habilitar `pg_cron` y activar la sección opcional del script.

## API REST e integraciones pendientes

El login ya está implementado con Supabase Auth. Las operaciones de catálogo, pedidos, pagos, reportes e inventario indicadas aquí usan datos de demostración en memoria y todavía no están conectadas a PostgreSQL:

| Método | Endpoint | Propósito |
| --- | --- | --- |
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

- **Listo:** servidor Express, interfaz de caja de demostración, búsqueda y filtros de menú, carrito, flujo de cobro simulado, esquema SQL Supabase, login real con Supabase Auth, cookies de sesión HttpOnly, renovación/cierre de sesión y autorización HTTP por rol.
- **Pendiente:** persistencia real del catálogo, pedidos, pagos e inventario con Supabase, CI/CD y despliegue en la nube.
- **Docker local:** imagen del backend con su interfaz estática, endpoint de salud y ejecución endurecida mediante Docker Compose; no incluye PostgreSQL porque todavía no existe una conexión activa desde la aplicación.
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
