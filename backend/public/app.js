const products = [
    { id: 1, name: "Espresso", category: "Cafés", price: 10, description: "Corto, intenso y recién molido.", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=700&q=80" },
    { id: 2, name: "Capuchino", category: "Cafés", price: 15, description: "Espresso, leche y espuma suave.", image: "https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=700&q=80" },
    { id: 3, name: "Latte", category: "Cafés", price: 16, description: "Leche cremosa y un doble espresso.", image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=700&q=80" },
    { id: 4, name: "Cold brew", category: "Cafés", price: 18, description: "Extracción lenta, servido bien frío.", image: "https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=700&q=80" },
    { id: 5, name: "Brownie", category: "Postres", price: 12, description: "Chocolate oscuro, centro húmedo.", image: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=700&q=80" },
    { id: 6, name: "Croissant", category: "Postres", price: 14, description: "Hojaldre dorado, hecho esta mañana.", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=700&q=80" },
    { id: 7, name: "Sándwich de la casa", category: "Sándwiches", price: 24, description: "Pan tostado, queso y vegetales frescos.", image: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=700&q=80" }
];

const cart = new Map();
let activeCategory = "Todos";
let orderSequence = 1;
let todaySales = 0;
let toastTimeout;

const categoryFilters = document.querySelector("#category-filters");
const productGrid = document.querySelector("#product-grid");
const cartItems = document.querySelector("#cart-items");
const searchInput = document.querySelector("#search-input");
const paymentDialog = document.querySelector("#payment-dialog");

function formatMoney(value) {
    return `Bs ${value.toFixed(2).replace(".", ",")}`;
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
        <button class="filter-button ${category === activeCategory ? "selected" : ""}" type="button" data-category="${category}" aria-pressed="${category === activeCategory}">
            ${category}
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
                    <img src="${product.image}" alt="${product.name}" loading="lazy">
                    <span class="product-category">${product.category}</span>
                </div>
                <div class="product-info">
                    <div class="product-name-row"><h3 class="product-name">${product.name}</h3><span class="product-price">Bs ${product.price}</span></div>
                    <p class="product-description">${product.description}</p>
                    <button class="add-button" type="button" data-add="${product.id}"><span>Agregar al pedido</span><span aria-hidden="true">+</span></button>
                </div>
            </article>
        `).join("")
        : `<p class="empty-results">No encontramos productos con esa busqueda.</p>`;
}

function renderCart() {
    const entries = [...cart.values()];
    const count = entries.reduce((total, item) => total + item.quantity, 0);
    const total = entries.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

    cartItems.innerHTML = entries.length ? entries.map(({ product, quantity }) => `
        <div class="cart-row">
            <div>
                <p class="cart-product-name">${product.name}</p>
                <span class="cart-product-meta">${formatMoney(product.price)} c/u</span>
                <div class="quantity-control" aria-label="Cantidad de ${product.name}">
                    <button type="button" data-quantity="${product.id}" data-change="-1" aria-label="Quitar una unidad de ${product.name}">−</button>
                    <span>${quantity}</span>
                    <button type="button" data-quantity="${product.id}" data-change="1" aria-label="Agregar una unidad de ${product.name}">+</button>
                </div>
            </div>
            <strong class="cart-product-total">${formatMoney(product.price * quantity)}</strong>
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
    const product = products.find((item) => item.id === Number(button.dataset.add));
    const current = cart.get(product.id);
    cart.set(product.id, { product, quantity: (current?.quantity || 0) + 1 });
    renderCart();
});

cartItems.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quantity]");
    if (!button) return;
    const id = Number(button.dataset.quantity);
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

document.querySelector("#payment-form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const total = [...cart.values()].reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const paymentMethod = new FormData(event.currentTarget).get("payment");
    todaySales += total;
    orderSequence += 1;
    document.querySelector("#sales-total").textContent = `Bs ${todaySales.toFixed(0)}`;
    document.querySelector("#orders-count").textContent = String(orderSequence - 1);
    document.querySelector("#preparing-count").innerHTML = `${orderSequence - 1} <small>pedidos</small>`;
    cart.clear();
    renderCart();
    paymentDialog.close();
    showToast(`Cobro de ${formatMoney(total)} registrado como ${paymentMethod}. Demostración local; no se guardó en la base de datos.`);
});

document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
    }
});

renderDate();
renderFilters();
renderProducts();
renderCart();