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

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((entry) => entry.detail || entry.code || "Square API error").join("; ");
    }

    if (error && error.message) {
        return error.message;
    }

    return "Unexpected card error";
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

function createCardsRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    // List cards (GET /v2/cards)
    router.get("/square/cards", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const q = req.query || {};
        const payload = {};

        if (q.cursor) payload.cursor = String(q.cursor);
        if (q.customerId || q.customer_id) payload.customerId = String(q.customerId || q.customer_id);
        if (q.referenceId || q.reference_id) payload.referenceId = String(q.referenceId || q.reference_id);
        if (q.sortOrder || q.sort_order) payload.sortOrder = String(q.sortOrder || q.sort_order);

        const includeDisabled = parseBool(q.includeDisabled || q.include_disabled);
        if (includeDisabled !== undefined) {
            payload.includeDisabled = includeDisabled;
        }

        try {
            const result = await client.cards.list(payload);
            return res.json({
                cards: (result && result.result && result.result.cards) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Create card (POST /v2/cards)
    router.post("/square/cards", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const body = req.body || {};
        const sourceId = body.sourceId || body.source_id;
        const verificationToken = body.verificationToken || body.verification_token;

        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            sourceId,
            verificationToken,
            card: body.card,
        };

        if (!payload.idempotencyKey) {
            return res.status(400).json({ error: "idempotencyKey is required" });
        }
        if (!payload.sourceId) {
            return res.status(400).json({ error: "sourceId is required" });
        }
        if (!payload.card || typeof payload.card !== "object") {
            return res.status(400).json({ error: "card object is required" });
        }

        try {
            const result = await client.cards.create(payload);
            return res.status(201).json({
                card: result && result.result && result.result.card,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve card (GET /v2/cards/{card_id})
    router.get("/square/cards/:cardId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const result = await client.cards.get(req.params.cardId);

            return res.json({
                card: result && result.result && result.result.card,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Disable card (POST /v2/cards/{card_id}/disable)
    router.post("/square/cards/:cardId/disable", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const result = await client.cards.disable(req.params.cardId);
            return res.json({
                card: result && result.result && result.result.card,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createCardsRouter,
};
