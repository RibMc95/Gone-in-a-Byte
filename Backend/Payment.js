const express = require("express");
const crypto = require("crypto");

function getSquareClient() {
    try {
        const square = require("square");
        const Client = square.Client || square.SquareClient;
        const Environment = square.Environment || square.SquareEnvironment;
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

        const client = new Client({
            accessToken,
            token: accessToken,
            environment,
        });

        return { client };
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

function toMoneyAmount(total) {
    const amount = Number(total);
    if (!Number.isFinite(amount) || amount <= 0) {
        return 0;
    }

    return Math.round(amount * 100);
}

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((entry) => entry.detail || entry.code || "Square API error").join("; ");
    }

    if (error && error.message) {
        return error.message;
    }

    return "Unexpected payment error";
}

function toStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.reduce((acc, entry) => {
        const normalized = String(entry || "").trim();
        if (normalized.length > 0) {
            acc.push(normalized);
        }
        return acc;
    }, []);
}

function parseBool(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    if (value.toLowerCase() === "true") {
        return true;
    }
    if (value.toLowerCase() === "false") {
        return false;
    }
    return undefined;
}

function getSquarePayload(result) {
    return result && result.result ? result.result : result;
}

function getPaymentsApi(client) {
    return client.paymentsApi || client.payments;
}

function getApplePayApi(client) {
    return client.applePayApi || client.applePay;
}

function createPaymentRouter({ findOrder, canAccessOrder, addHistory, saveOrder }) {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    router.get("/payment/options", (req, res) => {
        res.json({
            methods: [
                { key: "cashapp", label: "Cash App Pay", enabled: true },
                { key: "square-card", label: "Card (Square)", enabled: true },
                { key: "apple-pay", label: "Apple Pay", enabled: true },
                { key: "paypal-demo", label: "PayPal (Demo)", enabled: true },
            ],
        });
    });

    // Register Apple Pay domain (Square Apple Pay API)
    router.post("/square/apple-pay/domains", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const domainName = String((req.body && (req.body.domainName || req.body.domain_name)) || "").trim();
        if (!domainName) {
            return res.status(400).json({ error: "domainName (or domain_name) is required" });
        }

        try {
            const api = getApplePayApi(client);
            if (!api || typeof api.registerDomain !== "function") {
                return res.status(503).json({
                    error: "Apple Pay API is unavailable in this Square SDK version. Update the square package.",
                });
            }

            const result = await api.registerDomain({ domainName });
            const payload = getSquarePayload(result) || {};
            return res.status(201).json({
                status: payload.status,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    router.post("/orders/:id/cashapp/checkout", async (req, res) => {
        const order = await findOrder(req.params.id);
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        if (!canAccessOrder(req, order)) {
            return res.status(403).json({ error: "You can only access your own order" });
        }

        // Demo fallback token so frontend flow remains connected even before full backend Cash App wiring.
        const token = `demo_cashapp_token_${Date.now()}`;
        await addHistory(order.id, "cashapp_checkout_token", req.userId, { demo: true });
        res.json({ token });
    });

    router.post("/orders/:id/cashapp/capture", async (req, res) => {
        const order = await findOrder(req.params.id);
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        if (!canAccessOrder(req, order)) {
            return res.status(403).json({ error: "You can only access your own order" });
        }

        if (order.paymentStatus === "paid") {
            return res.status(409).json({ error: "Order already paid" });
        }

        order.paymentStatus = "paid";
        order.status = "paid";
        order.updatedAt = new Date().toISOString();
        await saveOrder(order);
        await addHistory(order.id, "cashapp_capture", req.userId, {
            token: String((req.body && req.body.token) || ""),
            demo: true,
        });

        res.json({ ok: true, orderId: order.id, status: order.paymentStatus });
    });

    router.post("/orders/:id/square/card", async (req, res) => {
        const order = await findOrder(req.params.id);
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        if (!canAccessOrder(req, order)) {
            return res.status(403).json({ error: "You can only access your own order" });
        }

        if (order.paymentStatus === "paid") {
            return res.status(409).json({ error: "Order already paid" });
        }

        const { sourceId, verificationToken } = req.body || {};
        if (!sourceId) {
            return res.status(400).json({ error: "Missing sourceId from Square card tokenization" });
        }

        const amountMoney = {
            amount: toMoneyAmount(order.total),
            currency: "USD",
        };

        if (amountMoney.amount <= 0) {
            return res.status(400).json({ error: "Order total must be greater than 0" });
        }

        const { client, error } = getSquareClient();
        if (!client) {
            return res.status(503).json({ error });
        }

        if (!process.env.SQUARE_LOCATION_ID) {
            return res.status(503).json({ error: "SQUARE_LOCATION_ID is not set on the backend." });
        }

        const idempotencyKey = (req.body && req.body.idempotencyKey) || createIdempotencyKey();

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.createPayment === "function"
                ? await paymentsApi.createPayment({
                    sourceId,
                    idempotencyKey,
                    amountMoney,
                    locationId: process.env.SQUARE_LOCATION_ID,
                    buyerEmailAddress: req.body && req.body.buyerEmailAddress,
                    verificationToken: verificationToken || undefined,
                    autocomplete: true,
                    note: `Order ${order.id}`,
                    referenceId: order.id,
                })
                : await paymentsApi.create({
                    sourceId,
                    idempotencyKey,
                    amountMoney,
                    locationId: process.env.SQUARE_LOCATION_ID,
                    buyerEmailAddress: req.body && req.body.buyerEmailAddress,
                    verificationToken: verificationToken || undefined,
                    autocomplete: true,
                    note: `Order ${order.id}`,
                    referenceId: order.id,
                });

            const payload = getSquarePayload(result) || {};
            const payment = payload.payment;
            if (!payment) {
                return res.status(502).json({ error: "Square did not return a payment object" });
            }

            order.paymentStatus = "paid";
            order.status = "paid";
            order.updatedAt = new Date().toISOString();
            await saveOrder(order);
            await addHistory(order.id, "square_card_payment", req.userId, {
                squarePaymentId: payment.id,
                amount: amountMoney.amount,
                currency: amountMoney.currency,
            });

            return res.status(201).json({
                ok: true,
                orderId: order.id,
                paymentStatus: order.paymentStatus,
                squarePaymentId: payment.id,
                receiptUrl: payment.receiptUrl,
                cardBrand: payment.cardDetails && payment.cardDetails.card && payment.cardDetails.card.cardBrand,
                last4: payment.cardDetails && payment.cardDetails.card && payment.cardDetails.card.last4,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // List payments (Square Payments API)
    router.get("/square/payments", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const payload = {};
        const query = req.query || {};

        if (query.beginTime) payload.beginTime = String(query.beginTime);
        if (query.endTime) payload.endTime = String(query.endTime);
        if (query.sortOrder) payload.sortOrder = String(query.sortOrder);
        if (query.cursor) payload.cursor = String(query.cursor);

        if (query.limit !== undefined) {
            const parsedLimit = Number(query.limit);
            if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
                payload.limit = Math.floor(parsedLimit);
            }
        }

        const includeTotal = parseBool(query.includeTotal);
        if (includeTotal !== undefined) payload.includeTotal = includeTotal;

        const locationIds = toStringArray(
            Array.isArray(query.locationId)
                ? query.locationId
                : String(query.locationId || "")
                    .split(",")
        );
        if (locationIds.length > 0) payload.locationId = locationIds;

        if (query.total !== undefined) {
            const total = Number(query.total);
            if (Number.isFinite(total) && total >= 0) {
                payload.total = toMoneyAmount(total);
            }
        }

        if (query.last4) payload.last4 = String(query.last4);
        if (query.cardBrand) payload.cardBrand = String(query.cardBrand);

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.listPayments === "function"
                ? await paymentsApi.listPayments(payload)
                : await paymentsApi.list(payload);
            const responsePayload = getSquarePayload(result) || {};
            return res.json({
                payments: responsePayload.payments || [],
                cursor: responsePayload.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Create payment (Square Payments API)
    router.post("/square/payments", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const body = req.body || {};
        if (!body.sourceId) {
            return res.status(400).json({ error: "sourceId is required" });
        }

        let amountMoney = body.amountMoney;
        if (!amountMoney && body.amount !== undefined) {
            amountMoney = {
                amount: toMoneyAmount(body.amount),
                currency: body.currency || "USD",
            };
        }

        if (!amountMoney || !Number.isFinite(Number(amountMoney.amount)) || Number(amountMoney.amount) <= 0) {
            return res.status(400).json({ error: "amountMoney.amount must be a positive integer in the smallest currency unit" });
        }

        const payload = {
            sourceId: body.sourceId,
            idempotencyKey: body.idempotencyKey || createIdempotencyKey(),
            amountMoney,
            locationId: body.locationId || process.env.SQUARE_LOCATION_ID,
            autocomplete: body.autocomplete !== undefined ? !!body.autocomplete : true,
            note: body.note,
            referenceId: body.referenceId,
            verificationToken: body.verificationToken,
            orderId: body.orderId,
            customerId: body.customerId,
            buyerEmailAddress: body.buyerEmailAddress,
        };

        if (!payload.locationId) {
            return res.status(400).json({ error: "locationId is required (or set SQUARE_LOCATION_ID)" });
        }

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.createPayment === "function"
                ? await paymentsApi.createPayment(payload)
                : await paymentsApi.create(payload);
            const responsePayload = getSquarePayload(result) || {};
            const payment = responsePayload.payment;
            return res.status(201).json({ payment });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Cancel payment by idempotency key
    router.post("/square/payments/cancel-by-idempotency-key", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const idempotencyKey = String((req.body && req.body.idempotencyKey) || "").trim();
        if (!idempotencyKey) {
            return res.status(400).json({ error: "idempotencyKey is required" });
        }

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.cancelPaymentByIdempotencyKey === "function"
                ? await paymentsApi.cancelPaymentByIdempotencyKey({ idempotencyKey })
                : await paymentsApi.cancelByIdempotencyKey({ idempotencyKey });
            const responsePayload = getSquarePayload(result) || {};
            return res.json({ payment: responsePayload.payment });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve payment (get payment)
    router.get("/square/payments/:paymentId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.getPayment === "function"
                ? await paymentsApi.getPayment(req.params.paymentId)
                : typeof paymentsApi.retrievePayment === "function"
                    ? await paymentsApi.retrievePayment(req.params.paymentId)
                    : await paymentsApi.get(req.params.paymentId);
            const responsePayload = getSquarePayload(result) || {};
            return res.json({ payment: responsePayload.payment });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Update payment
    router.put("/square/payments/:paymentId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const body = req.body || {};
        const payload = {
            payment: body.payment || {},
            idempotencyKey: body.idempotencyKey || createIdempotencyKey(),
        };

        if (Array.isArray(body.fieldsToClear)) {
            payload.fieldsToClear = body.fieldsToClear;
        }

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.updatePayment === "function"
                ? await paymentsApi.updatePayment(req.params.paymentId, payload)
                : await paymentsApi.update(req.params.paymentId, payload);
            const responsePayload = getSquarePayload(result) || {};
            return res.json({ payment: responsePayload.payment });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Cancel payment by payment ID
    router.post("/square/payments/:paymentId/cancel", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.cancelPayment === "function"
                ? await paymentsApi.cancelPayment(req.params.paymentId)
                : await paymentsApi.cancel(req.params.paymentId);
            const responsePayload = getSquarePayload(result) || {};
            return res.json({ payment: responsePayload.payment });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Complete payment by payment ID
    router.post("/square/payments/:paymentId/complete", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const body = req.body || {};
        const payload = {
            versionToken: body.versionToken,
        };

        try {
            const paymentsApi = getPaymentsApi(client);
            if (!paymentsApi) {
                return res.status(503).json({ error: "Payments API is unavailable in this Square SDK version." });
            }

            const result = typeof paymentsApi.completePayment === "function"
                ? await paymentsApi.completePayment(req.params.paymentId, payload)
                : await paymentsApi.complete(req.params.paymentId, payload);
            const responsePayload = getSquarePayload(result) || {};
            return res.json({ payment: responsePayload.payment });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createPaymentRouter,
};
