# Gone in a Bitee 🍪

A full-stack e-commerce web application for a cookie business — online storefront,
shopping cart, and real card payments powered by the Square API.

> ⚠️ **Work in progress.** This project is under active development. Some features
> are still being built or wired up (live payment testing, database persistence,
> and production hardening). Not yet production-ready.

---

## Overview

Gone in a Bitee is a from-scratch storefront that lets customers browse a cookie
catalog, build a cart, create an account, and check out with a credit card. On the
back end it integrates with Square for payments and orders, and with Oracle
Autonomous Database for persistence. The whole stack runs in Docker.

## Features

- 🛒 **Storefront & cart** — product catalog, cart, checkout, and a rewards counter
- 💳 **Card payments** — Square Web Payments SDK on the front end, Square Orders &
  Payments APIs on the back end
- 🔗 **Square OAuth** — secure flow for connecting a merchant's Square account
  (CSRF-protected `state`, server-side token exchange)
- 🔐 **Accounts & auth** — registration/login with bcrypt-hashed passwords and JWTs
- 🗄️ **Persistence** — Oracle Autonomous Database for orders and history
- 🌗 **Polished front end** — responsive pages with a day/night theme toggle
- 🐳 **Dockerized** — one `docker-compose up` brings up the API and the web server

## Tech Stack

| Layer      | Technology                                              |
| ---------- | ------------------------------------------------------- |
| Front end  | HTML, CSS, vanilla JavaScript, some React (via CDN)     |
| Back end   | Node.js, Express                                        |
| Payments   | Square API (Orders, Payments, Refunds, OAuth, Webhooks) |
| Database   | Oracle Autonomous Database (`oracledb`)                 |
| Auth       | bcrypt, JSON Web Tokens                                 |
| Security   | Helmet, CORS allowlist, rate limiting                   |
| Infra      | Docker, Docker Compose, nginx (static front end)        |

## Project Structure

```
.
├── Backend/            Express API — routes for orders, payments, auth, Square, etc.
├── Frontend/           Static site (HTML/CSS/JS) served by nginx
├── docker-compose.yml  Runs the backend API and frontend web server together
└── .env.example        Template for required environment variables
```

## Getting Started

### Prerequisites
- Docker & Docker Compose
- A Square developer account (for payment features)
- An Oracle Autonomous Database (for persistence)

### Setup
1. Copy the environment template and fill in your own values:
   ```bash
   cp .env.example .env
   ```
2. Add your Square credentials, Oracle DB connection details, and a strong
   `JWT_SECRET` to `.env`.
3. Start the stack:
   ```bash
   docker-compose up --build
   ```
4. Open the storefront at `http://localhost:8080` (API runs on `http://localhost:3001`).

> **Note:** secrets and database wallet files are intentionally excluded from this
> repository via `.gitignore`. You'll need to provide your own `.env` and Oracle
> wallet to run the app.

## Roadmap

- [ ] Complete end-to-end live payment testing with Square
- [ ] Move the user store from in-memory to the database
- [ ] Finish pre-launch security hardening
- [ ] Privacy policy and production deployment

---

*Built by Micah Cole. This is the business website that will be deloyed soon.*
