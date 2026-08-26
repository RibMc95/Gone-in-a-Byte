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

    return "Unexpected dispute error";
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

function toNodeFileWrapper(filePayload) {
    if (!filePayload || typeof filePayload !== "object") {
        return null;
    }

    const contentBase64 = String(filePayload.contentBase64 || "").trim();
    if (!contentBase64) {
        return null;
    }

    return {
        data: Buffer.from(contentBase64, "base64"),
        fileName: filePayload.fileName || filePayload.filename || "evidence",
        contentType: filePayload.contentType || filePayload.content_type || "application/octet-stream",
    };
}

function createDisputesRouter() {
    const router = express.Router();

    function requireSquareConfig(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }

        return client;
    }

    // List disputes
    router.get("/square/disputes", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const q = req.query || {};
        const payload = {};

        if (q.cursor) payload.cursor = String(q.cursor);
        if (q.locationId || q.location_id) payload.locationId = String(q.locationId || q.location_id);

        const states = toStringArray(
            Array.isArray(q.states)
                ? q.states
                : String(q.states || "").split(",")
        );
        if (states.length > 0) {
            payload.states = states;
        }

        try {
            const result = await client.disputes.list(payload);
            return res.json({
                disputes: (result && result.result && result.result.disputes) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve dispute
    router.get("/square/disputes/:disputeId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const result = await client.disputes.get(req.params.disputeId);
            return res.json({
                dispute: result && result.result && result.result.dispute,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Accept dispute
    router.post("/square/disputes/:disputeId/accept", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const result = await client.disputes.accept(req.params.disputeId);
            return res.json({
                dispute: result && result.result && result.result.dispute,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // List dispute evidence
    router.get("/square/disputes/:disputeId/evidence", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const payload = {};
        if (req.query && req.query.cursor) {
            payload.cursor = String(req.query.cursor);
        }

        try {
            const result = await client.disputes.evidence.list(req.params.disputeId, payload);
            return res.json({
                evidence: (result && result.result && result.result.evidence) || [],
                cursor: result && result.result && result.result.cursor,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Create dispute evidence text
    router.post("/square/disputes/:disputeId/evidence-text", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const body = req.body || {};
        const payload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            evidenceType: body.evidenceType || body.evidence_type,
            evidenceText: body.evidenceText || body.evidence_text,
        };

        if (!payload.evidenceText) {
            return res.status(400).json({ error: "evidenceText is required" });
        }

        try {
            const result = await client.disputes.createEvidenceText(req.params.disputeId, payload);
            return res.status(201).json({
                evidence: result && result.result && result.result.evidence,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Create dispute evidence file
    router.post("/square/disputes/:disputeId/evidence-files", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        const body = req.body || {};
        const requestPayload = {
            idempotencyKey: body.idempotencyKey || body.idempotency_key || createIdempotencyKey(),
            evidenceType: body.evidenceType || body.evidence_type,
            contentType: body.contentType || body.content_type,
        };
        const fileWrapper = toNodeFileWrapper(body.file);

        if (!fileWrapper) {
            return res.status(400).json({
                error: "file.contentBase64 is required. Send JSON body with file.contentBase64, file.fileName, and file.contentType.",
            });
        }

        try {
            let result;
            result = await client.disputes.createEvidenceFile(
                req.params.disputeId,
                requestPayload,
                fileWrapper
            );

            return res.status(201).json({
                evidence: result && result.result && result.result.evidence,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Retrieve dispute evidence
    router.get("/square/disputes/:disputeId/evidence/:evidenceId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const result = await client.disputes.evidence.get(
                req.params.disputeId,
                req.params.evidenceId
            );
            return res.json({
                evidence: result && result.result && result.result.evidence,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Delete dispute evidence
    router.delete("/square/disputes/:disputeId/evidence/:evidenceId", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            await client.disputes.evidence.delete(req.params.disputeId, req.params.evidenceId);
            return res.json({ ok: true });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // Submit evidence
    router.post("/square/disputes/:disputeId/submit-evidence", async (req, res) => {
        const client = requireSquareConfig(res);
        if (!client) {
            return;
        }

        try {
            const result = await client.disputes.submitEvidence(req.params.disputeId);
            return res.json({
                dispute: result && result.result && result.result.dispute,
            });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    return router;
}

module.exports = {
    createDisputesRouter,
};
