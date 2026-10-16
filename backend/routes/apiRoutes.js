const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
    res.json({
        nombre: "Moka - Sistema de Ventas",
        version: "1.0",
        estado: "En desarrollo"
    });
});

router.get("/estado", (req, res) => {
    res.json({
        sistema: "Moka",
        estado: "funcionando",
        servidor: "Node.js + Express"
    });
});

const productos = [
    { id: 1, nombre: "Espresso", precio: 10, categoria: "Cafés", stock: 50 },
    { id: 2, nombre: "Capuchino", precio: 15, categoria: "Cafés", stock: 40 },
    { id: 3, nombre: "Latte", precio: 16, categoria: "Cafés", stock: 35 },
    { id: 4, nombre: "Brownie", precio: 12, categoria: "Postres", stock: 20 }
];

router.get("/productos", (req, res) => {
    res.json(productos);
});

router.get("/productos/:id", (req, res) => {
    const id = Number(req.params.id);
    const producto = productos.find((item) => item.id === id);

    if (!producto) {
        return res.status(404).json({ mensaje: "Producto no encontrado" });
    }

    res.json(producto);
});

module.exports = router;