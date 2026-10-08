const express = require("express");
const app = express();
const PORT = 3001;

// Ruta 1: Nombre del sistema (Reto Práctico 01)
app.get("/", (req, res) => {
    res.send("Bienvenido al Sistema de Gestión de Ventas");
});

// Ruta 2: Breve descripción (Cambiado a /info como pide la guía)
app.get("/info", (req, res) => {
    res.send("Aplicación web moderna desarrollada para administrar y controlar las ventas e inventario de manera eficiente.");
});

// Ruta 3: Información de contacto ficticia (Reto Práctico 01)
app.get("/contacto", (req, res) => {
    res.send("Correo: contacto@sistema-ventas.com");
});

// Ruta adicional relacionada con el proyecto
app.get("/productos", (req, res) => {
    res.send("Módulo de productos y control de stock");
});

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});