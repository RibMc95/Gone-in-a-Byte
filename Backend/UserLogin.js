// Login/Register routes with basic user profile fields:
// email, password hash, order/catering history, and status snapshots.
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SALT_ROUNDS = Number(process.env.PASSWORD_SALT_ROUNDS || 10);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Fail loud rather than silently signing tokens with a known dev secret.
// In production JWT_SECRET must be set to a strong random value.
const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-me";
if (JWT_SECRET === "dev-jwt-secret-change-me") {
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "JWT_SECRET is not set. Refusing to start in production with the default dev secret."
        );
    }
    console.warn(
        "WARNING: JWT_SECRET is not set — using the insecure dev fallback. Set JWT_SECRET before launch."
    );
}

// Minimal local store so this file is self-contained even before DB wiring.
const userStore = new Map();

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function createPlayer(email, passwordHash) {
    if (userStore.has(email)) {
        const conflict = new Error("Email exists");
        conflict.name = "ConditionalCheckFailedException";
        throw conflict;
    }

    userStore.set(email, {
        email,
        passwordHash,
        ordersHistory: [],
        ordersStatus: [],
        cateringHistory: [],
        cateringStatus: [],
        createdAt: new Date().toISOString(),
    });
}

async function setPlayerPasswordHash(email, passwordHash) {
    const existing = userStore.get(email);
    if (!existing) {
        const conflict = new Error("Email exists");
        conflict.name = "ConditionalCheckFailedException";
        throw conflict;
    }

    userStore.set(email, {
        ...existing,
        passwordHash,
        updatedAt: new Date().toISOString(),
    });
}

async function getPlayer(email) {
    return userStore.get(email) || null;
}

function createUserLoginRouter() {
    const router = express.Router();

    // Register account
    router.post("/register", async (req, res) => {
        const { email, password } = req.body ?? {};

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            email.trim().length === 0 ||
            password.length < 6
        ) {
            return res.status(400).json({
                message: "Email is required and password must be at least 6 characters.",
            });
        }

        const clean = normalizeEmail(email);

        if (!isValidEmail(clean)) {
            return res.status(400).json({ message: "Invalid email format." });
        }

        try {
            const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
            await createPlayer(clean, passwordHash);
            const token = jwt.sign({ email: clean }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
            return res.status(201).json({ email: clean, token });
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                try {
                    await setPlayerPasswordHash(clean, await bcrypt.hash(password, SALT_ROUNDS));
                    const token = jwt.sign({ email: clean }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
                    return res.status(201).json({ email: clean, token });
                } catch (upgradeErr) {
                    if (upgradeErr.name === "ConditionalCheckFailedException") {
                        return res.status(409).json({ message: "Email already taken." });
                    }
                    console.error("Register legacy upgrade error:", upgradeErr);
                    return res.status(500).json({ message: "Internal server error." });
                }
            }

            console.error("Register error:", err);
            return res.status(500).json({ message: "Internal server error." });
        }
    });

    // Login account
    router.post("/login", async (req, res) => {
        const { email, password } = req.body ?? {};

        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "Email and password are required." });
        }

        const clean = normalizeEmail(email);

        try {
            const player = await getPlayer(clean);

            if (!player || typeof player.passwordHash !== "string" || player.passwordHash.length === 0) {
                // Use a dummy compare so invalid emails do not return noticeably faster.
                await bcrypt.compare(password, "$2b$12$123456789012345678901u4vQ0M2s9Qf8P8Vk00vLm7BxwRkFQ7x6");
                return res.status(401).json({ message: "Invalid email or password." });
            }

            const match = await bcrypt.compare(password, player.passwordHash);
            if (!match) {
                return res.status(401).json({ message: "Invalid email or password." });
            }

            const token = jwt.sign({ email: clean }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
            return res.json({
                email: clean,
                token,
                ordersHistory: player.ordersHistory,
                ordersStatus: player.ordersStatus,
                cateringHistory: player.cateringHistory,
                cateringStatus: player.cateringStatus,
            });
        } catch (err) {
            console.error("Login error:", err);
            return res.status(500).json({ message: "Internal server error." });
        }
    });

    return router;
}

module.exports = {
    createUserLoginRouter,
};
