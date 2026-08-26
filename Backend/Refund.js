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

    return "Unexpected refund error";
}

function toMoneyAmount(total) {
    const amount = Number(total);
    if (!Number.isFinite(amount) || amount <= 0) {
        return 0;
    }

    return Math.round(amount * 100);
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

function getRefundsApi(client) {
    return client.refundsApi || client.refunds;
}

function createRefundRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    // List payment refunds (GET /v2/refunds)
    router.get("/square/refunds", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const q = req.query || {};
        const payload = {};

        if (q.beginTime || q.begin_time) payload.beginTime = String(q.beginTime || q.begin_time);
        if (q.endTime || q.end_time) payload.endTime = String(q.endTime || q.end_time);
        if (q.sortOrder || q.sort_order) payload.sortOrder = String(q.sortOrder || q.sort_order);
        if (q.cursor) payload.cursor = String(q.cursor);
        if (q.locationId || q.location_id) payload.locationId = String(q.locationId || q.location_id);
        if (q.status) payload.status = String(q.status);
        if (q.sourceType || q.source_type) payload.sourceType = String(q.sourceType || q.source_type);
        if (q.updatedAtBeginTime || q.updated_at_begin_time) {
            payload.updatedAtBeginTime = String(q.updatedAtBeginTime || q.updated_at_begin_time);
        }
        if (q.updatedAtEndTime || q.updated_at_end_time) {
            payload.updatedAtEndTime = String(q.updatedAtEndTime || q.updated_at_end_time);
        }
        if (q.sortField || q.sort_field) payload.sortField = String(q.sortField || q.sort_field);

        if (q.limit !== undefined) {
            const parsed = Number(q.limit);
            if (Number.isFinite(parsed) && parsed > 0) {
                payload.limit = Math.min(100, Math.floor(parsed));
            }
        }

        try {
            const refundsApi = getRefundsApi(client);
            if (!refundsApi) {
                return res.status(503).json({ error: "Refunds API is unavailable in this Square SDK version." });
            }

            const result = typeof refundsApi.listPaymentRefunds === "function"
                ? await refundsApi.listPaymentRefunds(payload)
                : await refundsApi.list(payload);
            const responsePayload = getSquarePayload(result) || {};
            return res.json({
                refunds: responsePayload.refunds || [],
                cursor: responsePayload.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Refund payment (POST /v2/refunds)
    router.post("/square/refunds", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const body = req.body || {};
        const amountMoney = body.amountMoney || body.amount_money || (body.amount !== undefined
            ? {
                amount: toMoneyAmount(body.amount),
                currency: body.currency || "USD",
            }
            : undefined);

        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            amountMoney,
            paymentId: body.paymentId || body.payment_id,
            destinationId: body.destinationId || body.destination_id,
            unlinked: body.unlinked,
            locationId: body.locationId || body.location_id,
            customerId: body.customerId || body.customer_id,
            reason: body.reason,
            paymentVersionToken: body.paymentVersionToken || body.payment_version_token,
            teamMemberId: body.teamMemberId || body.team_member_id,
            appFeeMoney: body.appFeeMoney || body.app_fee_money,
            cashDetails: body.cashDetails || body.cash_details,
            externalDetails: body.externalDetails || body.external_details,
        };

        if (!payload.idempotencyKey) {
            return res.status(400).json({ error: "idempotencyKey is required" });
        }
        if (!payload.amountMoney || !Number.isFinite(Number(payload.amountMoney.amount)) || Number(payload.amountMoney.amount) <= 0) {
            return res.status(400).json({ error: "amountMoney.amount must be a positive integer in the smallest currency unit" });
        }

        const isUnlinked = parseBool(String(payload.unlinked));
        if (isUnlinked === true) {
            if (!payload.destinationId || !payload.locationId) {
                return res.status(400).json({ error: "destinationId and locationId are required when unlinked=true" });
            }
            if (payload.paymentId) {
                return res.status(400).json({ error: "paymentId must not be set when unlinked=true" });
            }
            payload.unlinked = true;
        } else {
            if (!payload.paymentId) {
                return res.status(400).json({ error: "paymentId is required for linked refunds" });
            }
            payload.unlinked = false;
        }

        try {
            const refundsApi = getRefundsApi(client);
            if (!refundsApi) {
                return res.status(503).json({ error: "Refunds API is unavailable in this Square SDK version." });
            }

            const result = await refundsApi.refundPayment(payload);
            const responsePayload = getSquarePayload(result) || {};
            return res.status(201).json({
                refund: responsePayload.refund,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Get payment refund (GET /v2/refunds/{refund_id})
    router.get("/square/refunds/:refundId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const refundsApi = getRefundsApi(client);
            if (!refundsApi) {
                return res.status(503).json({ error: "Refunds API is unavailable in this Square SDK version." });
            }

            const result = typeof refundsApi.getPaymentRefund === "function"
                ? await refundsApi.getPaymentRefund(req.params.refundId)
                : typeof refundsApi.retrievePaymentRefund === "function"
                    ? await refundsApi.retrievePaymentRefund(req.params.refundId)
                    : await refundsApi.get(req.params.refundId);

            const responsePayload = getSquarePayload(result) || {};

            return res.json({
                refund: responsePayload.refund,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createRefundRouter,
};
