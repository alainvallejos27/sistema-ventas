const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3001;

const apiRoutes = require("./routes/apiRoutes");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/info", (req, res) => {
    res.send("Sistema web para administrar productos, pedidos y ventas de la cafetería Moka.");
});

app.get("/contacto", (req, res) => {
    res.send("Correo: contacto@moka.com");
});

app.get("/productos", (req, res) => {
    res.send("Módulo de productos y control de stock de Moka");
});

app.use("/api", apiRoutes);

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});