/*
Simple Order API

How to run:
1) npm init -y
2) npm install express
3) node Order.js

Headers used as a lightweight auth simulation:
- x-user-id: any string (example: user-123)
*/

const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createPaymentRouter } = require("./Payment");
const { createRefundRouter } = require("./Refund");
const { createCardsRouter } = require("./Cards");
const { createDisputesRouter } = require("./Disputes");
const { createCatalogRouter } = require("./Catalog");
const { createInventoryRouter } = require("./Inventory");
const { createInvoiceRouter } = require("./invoice");
const { createOauthRouter } = require("./Oauth");
const { createWebhooksRouter } = require("./Webhooks");
const { createBankAccountRouter } = require("./BankAccount");
const { createPayoutRouter } = require("./Payout");
const { createCustomerRouter } = require("./Customer");
const { createOrderCustomAttributesRouter } = require("./OrderCustomAttributes");
const { createUserLoginRouter } = require("./UserLogin");
const { createStorage } = require("./storage");

const app = express();
const PORT = process.env.PORT || 3001;
const storage = createStorage();
let server;
let isShuttingDown = false;

// Security headers on every response.
app.use(helmet());

// CORS: only reflect origins on the allowlist instead of "*".
// Set ALLOWED_ORIGINS in .env as a comma-separated list, e.g.
// ALLOWED_ORIGINS=http://localhost:8080,https://goneinabite.com
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:8080")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }
    next();
});

// Rate limiting. A general cap on all routes, plus a stricter cap on the
// auth endpoints to slow credential-stuffing and brute-force attempts.
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many attempts. Please try again later." },
});
app.use(generalLimiter);
app.use(["/login", "/register"], authLimiter);

app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf.toString("utf8");
        },
    })
);

function getSquareClient() {
    try {
        const square = require("square");
        const Client = square.SquareClient;
        const Environment = square.SquareEnvironment;
        const accessToken = process.env.SQUARE_ACCESS_TOKEN;
        const environment =
            process.env.SQUARE_ENVIRONMENT === "production"
                ? Environment.Production
                : Environment.Sandbox;

        if (!accessToken) {
            return {
                error: "SQUARE_ACCESS_TOKEN is not set on the backend.",
            };
        }

        return {
            client: new Client({
                token: accessToken,
                environment,
            }),
        };
    } catch (error) {
        return {
            error: "Square SDK is not installed. Run npm install square in Backend.",
        };
    }
}

function createIdempotencyKey() {
    if (crypto && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `idem_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((entry) => entry.detail || entry.code || "Square API error").join("; ");
    }

    if (error && error.message) {
        return error.message;
    }

    return "Unexpected Square API error";
}

// Utility functions
function createOrderId() {
    return `ord_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function addHistory(orderId, action, actor, details, userId = actor) {
    await storage.addHistoryEntry({
        historyId: `hist_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        orderId,
        action,
        actor,
        userId,
        details,
        timestamp: new Date().toISOString(),
    });
}

// Verify the JWT issued at login and derive the user from it.
// Login is required for order routes — no more trusting a spoofable header.
const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-me";

function auth(req, res, next) {
    const header = req.header("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return res.status(401).json({ error: "Authentication required. Please log in." });
    }

    try {
        const payload = jwt.verify(match[1], JWT_SECRET);
        const email = payload && typeof payload.email === "string" ? payload.email : "";
        if (!email) {
            return res.status(401).json({ error: "Invalid authentication token." });
        }
        req.userId = email;
        return next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired authentication token." });
    }
}

// Helper functions
async function findOrder(orderId) {
    return storage.getOrder(orderId);
}

async function saveOrder(order) {
    return storage.putOrder(order);
}

// Check if the user can access the order (owner only)
function canAccessOrder(req, order) {
    return order.userId === req.userId;
}

// Normalize items to ensure they have consistent structure and types
function normalizeItems(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.reduce((acc, item) => {
        const normalizedItem = {
            id: String(item.id || ""),
            name: String(item.name || "Unknown Item"),
            price: Number(item.price) || 0,
            qty: Math.max(1, Number(item.qty) || 1),
        };

        if (normalizedItem.id.length > 0 || normalizedItem.name.length > 0) {
            acc.push(normalizedItem);
        }

        return acc;
    }, []);
}

function validateOrderItems(items) {
    if (items === undefined) {
        return "items is required and must contain at least one item";
    }

    if (!Array.isArray(items)) {
        return "items must be an array";
    }

    if (items.length === 0) {
        return "items must contain at least one item";
    }

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index] || {};
        const price = Number(item.price);
        const qty = Number(item.qty);

        if (!Number.isFinite(price) || price < 0) {
            return `items[${index}].price must be a number greater than or equal to 0`;
        }

        if (!Number.isFinite(qty) || qty < 1) {
            return `items[${index}].qty must be a number greater than or equal to 1`;
        }
    }

    return null;
}

// Calculate total price for an order based on its items
function calculateOrderTotal(items) {
    return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function toSquareMoneyAmount(dollars) {
    const amount = Number(dollars);
    if (!Number.isFinite(amount) || amount < 0) {
        return 0;
    }

    return Math.round(amount * 100);
}

function toSquareLineItems(items) {
    return normalizeItems(items).map((item) => ({
        name: item.name,
        quantity: String(item.qty),
        basePriceMoney: {
            amount: toSquareMoneyAmount(item.price),
            currency: "USD",
        },
    }));
}

function toStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.reduce((acc, entry) => {
        const normalized = String(entry || "");
        if (normalized.length > 0) {
            acc.push(normalized);
        }
        return acc;
    }, []);
}

// Require a valid login only on user-owned order routes. Public routes
// (/health, /login, /register, /oauth/*, Square admin/webhooks) stay open.
// This also covers the payment router's /orders/:id/... routes.
app.use("/orders", auth);

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ ok: true, service: "order-api" });
});

// Create order
app.post("/orders", async (req, res) => {
    if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({
            error: "Request body must be valid JSON. Set Content-Type to application/json.",
        });
    }

    const { items = [], note = "" } = req.body;
    const validationError = validateOrderItems(items);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const normalizedItems = normalizeItems(items);
    const total = calculateOrderTotal(normalizedItems);

    const order = {
        id: createOrderId(),
        userId: req.userId,
        items: normalizedItems,
        total,
        note,
        status: "created",
        paymentStatus: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    await saveOrder(order);
    await addHistory(order.id, "create", req.userId, { total: order.total, items: order.items.length });

    res.status(201).json(order);
});

// Get my orders
app.get("/orders", async (req, res) => {
    const myOrders = await storage.listOrdersByUser(req.userId);
    res.json(myOrders);
});

// Get my order history
app.get("/orders/history/me", async (req, res) => {
    const myHistory = await storage.listHistoryForUser(req.userId);
    res.json(myHistory);
});

// Get single order (owner only)
app.get("/orders/:id", async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    if (!canAccessOrder(req, order)) {
        return res.status(403).json({ error: "You can only access your own order" });
    }

    res.json(order);
});

// Sync a local order to Square Orders API (Create order)
app.post("/orders/:id/square/sync", async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    if (!canAccessOrder(req, order)) {
        return res.status(403).json({ error: "You can only access your own order" });
    }

    if (!process.env.SQUARE_LOCATION_ID) {
        return res.status(503).json({ error: "SQUARE_LOCATION_ID is not set on the backend." });
    }

    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const idempotencyKey = (req.body && req.body.idempotencyKey) || createIdempotencyKey();

    try {
        const result = await client.ordersApi.createOrder({
            idempotencyKey,
            order: {
                locationId: process.env.SQUARE_LOCATION_ID,
                lineItems: toSquareLineItems(order.items),
                referenceId: order.id,
                note: typeof order.note === "string" ? order.note : "",
            },
        });

        const squareOrder = result && result.result && result.result.order;
        if (!squareOrder || !squareOrder.id) {
            return res.status(502).json({ error: "Square did not return an order object" });
        }

        order.squareOrderId = squareOrder.id;
        order.updatedAt = new Date().toISOString();
        await saveOrder(order);
        await addHistory(order.id, "square_order_sync", req.userId, {
            squareOrderId: squareOrder.id,
        });

        return res.status(201).json({
            ok: true,
            orderId: order.id,
            squareOrderId: squareOrder.id,
            squareOrderState: squareOrder.state,
            squareVersion: squareOrder.version,
            totalMoney: squareOrder.totalMoney,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Retrieve synced Square order by local order ID
app.get("/orders/:id/square", async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    if (!canAccessOrder(req, order)) {
        return res.status(403).json({ error: "You can only access your own order" });
    }

    if (!order.squareOrderId) {
        return res.status(400).json({
            error: "This order is not synced to Square yet. Call POST /orders/:id/square/sync first.",
        });
    }

    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    try {
        const result = await client.ordersApi.retrieveOrder(order.squareOrderId);
        const squareOrder = result && result.result && result.result.order;
        if (!squareOrder) {
            return res.status(502).json({ error: "Square did not return an order object" });
        }

        return res.json({
            localOrderId: order.id,
            squareOrder,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Search Square orders for this location
app.post("/square/orders/search", async (req, res) => {
    if (!process.env.SQUARE_LOCATION_ID) {
        return res.status(503).json({ error: "SQUARE_LOCATION_ID is not set on the backend." });
    }

    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const limit = Math.min(100, Math.max(1, Number(req.body && req.body.limit) || 25));
    const cursor = req.body && req.body.cursor;

    try {
        const result = await client.ordersApi.searchOrders({
            locationIds: [process.env.SQUARE_LOCATION_ID],
            cursor,
            limit,
            query: req.body && req.body.query,
        });

        return res.json({
            orders: (result && result.result && result.result.orders) || [],
            cursor: result && result.result && result.result.cursor,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Retrieve a Square order directly by Square order ID
app.get("/square/orders/:squareOrderId", async (req, res) => {
    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    try {
        const result = await client.ordersApi.retrieveOrder(req.params.squareOrderId);
        const squareOrder = result && result.result && result.result.order;
        if (!squareOrder) {
            return res.status(502).json({ error: "Square did not return an order object" });
        }

        return res.json({ squareOrder });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Batch retrieve Square orders by IDs
app.post("/square/orders", async (req, res) => {
    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const body = req.body || {};
    const requestOrder = body.order;
    if (!requestOrder || typeof requestOrder !== "object") {
        return res.status(400).json({ error: "order object is required" });
    }

    const idempotencyKey = body.idempotencyKey || body.idempotency_key || createIdempotencyKey();

    const payload = {
        idempotencyKey,
        order: {
            ...requestOrder,
            locationId: requestOrder.locationId || requestOrder.location_id || process.env.SQUARE_LOCATION_ID,
        },
    };

    if (!payload.order.locationId) {
        return res.status(400).json({
            error: "order.locationId is required (or set SQUARE_LOCATION_ID)",
        });
    }

    try {
        const result = await client.ordersApi.createOrder(payload);
        return res.status(201).json({
            order: result && result.result && result.result.order,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Batch retrieve Square orders by IDs
app.post("/square/orders/batch-retrieve", async (req, res) => {
    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const orderIds = toStringArray(req.body && (req.body.orderIds || req.body.order_ids));
    if (orderIds.length === 0) {
        return res.status(400).json({ error: "orderIds is required and must be a non-empty array" });
    }

    try {
        const result = await client.ordersApi.batchRetrieveOrders({ orderIds });
        return res.json({
            orders: (result && result.result && result.result.orders) || [],
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Calculate order pricing without creating an order
app.post("/square/orders/calculate", async (req, res) => {
    if (!process.env.SQUARE_LOCATION_ID) {
        return res.status(503).json({ error: "SQUARE_LOCATION_ID is not set on the backend." });
    }

    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const requestOrder = req.body && req.body.order;
    if (!requestOrder || typeof requestOrder !== "object") {
        return res.status(400).json({ error: "order object is required" });
    }

    const payload = {
        order: {
            ...requestOrder,
            locationId: requestOrder.locationId || process.env.SQUARE_LOCATION_ID,
        },
    };

    try {
        const result = await client.ordersApi.calculateOrder(payload);
        return res.json({
            order: result && result.result && result.result.order,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Clone a Square order (creates a DRAFT clone)
app.post("/square/orders/clone", async (req, res) => {
    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const orderId = String((req.body && req.body.orderId) || "").trim();
    if (!orderId) {
        return res.status(400).json({ error: "orderId is required" });
    }

    const payload = {
        orderId,
        idempotencyKey: (req.body && req.body.idempotencyKey) || createIdempotencyKey(),
    };

    if (req.body && Number.isInteger(req.body.version)) {
        payload.version = req.body.version;
    }

    try {
        const result = await client.ordersApi.cloneOrder(payload);
        const cloned = result && result.result && result.result.order;
        return res.status(201).json({
            order: cloned,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Update a Square order by Square order ID
app.put("/square/orders/:squareOrderId", async (req, res) => {
    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const order = req.body && req.body.order;
    if (!order || typeof order !== "object") {
        return res.status(400).json({ error: "order object is required" });
    }

    const payload = {
        order,
    };

    if (Array.isArray(req.body && req.body.fieldsToClear)) {
        payload.fieldsToClear = req.body.fieldsToClear;
    }

    try {
        const result = await client.ordersApi.updateOrder(req.params.squareOrderId, payload);
        return res.json({
            order: result && result.result && result.result.order,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Pay an order with approved payment IDs or settle $0 orders
app.post("/square/orders/:squareOrderId/pay", async (req, res) => {
    const { client, error } = getSquareClient();
    if (!client) {
        return res.status(503).json({ error });
    }

    const payload = {
        idempotencyKey: (req.body && req.body.idempotencyKey) || createIdempotencyKey(),
    };

    const paymentIds = toStringArray(req.body && req.body.paymentIds);
    if (paymentIds.length > 0) {
        payload.paymentIds = paymentIds;
    }

    if (req.body && req.body.orderVersion !== undefined) {
        payload.orderVersion = Number(req.body.orderVersion);
    }

    try {
        const result = await client.ordersApi.payOrder(req.params.squareOrderId, payload);
        return res.json({
            order: result && result.result && result.result.order,
        });
    } catch (squareError) {
        return res.status(502).json({ error: normalizeSquareError(squareError) });
    }
});

// Update order (owner only)
app.patch("/orders/:id", async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    if (!canAccessOrder(req, order)) {
        return res.status(403).json({ error: "You can only update your own order" });
    }

    const allowedFields = ["items", "total", "note", "status", "paymentStatus"];
    for (const field of allowedFields) {
        if (field in req.body) {
            if (field === "items") {
                order.items = normalizeItems(req.body.items);
            } else if (field !== "total") {
                order[field] = req.body[field];
            }
        }
    }

    order.total = calculateOrderTotal(order.items);

    order.updatedAt = new Date().toISOString();
    await saveOrder(order);
    await addHistory(order.id, "update", req.userId, { changes: Object.keys(req.body) });

    res.json(order);
});

// Delete order (owner only)
app.delete("/orders/:id", async (req, res) => {
    const order = await findOrder(req.params.id);
    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    if (!canAccessOrder(req, order)) {
        return res.status(403).json({ error: "You can only delete your own order" });
    }

    await storage.deleteOrder(order.id);
    await addHistory(order.id, "delete", req.userId, {});

    res.json({ message: "Order deleted", id: order.id });
});

// Mount payment routes (Cash App Pay + payment options)
app.use(createPaymentRouter({ findOrder, canAccessOrder, addHistory, saveOrder }));
app.use(createRefundRouter());
app.use(createCardsRouter());
app.use(createDisputesRouter());
app.use(createCatalogRouter());
app.use(createInventoryRouter());
app.use(createInvoiceRouter());
app.use(createOauthRouter());
app.use(createWebhooksRouter());
app.use(createBankAccountRouter());
app.use(createPayoutRouter());
app.use(createCustomerRouter());
app.use(createOrderCustomAttributesRouter());
app.use(createUserLoginRouter());

async function start() {
    try {
        await storage.init();
        console.log("Oracle DB connected.");
    } catch (dbError) {
        console.warn("Oracle DB unavailable — starting without database:", dbError.message);
        console.warn("Order/history routes will fail until DB is configured.");
    }
    server = app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
    });
}

function closeServer() {
    if (!server) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                return reject(error);
            }
            return resolve();
        });
    });
}

async function shutdown(signal) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}. Shutting down backend gracefully...`);

    try {
        await closeServer();

        if (typeof storage.close === "function") {
            await storage.close();
        }

        console.log("Backend shutdown complete.");
        process.exit(0);
    } catch (error) {
        console.error("Error during graceful shutdown", error);
        process.exit(1);
    }
}

process.on("SIGTERM", () => {
    shutdown("SIGTERM");
});

process.on("SIGINT", () => {
    shutdown("SIGINT");
});

start().catch((error) => {
    console.error("Failed to start backend", error);
    process.exit(1);
});
