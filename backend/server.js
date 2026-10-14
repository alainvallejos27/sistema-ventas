const express = require("express");
const app = express();
const PORT = 3000;

// Importar las rutas organizadas
const apiRoutes = require("./routes/apiRoutes");

// Ruta principal del servidor
app.get("/", (req, res) => {
    res.send("Bienvenido al Sistema de Gestión de Ventas");
});

// Conectar las rutas de la API bajo el prefijo "/api"
app.use("/api", apiRoutes);

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});