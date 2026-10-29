const express = require("express");
const helmet = require("helmet");
const path = require("path");
if (process.env.NODE_ENV !== "test") {
    require("dotenv").config({ path: path.join(__dirname, ".env") });
}
const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
}

const apiRoutes = require("./routes/apiRoutes");
const authRoutes = require("./routes/authRoutes");

app.disable("x-powered-by");
app.use(helmet({
    hsts: process.env.NODE_ENV === "production" ? undefined : false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'self'"]
        }
    }
}));
app.use(express.json({ limit: "16kb" }));
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

app.use("/api/auth", authRoutes);
app.use("/api", apiRoutes);

const server = app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});

function cerrarServidor(signal) {
    console.log(`Señal ${signal} recibida; cerrando el servidor HTTP.`);
    server.close((error) => {
        if (error) {
            console.error("No se pudo cerrar el servidor HTTP correctamente:", error);
            process.exitCode = 1;
        }
    });
}

process.once("SIGTERM", () => cerrarServidor("SIGTERM"));
process.once("SIGINT", () => cerrarServidor("SIGINT"));