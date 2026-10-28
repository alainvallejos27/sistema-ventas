const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const { after, before, test } = require("node:test");
const net = require("node:net");
const { authenticate } = require("../middleware/auth");

let serverProcess;
let baseUrl;
let serverOutput = "";

before(async () => {
    const portServer = net.createServer();
    await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const { port } = portServer.address();
    await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));

    const backendDirectory = path.resolve(__dirname, "..");
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, ["server.js"], {
        cwd: backendDirectory,
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: "test",
            SUPABASE_URL: "",
            SUPABASE_ANON_KEY: ""
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    serverProcess.stdout.on("data", (chunk) => { serverOutput += chunk; });
    serverProcess.stderr.on("data", (chunk) => { serverOutput += chunk; });

    for (let attempt = 0; attempt < 300; attempt += 1) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`Backend exited before startup:\n${serverOutput}`);
        }
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.ok) return;
            serverOutput += `Health probe returned ${response.status}.\n`;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    serverProcess.kill("SIGTERM");
    throw new Error(`Backend did not start at ${baseUrl} (exit code: ${serverProcess.exitCode}):\n${serverOutput}`);
});

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill("SIGTERM");
        await once(serverProcess, "exit");
    }
});

test("serves the login screen with security headers and a public health check", async () => {
    const page = await fetch(baseUrl);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /id="login-form"/);
    assert.ok(page.headers.get("content-security-policy"));
    assert.equal(page.headers.get("x-powered-by"), null);

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { estado: "ok" });
});

test("does not fall back to demo data when Supabase is missing and blocks protected operations", async () => {
    const catalog = await fetch(`${baseUrl}/api/productos`);
    assert.equal(catalog.status, 502);
    assert.match((await catalog.json()).mensaje, /base de datos/i);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: "personal@moka.com", password: "example" })
    });
    assert.equal(login.status, 503);
    assert.equal(login.headers.get("set-cookie"), null);

    const protectedRoute = await fetch(`${baseUrl}/api/pedidos`, { method: "POST" });
    assert.equal(protectedRoute.status, 503);
});

test("rejects cross-origin login and logout attempts", async () => {
    for (const endpoint of ["/api/auth/login", "/api/auth/logout"]) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        assert.equal(response.status, 403);
    }
});

test("returns 401 for protected routes when Supabase is configured but there is no session", async () => {
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_ANON_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-public-key";
    const response = {
        status(status) { this.statusCode = status; return this; },
        json(body) { this.body = body; return this; },
        clearCookie() {},
        headersSent: false
    };

    try {
        await authenticate({ headers: {} }, response, () => assert.fail("Unauthenticated request passed through"));
    } finally {
        if (previousUrl === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = previousUrl;
        if (previousKey === undefined) delete process.env.SUPABASE_ANON_KEY;
        else process.env.SUPABASE_ANON_KEY = previousKey;
    }

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.mensaje, "Inicia sesión para continuar.");
});
