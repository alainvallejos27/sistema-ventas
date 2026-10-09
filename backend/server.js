const express = require("express");
const app = express();
const PORT = 3001;

// Ruta 1: Nombre del sistema 
app.get("/", (req, res) => {
    res.send("Bienvenido al Sistema de Gestión de Ventas");
});

// Ruta 2: Breve descripción 
app.get("/info", (req, res) => {
    res.send("Aplicación web moderna desarrollada para administrar y controlar las ventas e inventario de manera eficiente.");
});

// Ruta 3: Información de contacto final
app.get("/contacto", (req, res) => {
    res.send("Correo: contacto@sistema-ventas.com");
});

// Ruta adicional relacionada con el proyecto
app.get("/productos", (req, res) => {
    res.send("Módulo de productos y control de stock");
});

// Reto: Ruta /api con formato JSON
app.get("/api", (req, res) => {
    res.json({
        nombre: "Mi aplicación de Ventas",
        version: "1.0",
        estado: "En desarrollo"
    });
});

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});