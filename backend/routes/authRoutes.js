const express = require("express");
const rateLimit = require("express-rate-limit");
const {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    authenticate,
    checkSameOrigin,
    clearSessionCookies,
    createSupabaseClient,
    isSupabaseConfigured,
    loadProfile,
    readCookies,
    responderError,
    setSessionCookies
} = require("../middleware/auth");

const router = express.Router();
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { mensaje: "Demasiados intentos. Espera 15 minutos antes de volver a intentarlo." }
});

router.post("/login", checkSameOrigin, loginLimiter, async (req, res) => {
    const correo = typeof req.body?.correo === "string" ? req.body.correo.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || password.length < 1 || password.length > 256) {
        return responderError(res, 400, "Escribe un correo válido y una contraseña.");
    }
    if (!isSupabaseConfigured()) {
        return responderError(res, 503, "Configura SUPABASE_URL y SUPABASE_ANON_KEY para habilitar el inicio de sesión.");
    }

    try {
        const client = createSupabaseClient();
        const { data, error } = await client.auth.signInWithPassword({ email: correo, password });
        if (error || !data.session || !data.user) {

            // ---> PONLO AQUÍ <---
            console.error("DETALLE DEL ERROR DE SUPABASE:", error);
            return responderError(res, 401, "Correo o contraseña incorrectos.");
        }

        const profileClient = createSupabaseClient(data.session.access_token);
        const { data: profile, error: profileError } = await loadProfile(profileClient, data.user.id);
        if (profileError) {
            console.error("No se pudo consultar el perfil después del inicio de sesión:", profileError);
            return responderError(res, 503, "No se pudo verificar el perfil del usuario.");
        }
        if (!profile || !profile.activo || !["ADMIN", "MENU_STAFF", "CASHIER", "BARISTA"].includes(profile.rol)) {
            return responderError(res, 403, "La cuenta no tiene acceso al sistema de ventas.");
        }

        setSessionCookies(res, data.session);
        return res.json({
            ok: true,
            usuario: {
                id: profile.id,
                nombre: profile.nombre,
                correo: profile.correo,
                rol: profile.rol,
                sucursal_id: profile.sucursal_id
            }
        });
    } catch (error) {
        console.error("Error al iniciar sesión con Supabase:", error);
        return responderError(res, 503, "El servicio de autenticación no está disponible.");
    }
});

router.get("/session", authenticate, (req, res) => {
    res.json({
        usuario: {
            id: req.auth.profile.id,
            nombre: req.auth.profile.nombre,
            correo: req.auth.profile.correo,
            rol: req.auth.profile.rol,
            sucursal_id: req.auth.profile.sucursal_id
        }
    });
});

router.post("/logout", checkSameOrigin, async (req, res) => {
    const cookies = readCookies(req);
    const accessToken = cookies[ACCESS_COOKIE];
    const refreshToken = cookies[REFRESH_COOKIE];

    try {
        if (isSupabaseConfigured() && accessToken && refreshToken) {
            const client = createSupabaseClient();
            const { error: sessionError } = await client.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            });
            if (sessionError) throw sessionError;
            const { error } = await client.auth.signOut({ scope: "local" });
            if (error) throw error;
        }
    } catch (error) {
        console.error("No se pudo invalidar la sesión remota de Supabase:", error);
        clearSessionCookies(res);
        return responderError(res, 503, "Se cerró la sesión local, pero no se pudo invalidar la sesión remota.");
    }

    clearSessionCookies(res);
    return res.status(204).send();
});

module.exports = router;
