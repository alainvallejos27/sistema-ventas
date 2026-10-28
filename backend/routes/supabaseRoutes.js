const express = require("express");
const { createSupabaseClient } = require("../middleware/auth");

const router = express.Router();
const ORDER_WITH_ITEMS = [
    "id",
    "tipo",
    "estado",
    "total",
    "fecha",
    "sucursal_id",
    "detalle_pedido(id,variante_id,cantidad,precio_unitario,subtotal,variantes_producto(tamano,productos(nombre)))"
].join(",");
const METHODS = ["EFECTIVO", "QR", "TARJETA"];
const ORDER_TYPES = ["PARA_LLEVAR", "EN_MESA"];
const ORDER_STATES = ["PENDIENTE", "PAGADO", "EN_PREPARACION", "LISTO", "ENTREGADO", "CANCELADO"];
const VARIANT_ORDER = { P: 0, M: 1, G: 2, UNICO: 3 };

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function databaseClient(req) {
    return createSupabaseClient(req.auth?.accessToken);
}

function failDatabase(error) {
    console.error("Error en operación Supabase:", error);
    if (error.status === 401) throw new ApiError(401, "La sesión de Supabase expiró. Inicia sesión nuevamente.");
    if (error.status === 403 || error.code === "42501") throw new ApiError(403, "Supabase denegó esta operación por sus permisos o políticas RLS.");
    if (error.code === "23505") throw new ApiError(409, "Ya existe un registro con esos datos.");
    if (error.code === "23503") throw new ApiError(409, "No se puede completar la operación porque el registro tiene datos asociados.");
    if (error.code === "P0001" && /no autorizado/i.test(error.message || "")) {
        throw new ApiError(403, "No tienes permiso para realizar esta operación.");
    }
    if (error.code === "22P02" || error.code === "23514" || error.code === "P0001") {
        throw new ApiError(400, error.message || "Los datos no cumplen las reglas de la base de datos.");
    }
    if (error.code === "PGRST116") throw new ApiError(404, "No se encontró el registro solicitado.");
    throw new ApiError(502, "No se pudo completar la operación con la base de datos.");
}

function dataOrThrow(result) {
    if (result.error) failDatabase(result.error);
    return result.data;
}

function handleError(res, error) {
    if (error instanceof ApiError) return res.status(error.status).json({ mensaje: error.message });
    console.error("Error inesperado en una ruta de Supabase:", error);
    return res.status(502).json({ mensaje: "No se pudo completar la operación con la base de datos." });
}

function validarTexto(value, label, maxLength) {
    if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > maxLength) {
        throw new ApiError(400, `${label} debe tener entre 2 y ${maxLength} caracteres.`);
    }
    return value.trim();
}

function validarPrecio(value) {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0 || price > 100000) throw new ApiError(400, "El precio debe ser un número válido mayor o igual a cero.");
    return price;
}

function ordenarVariantes(variants) {
    return [...variants].sort((a, b) => (VARIANT_ORDER[a.tamano] ?? 9) - (VARIANT_ORDER[b.tamano] ?? 9));
}

function exponerProducto(product, category, variants) {
    const activeVariants = ordenarVariantes(variants.filter((variant) => variant.activo));
    const firstVariant = activeVariants[0];
    return {
        id: product.id,
        nombre: product.nombre,
        categoria: category?.nombre || "Sin categoría",
        categoriaId: product.categoria_id,
        precio: Number(firstVariant?.precio || 0),
        varianteId: firstVariant?.id || null,
        variantes: activeVariants.map((variant) => ({
            id: variant.id,
            tamano: variant.tamano,
            precio: Number(variant.precio)
        })),
        descripcion: product.descripcion || "",
        imagen: product.imagen_url || "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=700&q=80",
        stock: null,
        activo: product.activo
    };
}

async function cargarProductos(client, { id, includeInactive = false } = {}) {
    let productsQuery = client
        .from("productos")
        .select("id,categoria_id,nombre,descripcion,imagen_url,activo,creado_en");
    if (id) productsQuery = productsQuery.eq("id", id);
    else if (!includeInactive) productsQuery = productsQuery.eq("activo", true);

    const products = dataOrThrow(await productsQuery.order("nombre"));
    if (!products.length) return [];

    const categoryIds = [...new Set(products.map((product) => product.categoria_id))];
    const productIds = products.map((product) => product.id);
    const [categories, variants] = await Promise.all([
        client.from("categorias").select("id,nombre,descripcion").in("id", categoryIds),
        client.from("variantes_producto").select("id,producto_id,tamano,precio,activo").in("producto_id", productIds).eq("activo", true)
    ]);
    const categoryById = new Map(dataOrThrow(categories).map((category) => [category.id, category]));
    const variantsByProduct = new Map();
    for (const variant of dataOrThrow(variants)) {
        const group = variantsByProduct.get(variant.producto_id) || [];
        group.push(variant);
        variantsByProduct.set(variant.producto_id, group);
    }

    return products.map((product) => exponerProducto(
        product,
        categoryById.get(product.categoria_id),
        variantsByProduct.get(product.id) || []
    ));
}

async function buscarCategoriaPorNombre(client, nombre) {
    const result = await client.from("categorias").select("id,nombre").eq("nombre", nombre).maybeSingle();
    return dataOrThrow(result);
}

async function cargarPedido(client, pedidoId) {
    const result = await client
        .from("pedidos")
        .select(ORDER_WITH_ITEMS)
        .eq("id", pedidoId)
        .maybeSingle();
    const order = dataOrThrow(result);
    if (!order) throw new ApiError(404, "Pedido no encontrado.");

    return {
        ...order,
        items: (order.detalle_pedido || []).map((item) => ({
            varianteId: item.variante_id,
            cantidad: item.cantidad,
            precioUnitario: Number(item.precio_unitario),
            subtotal: Number(item.subtotal),
            tamano: item.variantes_producto?.tamano,
            nombre: item.variantes_producto?.productos?.nombre
        }))
    };
}

router.get("/", (req, res) => {
    res.json({
        nombre: "Moka - Sistema de Ventas",
        version: "1.0",
        estado: "funcionando",
        modo: "supabase"
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

router.get("/categorias", async (req, res) => {
    try {
        const client = databaseClient(req);
        const categories = dataOrThrow(await client.from("categorias").select("id,nombre,descripcion").order("nombre"));
        const counts = await Promise.all(categories.map(async (category) => {
            const result = await client
                .from("productos")
                .select("id", { count: "exact", head: true })
                .eq("categoria_id", category.id)
                .eq("activo", true);
            if (result.error) failDatabase(result.error);
            return { ...category, cantidadProductos: result.count || 0 };
        }));
        return res.json(counts);
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/categorias", async (req, res) => {
    try {
        const nombre = validarTexto(req.body?.nombre, "El nombre", 60);
        const descripcion = typeof req.body?.descripcion === "string" ? req.body.descripcion.trim() : "";
        const result = await databaseClient(req)
            .from("categorias")
            .insert({ nombre, descripcion })
            .select("id,nombre,descripcion")
            .single();
        const category = dataOrThrow(result);
        return res.status(201).json({ ...category, cantidadProductos: 0 });
    } catch (error) {
        return handleError(res, error);
    }
});

router.put("/categorias/:nombre", async (req, res) => {
    try {
        const client = databaseClient(req);
        const oldName = req.params.nombre;
        const category = await buscarCategoriaPorNombre(client, oldName);
        if (!category) throw new ApiError(404, "Categoría no encontrada.");
        const nombre = validarTexto(req.body?.nombre, "El nombre", 60);
        const descripcion = typeof req.body?.descripcion === "string" ? req.body.descripcion.trim() : "";
        const updated = dataOrThrow(await client.from("categorias")
            .update({ nombre, descripcion })
            .eq("id", category.id)
            .select("id,nombre,descripcion")
            .single());
        return res.json(updated);
    } catch (error) {
        return handleError(res, error);
    }
});

router.delete("/categorias/:nombre", async (req, res) => {
    try {
        const client = databaseClient(req);
        const category = await buscarCategoriaPorNombre(client, req.params.nombre);
        if (!category) throw new ApiError(404, "Categoría no encontrada.");
        dataOrThrow(await client.from("categorias").delete().eq("id", category.id));
        return res.status(204).send();
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/productos", async (req, res) => {
    try {
        const products = await cargarProductos(databaseClient(req));
        const query = typeof req.query.buscar === "string" ? req.query.buscar.trim().toLocaleLowerCase("es") : "";
        return res.json(query
            ? products.filter((product) => `${product.nombre} ${product.descripcion}`.toLocaleLowerCase("es").includes(query))
            : products);
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/productos/:id", async (req, res) => {
    try {
        const products = await cargarProductos(databaseClient(req), { id: req.params.id });
        if (!products.length) throw new ApiError(404, "Producto no encontrado.");
        return res.json(products[0]);
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/productos", async (req, res) => {
    let createdProductId;
    try {
        const client = databaseClient(req);
        const nombre = validarTexto(req.body?.nombre, "El nombre", 80);
        const categoria = validarTexto(req.body?.categoria, "La categoría", 60);
        const precio = validarPrecio(req.body?.precio);
        const category = await buscarCategoriaPorNombre(client, categoria);
        if (!category) throw new ApiError(400, "La categoría seleccionada no existe.");

        const result = await client.from("productos").insert({
            nombre,
            categoria_id: category.id,
            descripcion: typeof req.body?.descripcion === "string" ? req.body.descripcion.trim() : "",
            imagen_url: typeof req.body?.imagen === "string" ? req.body.imagen.trim() || null : null
        }).select("id").single();
        createdProductId = dataOrThrow(result).id;

        dataOrThrow(await client.from("variantes_producto").insert({
            producto_id: createdProductId,
            tamano: "UNICO",
            precio
        }));
        const products = await cargarProductos(client, { id: createdProductId });
        return res.status(201).json(products[0]);
    } catch (error) {
        if (createdProductId) {
            const cleanup = await client.from("productos").delete().eq("id", createdProductId);
            if (cleanup.error) console.error("No se pudo limpiar el producto tras un error al guardar su variante:", cleanup.error);
        }
        return handleError(res, error);
    }
});

router.put("/productos/:id", async (req, res) => {
    try {
        const client = databaseClient(req);
        const products = await cargarProductos(client, { id: req.params.id, includeInactive: true });
        if (!products.length) throw new ApiError(404, "Producto no encontrado.");
        const current = products[0];
        const patch = {};

        if (req.body?.nombre !== undefined) patch.nombre = validarTexto(req.body.nombre, "El nombre", 80);
        if (req.body?.descripcion !== undefined) patch.descripcion = String(req.body.descripcion).trim();
        if (req.body?.imagen !== undefined) patch.imagen_url = String(req.body.imagen).trim() || null;
        if (req.body?.activo !== undefined) {
            if (typeof req.body.activo !== "boolean") throw new ApiError(400, "El campo activo debe ser booleano.");
            patch.activo = req.body.activo;
        }
        if (req.body?.categoria !== undefined) {
            const category = await buscarCategoriaPorNombre(client, validarTexto(req.body.categoria, "La categoría", 60));
            if (!category) throw new ApiError(400, "La categoría seleccionada no existe.");
            patch.categoria_id = category.id;
        }
        if (Object.keys(patch).length) dataOrThrow(await client.from("productos").update(patch).eq("id", req.params.id));
        if (req.body?.precio !== undefined) {
            const precio = validarPrecio(req.body.precio);
            const baseVariant = current.variantes[0];
            if (baseVariant) {
                dataOrThrow(await client.from("variantes_producto").update({ precio }).eq("id", baseVariant.id));
            } else {
                dataOrThrow(await client.from("variantes_producto").insert({
                    producto_id: req.params.id,
                    tamano: "UNICO",
                    precio
                }));
            }
        }

        return res.json((await cargarProductos(client, { id: req.params.id, includeInactive: true }))[0]);
    } catch (error) {
        return handleError(res, error);
    }
});

router.delete("/productos/:id", async (req, res) => {
    try {
        const client = databaseClient(req);
        const result = await client.from("productos").update({ activo: false }).eq("id", req.params.id).select("id").maybeSingle();
        const product = dataOrThrow(result);
        if (!product) throw new ApiError(404, "Producto no encontrado.");
        return res.json({ id: product.id, mensaje: "Producto desactivado", activo: false });
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/insumos", async (req, res) => {
    try {
        let query = databaseClient(req)
            .from("insumos")
            .select("id,sucursal_id,nombre,unidad,stock,stock_minimo")
            .order("nombre");
        if (req.auth.profile.rol !== "ADMIN" || req.auth.profile.sucursal_id) {
            query = query.eq("sucursal_id", req.auth.profile.sucursal_id);
        }
        const supplies = dataOrThrow(await query);
        return res.json(supplies.map((supply) => ({
            id: supply.id,
            sucursalId: supply.sucursal_id,
            nombre: supply.nombre,
            unidad: supply.unidad,
            stock: Number(supply.stock),
            stockMinimo: Number(supply.stock_minimo)
        })));
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/insumos/alertas/stock-bajo", async (req, res) => {
    try {
        const result = await databaseClient(req)
            .from("vw_insumos_stock_bajo")
            .select("id,sucursal_id,nombre,unidad,stock,stock_minimo")
            .order("nombre");
        return res.json(dataOrThrow(result).map((supply) => ({
            id: supply.id,
            sucursalId: supply.sucursal_id,
            nombre: supply.nombre,
            unidad: supply.unidad,
            stock: Number(supply.stock),
            stockMinimo: Number(supply.stock_minimo)
        })));
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/insumos", async (req, res) => {
    try {
        const nombre = validarTexto(req.body?.nombre, "El nombre", 100);
        const unidad = typeof req.body?.unidad === "string" ? req.body.unidad.trim() : "";
        if (!unidad || unidad.length > 20) throw new ApiError(400, "La unidad debe tener entre 1 y 20 caracteres.");
        const stock = Number(req.body?.stock ?? 0);
        const stockMinimo = Number(req.body?.stockMinimo ?? 0);
        if (!Number.isFinite(stock) || stock < 0 || !Number.isFinite(stockMinimo) || stockMinimo < 0) {
            throw new ApiError(400, "El stock y el mínimo deben ser números mayores o iguales a cero.");
        }

        const client = databaseClient(req);
        let sucursalId = req.auth.profile.sucursal_id;
        if (!sucursalId && req.auth.profile.rol === "ADMIN") {
            const branch = dataOrThrow(await client.from("sucursales").select("id").eq("activa", true).order("nombre").limit(1).maybeSingle());
            if (!branch) throw new ApiError(400, "Crea una sucursal activa antes de registrar insumos.");
            sucursalId = branch.id;
        }
        if (!sucursalId) throw new ApiError(403, "El perfil debe tener una sucursal asignada.");

        const result = await client.from("insumos")
            .insert({ sucursal_id: sucursalId, nombre, unidad, stock, stock_minimo: stockMinimo })
            .select("id,sucursal_id,nombre,unidad,stock,stock_minimo")
            .single();
        const supply = dataOrThrow(result);
        return res.status(201).json({
            id: supply.id,
            sucursalId: supply.sucursal_id,
            nombre: supply.nombre,
            unidad: supply.unidad,
            stock: Number(supply.stock),
            stockMinimo: Number(supply.stock_minimo)
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.put("/insumos/:id", async (req, res) => {
    try {
        const patch = {};
        if (req.body?.nombre !== undefined) patch.nombre = validarTexto(req.body.nombre, "El nombre", 100);
        if (req.body?.unidad !== undefined) patch.unidad = validarTexto(req.body.unidad, "La unidad", 20);
        for (const [field, column] of [["stock", "stock"], ["stockMinimo", "stock_minimo"]]) {
            if (req.body?.[field] !== undefined) {
                const value = Number(req.body[field]);
                if (!Number.isFinite(value) || value < 0) throw new ApiError(400, `${field} debe ser un número mayor o igual a cero.`);
                patch[column] = value;
            }
        }
        if (!Object.keys(patch).length) throw new ApiError(400, "Envía al menos un campo para actualizar.");
        const result = await databaseClient(req).from("insumos")
            .update(patch)
            .eq("id", req.params.id)
            .select("id,sucursal_id,nombre,unidad,stock,stock_minimo")
            .maybeSingle();
        const supply = dataOrThrow(result);
        if (!supply) throw new ApiError(404, "Insumo no encontrado.");
        return res.json({
            id: supply.id,
            sucursalId: supply.sucursal_id,
            nombre: supply.nombre,
            unidad: supply.unidad,
            stock: Number(supply.stock),
            stockMinimo: Number(supply.stock_minimo)
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/insumos/:id/compra", async (req, res) => {
    try {
        const cantidad = Number(req.body?.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) throw new ApiError(400, "La cantidad debe ser un número mayor a cero.");
        dataOrThrow(await databaseClient(req).rpc("registrar_compra_insumo", {
            p_insumo: req.params.id,
            p_cantidad: cantidad
        }));
        const result = await databaseClient(req)
            .from("insumos")
            .select("id,sucursal_id,nombre,unidad,stock,stock_minimo")
            .eq("id", req.params.id)
            .maybeSingle();
        const supply = dataOrThrow(result);
        if (!supply) throw new ApiError(404, "Insumo no encontrado.");
        return res.json({
            id: supply.id,
            sucursalId: supply.sucursal_id,
            nombre: supply.nombre,
            unidad: supply.unidad,
            stock: Number(supply.stock),
            stockMinimo: Number(supply.stock_minimo)
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.delete("/insumos/:id", async (req, res) => {
    try {
        const result = await databaseClient(req).from("insumos").delete().eq("id", req.params.id).select("id").maybeSingle();
        if (!dataOrThrow(result)) throw new ApiError(404, "Insumo no encontrado.");
        return res.status(204).send();
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/pedidos", async (req, res) => {
    try {
        let query = databaseClient(req).from("pedidos").select(ORDER_WITH_ITEMS).order("fecha", { ascending: false });
        if (req.query.estado && req.query.estado !== "TODOS") {
            if (!ORDER_STATES.includes(req.query.estado)) throw new ApiError(400, "El estado del pedido no es válido.");
            query = query.eq("estado", req.query.estado);
        }
        const orders = dataOrThrow(await query);
        return res.json(orders.map((order) => ({
            ...order,
            items: (order.detalle_pedido || []).map((item) => ({
                varianteId: item.variante_id,
                cantidad: item.cantidad,
                precioUnitario: Number(item.precio_unitario),
                subtotal: Number(item.subtotal),
                tamano: item.variantes_producto?.tamano,
                nombre: item.variantes_producto?.productos?.nombre
            }))
        })));
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/pedidos", async (req, res) => {
    try {
        const items = req.body?.items;
        const tipo = req.body?.tipo || "PARA_LLEVAR";
        if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
            throw new ApiError(400, "El pedido debe incluir entre 1 y 50 productos.");
        }
        if (!ORDER_TYPES.includes(tipo)) throw new ApiError(400, "El tipo de pedido no es válido.");
        const normalizedItems = items.map((item) => {
            const cantidad = Number(item?.cantidad);
            if (typeof item?.varianteId !== "string" || !/^[0-9a-f-]{36}$/i.test(item.varianteId)
                || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
                throw new ApiError(400, "Cada producto debe tener una variante válida y cantidad de 1 a 99.");
            }
            return { varianteId: item.varianteId, cantidad };
        });

        const result = await databaseClient(req).rpc("crear_pedido", {
            p_items: normalizedItems,
            p_tipo: tipo
        });
        const orderId = dataOrThrow(result);
        return res.status(201).json(await cargarPedido(databaseClient(req), orderId));
    } catch (error) {
        return handleError(res, error);
    }
});

router.patch("/pedidos/:id/estado", async (req, res) => {
    try {
        const estado = req.body?.estado;
        if (!ORDER_STATES.includes(estado) || estado === "PENDIENTE" || estado === "PAGADO") {
            throw new ApiError(400, "El nuevo estado del pedido no es válido.");
        }
        dataOrThrow(await databaseClient(req).rpc("cambiar_estado_pedido", {
            p_pedido: req.params.id,
            p_nuevo: estado
        }));
        return res.json(await cargarPedido(databaseClient(req), req.params.id));
    } catch (error) {
        return handleError(res, error);
    }
});

router.post("/ventas", async (req, res) => {
    try {
        const client = databaseClient(req);
        const metodo = req.body?.metodo || "EFECTIVO";
        if (!METHODS.includes(metodo)) throw new ApiError(400, "El método de pago no es válido.");

        let pedidoId = req.body?.pedidoId;
        let paymentId;
        if (!pedidoId && Array.isArray(req.body?.items)) {
            const items = req.body.items;
            if (items.length === 0 || items.length > 50) throw new ApiError(400, "El pedido debe incluir entre 1 y 50 productos.");
            const normalizedItems = items.map((item) => {
                const cantidad = Number(item?.cantidad);
                if (typeof item?.varianteId !== "string" || !/^[0-9a-f-]{36}$/i.test(item.varianteId)
                    || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
                    throw new ApiError(400, "Cada producto debe tener una variante válida y cantidad de 1 a 99.");
                }
                return { varianteId: item.varianteId, cantidad };
            });
            const created = dataOrThrow(await client.rpc("crear_pedido_y_cobrar", {
                p_items: normalizedItems,
                p_metodo: metodo,
                p_tipo: req.body?.tipo || "PARA_LLEVAR"
            }));
            pedidoId = created?.pedido_id;
            paymentId = created?.pago_id;
        }
        if (typeof pedidoId !== "string" || !/^[0-9a-f-]{36}$/i.test(pedidoId)) {
            throw new ApiError(400, "Envía un pedido válido para registrar el pago.");
        }

        if (!paymentId) {
            paymentId = dataOrThrow(await client.rpc("registrar_pago", {
                p_pedido: pedidoId,
                p_metodo: metodo
            }));
        }
        const payment = dataOrThrow(await client.from("pagos")
            .select("id,pedido_id,metodo,monto,estado,fecha")
            .eq("id", paymentId)
            .single());
        const order = await cargarPedido(client, pedidoId);
        return res.status(201).json({
            venta: {
                id: payment.id,
                pedidoId: payment.pedido_id,
                metodo: payment.metodo,
                monto: Number(payment.monto),
                estado: payment.estado,
                fecha: payment.fecha
            },
            pedido: order,
            mensaje: `Pago registrado con ${payment.metodo}. Confirma manualmente que el dinero fue recibido.`
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/reportes/ventas-dia", async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await databaseClient(req)
            .from("vw_ventas_diarias")
            .select("dia,pedidos,total_vendido")
            .eq("dia", today);
        const rows = dataOrThrow(result);
        return res.json({
            fecha: today,
            total: rows.reduce((sum, row) => sum + Number(row.total_vendido), 0),
            pedidos: rows.reduce((sum, row) => sum + Number(row.pedidos), 0),
            ventas: rows
        });
    } catch (error) {
        return handleError(res, error);
    }
});

router.get("/reportes/mas-vendidos", async (req, res) => {
    try {
        const result = await databaseClient(req)
            .from("vw_productos_mas_vendidos")
            .select("producto_id,producto,unidades,ingresos")
            .order("unidades", { ascending: false })
            .limit(20);
        return res.json(dataOrThrow(result).map((row) => ({
            productoId: row.producto_id,
            nombre: row.producto,
            cantidad: Number(row.unidades),
            ingresos: Number(row.ingresos)
        })));
    } catch (error) {
        return handleError(res, error);
    }
});

module.exports = router;
