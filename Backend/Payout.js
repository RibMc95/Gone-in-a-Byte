const express = require("express");

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
            return { error: "SQUARE_ACCESS_TOKEN is not set on the backend." };
        }

        return { client: new Client({ accessToken, environment }) };
    } catch (error) {
        return { error: "Square SDK is not installed. Run npm install square in Backend." };
    }
}

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((e) => e.detail || e.code || "Square API error").join("; ");
    }
    if (error && error.message) return error.message;
    return "Unexpected payout error";
}

function createPayoutRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }
        return client;
    }

    // ListPayouts
    // GET /square/payouts
    // Query params: locationId, status, beginTime, endTime, sortOrder, cursor, limit
    router.get("/square/payouts", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const locationId = q.locationId || q.location_id || process.env.SQUARE_LOCATION_ID || undefined;

        const params = {
            locationId,
            status: q.status || undefined,
            beginTime: q.beginTime || q.begin_time || undefined,
            endTime: q.endTime || q.end_time || undefined,
            sortOrder: q.sortOrder || q.sort_order || undefined,
            cursor: q.cursor || undefined,
            limit: q.limit !== undefined ? Number(q.limit) : undefined,
        };

        // Remove undefined keys to keep the SDK call clean
        Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);

        try {
            const result = await client.payouts.list(params);
            return res.json({
                payouts: (result && result.result && result.result.payouts) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // GetPayout
    // GET /square/payouts/:payoutId
    router.get("/square/payouts/:payoutId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.payouts.get(req.params.payoutId);
            return res.json({
                payout: result && result.result && result.result.payout,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // ListPayoutEntries
    // GET /square/payouts/:payoutId/entries
    // Query params: sortOrder, cursor, limit
    router.get("/square/payouts/:payoutId/entries", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};

        const params = {
            sortOrder: q.sortOrder || q.sort_order || undefined,
            cursor: q.cursor || undefined,
            limit: q.limit !== undefined ? Number(q.limit) : undefined,
        };

        Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);

        try {
            const result = await client.payouts.listEntries(req.params.payoutId, params);
            return res.json({
                payoutEntries: (result && result.result && result.result.payoutEntries) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = { createPayoutRouter };
