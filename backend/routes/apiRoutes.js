const express = require("express");
const router = express.Router();
const { authenticate, checkSameOrigin, requireRoles } = require("../middleware/auth");

router.use((req, res, next) => {
    const publicRead = req.method === "GET" && (
        ["/", "/health", "/categorias", "/productos"].includes(req.path)
        || /^\/productos\/[^/]+$/.test(req.path)
    );
    if (publicRead) return next();

    let roles = ["ADMIN"];
    if (req.path.startsWith("/categorias") || req.path.startsWith("/productos") || req.path.startsWith("/insumos")) {
        roles = ["ADMIN", "MENU_STAFF"];
    } else if (req.path === "/pedidos" && req.method === "GET") {
        roles = ["ADMIN", "MENU_STAFF", "CASHIER", "BARISTA"];
    } else if (req.path === "/pedidos" && req.method === "POST") {
        roles = ["ADMIN", "CASHIER"];
    } else if (req.path.startsWith("/pedidos/") && req.method === "PATCH") {
        roles = ["ADMIN", "CASHIER", "BARISTA"];
    } else if (req.path.startsWith("/ventas") || req.path.startsWith("/reportes")) {
        roles = ["ADMIN", "CASHIER"];
    }

    return checkSameOrigin(req, res, () => authenticate(req, res, () => requireRoles(roles)(req, res, next)));
});

router.use(require("./supabaseRoutes"));

const productos = [
    {
        id: 1,
        nombre: "Espresso",
        precio: 10,
        categoria: "Cafés",
        stock: 50,
        descripcion: "Corto, intenso y recién molido.",
        imagen: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=700&q=80",
        activo: true
    },
    {
        id: 2,
        nombre: "Capuchino",
        precio: 15,
        categoria: "Cafés",
        stock: 40,
        descripcion: "Espresso, leche y espuma suave.",
        imagen: "https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=700&q=80",
        activo: true
    },
    {
        id: 3,
        nombre: "Latte",
        precio: 16,
        categoria: "Cafés",
        stock: 35,
        descripcion: "Leche cremosa y un doble espresso.",
        imagen: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=700&q=80",
        activo: true
    },
    {
        id: 4,
        nombre: "Cold brew",
        precio: 18,
        categoria: "Cafés",
        stock: 25,
        descripcion: "Extracción lenta, servido bien frío.",
        imagen: "https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=700&q=80",
        activo: true
    },
    {
        id: 5,
        nombre: "Brownie",
        precio: 12,
        categoria: "Postres",
        stock: 20,
        descripcion: "Chocolate oscuro, centro húmedo.",
        imagen: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=700&q=80",
        activo: true
    },
    {
        id: 6,
        nombre: "Croissant",
        precio: 14,
        categoria: "Postres",
        stock: 18,
        descripcion: "Hojaldre dorado, hecho esta mañana.",
        imagen: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=700&q=80",
        activo: true
    },
    {
        id: 7,
        nombre: "Sándwich de la casa",
        precio: 24,
        categoria: "Sándwiches",
        stock: 12,
        descripcion: "Pan tostado, queso y vegetales frescos.",
        imagen: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=700&q=80",
        activo: true
    }
];

const pedidos = [];
const ventas = [];
const categorias = [
    { nombre: "Cafés", descripcion: "Bebidas a base de café" },
    { nombre: "Postres", descripcion: "Dulces y repostería" },
    { nombre: "Sándwiches", descripcion: "Opciones saladas" }
];
const insumos = [
    { id: 1, nombre: "Cafe en grano", unidad: "kg", stock: 18, stockMinimo: 10 },
    { id: 2, nombre: "Leche entera", unidad: "litros", stock: 7, stockMinimo: 12 },
    { id: 3, nombre: "Chocolate", unidad: "kg", stock: 5, stockMinimo: 4 }
];
let nextProductId = 8;
let nextPedidoId = 1;
let nextVentaId = 1;
let nextInsumoId = 4;

const estadosPedidoPermitidos = {
    PENDIENTE: ["PAGADO", "CANCELADO"],
    PAGADO: ["EN_PREPARACION", "CANCELADO"],
    EN_PREPARACION: ["LISTO", "CANCELADO"],
    LISTO: ["ENTREGADO", "CANCELADO"],
    ENTREGADO: [],
    CANCELADO: []
};

function normalizarProducto(producto) {
    return {
        id: Number(producto.id),
        nombre: String(producto.nombre || "").trim(),
        categoria: String(producto.categoria || "Sin categoría").trim(),
        precio: Number(producto.precio),
        descripcion: String(producto.descripcion || "").trim(),
        imagen: String(producto.imagen || "").trim() || "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=700&q=80",
        stock: Number(producto.stock || 0),
        activo: producto.activo !== false
    };
}

function obtenerProductoPorId(id) {
    return productos.find((item) => Number(item.id) === Number(id));
}

function calcularTotalPedido(items) {
    return items.reduce((sum, item) => {
        const producto = obtenerProductoPorId(item.productoId || item.productId);
        if (!producto) return sum;
        const cantidad = Number(item.cantidad || 0);
        return sum + (cantidad * Number(producto.precio || 0));
    }, 0);
}

function responderError(res, codigo, mensaje, detalles) {
    return res.status(codigo).json({
        mensaje,
        ...(detalles ? { detalle: detalles } : {})
    });
}

router.get("/", (req, res) => {
    res.json({
        nombre: "Moka - Sistema de Ventas",
        version: "1.0",
        estado: "En desarrollo",
        modo: "demo-local"
    });
});

router.get("/estado", (req, res) => {
    res.json({
        sistema: "Moka",
        estado: "funcionando",
        servidor: "Node.js + Express",
        persistencia: "Supabase PostgreSQL",
        integracion: "Supabase"
    });
});

router.get("/health", (req, res) => {
    res.status(200).json({ estado: "ok" });
});

router.get("/categorias", (req, res) => {
    const respuesta = categorias.map((categoria) => ({
        ...categoria,
        cantidadProductos: productos.filter((producto) => producto.categoria === categoria.nombre && producto.activo).length
    }));
    res.json(respuesta);
});

router.post("/categorias", (req, res) => {
    const nombre = String(req.body?.nombre || "").trim();
    if (nombre.length < 2) return responderError(res, 400, "El nombre debe tener al menos 2 caracteres");
    if (categorias.some((categoria) => categoria.nombre.toLowerCase() === nombre.toLowerCase())) {
        return responderError(res, 409, "Ya existe una categoría con ese nombre");
    }
    const categoria = { nombre, descripcion: String(req.body?.descripcion || "").trim() };
    categorias.push(categoria);
    res.status(201).json({ ...categoria, cantidadProductos: 0 });
});

router.put("/categorias/:nombre", (req, res) => {
    const anterior = decodeURIComponent(req.params.nombre);
    const nuevoNombre = String(req.body?.nombre || "").trim();
    if (nuevoNombre.length < 2) return responderError(res, 400, "El nombre debe tener al menos 2 caracteres");
    const categoria = categorias.find((item) => item.nombre === anterior);
    const existe = Boolean(categoria);
    if (!existe) return responderError(res, 404, "Categoría no encontrada");
    productos.forEach((producto) => { if (producto.categoria === anterior) producto.categoria = nuevoNombre; });
    categoria.nombre = nuevoNombre;
    categoria.descripcion = String(req.body?.descripcion || categoria.descripcion);
    res.json({ ...categoria, cantidadProductos: productos.filter((p) => p.categoria === nuevoNombre).length });
});

router.delete("/categorias/:nombre", (req, res) => {
    const nombre = decodeURIComponent(req.params.nombre);
    if (productos.some((producto) => producto.categoria === nombre)) return responderError(res, 409, "No se puede eliminar: la categoría tiene productos asociados");
    const index = categorias.findIndex((categoria) => categoria.nombre === nombre);
    if (index < 0) return responderError(res, 404, "Categoría no encontrada");
    categorias.splice(index, 1);
    res.status(204).send();
});

router.get("/productos", (req, res) => {
    let resultado = productos.filter((producto) => producto.activo);
    const { buscar } = req.query;

    if (buscar) {
        const termino = String(buscar).toLowerCase();
        resultado = resultado.filter((p) => p.nombre.toLowerCase().includes(termino));
    }

    res.json(resultado);
});

router.get("/productos/:id", (req, res) => {
    const producto = obtenerProductoPorId(req.params.id);

    if (!producto || !producto.activo) {
        return responderError(res, 404, "Producto no encontrado");
    }

    res.json(producto);
});

router.post("/productos", (req, res) => {
    const { nombre, categoria, precio, descripcion, imagen, stock, activo } = req.body || {};

    if (!nombre || !categoria || Number.isNaN(Number(precio))) {
        return responderError(res, 400, "Faltan datos obligatorios: nombre, categoria y precio");
    }

    // Validación obligatoria de la Ficha F: si mandan activo, debe ser un booleano (true o false)
    if (activo !== undefined && typeof activo !== 'boolean') {
        return responderError(res, 400, "El campo activo debe ser un valor booleano (true o false)");
    }

    const producto = normalizarProducto({
        id: nextProductId++,
        nombre,
        categoria,
        precio,
        descripcion,
        imagen,
        stock: stock ?? 0,
        activo: activo !== undefined ? activo : true
    });

    productos.push(producto);
    res.status(201).json(producto);
});

router.put("/productos/:id", (req, res) => {
    const producto = obtenerProductoPorId(req.params.id);
    if (!producto) {
        return responderError(res, 404, "Producto no encontrado");
    }

    const { activo } = req.body || {};

    // Validación obligatoria de la Ficha F en el PUT
    if (activo !== undefined && typeof activo !== 'boolean') {
        return responderError(res, 400, "El campo activo debe ser un valor booleano (true o false)");
    }

    const actualizado = normalizarProducto({
        ...producto,
        ...req.body,
        id: producto.id
    });

    const index = productos.findIndex((item) => Number(item.id) === Number(req.params.id));
    productos[index] = actualizado;
    res.json(actualizado);
});

router.delete("/productos/:id", (req, res) => {
    const producto = obtenerProductoPorId(req.params.id);
    if (!producto) {
        return responderError(res, 404, "Producto no encontrado");
    }

    producto.activo = false;
    res.json({
        id: producto.id,
        mensaje: "Producto desactivado",
        activo: false
    });
});
router.get("/insumos", (req, res) => res.json(insumos));
router.get("/insumos/alertas/stock-bajo", (req, res) => res.json(insumos.filter((item) => item.stock <= item.stockMinimo)));
router.post("/insumos", (req, res) => {
    const { nombre, unidad, stock = 0, stockMinimo = 0 } = req.body || {};
    if (!nombre || !unidad || Number(stock) < 0 || Number(stockMinimo) < 0) return responderError(res, 400, "Completa los datos del insumo correctamente");
    const insumo = { id: nextInsumoId++, nombre: String(nombre).trim(), unidad: String(unidad).trim(), stock: Number(stock), stockMinimo: Number(stockMinimo) };
    insumos.push(insumo);
    res.status(201).json(insumo);
});
router.put("/insumos/:id", (req, res) => {
    const insumo = insumos.find((item) => item.id === Number(req.params.id));
    if (!insumo) return responderError(res, 404, "Insumo no encontrado");
    Object.assign(insumo, req.body, { id: insumo.id, stock: Number(req.body.stock ?? insumo.stock), stockMinimo: Number(req.body.stockMinimo ?? insumo.stockMinimo) });
    res.json(insumo);
});
router.post("/insumos/:id/compra", (req, res) => {
    const insumo = insumos.find((item) => item.id === Number(req.params.id));
    const cantidad = Number(req.body?.cantidad);
    if (!insumo) return responderError(res, 404, "Insumo no encontrado");
    if (!Number.isFinite(cantidad) || cantidad <= 0) return responderError(res, 400, "La cantidad debe ser mayor a 0");
    insumo.stock += cantidad;
    res.json(insumo);
});
router.delete("/insumos/:id", (req, res) => {
    const index = insumos.findIndex((item) => item.id === Number(req.params.id));
    if (index < 0) return responderError(res, 404, "Insumo no encontrado");
    insumos.splice(index, 1);
    res.status(204).send();
});

router.get("/pedidos", (req, res) => {
    res.json(pedidos);
});

router.post("/pedidos", (req, res) => {
    const { items = [], tipo = "PARA_LLEVAR", usuarioId = null } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
        return responderError(res, 400, "El pedido debe incluir al menos un producto");
    }

    try {
        const detalle = items.map((item) => {
            const producto = obtenerProductoPorId(item.productoId);
            if (!producto || !producto.activo) {
                throw new Error(`Producto ${item.productoId} no encontrado`);
            }
            return {
                productoId: Number(item.productoId),
                cantidad: Number(item.cantidad || 1),
                precioUnitario: Number(producto.precio)
            };
        });

        const total = detalle.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0);
        const pedido = {
            id: `PED-${String(nextPedidoId++)}`,
            usuarioId,
            tipo,
            estado: "PENDIENTE",
            total,
            items: detalle,
            fecha: new Date().toISOString()
        };

        pedidos.push(pedido);
        res.status(201).json(pedido);
    } catch (error) {
        return responderError(res, 400, error.message || "No se pudo crear el pedido");
    }
});

router.patch("/pedidos/:id/estado", (req, res) => {
    const { estado } = req.body || {};
    const pedido = pedidos.find((item) => item.id === req.params.id);

    if (!pedido) {
        return responderError(res, 404, "Pedido no encontrado");
    }

    if (!estado || !estadosPedidoPermitidos[pedido.estado]?.includes(estado)) {
        return responderError(res, 400, `Transición no válida: ${pedido.estado} -> ${estado || "-"}`);
    }

    pedido.estado = estado;
    res.json(pedido);
});

router.post("/ventas", (req, res) => {
    const { metodo = "EFECTIVO", items = [], pedidoId = null, total } = req.body || {};

    if (!metodo || !Array.isArray(items) || items.length === 0) {
        return responderError(res, 400, "Debe enviar el método de pago y los productos vendidos");
    }

    let pedido = pedidoId ? pedidos.find((item) => item.id === pedidoId) : null;

    if (pedidoId && !pedido) {
        return responderError(res, 404, "Pedido no encontrado");
    }

    if (!pedido) {
        pedido = {
            id: `PED-${String(nextPedidoId++)}`,
            usuarioId: null,
            tipo: "PARA_LLEVAR",
            estado: "PAGADO",
            items: items.map((item) => ({
                productoId: Number(item.productoId),
                cantidad: Number(item.cantidad || 1),
                precioUnitario: Number(item.precioUnitario || 0)
            })),
            total: Number(total || 0),
            fecha: new Date().toISOString()
        };
        pedidos.push(pedido);
    }

    const monto = Number(total ?? pedido.total ?? calcularTotalPedido(items));
    pedido.total = Number(pedido.total || monto);
    pedido.estado = "PAGADO";

    const venta = {
        id: `VEN-${String(nextVentaId++)}`,
        pedidoId: pedido.id,
        metodo,
        monto,
        estado: "CONFIRMADO",
        fecha: new Date().toISOString()
    };

    ventas.push(venta);

    res.status(201).json({
        venta,
        pedido,
        mensaje: `Cobro registrado con ${metodo}`
    });
});

router.get("/reportes/ventas-dia", (req, res) => {
    const hoy = new Date();
    const ventasHoy = ventas.filter((venta) => {
        const fecha = new Date(venta.fecha);
        return fecha.getDate() === hoy.getDate()
            && fecha.getMonth() === hoy.getMonth()
            && fecha.getFullYear() === hoy.getFullYear();
    });

    const total = ventasHoy.reduce((sum, venta) => sum + Number(venta.monto || 0), 0);
    res.json({
        fecha: hoy.toISOString(),
        total,
        ventas: ventasHoy
    });
});

router.get("/reportes/mas-vendidos", (req, res) => {
    const ranking = ventas.flatMap((venta) => {
        const pedido = pedidos.find((item) => item.id === venta.pedidoId);
        return pedido ? pedido.items.map((item) => ({
            productoId: item.productoId,
            cantidad: item.cantidad
        })) : [];
    }).reduce((acc, item) => {
        const key = Number(item.productoId);
        acc[key] = (acc[key] || 0) + Number(item.cantidad || 0);
        return acc;
    }, {});

    const resultado = Object.entries(ranking)
        .map(([productoId, cantidad]) => ({
            productoId: Number(productoId),
            nombre: obtenerProductoPorId(productoId)?.nombre || "Producto eliminado",
            cantidad
        }))
        .sort((a, b) => b.cantidad - a.cantidad);

    res.json(resultado);
});

module.exports = router;