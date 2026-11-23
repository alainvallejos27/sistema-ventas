let products = [];

const cart = new Map();
let activeCategory = "Todos";
let orderSequence = 1;
let todaySales = 0;
let toastTimeout;
let currentUser = null;
let productBeingCustomized = null;
let activeShift = null;
let orderPolling = null;
let orderImageProducts = null;

const categoryFilters = document.querySelector("#category-filters");
const productGrid = document.querySelector("#product-grid");
const cartItems = document.querySelector("#cart-items");
const searchInput = document.querySelector("#search-input");
const paymentDialog = document.querySelector("#payment-dialog");
const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const selectedVariants = new Map();
const customizeDialog = document.querySelector("#customize-dialog");

function formatMoney(value) {
    return `Bs ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}

function parseCashAmount(value) {
    const normalized = String(value).trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return Number.NaN;
    return Number(normalized);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

function safeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
        const url = new URL(value, window.location.origin);
        return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

async function requestJson(url, options) {
    let response;
    try {
        response = await fetch(url, options);
    } catch {
        throw new Error("No se pudo conectar con el servidor. Ejecuta node backend/server.js e inténtalo nuevamente.");
    }
    const data = await response.json().catch(() => null);
    if (response.status === 401 && currentUser) showLogin("Tu sesión expiró. Inicia sesión nuevamente.");
    if (!response.ok) throw new Error(data?.mensaje || `Error HTTP ${response.status}: ${response.statusText || "solicitud fallida"}`);
    return data;
}

function mapProduct(product) {
    const variants = (product.variantes || []).map((variant) => ({
        id: variant.id,
        size: variant.tamano,
        price: Number(variant.precio)
    }));
    return {
        id: product.id,
        name: product.nombre,
        category: product.categoria,
        price: variants[0]?.price ?? Number(product.precio),
        description: product.descripcion || "",
        image: safeImageUrl(product.imagen),
        variants,
        stock: product.stock === null ? null : Number(product.stock || 0)
    };
}

async function loadProducts() {
    try {
        const response = await requestJson("/api/productos");
        products = response.map(mapProduct);
        orderImageProducts = products;
        document.querySelector("#connection-badge").innerHTML = "<span></span> API CONECTADA";
        renderFilters();
        renderProducts();
    } catch (error) {
        document.querySelector("#connection-badge").innerHTML = "<span></span> API SIN CONEXION";
        productGrid.innerHTML = `<p class="empty-results">${escapeHtml(error.message)}. <button class="text-button" type="button" id="retry-products">Reintentar</button></p>`;
        document.querySelector("#retry-products")?.addEventListener("click", loadProducts);
    }
}

async function loadTodayStats() {
    try {
        const report = await requestJson("/api/reportes/ventas-dia");
        document.querySelector("#sales-total").textContent = formatMoney(Number(report.total || 0));
        document.querySelector("#orders-count").textContent = String(report.pedidos || 0);
        try {
            const preparing = await requestJson("/api/pedidos?estado=EN_PREPARACION");
            document.querySelector("#preparing-count").innerHTML = `${preparing.length} <small>pedidos</small>`;
        } catch {
            document.querySelector("#preparing-count").innerHTML = "— <small>pedidos</small>";
        }
        document.querySelector("#connection-badge").innerHTML = "<span></span> API CONECTADA";
        const analytics = document.querySelector("#analytics-panel");
        analytics.hidden = currentUser?.rol !== "ADMIN";
        if (currentUser?.rol === "ADMIN") {
            renderSalesChart(report.ventas || [], report.fecha);
            try {
                const bestSellers = await requestJson("/api/reportes/mas-vendidos");
                document.querySelector("#best-sellers").innerHTML = bestSellers.length
                    ? bestSellers.slice(0, 5).map((item) => `<li><span><strong>${escapeHtml(item.nombre)}</strong><small>${item.cantidad} unidades</small></span><b>${formatMoney(item.ingresos)}</b></li>`).join("")
                    : `<li class="chart-empty">Aún no hay ventas registradas.</li>`;
            } catch (error) {
                document.querySelector("#best-sellers").innerHTML = `<li class="chart-empty">${escapeHtml(error.message)}</li>`;
            }
        }
    } catch {
        document.querySelector("#connection-badge").innerHTML = "<span></span> API SIN CONEXION";
    }
}

function renderSalesChart(rows, through) {
    const valuesByDay = new Map();
    rows.forEach((row) => {
        const key = String(row.dia).slice(0, 10);
        valuesByDay.set(key, (valuesByDay.get(key) || 0) + Number(row.total_vendido));
    });
    const today = new Date(`${through}T00:00:00Z`);
    const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - (6 - index));
        const key = date.toISOString().slice(0, 10);
        return { key, total: valuesByDay.get(key) || 0, label: new Intl.DateTimeFormat("es-BO", { weekday: "short", timeZone: "UTC" }).format(date) };
    });
    const max = Math.max(1, ...days.map((day) => day.total));
    document.querySelector("#sales-chart").innerHTML = days.map((day) => {
        const level = day.total ? Math.max(1, Math.ceil(day.total / max * 10)) : 0;
        return `<div class="chart-day" title="${escapeHtml(day.label)}: ${formatMoney(day.total)}"><span class="chart-value">${day.total ? formatMoney(day.total) : "—"}</span><span class="chart-track"><i class="chart-bar level-${level}"></i></span><span class="chart-label">${escapeHtml(day.label)}</span></div>`;
    }).join("");
}

async function loadInventoryAlerts() {
    const badge = document.querySelector("#inventory-badge");
    if (!badge || !currentUser || !["ADMIN", "MENU_STAFF"].includes(currentUser.rol)) return;
    try {
        const alerts = await requestJson("/api/insumos/alertas/stock-bajo");
        badge.textContent = alerts.length > 99 ? "99+" : String(alerts.length);
        badge.hidden = alerts.length === 0;
    } catch {
        badge.hidden = true;
    }
}

function renderShift(shift) {
    const isOpen = Boolean(shift && shift.estado === "ABIERTO");
    const shiftName = shift?.tipo_turno === "TARDE" ? "tarde" : "mañana";
    document.querySelector("#shift-state").textContent = isOpen ? `Turno de la ${shiftName} abierto` : "Sin turno abierto";
    document.querySelector("#shift-time").textContent = isOpen ? `Apertura: ${new Date(shift.apertura).toLocaleString("es-BO")}` : "Abre un turno de mañana o tarde para registrar ventas desde caja.";
    document.querySelector("#shift-opening-total").textContent = formatMoney(Number(shift?.monto_inicial || 0));
    document.querySelector("#shift-cash-total").textContent = formatMoney(Number(shift?.total_efectivo || 0));
    document.querySelector("#shift-qr-total").textContent = formatMoney(Number(shift?.total_qr || 0));
    document.querySelector("#shift-card-total").textContent = formatMoney(Number(shift?.total_tarjeta || 0));
    document.querySelector("#shift-sales-total").textContent = formatMoney(Number(shift?.total_vendido || 0));
    document.querySelector("#shift-expected-total").textContent = formatMoney(Number(shift?.monto_esperado || shift?.monto_inicial || 0));
    document.querySelector("#shift-open-form").hidden = isOpen;
    document.querySelector("#shift-close-form").hidden = !isOpen;
    renderCart();
}

async function loadCashShift() {
    if (!currentUser || !["ADMIN", "CASHIER"].includes(currentUser.rol)) return null;
    try {
        activeShift = await requestJson("/api/caja/turno");
        document.querySelector("#shift-error").textContent = "";
        renderShift(activeShift);
        return activeShift;
    } catch (error) {
        if (activeShift) renderShift(activeShift);
        else {
            renderShift(null);
            document.querySelector("#shift-state").textContent = "No se pudo verificar el turno";
            document.querySelector("#shift-time").textContent = "Comprueba la conexión e inténtalo nuevamente.";
            document.querySelector("#shift-open-form").hidden = true;
            document.querySelector("#shift-close-form").hidden = true;
        }
        document.querySelector("#shift-error").textContent = `No se pudo actualizar la caja: ${error.message}`;
        return activeShift;
    }
}

async function loadAdminShifts() {
    const history = document.querySelector("#admin-shift-history");
    if (currentUser?.rol !== "ADMIN") {
        history.hidden = true;
        return;
    }
    history.hidden = false;
    try {
        const shifts = await requestJson("/api/caja/turnos");
        document.querySelector("#admin-shifts-table").innerHTML = shifts.length
            ? shifts.map((shift) => `<tr><td data-label="Usuario"><strong>${escapeHtml(shift.usuarios?.nombre || shift.usuarios?.correo || "Usuario")}</strong></td><td data-label="Sucursal">${escapeHtml(shift.sucursales?.nombre || "Sucursal")}</td><td data-label="Turno">${shift.tipo_turno === "TARDE" ? "Tarde" : "Mañana"}</td><td data-label="Estado">${escapeHtml(shift.estado)}</td><td data-label="Efectivo">${formatMoney(Number(shift.total_efectivo))}</td><td data-label="QR">${formatMoney(Number(shift.total_qr))}</td><td data-label="Tarjeta">${formatMoney(Number(shift.total_tarjeta))}</td><td data-label="Total vendido">${formatMoney(Number(shift.total_vendido))}</td></tr>`).join("")
            : `<tr><td colspan="8" class="table-empty">Aún no hay turnos registrados.</td></tr>`;
    } catch (error) {
        document.querySelector("#admin-shifts-table").innerHTML = `<tr><td colspan="8" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderDate() {
    const now = new Date();
    document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("es-BO", {
        weekday: "short",
        day: "numeric",
        month: "short"
    }).format(now);
    document.querySelector("#date-day").textContent = new Intl.DateTimeFormat("es-BO", { day: "2-digit" }).format(now);
    document.querySelector("#date-month").textContent = new Intl.DateTimeFormat("es-BO", { month: "short" }).format(now);
}

function renderFilters() {
    const categories = ["Todos", ...new Set(products.map((product) => product.category))];
    categoryFilters.innerHTML = categories.map((category) => `
        <button class="filter-button ${category === activeCategory ? "selected" : ""}" type="button" data-category="${escapeHtml(category)}" aria-pressed="${category === activeCategory}">
            ${escapeHtml(category)}
        </button>
    `).join("");
}

function renderProducts() {
    const query = searchInput.value.trim().toLocaleLowerCase("es");
    const visibleProducts = products.filter((product) => {
        const matchesCategory = activeCategory === "Todos" || product.category === activeCategory;
        const matchesQuery = `${product.name} ${product.description}`.toLocaleLowerCase("es").includes(query);
        return matchesCategory && matchesQuery;
    });

    productGrid.innerHTML = visibleProducts.length
        ? visibleProducts.map((product) => `
            <article class="product-card">
                <div class="product-image">
                    ${product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">` : ""}
                    <span class="product-category">${escapeHtml(product.category)}</span>
                </div>
                <div class="product-info">
                    <div class="product-name-row"><h3 class="product-name">${escapeHtml(product.name)}</h3><span class="product-price" data-price-for="${escapeHtml(product.id)}">Bs ${product.price}</span></div>
                    <p class="product-description">${escapeHtml(product.description)}</p>
                    <button class="add-button" type="button" data-customize="${escapeHtml(product.id)}" ${product.variants.length ? "" : "disabled"}><span>${product.variants.length ? "Personalizar y agregar" : "No disponible"}</span><span aria-hidden="true">+</span></button>
                </div>
            </article>
        `).join("")
        : `<p class="empty-results">No encontramos productos con esa busqueda.</p>`;
}

function renderCart() {
    const entries = [...cart.entries()];
    const values = entries.map(([, item]) => item);
    const count = values.reduce((total, item) => total + item.quantity, 0);
    const total = values.reduce((sum, item) => sum + item.variant.price * item.quantity, 0);

    cartItems.innerHTML = entries.length ? entries.map(([key, { product, variant, quantity, options }]) => `
        <div class="cart-row">
            <div>
                <p class="cart-product-name">${escapeHtml(product.name)}${variant.size !== "UNICO" ? ` · ${escapeHtml(variant.size)}` : ""}</p>
                <span class="cart-product-meta">${formatMoney(variant.price)} c/u${options.leche ? ` · Leche ${escapeHtml(options.leche.toLocaleLowerCase("es"))}` : ""}${options.agregados?.length ? ` · ${escapeHtml(options.agregados.map((value) => value.toLocaleLowerCase("es")).join(", "))}` : ""}</span>
                <div class="quantity-control" aria-label="Cantidad de ${product.name}">
                    <button type="button" data-quantity="${escapeHtml(key)}" data-change="-1" aria-label="Quitar una unidad de ${escapeHtml(product.name)}">−</button>
                    <span>${quantity}</span>
                    <button type="button" data-quantity="${escapeHtml(key)}" data-change="1" aria-label="Agregar una unidad de ${escapeHtml(product.name)}">+</button>
                </div>
            </div>
            <strong class="cart-product-total">${formatMoney(variant.price * quantity)}</strong>
        </div>
    `).join("") : `
        <div class="empty-cart"><span class="empty-mark">+</span><p>Tu pedido empieza aqui</p><span>Elige algo del menu</span></div>
    `;

    document.querySelector("#subtotal").textContent = formatMoney(total);
    document.querySelector("#total").textContent = formatMoney(total);
    document.querySelector("#dialog-total").textContent = formatMoney(total);
    document.querySelector("#checkout-button").disabled = count === 0;
    document.querySelector("#clear-order").disabled = count === 0;
    document.querySelector("#order-number").textContent = `#${String(orderSequence).padStart(3, "0")}`;
}

function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 3200);
}

categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    activeCategory = button.dataset.category;
    renderFilters();
    renderProducts();
});

searchInput.addEventListener("input", renderProducts);

productGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-customize]");
    if (!button) return;
    const product = products.find((item) => item.id === button.dataset.customize);
    if (!product?.variants.length) return showToast("Este producto no tiene una variante disponible.");
    productBeingCustomized = product;
    document.querySelector("#customize-title").textContent = product.name;
    document.querySelector("#customize-description").textContent = product.description;
    const sizeSelect = document.querySelector("#customize-size");
    sizeSelect.innerHTML = product.variants.map((variant) => `<option value="${escapeHtml(variant.id)}">${escapeHtml(({ P: "Pequeño", M: "Mediano", G: "Grande", UNICO: "Único" })[variant.size] || variant.size)} · ${formatMoney(variant.price)}</option>`).join("");
    document.querySelector("#customize-size-field").hidden = product.variants.length === 1;
    document.querySelector("#coffee-options").hidden = !product.category.toLocaleLowerCase("es").includes("caf");
    document.querySelector("#customize-milk").value = "";
    document.querySelectorAll('input[name="agregado"]').forEach((input) => { input.checked = false; });
    document.querySelector("#customize-error").textContent = "";
    customizeDialog.showModal();
});

document.querySelector("#customize-form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    if (!productBeingCustomized) return;
    const variant = productBeingCustomized.variants.find((item) => item.id === document.querySelector("#customize-size").value);
    if (!variant) return;
    const options = {
        ...(document.querySelector("#customize-milk").value ? { leche: document.querySelector("#customize-milk").value } : {}),
        agregados: [...document.querySelectorAll('input[name="agregado"]:checked')].map((input) => input.value)
    };
    const key = `${variant.id}|${options.leche || ""}|${options.agregados.join(",")}`;
    const current = cart.get(key);
    cart.set(key, { product: productBeingCustomized, variant, quantity: (current?.quantity || 0) + 1, options });
    selectedVariants.set(productBeingCustomized.id, variant.id);
    customizeDialog.close();
    productBeingCustomized = null;
    renderCart();
});

cartItems.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quantity]");
    if (!button) return;
    const id = button.dataset.quantity;
    const entry = cart.get(id);
    const quantity = entry.quantity + Number(button.dataset.change);
    if (quantity <= 0) cart.delete(id);
    else cart.set(id, { ...entry, quantity });
    renderCart();
});

document.querySelector("#clear-order").addEventListener("click", () => {
    cart.clear();
    renderCart();
});

document.querySelector("#checkout-button").addEventListener("click", async () => {
    if (currentUser?.rol === "CUSTOMER") {
        const items = [...cart.values()].map(({ variant, quantity, options }) => ({ varianteId: variant.id, cantidad: quantity, opciones: options }));
        const button = document.querySelector("#checkout-button");
        button.disabled = true;
        try {
            const order = await requestJson("/api/pedidos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items })
            });
            cart.clear();
            orderSequence += 1;
            renderCart();
            showToast(`Pedido #${order.id.slice(-6).toUpperCase()} enviado. Paga en caja al recogerlo.`);
        } catch (error) {
            showToast(error.message);
        } finally {
            button.disabled = false;
        }
        return;
    }
    updatePaymentFields();
    paymentDialog.showModal();
});

function updatePaymentFields() {
    const method = document.querySelector('input[name="payment"]:checked')?.value;
    const cashField = document.querySelector("#cash-received-field");
    const changeLine = document.querySelector("#change-line");
    const total = [...cart.values()].reduce((sum, item) => sum + item.variant.price * item.quantity, 0);
    cashField.hidden = method !== "EFECTIVO";
    changeLine.hidden = method !== "EFECTIVO";
    const received = parseCashAmount(document.querySelector("#cash-received").value);
    const change = received - total;
    document.querySelector("#cash-change").textContent = Number.isFinite(received)
        ? change >= 0 ? formatMoney(change) : `Faltan ${formatMoney(Math.abs(change))}`
        : "Escribe el monto recibido";
    document.querySelector("#cash-change").classList.toggle("change-short", Number.isFinite(received) && change < 0);
}

document.querySelectorAll('input[name="payment"]').forEach((input) => input.addEventListener("change", updatePaymentFields));
document.querySelector("#cash-received").addEventListener("input", updatePaymentFields);

function showTicket(result, paymentMethod, received, change) {
    const order = result.pedido;
    const lines = (order.items || []).map((item) => {
        const options = item.opciones || {};
        const extras = [options.leche, ...(options.agregados || [])].filter(Boolean).join(", ");
        return `<div class="receipt-item"><span>${item.cantidad} × ${escapeHtml(item.nombre)}${item.tamano && item.tamano !== "UNICO" ? ` · ${escapeHtml(item.tamano)}` : ""}${extras ? `<small>${escapeHtml(extras)}</small>` : ""}</span><strong>${formatMoney(Number(item.subtotal))}</strong></div>`;
    }).join("");
    document.querySelector("#receipt-content").innerHTML = `
        <p class="receipt-brand">MOKA · CAFETERÍA</p><p class="receipt-meta">Pedido ${escapeHtml(order.id)}<br>${new Date(result.venta.fecha).toLocaleString("es-BO")}</p>
        <div class="receipt-lines">${lines}</div><div class="receipt-total"><span>Total</span><strong>${formatMoney(Number(result.venta.monto))}</strong></div>
        <p class="receipt-meta">Pago: ${escapeHtml(paymentMethod)}${paymentMethod === "EFECTIVO" ? `<br>Recibido: ${formatMoney(received)}<br>Cambio: ${formatMoney(change)}` : ""}</p>
        <p class="receipt-thanks">Gracias por tu visita</p>`;
    document.querySelector("#ticket-dialog").showModal();
}

document.querySelector("#close-ticket").addEventListener("click", () => document.querySelector("#ticket-dialog").close());
document.querySelector("#ticket-done").addEventListener("click", () => document.querySelector("#ticket-dialog").close());
document.querySelector("#print-ticket").addEventListener("click", () => window.print());

document.querySelector("#payment-form").addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const total = [...cart.values()].reduce((sum, item) => sum + item.variant.price * item.quantity, 0);
    const paymentMethod = new FormData(event.currentTarget).get("payment");
    const received = parseCashAmount(document.querySelector("#cash-received").value);
    if (paymentMethod === "EFECTIVO" && (!Number.isFinite(received) || received < total)) {
        document.querySelector("#cash-received").focus();
        return showToast("Escribe un monto válido que cubra el total del pedido.");
    }
    const items = [...cart.values()].map(({ variant, quantity, options }) => ({ varianteId: variant.id, cantidad: quantity, opciones: options }));
    const confirmButton = document.querySelector("#confirm-payment");
    confirmButton.disabled = true;
    try {
        const result = await requestJson("/api/ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metodo: paymentMethod, items })
        });
        const paidTotal = Number(result.venta.monto);
        if (activeShift) {
            const totalKey = {
                EFECTIVO: "total_efectivo",
                QR: "total_qr",
                TARJETA: "total_tarjeta"
            }[paymentMethod];
            activeShift = {
                ...activeShift,
                total_vendido: Number(activeShift.total_vendido || 0) + paidTotal,
                [totalKey]: Number(activeShift[totalKey] || 0) + paidTotal,
                monto_esperado: Number(activeShift.monto_esperado || activeShift.monto_inicial || 0)
                    + (paymentMethod === "EFECTIVO" ? paidTotal : 0)
            };
            renderShift(activeShift);
        }
        cart.clear();
        orderSequence += 1;
        renderCart();
        paymentDialog.close();
        document.querySelector("#cash-received").value = "";
        updatePaymentFields();
        showToast(`Cobro de ${formatMoney(paidTotal)} registrado como ${paymentMethod}.`);
        await Promise.all([loadTodayStats(), loadOrders(), loadInventoryAlerts(), loadCashShift()]);
    } catch (error) {
        showToast(error.message);
    } finally {
        confirmButton.disabled = false;
    }
});

document.addEventListener("keydown", (event) => {
    if (appView.hidden) return;
    if (event.key === "F2") {
        event.preventDefault();
        if (!document.querySelector("dialog[open]") && cart.size) document.querySelector("#checkout-button").click();
    } else if (event.key === "F4") {
        event.preventDefault();
        searchInput.focus();
    } else if (event.key === "Escape" && !document.querySelector("dialog[open]") && cart.size) {
        cart.clear();
        renderCart();
        showToast("Pedido vaciado.");
    } else if (event.key === "/" && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
    }
});

const routeNames = { "/": "Punto de venta", "/pedidos": "Pedidos", "/turno": "Turno de caja", "/productos": "Productos", "/categorias": "Categorías", "/inventario": "Inventario" };
const routesByRole = {
    ADMIN: Object.keys(routeNames),
    CASHIER: ["/", "/pedidos", "/turno"],
    BARISTA: ["/pedidos"],
    MENU_STAFF: ["/productos", "/categorias", "/inventario"],
    CUSTOMER: ["/"]
};
const roleNames = { ADMIN: "Administrador", MENU_STAFF: "Personal de menú", CASHIER: "Cajero", BARISTA: "Barista", CUSTOMER: "Cliente" };

function showLogin(message = "") {
    currentUser = null;
    activeShift = null;
    cart.clear();
    clearInterval(orderPolling);
    orderPolling = null;
    appView.hidden = true;
    loginView.hidden = false;
    document.querySelector("#login-error").textContent = message;
    document.querySelector("#login-password").value = "";
    document.querySelector("#login-email").focus();
}

function showApp(user) {
    currentUser = user;
    loginView.hidden = true;
    appView.hidden = false;
    document.querySelector("#user-name").textContent = user.nombre;
    document.querySelector("#page-title").textContent = `Hola, ${user.nombre}.`;
    document.querySelector("#user-role").textContent = roleNames[user.rol];
    document.querySelector("#analytics-panel").hidden = user.rol !== "ADMIN";
    document.querySelector("#quick-stats").hidden = user.rol !== "ADMIN";
    document.querySelector(".welcome-row").hidden = user.rol === "CUSTOMER";
    document.querySelector("#checkout-button-label").textContent = user.rol === "CUSTOMER" ? "Enviar pedido" : "Cobrar pedido";
    document.querySelector("#secure-note").hidden = user.rol === "CUSTOMER";
    document.querySelector("#user-avatar").textContent = user.nombre
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toLocaleUpperCase("es"))
        .join("");

    const allowedRoutes = routesByRole[user.rol] || [];
    document.querySelectorAll(".nav-link[data-route]").forEach((link) => {
        link.hidden = !allowedRoutes.includes(link.dataset.route);
    });
    const route = allowedRoutes.includes(currentRoute()) ? currentRoute() : allowedRoutes[0];
    if (route !== currentRoute()) window.location.hash = `#${route}`;
    updateRoute();
    renderDate();
    renderCart();
    if (user.rol !== "BARISTA") loadProducts();
    if (user.rol === "ADMIN") loadTodayStats();
    if (["ADMIN", "CASHIER"].includes(user.rol)) loadCashShift();
    if (["ADMIN", "MENU_STAFF"].includes(user.rol)) loadInventoryAlerts();
}

function currentRoute() {
    return window.location.hash.replace(/^#/, "") || "/";
}

function updateRoute() {
    const route = routeNames[currentRoute()] ? currentRoute() : "/";
    if (currentUser && !routesByRole[currentUser.rol]?.includes(route)) {
        window.location.hash = `#${routesByRole[currentUser.rol]?.[0] || "/"}`;
        return;
    }
    document.querySelectorAll("[data-module]").forEach((section) => { section.classList.toggle("visible", section.dataset.module === route.slice(1)); });
    document.querySelector(".pos-layout").hidden = route !== "/";
    document.querySelector(".welcome-row").hidden = route !== "/" || currentUser?.rol === "CUSTOMER";
    document.querySelector(".quick-stats").hidden = route !== "/" || currentUser?.rol !== "ADMIN";
    document.querySelector("#analytics-panel").hidden = route !== "/" || currentUser?.rol !== "ADMIN";
    document.querySelector(".menu-section")?.closest(".pos-layout");
    document.querySelectorAll(".nav-link[data-route]").forEach((link) => {
        const active = link.dataset.route === route;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    document.querySelector(".breadcrumb strong").textContent = routeNames[route];
    if (route === "/pedidos") loadOrders();
    if (route === "/turno") {
        loadCashShift();
        loadAdminShifts();
    }
    if (route === "/productos") loadAdminProducts();
    if (route === "/categorias") loadCategories();
    if (route === "/inventario") loadInventory();
    syncOrderPolling();
}

async function loadOrders(status = "TODOS") {
    try {
        const kitchenMode = currentUser?.rol === "BARISTA";
        const selectedStatus = kitchenMode ? "TODOS" : status;
        const query = selectedStatus === "TODOS" ? "" : `?estado=${encodeURIComponent(selectedStatus)}`;
        document.querySelector("#orders-description").textContent = kitchenMode
            ? "Pedidos en preparación o listos para entregar. La lista se actualiza automáticamente."
            : "Controla el flujo de cada pedido hasta la entrega.";
        document.querySelector("#order-filters").hidden = kitchenMode;
        const responseOrders = await requestJson(`/api/pedidos${query}`);
        if (orderImageProducts === null) {
            try {
                orderImageProducts = products.length ? products : (await requestJson("/api/productos")).map(mapProduct);
            } catch (error) {
                orderImageProducts = [];
                showToast(`No se pudieron cargar las imágenes de productos: ${error.message}`);
            }
        }
        const orders = kitchenMode
            ? responseOrders.filter((order) => ["PAGADO", "EN_PREPARACION", "LISTO"].includes(order.estado))
            : responseOrders;
        document.querySelector("#orders-table").innerHTML = orders.length ? orders.map((order) => {
            const next = currentUser?.rol === "BARISTA"
                ? { PAGADO: "EN_PREPARACION", EN_PREPARACION: "LISTO", LISTO: "ENTREGADO" }[order.estado]
                : currentUser?.rol === "ADMIN"
                    ? { PAGADO: "EN_PREPARACION", EN_PREPARACION: "LISTO", LISTO: "ENTREGADO" }[order.estado]
                    : null;
            const action = order.estado === "ENTREGADO"
                ? `<button class="table-button delivery-complete" type="button" disabled>Entregado</button>`
                : order.estado === "PENDIENTE" && ["ADMIN", "CASHIER"].includes(currentUser?.rol)
                ? `<button class="table-button" data-pay="${escapeHtml(order.id)}">Cobrar en efectivo</button>`
                : next
                    ? `<button class="table-button" data-advance="${escapeHtml(order.id)}" data-next="${next}">${next === "ENTREGADO" ? "Entregar" : "Avanzar"}</button>`
                    : "-";
            const contents = (order.items || []).map((item) => {
                const options = item.opciones || {};
                const extras = [options.leche, ...(options.agregados || [])].filter(Boolean).join(", ");
                const relatedProduct = orderImageProducts.find((product) => (
                    product.variants.some((variant) => String(variant.id) === String(item.varianteId))
                    || String(product.id) === String(item.productoId || item.productId)
                ));
                const image = safeImageUrl(item.imagen || item.imagen_url || relatedProduct?.image || "");
                return `<span class="order-item">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : `<span class="order-item-placeholder" aria-hidden="true">☕</span>`}<span>${item.cantidad} × ${escapeHtml(item.nombre || "Producto")}${item.tamano && item.tamano !== "UNICO" ? ` · ${escapeHtml(item.tamano)}` : ""}${extras ? `<small>${escapeHtml(extras)}</small>` : ""}</span></span>`;
            }).join("");
            return `<tr><td data-label="Pedido"><strong>#${escapeHtml(order.id.slice(-6).toUpperCase())}</strong><small>${contents || "Sin detalle"}</small></td><td data-label="Fecha">${new Date(order.fecha).toLocaleString("es-BO")}</td><td data-label="Total">${formatMoney(Number(order.total))}</td><td data-label="Estado"><span class="status-badge status-${escapeHtml(order.estado.toLowerCase())}">${escapeHtml(order.estado.replaceAll("_", " "))}</span></td><td data-label="Acción">${action}</td></tr>`;
        }).join("") : `<tr><td colspan="5" class="table-empty">Aún no hay pedidos registrados.</td></tr>`;
    } catch (error) {
        document.querySelector("#orders-table").innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

function syncOrderPolling() {
    clearInterval(orderPolling);
    orderPolling = null;
    if (currentUser?.rol === "BARISTA" && currentRoute() === "/pedidos") {
        orderPolling = setInterval(() => loadOrders("EN_PREPARACION"), 5000);
    }
}

async function loadAdminProducts() {
    try {
        const list = await requestJson("/api/productos");
        const query = document.querySelector("#admin-product-search").value.toLowerCase();
        const visible = list.filter((item) => item.nombre.toLowerCase().includes(query));
        document.querySelector("#products-table").innerHTML = visible.length
            ? visible.map((item) => `<tr><td data-label="Producto"><strong>${escapeHtml(item.nombre)}</strong><small>${escapeHtml(item.descripcion)}</small></td><td data-label="Categoría">${escapeHtml(item.categoria)}</td><td data-label="Precio">${formatMoney(Number(item.precio))}</td><td data-label="Existencias">Gestionadas por insumos</td><td data-label="Acciones"><button class="table-button" data-toggle-product="${escapeHtml(item.id)}">Desactivar</button></td></tr>`).join("")
            : `<tr><td colspan="5" class="table-empty">No se encontraron productos.</td></tr>`;
    } catch (error) {
        document.querySelector("#products-table").innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

async function loadCategories() {
    try {
        const list = await requestJson("/api/categorias");
        document.querySelector("#categories-table").innerHTML = list.length
            ? list.map((item) => `<tr><td data-label="Nombre"><strong>${escapeHtml(item.nombre)}</strong></td><td data-label="Productos">${item.cantidadProductos}</td><td data-label="Acciones"><button class="table-button" data-delete-category="${escapeHtml(item.id)}">Eliminar</button></td></tr>`).join("")
            : `<tr><td colspan="3" class="table-empty">No hay categorías registradas.</td></tr>`;
    } catch (error) {
        document.querySelector("#categories-table").innerHTML = `<tr><td colspan="3" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

async function loadInventory() {
    try {
        const [list, alerts] = await Promise.all([
            requestJson("/api/insumos"),
            requestJson("/api/insumos/alertas/stock-bajo")
        ]);
        const badge = document.querySelector("#inventory-badge");
        badge.textContent = alerts.length > 99 ? "99+" : String(alerts.length);
        badge.hidden = alerts.length === 0;
        document.querySelector("#inventory-alert").textContent = alerts.length ? `${alerts.length} insumo(s) necesitan reposición.` : "Inventario saludable: no hay alertas de stock.";
        document.querySelector("#inventory-table").innerHTML = list.length
            ? list.map((item) => `<tr><td data-label="Insumo"><strong>${escapeHtml(item.nombre)}</strong></td><td data-label="Unidad">${escapeHtml(item.unidad)}</td><td data-label="Stock actual"><span class="${item.stock <= item.stockMinimo ? "low-stock" : ""}">${item.stock}</span></td><td data-label="Mínimo">${item.stockMinimo}</td><td data-label="Acciones"><button class="table-button" data-buy-supply="${escapeHtml(item.id)}">Registrar compra</button></td></tr>`).join("")
            : `<tr><td colspan="5" class="table-empty">No hay insumos registrados.</td></tr>`;
    } catch (error) {
        document.querySelector("#inventory-alert").textContent = error.message;
        document.querySelector("#inventory-table").innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

document.querySelector("#shift-open-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#shift-open-button");
    const error = document.querySelector("#shift-error");
    error.textContent = "";
    button.disabled = true;
    try {
        const shift = await requestJson("/api/caja/turno/abrir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                montoInicial: Number(document.querySelector("#shift-opening-amount").value),
                tipoTurno: document.querySelector("#shift-type").value
            })
        });
        activeShift = {
            ...shift,
            total_vendido: 0,
            monto_esperado: Number(shift.monto_inicial)
        };
        renderShift(activeShift);
        document.querySelector("#shift-result").textContent = "Turno abierto. Las ventas se registrarán en esta caja.";
        showToast("Turno de caja abierto.");
    } catch (requestError) {
        error.textContent = requestError.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelector("#shift-close-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeShift) return;
    const closedShiftType = activeShift.tipo_turno;
    const button = document.querySelector("#shift-close-button");
    const error = document.querySelector("#shift-error");
    error.textContent = "";
    button.disabled = true;
    try {
        const result = await requestJson("/api/caja/turno/cerrar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ turnoId: activeShift.id, montoCierre: Number(document.querySelector("#shift-closing-amount").value) })
        });
        activeShift = null;
        renderShift(null);
        const shiftName = closedShiftType === "TARDE" ? "tarde" : "mañana";
        document.querySelector("#shift-result").textContent = `Cierre de ${shiftName} · efectivo ${formatMoney(result.totalEfectivo)} · QR ${formatMoney(result.totalQr)} · tarjeta ${formatMoney(result.totalTarjeta)} · total vendido ${formatMoney(result.totalVendido)} · diferencia ${formatMoney(result.diferencia)}.`;
        showToast("Turno cerrado correctamente.");
    } catch (requestError) {
        error.textContent = requestError.message;
    } finally {
        button.disabled = false;
    }
});

window.addEventListener("hashchange", updateRoute);
document.querySelector("#refresh-orders").addEventListener("click", async () => { await loadOrders(); showToast("Lista de pedidos actualizada."); });
document.querySelector("#order-filters").addEventListener("click", (event) => { const button = event.target.closest("[data-order-status]"); if (button) loadOrders(button.dataset.orderStatus); });
document.querySelector("#orders-table").addEventListener("click", async (event) => {
    const payButton = event.target.closest("[data-pay]");
    const advanceButton = event.target.closest("[data-advance]");
    if (!payButton && !advanceButton) return;
    const button = payButton || advanceButton;
    button.disabled = true;
    try {
        if (payButton) {
            if (!confirm("¿Confirmas que recibiste el pago en efectivo de este pedido?")) {
                button.disabled = false;
                return;
            }
            const result = await requestJson("/api/ventas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pedidoId: payButton.dataset.pay, metodo: "EFECTIVO" })
            });
            showToast(`Pago en efectivo registrado: ${formatMoney(Number(result.venta.monto))}.`);
        } else {
            await requestJson(`/api/pedidos/${advanceButton.dataset.advance}/estado`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ estado: advanceButton.dataset.next })
            });
            showToast("Estado del pedido actualizado.");
        }
        await loadOrders();
    } catch (error) {
        button.disabled = false;
        showToast(error.message);
    }
});
document.querySelector("#admin-product-search").addEventListener("input", loadAdminProducts);
const productDialog = document.querySelector("#product-dialog");
const productForm = document.querySelector("#product-form");
document.addEventListener("click", (event) => {
    const cancelButton = event.target.closest("[data-dialog-cancel]");
    if (!cancelButton) return;
    const dialog = cancelButton.closest("dialog");
    const form = cancelButton.closest("form");
    form?.reset();
    dialog?.querySelectorAll('[role="alert"], .form-error').forEach((message) => { message.textContent = ""; });
    if (dialog === customizeDialog) productBeingCustomized = null;
    dialog?.close();
});
document.querySelector("#new-product").addEventListener("click", () => { productForm.reset(); document.querySelector("#product-error").textContent = ""; productDialog.showModal(); document.querySelector("#product-name").focus(); });
productForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const formData = new FormData(productForm);
    const nombre = String(formData.get("nombre") || "").trim();
    const categoria = String(formData.get("categoria") || "").trim();
    const descripcion = String(formData.get("descripcion") || "").trim();
    const imagen = String(formData.get("imagen") || "").trim();
    const precio = Number(formData.get("precio"));
    const error = document.querySelector("#product-error");
    if (nombre.length < 2 || !categoria || !Number.isFinite(precio) || precio < 0) {
        error.textContent = "Completa los campos obligatorios con valores válidos.";
        return;
    }
    if (imagen && !safeImageUrl(imagen)) {
        error.textContent = "Escribe una URL de imagen válida.";
        return;
    }
    const button = document.querySelector("#save-product");
    button.disabled = true;
    try {
        await requestJson("/api/productos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, categoria, precio, descripcion, imagen })
        });
        await loadAdminProducts();
        await loadProducts();
        productDialog.close();
        showToast("Producto creado correctamente.");
    } catch (requestError) {
        error.textContent = requestError.message;
    } finally {
        button.disabled = false;
    }
});
document.querySelector("#products-table").addEventListener("click", async (event) => { const button = event.target.closest("[data-toggle-product]"); if (!button) return; try { await requestJson(`/api/productos/${button.dataset.toggleProduct}`, { method: "DELETE" }); await loadAdminProducts(); await loadProducts(); showToast("Producto desactivado."); } catch (error) { showToast(error.message); } });
const categoryDialog = document.querySelector("#category-dialog");
const categoryForm = document.querySelector("#category-form");
document.querySelector("#new-category").addEventListener("click", () => { categoryForm.reset(); document.querySelector("#category-error").textContent = ""; categoryDialog.showModal(); document.querySelector("#category-name").focus(); });
categoryForm.addEventListener("submit", async (event) => { if (event.submitter?.value !== "confirm") return; event.preventDefault(); const formData = new FormData(categoryForm); const nombre = String(formData.get("nombre") || "").trim(); const descripcion = String(formData.get("descripcion") || "").trim(); const error = document.querySelector("#category-error"); if (nombre.length < 2) { error.textContent = "El nombre debe tener al menos 2 caracteres."; return; } const button = document.querySelector("#save-category"); button.disabled = true; try { await requestJson("/api/categorias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre, descripcion }) }); await loadCategories(); categoryDialog.close(); showToast("Categoría creada correctamente."); } catch (requestError) { error.textContent = requestError.message; } finally { button.disabled = false; } });
document.querySelector("#categories-table").addEventListener("click", async (event) => { const button = event.target.closest("[data-delete-category]"); if (!button || !confirm("¿Eliminar esta categoría?")) return; try { await requestJson(`/api/categorias/${encodeURIComponent(button.dataset.deleteCategory)}`, { method: "DELETE" }); await loadCategories(); showToast("Categoría eliminada."); } catch (error) { showToast(error.message); } });
const supplyDialog = document.querySelector("#supply-dialog");
const supplyForm = document.querySelector("#supply-form");
document.querySelector("#new-supply").addEventListener("click", () => { supplyForm.reset(); document.querySelector("#supply-error").textContent = ""; supplyDialog.showModal(); document.querySelector("#supply-name").focus(); });
supplyForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const formData = new FormData(supplyForm);
    const nombre = String(formData.get("nombre") || "").trim();
    const unidad = String(formData.get("unidad") || "").trim();
    const stock = Number(formData.get("stock"));
    const stockMinimo = Number(formData.get("stockMinimo"));
    const error = document.querySelector("#supply-error");
    if (nombre.length < 2 || !unidad || !Number.isFinite(stock) || !Number.isFinite(stockMinimo) || stock < 0 || stockMinimo < 0) {
        error.textContent = "Completa valores de inventario válidos.";
        return;
    }
    const button = document.querySelector("#save-supply");
    button.disabled = true;
    try {
        await requestJson("/api/insumos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, unidad, stock, stockMinimo })
        });
        await loadInventory();
        supplyDialog.close();
        showToast("Insumo creado correctamente.");
    } catch (requestError) {
        error.textContent = requestError.message;
    } finally {
        button.disabled = false;
    }
});
const purchaseDialog = document.querySelector("#purchase-dialog");
const purchaseForm = document.querySelector("#purchase-form");
document.querySelector("#inventory-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-buy-supply]");
    if (!button) return;
    purchaseForm.dataset.supplyId = button.dataset.buySupply;
    purchaseForm.reset();
    document.querySelector("#purchase-error").textContent = "";
    document.querySelector("#purchase-dialog-title").textContent = `Registrar compra · ${button.closest("tr").querySelector("strong").textContent}`;
    purchaseDialog.showModal();
    document.querySelector("#purchase-quantity").focus();
});
purchaseForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const cantidad = Number(new FormData(purchaseForm).get("cantidad"));
    const error = document.querySelector("#purchase-error");
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
        error.textContent = "La cantidad debe ser mayor a 0.";
        return;
    }
    const button = document.querySelector("#save-purchase");
    button.disabled = true;
    try {
        await requestJson(`/api/insumos/${purchaseForm.dataset.supplyId}/compra`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cantidad })
        });
        await loadInventory();
        purchaseDialog.close();
        showToast("Compra registrada correctamente.");
    } catch (requestError) {
        error.textContent = requestError.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.querySelector("#login-submit");
    const formData = new FormData(form);
    const correo = String(formData.get("correo") || "").trim();
    const password = String(formData.get("password") || "");
    const errorLabel = document.querySelector("#login-error");
    errorLabel.textContent = "";
    button.disabled = true;
    try {
        const result = await requestJson("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo, password })
        });
        form.reset();
        showApp(result.usuario);
    } catch (error) {
        errorLabel.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.mensaje || "No se pudo cerrar la sesión.");
        }
        window.location.hash = "";
        showLogin();
    } catch (error) {
        showLogin(error.message);
    }
});

async function restoreSession() {
    try {
        const result = await requestJson("/api/auth/session");
        showApp(result.usuario);
    } catch (error) {
        showLogin(error.message === "Inicia sesión para continuar." ? "" : error.message);
    }
}

restoreSession();