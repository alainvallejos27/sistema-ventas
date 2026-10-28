let products = [];

const cart = new Map();
let activeCategory = "Todos";
let orderSequence = 1;
let todaySales = 0;
let toastTimeout;
let currentUser = null;

const categoryFilters = document.querySelector("#category-filters");
const productGrid = document.querySelector("#product-grid");
const cartItems = document.querySelector("#cart-items");
const searchInput = document.querySelector("#search-input");
const paymentDialog = document.querySelector("#payment-dialog");
const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const selectedVariants = new Map();

function formatMoney(value) {
    return `Bs ${value.toFixed(2).replace(".", ",")}`;
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
    if (!response.ok) throw new Error(data?.mensaje || "No se pudo completar la solicitud");
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
        document.querySelector("#connection-badge").innerHTML = "<span></span> API CONECTADA";
    } catch {
        document.querySelector("#connection-badge").innerHTML = "<span></span> API SIN CONEXION";
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
                    ${product.variants.length > 1 ? `<label class="variant-picker">Tamaño<select data-variant-for="${escapeHtml(product.id)}">${product.variants.map((variant) => `<option value="${escapeHtml(variant.id)}" data-price="${variant.price}" ${variant.id === (selectedVariants.get(product.id) || product.variants[0].id) ? "selected" : ""}>${escapeHtml(variant.size)} · Bs ${variant.price}</option>`).join("")}</select></label>` : ""}
                    <button class="add-button" type="button" data-add="${escapeHtml(product.id)}" ${product.variants.length ? "" : "disabled"}><span>${product.variants.length ? "Agregar al pedido" : "No disponible"}</span><span aria-hidden="true">+</span></button>
                </div>
            </article>
        `).join("")
        : `<p class="empty-results">No encontramos productos con esa busqueda.</p>`;
}

function renderCart() {
    const entries = [...cart.values()];
    const count = entries.reduce((total, item) => total + item.quantity, 0);
    const total = entries.reduce((sum, item) => sum + item.variant.price * item.quantity, 0);

    cartItems.innerHTML = entries.length ? entries.map(({ product, variant, quantity }) => `
        <div class="cart-row">
            <div>
                <p class="cart-product-name">${escapeHtml(product.name)}${variant.size !== "UNICO" ? ` · ${escapeHtml(variant.size)}` : ""}</p>
                <span class="cart-product-meta">${formatMoney(variant.price)} c/u</span>
                <div class="quantity-control" aria-label="Cantidad de ${product.name}">
                    <button type="button" data-quantity="${escapeHtml(variant.id)}" data-change="-1" aria-label="Quitar una unidad de ${escapeHtml(product.name)}">−</button>
                    <span>${quantity}</span>
                    <button type="button" data-quantity="${escapeHtml(variant.id)}" data-change="1" aria-label="Agregar una unidad de ${escapeHtml(product.name)}">+</button>
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
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const product = products.find((item) => item.id === button.dataset.add);
    const selectedVariantId = selectedVariants.get(product.id) || product.variants[0]?.id;
    const variant = product.variants.find((item) => item.id === selectedVariantId);
    if (!variant) return showToast("Este producto no tiene una variante disponible.");
    const current = cart.get(variant.id);
    cart.set(variant.id, { product, variant, quantity: (current?.quantity || 0) + 1 });
    renderCart();
});

productGrid.addEventListener("change", (event) => {
    const select = event.target.closest("[data-variant-for]");
    if (!select) return;
    const productId = select.dataset.variantFor;
    selectedVariants.set(productId, select.value);
    const price = Number(select.selectedOptions[0]?.dataset.price);
    const priceLabel = productGrid.querySelector(`[data-price-for="${CSS.escape(productId)}"]`);
    if (priceLabel && Number.isFinite(price)) priceLabel.textContent = `Bs ${price}`;
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

document.querySelector("#checkout-button").addEventListener("click", () => paymentDialog.showModal());

document.querySelector("#payment-form").addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const total = [...cart.values()].reduce((sum, item) => sum + item.variant.price * item.quantity, 0);
    const paymentMethod = new FormData(event.currentTarget).get("payment");
    const items = [...cart.values()].map(({ variant, quantity }) => ({ varianteId: variant.id, cantidad: quantity }));
    const confirmButton = document.querySelector("#confirm-payment");
    confirmButton.disabled = true;
    try {
        const result = await requestJson("/api/ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metodo: paymentMethod, items })
        });
        const paidTotal = Number(result.venta.monto);
        todaySales += paidTotal;
        orderSequence += 1;
        document.querySelector("#sales-total").textContent = formatMoney(todaySales);
        document.querySelector("#orders-count").textContent = String(orderSequence - 1);
        document.querySelector("#preparing-count").innerHTML = `${orderSequence - 1} <small>pedidos</small>`;
        cart.clear();
        renderCart();
        document.querySelector("#order-number").textContent = `#${result.pedido.id.slice(-6).toUpperCase()}`;
        paymentDialog.close();
        showToast(`Cobro de ${formatMoney(paidTotal)} registrado como ${paymentMethod}.`);
    } catch (error) {
        showToast(error.message);
    } finally {
        confirmButton.disabled = false;
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
    }
});

const routeNames = { "/": "Punto de venta", "/pedidos": "Pedidos", "/productos": "Productos", "/categorias": "Categorías", "/inventario": "Inventario" };
const routesByRole = {
    ADMIN: Object.keys(routeNames),
    CASHIER: ["/", "/pedidos"],
    BARISTA: ["/pedidos"],
    MENU_STAFF: ["/productos", "/categorias", "/inventario"]
};
const roleNames = { ADMIN: "Administrador", MENU_STAFF: "Personal de menú", CASHIER: "Cajero", BARISTA: "Barista" };

function showLogin(message = "") {
    currentUser = null;
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
    document.querySelector("#user-role").textContent = roleNames[user.rol];
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
    loadProducts();
    if (["ADMIN", "CASHIER"].includes(user.rol)) loadTodayStats();
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
    document.querySelector(".welcome-row").hidden = route !== "/";
    document.querySelector(".quick-stats").hidden = route !== "/";
    document.querySelector(".menu-section")?.closest(".pos-layout");
    document.querySelectorAll(".nav-link[data-route]").forEach((link) => {
        const active = link.dataset.route === route;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    document.querySelector(".breadcrumb strong").textContent = routeNames[route];
    if (route === "/pedidos") loadOrders();
    if (route === "/productos") loadAdminProducts();
    if (route === "/categorias") loadCategories();
    if (route === "/inventario") loadInventory();
}

async function loadOrders(status = "TODOS") {
    try {
        const query = status === "TODOS" ? "" : `?estado=${encodeURIComponent(status)}`;
        const orders = await requestJson(`/api/pedidos${query}`);
        document.querySelector("#orders-table").innerHTML = orders.length ? orders.map((order) => {
            const next = { PAGADO: "EN_PREPARACION", EN_PREPARACION: "LISTO", LISTO: "ENTREGADO" }[order.estado];
            const action = order.estado === "PENDIENTE"
                ? `<button class="table-button" data-pay="${escapeHtml(order.id)}">Cobrar en efectivo</button>`
                : next
                    ? `<button class="table-button" data-advance="${escapeHtml(order.id)}" data-next="${next}">Avanzar</button>`
                    : "-";
            return `<tr><td data-label="Pedido"><strong>${escapeHtml(order.id)}</strong></td><td data-label="Fecha">${new Date(order.fecha).toLocaleString("es-BO")}</td><td data-label="Total">${formatMoney(Number(order.total))}</td><td data-label="Estado"><span class="status-badge status-${escapeHtml(order.estado.toLowerCase())}">${escapeHtml(order.estado.replaceAll("_", " "))}</span></td><td data-label="Acción">${action}</td></tr>`;
        }).join("") : `<tr><td colspan="5" class="table-empty">Aún no hay pedidos registrados.</td></tr>`;
    } catch (error) {
        document.querySelector("#orders-table").innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
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
            ? list.map((item) => `<tr><td data-label="Nombre"><strong>${escapeHtml(item.nombre)}</strong></td><td data-label="Productos">${item.cantidadProductos}</td><td data-label="Acciones"><button class="table-button" data-delete-category="${encodeURIComponent(item.nombre)}">Eliminar</button></td></tr>`).join("")
            : `<tr><td colspan="3" class="table-empty">No hay categorías registradas.</td></tr>`;
    } catch (error) {
        document.querySelector("#categories-table").innerHTML = `<tr><td colspan="3" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

async function loadInventory() {
    try {
        const list = await requestJson("/api/insumos");
        const alerts = list.filter((item) => item.stock <= item.stockMinimo);
        document.querySelector("#inventory-alert").textContent = alerts.length ? `${alerts.length} insumo(s) necesitan reposición.` : "Inventario saludable: no hay alertas de stock.";
        document.querySelector("#inventory-table").innerHTML = list.length
            ? list.map((item) => `<tr><td data-label="Insumo"><strong>${escapeHtml(item.nombre)}</strong></td><td data-label="Unidad">${escapeHtml(item.unidad)}</td><td data-label="Stock actual"><span class="${item.stock <= item.stockMinimo ? "low-stock" : ""}">${item.stock}</span></td><td data-label="Mínimo">${item.stockMinimo}</td><td data-label="Acciones"><button class="table-button" data-buy-supply="${escapeHtml(item.id)}">Registrar compra</button></td></tr>`).join("")
            : `<tr><td colspan="5" class="table-empty">No hay insumos registrados.</td></tr>`;
    } catch (error) {
        document.querySelector("#inventory-alert").textContent = error.message;
        document.querySelector("#inventory-table").innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

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
document.querySelector("#new-product").addEventListener("click", () => { productForm.reset(); document.querySelector("#product-error").textContent = ""; productDialog.showModal(); document.querySelector("#product-name").focus(); });
productForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const formData = new FormData(productForm);
    const nombre = String(formData.get("nombre") || "").trim();
    const categoria = String(formData.get("categoria") || "").trim();
    const descripcion = String(formData.get("descripcion") || "").trim();
    const precio = Number(formData.get("precio"));
    const error = document.querySelector("#product-error");
    if (nombre.length < 2 || !categoria || !Number.isFinite(precio) || precio < 0) {
        error.textContent = "Completa los campos obligatorios con valores válidos.";
        return;
    }
    const button = document.querySelector("#save-product");
    button.disabled = true;
    try {
        await requestJson("/api/productos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, categoria, precio, descripcion })
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
document.querySelector("#categories-table").addEventListener("click", async (event) => { const button = event.target.closest("[data-delete-category]"); if (!button || !confirm("¿Eliminar esta categoría?")) return; try { await requestJson(`/api/categorias/${button.dataset.deleteCategory}`, { method: "DELETE" }); await loadCategories(); showToast("Categoría eliminada."); } catch (error) { showToast(error.message); } });
document.querySelector("#new-supply").addEventListener("click", async () => { const nombre = prompt("Nombre del insumo:"); if (!nombre) return; const unidad = prompt("Unidad:", "kg"); const stock = Number(prompt("Stock actual:", "0")); const stockMinimo = Number(prompt("Stock mínimo:", "0")); if (!unidad || !Number.isFinite(stock) || !Number.isFinite(stockMinimo) || stock < 0 || stockMinimo < 0) return showToast("Completa valores de inventario válidos."); try { await requestJson("/api/insumos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre, unidad, stock, stockMinimo }) }); await loadInventory(); showToast("Insumo creado correctamente."); } catch (error) { showToast(error.message); } });
document.querySelector("#inventory-table").addEventListener("click", async (event) => { const button = event.target.closest("[data-buy-supply]"); if (!button) return; const cantidad = Number(prompt("Cantidad comprada:", "1")); if (!Number.isFinite(cantidad) || cantidad <= 0) return showToast("La cantidad debe ser mayor a 0."); try { await requestJson(`/api/insumos/${button.dataset.buySupply}/compra`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cantidad }) }); await loadInventory(); showToast("Compra registrada correctamente."); } catch (error) { showToast(error.message); } });

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