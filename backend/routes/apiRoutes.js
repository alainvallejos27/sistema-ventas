const express = require("express");
const router = express.Router();

// Ruta base de la API (/api)
router.get("/", (req, res) => {
    res.json({
        mensaje: "API funcionando correctamente",
        curso: "Tecnología Web II",
        estado: "activo"
    });
});

// Ruta de estado del sistema
router.get("/estado", (req, res) => {
    res.json({
        sistema: "Tecnología Web II",
        estado: "funcionando",
        servidor: "Node.js + Express"
    });
});

// Ruta de listado de productos contextualizada a tu sistema de ventas
router.get("/productos", (req, res) => {
    const productos = [
        { id: 1, nombre: "Laptop HP Victus", precio: 5500 },
        { id: 2, nombre: "Xiaomi Redmi Note 14", precio: 2200 },
        { id: 3, nombre: "Proyector Xiaomi", precio: 1800 }
    ];
    res.json(productos);
});

// Ruta dinámica con parámetro :id
router.get("/productos/:id", (req, res) => {
    const id = Number(req.params.id);
    res.json({
        mensaje: "Producto solicitado del sistema de ventas",
        id: id
    });
});

module.exports = router;