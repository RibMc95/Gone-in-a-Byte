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

        const clientConfig = {
            environment,
        };

        if (accessToken) {
            clientConfig.accessToken = accessToken;
        }

        return {
            client: new Client(clientConfig),
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

    return "Unexpected OAuth error";
}

function verifyWebhookSignature(signatureHeader, rawBody, notificationUrl, signatureKey) {
    if (!signatureHeader || !rawBody || !notificationUrl || !signatureKey) {
        return false;
    }

    const payload = `${notificationUrl}${rawBody}`;
    const expectedSignature = crypto
        .createHmac("sha256", signatureKey)
        .update(payload, "utf8")
        .digest("base64");

    const provided = Buffer.from(String(signatureHeader), "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (provided.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(provided, expected);
}

function createAuthorizeUrl(params) {
    const environment = process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
    const base =
        environment === "production"
            ? "https://connect.squareup.com/oauth2/authorize"
            : "https://connect.squareupsandbox.com/oauth2/authorize";

    const url = new URL(base);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).length > 0) {
            url.searchParams.set(key, String(value));
        }
    });
    return url.toString();
}

// In-memory store for CSRF state tokens. Each entry expires after 10 minutes.
const pendingStates = new Map();

function createState() {
    const token = crypto.randomBytes(32).toString("hex");
    pendingStates.set(token, Date.now());
    return token;
}

function validateState(token) {
    const created = pendingStates.get(token);
    if (!created) return false;
    pendingStates.delete(token);
    return Date.now() - created < 10 * 60 * 1000;
}

function createOauthRouter() {
    const router = express.Router();

    function requireSquareClient(res) {
        const { client, error } = getSquareClient();
        if (!client) {
            res.status(503).json({ error });
            return null;
        }
        return client;
    }

    // Step 1 — Redirect the merchant to Square's authorization page.
    // Set SQUARE_OAUTH_REDIRECT_URI in .env to: http://localhost:3001/oauth/callback
    router.get("/oauth/connect", (req, res) => {
        const clientId = (process.env.SQUARE_APPLICATION_ID || process.env.SQUARE_CLIENT_ID || "").trim();
        const redirectUri = (process.env.SQUARE_OAUTH_REDIRECT_URI || "").trim();

        if (!clientId) {
            return res.status(503).send("SQUARE_APPLICATION_ID is not set in .env");
        }
        if (!redirectUri) {
            return res.status(503).send("SQUARE_OAUTH_REDIRECT_URI is not set in .env");
        }

        const state = createState();
        const scope = [
            "MERCHANT_PROFILE_READ",
            "PAYMENTS_READ",
            "PAYMENTS_WRITE",
            "ORDERS_READ",
            "ORDERS_WRITE",
        ].join(" ");

        const authorizeUrl = createAuthorizeUrl({
            client_id: clientId,
            response_type: "code",
            scope,
            redirect_uri: redirectUri,
            state,
        });

        return res.redirect(authorizeUrl);
    });

    // Step 2 — Square redirects here with ?code=&state= after the merchant approves.
    // The backend exchanges the code for a permanent access token and refresh token.
    router.get("/oauth/callback", async (req, res) => {
        const { code, state, error: squareError } = req.query;

        // Merchant denied the request
        if (squareError) {
            return res.redirect(`/oauth-result.html?status=error&reason=${encodeURIComponent(squareError)}`);
        }

        if (!state || !validateState(String(state))) {
            return res.redirect("/oauth-result.html?status=error&reason=invalid_state");
        }

        if (!code) {
            return res.redirect("/oauth-result.html?status=error&reason=missing_code");
        }

        const clientId = (process.env.SQUARE_APPLICATION_ID || process.env.SQUARE_CLIENT_ID || "").trim();
        const clientSecret = (process.env.SQUARE_APPLICATION_SECRET || process.env.SQUARE_CLIENT_SECRET || "").trim();
        const redirectUri = (process.env.SQUARE_OAUTH_REDIRECT_URI || "").trim();

        if (!clientId || !clientSecret) {
            return res.redirect("/oauth-result.html?status=error&reason=server_misconfigured");
        }

        const { client } = getSquareClient();
        if (!client) {
            return res.redirect("/oauth-result.html?status=error&reason=square_sdk_unavailable");
        }

        try {
            const result = await client.oAuth.obtainToken({
                clientId,
                clientSecret,
                grantType: "authorization_code",
                code: String(code),
                redirectUri,
            });

            const token = result && result.result ? result.result : result;

            // Log the tokens server-side only — never send them to the browser.
            console.log("=== Square OAuth: Merchant Connected ===");
            console.log("Merchant ID  :", token.merchantId);
            console.log("Access Token :", token.accessToken);
            console.log("Refresh Token:", token.refreshToken);
            console.log("Expires At   :", token.expiresAt);
            console.log("========================================");

            return res.redirect(
                `/oauth-result.html?status=success&merchant=${encodeURIComponent(token.merchantId || "")}`
            );
        } catch (err) {
            const reason = normalizeSquareError(err);
            console.error("Square OAuth token exchange failed:", reason);
            return res.redirect(`/oauth-result.html?status=error&reason=${encodeURIComponent(reason)}`);
        }
    });

    // Authorize URL helper (redirect target for Square OAuth flow)
    router.get("/square/oauth2/authorize", async (req, res) => {
        const q = req.query || {};
        const clientId =
            (q.clientId || q.client_id || process.env.SQUARE_APPLICATION_ID || process.env.SQUARE_CLIENT_ID || "")
                .toString()
                .trim();
        const redirectUri =
            (q.redirectUri || q.redirect_uri || process.env.SQUARE_OAUTH_REDIRECT_URI || "")
                .toString()
                .trim();

        if (!clientId || !redirectUri) {
            return res.status(400).json({
                error: "clientId and redirectUri are required (or set SQUARE_APPLICATION_ID/SQUARE_CLIENT_ID and SQUARE_OAUTH_REDIRECT_URI)",
            });
        }

        const authorizeUrl = createAuthorizeUrl({
            client_id: clientId,
            response_type: "code",
            scope: (q.scope || "PAYMENTS_READ PAYMENTS_WRITE ORDERS_READ ORDERS_WRITE").toString(),
            session: q.session,
            state: q.state,
            redirect_uri: redirectUri,
            code_challenge: q.codeChallenge || q.code_challenge,
            code_challenge_method: q.codeChallengeMethod || q.code_challenge_method,
        });

        return res.json({ authorizeUrl });
    });

    // ObtainToken
    router.post("/square/oauth2/token", async (req, res) => {
        const client = requireSquareClient(res);
        if (!client) return;

        const body = req.body || {};
        const payload = {
            clientId: body.clientId || body.client_id || process.env.SQUARE_APPLICATION_ID || process.env.SQUARE_CLIENT_ID,
            clientSecret:
                body.clientSecret ||
                body.client_secret ||
                process.env.SQUARE_APPLICATION_SECRET ||
                process.env.SQUARE_CLIENT_SECRET,
            grantType: body.grantType || body.grant_type || "authorization_code",
            code: body.code,
            redirectUri: body.redirectUri || body.redirect_uri || process.env.SQUARE_OAUTH_REDIRECT_URI,
            codeVerifier: body.codeVerifier || body.code_verifier,
            refreshToken: body.refreshToken || body.refresh_token,
            migrationToken: body.migrationToken || body.migration_token,
            shortLived: body.shortLived ?? body.short_lived,
        };

        if (!payload.clientId || !payload.clientSecret) {
            return res.status(400).json({ error: "clientId and clientSecret are required" });
        }
        if (payload.grantType === "authorization_code" && !payload.code) {
            return res.status(400).json({ error: "code is required when grantType is authorization_code" });
        }
        if (payload.grantType === "refresh_token" && !payload.refreshToken) {
            return res.status(400).json({ error: "refreshToken is required when grantType is refresh_token" });
        }

        try {
            const result = await client.oAuth.obtainToken(payload);
            return res.status(201).json(result && result.result ? result.result : {});
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RetrieveTokenStatus
    router.post("/square/oauth2/token/status", async (req, res) => {
        const client = requireSquareClient(res);
        if (!client) return;

        const body = req.body || {};
        const accessToken = body.accessToken || body.access_token || process.env.SQUARE_ACCESS_TOKEN;
        if (!accessToken) {
            return res.status(400).json({ error: "accessToken is required" });
        }

        try {
            const result = await client.oAuth.retrieveTokenStatus({
                accessToken,
            });
            return res.json(result && result.result ? result.result : {});
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // RevokeToken
    router.post("/square/oauth2/revoke", async (req, res) => {
        const client = requireSquareClient(res);
        if (!client) return;

        const body = req.body || {};
        const accessToken = body.accessToken || body.access_token;
        const clientId = body.clientId || body.client_id || process.env.SQUARE_APPLICATION_ID || process.env.SQUARE_CLIENT_ID;
        const merchantId = body.merchantId || body.merchant_id;
        const revokeOnlyAccessToken = body.revokeOnlyAccessToken ?? body.revoke_only_access_token;

        if (!accessToken) {
            return res.status(400).json({ error: "accessToken is required" });
        }

        try {
            const result = await client.oAuth.revokeToken({
                clientId,
                accessToken,
                merchantId,
                revokeOnlyAccessToken,
            });
            return res.json(result && result.result ? result.result : { success: true });
        } catch (squareError) {
            return res.status(502).json({ error: normalizeSquareError(squareError) });
        }
    });

    // OAuth webhook handler for oauth.authorization.revoked
    router.post("/square/webhooks/oauth.authorization.revoked", (req, res) => {
        const signatureHeader = req.header("x-square-hmacsha256-signature");
        const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
        const notificationUrl =
            process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
            `${req.protocol}://${req.get("host")}${req.originalUrl}`;
        const rawBody =
            typeof req.rawBody === "string" && req.rawBody.length > 0
                ? req.rawBody
                : JSON.stringify(req.body || {});

        if (!signatureKey) {
            return res.status(503).json({
                error: "SQUARE_WEBHOOK_SIGNATURE_KEY is required to verify webhook signatures",
            });
        }

        const isValid = verifyWebhookSignature(
            signatureHeader,
            rawBody,
            notificationUrl,
            signatureKey
        );

        if (!isValid) {
            return res.status(401).json({ error: "Invalid webhook signature" });
        }

        const eventType = req.body && req.body.type;
        if (eventType !== "oauth.authorization.revoked") {
            return res.status(202).json({
                ignored: true,
                reason: "Unhandled event type",
                receivedType: eventType,
            });
        }

        const data = (req.body && req.body.data) || {};
        const object = data.object || {};

        // Hook point: persist revocation details and disconnect merchant from local records.
        return res.status(200).json({
            received: true,
            type: eventType,
            merchantId: object.merchant_id || object.merchantId,
            clientId: object.client_id || object.clientId,
            revokedAt: object.revoked_at || object.revokedAt,
        });
    });

    return router;
}

module.exports = {
    createOauthRouter,
};
