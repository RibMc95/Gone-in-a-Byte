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
            return {
                error: "SQUARE_ACCESS_TOKEN is not set on the backend.",
            };
        }

        return {
            client: new Client({
                accessToken,
                environment,
            }),
        };
    } catch (error) {
        return {
            error: "Square SDK is not installed. Run npm install square in Backend.",
        };
    }
}

function normalizeSquareError(error) {
    const fromSdk = error && error.result && error.result.errors;
    if (Array.isArray(fromSdk) && fromSdk.length > 0) {
        return fromSdk.map((entry) => entry.detail || entry.code || "Square API error").join("; ");
    }

    if (error && error.message) {
        return error.message;
    }

    return "Unexpected bank account error";
}

function createBankAccountRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    // ListBankAccounts
    router.get("/square/bank-accounts", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        const q = req.query || {};
        const cursor = q.cursor ? String(q.cursor) : undefined;
        const limit = q.limit !== undefined ? Number(q.limit) : undefined;
        const locationId = q.locationId || q.location_id || process.env.SQUARE_LOCATION_ID || undefined;

        try {
            const result = await client.bankAccounts.list(
                cursor,
                Number.isFinite(limit) ? limit : undefined,
                locationId
            );

            return res.json({
                bankAccounts: (result && result.result && result.result.bankAccounts) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // GetBankAccountByV1Id
    router.get("/square/bank-accounts/by-v1-id/:v1BankAccountId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.bankAccounts.getByV1Id(
                req.params.v1BankAccountId
            );

            return res.json({
                bankAccount: result && result.result && result.result.bankAccount,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // GetBankAccount
    router.get("/square/bank-accounts/:bankAccountId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.bankAccounts.get(req.params.bankAccountId);

            return res.json({
                bankAccount: result && result.result && result.result.bankAccount,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // DisableBankAccount
    router.post("/square/bank-accounts/:bankAccountId/disable", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) return;

        try {
            const result = await client.bankAccounts.disableBankAccount(
                req.params.bankAccountId
            );

            return res.json({
                bankAccount: result && result.result && result.result.bankAccount,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createBankAccountRouter,
};
