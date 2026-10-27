const { createClient } = require("@supabase/supabase-js");

const ACCESS_COOKIE = "moka-access";
const REFRESH_COOKIE = "moka-refresh";
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/"
};
const STAFF_ROLES = ["ADMIN", "MENU_STAFF", "CASHIER", "BARISTA"];

function isSupabaseConfigured() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function createSupabaseClient(accessToken) {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false
        },
        ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {})
    });
}

function readCookies(req) {
    return Object.fromEntries((req.headers.cookie || "").split(";").flatMap((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [];
        try {
            return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
        } catch {
            return [];
        }
    }));
}

function setSessionCookies(res, session) {
    const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
    res.cookie(ACCESS_COOKIE, session.access_token, {
        ...COOKIE_OPTIONS,
        maxAge: Math.max(0, (expiresAt * 1000) - Date.now())
    });
    res.cookie(REFRESH_COOKIE, session.refresh_token, {
        ...COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });
}

function clearSessionCookies(res) {
    res.clearCookie(ACCESS_COOKIE, COOKIE_OPTIONS);
    res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
}

function responderError(res, status, message) {
    return res.status(status).json({ mensaje: message });
}

async function loadProfile(client, userId) {
    return client
        .from("usuarios")
        .select("id,nombre,correo,rol,sucursal_id,activo")
        .eq("id", userId)
        .maybeSingle();
}

async function authenticate(req, res, next) {
    if (!isSupabaseConfigured()) {
        return responderError(res, 503, "La autenticación no está configurada en el servidor.");
    }

    try {
        return await authenticateRequest(req, res, next);
    } catch (error) {
        console.error("Error al validar la sesión de Supabase:", error);
        if (res.headersSent) return next(error);
        return responderError(res, 503, "No se pudo validar la sesión.");
    }
}

async function authenticateRequest(req, res, next) {
    const cookies = readCookies(req);
    let accessToken = cookies[ACCESS_COOKIE];
    let refreshToken = cookies[REFRESH_COOKIE];
    let client = createSupabaseClient();
    let authResult = accessToken ? await client.auth.getUser(accessToken) : { data: { user: null }, error: null };

    if (authResult.error || !authResult.data.user) {
        if (!refreshToken) {
            clearSessionCookies(res);
            return responderError(res, 401, "Inicia sesión para continuar.");
        }

        const refreshed = await client.auth.refreshSession({ refresh_token: refreshToken });
        if (refreshed.error || !refreshed.data.session) {
            clearSessionCookies(res);
            if (refreshed.error && !refreshed.error.status) {
                console.error("No se pudo renovar la sesión de Supabase:", refreshed.error);
                return responderError(res, 503, "El servicio de autenticación no está disponible.");
            }
            return responderError(res, 401, "La sesión expiró. Inicia sesión nuevamente.");
        }

        setSessionCookies(res, refreshed.data.session);
        accessToken = refreshed.data.session.access_token;
        refreshToken = refreshed.data.session.refresh_token;
        client = createSupabaseClient(accessToken);
        authResult = await client.auth.getUser(accessToken);
    }

    if (authResult.error || !authResult.data.user) {
        clearSessionCookies(res);
        if (authResult.error && !authResult.error.status) {
            console.error("No se pudo validar la sesión de Supabase:", authResult.error);
            return responderError(res, 503, "El servicio de autenticación no está disponible.");
        }
        return responderError(res, 401, "La sesión expiró. Inicia sesión nuevamente.");
    }

    client = createSupabaseClient(accessToken);
    const { data: profile, error: profileError } = await loadProfile(client, authResult.data.user.id);
    if (profileError) {
        console.error("No se pudo consultar el perfil del usuario:", profileError);
        return responderError(res, 503, "No se pudo verificar el perfil del usuario.");
    }
    if (!profile || !profile.activo || !STAFF_ROLES.includes(profile.rol)) {
        clearSessionCookies(res);
        return responderError(res, 403, "La cuenta no tiene acceso al sistema de ventas.");
    }

    req.auth = { user: authResult.data.user, profile, accessToken, refreshToken };
    return next();
}

function requireRoles(roles) {
    return (req, res, next) => {
        if (!roles.includes(req.auth?.profile?.rol)) {
            return responderError(res, 403, "No tienes permisos para realizar esta acción.");
        }
        return next();
    };
}

function checkSameOrigin(req, res, next) {
    const origin = req.get("origin");
    if (origin) {
        try {
            if (new URL(origin).host !== req.get("host")) {
                return responderError(res, 403, "Solicitud de origen no permitido.");
            }
        } catch {
            return responderError(res, 403, "Origen de solicitud no válido.");
        }
    }
    return next();
}

module.exports = {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    STAFF_ROLES,
    authenticate,
    checkSameOrigin,
    clearSessionCookies,
    createSupabaseClient,
    isSupabaseConfigured,
    loadProfile,
    readCookies,
    requireRoles,
    responderError,
    setSessionCookies
};
