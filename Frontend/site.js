(function () {
    const CART_STORAGE_KEY = "goneInABiteeCart";
    const REWARDS_STORAGE_KEY = "goneInABiteeRewardOrders";
    const REWARDS_RESET_MARKER_KEY = "goneInABiteeRewardResetMarker";
    const THEME_STORAGE_KEY = "goneInABiteeThemePreference";
    const AUTH_TOKEN_STORAGE_KEY = "goneInABiteeAuthToken";
    const AUTH_EMAIL_STORAGE_KEY = "goneInABiteeAuthEmail";
    const LOCAL_REWARDS_RESET_VERSION = "2026-05-17-local-reset-1";
    const THEME_DAY = "day";
    const THEME_NIGHT = "night";
    const REWARD_GOAL = 10;
    const REWARD_DISCOUNT = 30;
    let systemThemeMediaQuery = null;
    let hasBoundSystemThemeListener = false;

    function safeStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function safeStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function safeStorageRemove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            return false;
        }
    }

    function safeSessionGet(key) {
        try {
            return sessionStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function safeSessionSet(key, value) {
        try {
            sessionStorage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function safeSessionRemove(key) {
        try {
            sessionStorage.removeItem(key);
            return true;
        } catch (error) {
            return false;
        }
    }

    function readStoredThemePreference() {
        const value = safeStorageGet(THEME_STORAGE_KEY);
        return value === THEME_DAY || value === THEME_NIGHT ? value : null;
    }

    function saveThemePreference(theme) {
        safeStorageSet(THEME_STORAGE_KEY, theme);
    }

    function getThemeToggle() {
        return document.getElementById("theme-toggle");
    }

    function updateThemeToggle(theme) {
        const toggle = getThemeToggle();
        if (!toggle) {
            return;
        }

        const isNight = theme === THEME_NIGHT;
        toggle.textContent = isNight ? "Day Mode" : "Night Mode";
        toggle.setAttribute("aria-pressed", String(isNight));
        toggle.setAttribute("aria-label", isNight ? "Switch to day mode" : "Switch to night mode");
    }

    function getSystemPreferredTheme() {
        if (typeof window.matchMedia !== "function") {
            return THEME_DAY;
        }

        if (!systemThemeMediaQuery) {
            systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        }

        return systemThemeMediaQuery.matches ? THEME_NIGHT : THEME_DAY;
    }

    function resolveInitialTheme() {
        return readStoredThemePreference() || getSystemPreferredTheme();
    }

    function applyTheme(theme) {
        const nextTheme = theme === THEME_NIGHT ? THEME_NIGHT : THEME_DAY;
        document.documentElement.setAttribute("data-theme", nextTheme);
        updateThemeToggle(nextTheme);
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute("data-theme") === THEME_NIGHT
            ? THEME_NIGHT
            : THEME_DAY;
        const nextTheme = currentTheme === THEME_NIGHT ? THEME_DAY : THEME_NIGHT;
        applyTheme(nextTheme);
        saveThemePreference(nextTheme);
    }

    function bindThemeToggle() {
        const toggle = getThemeToggle();
        if (!toggle) {
            return;
        }

        if (toggle.dataset.bound === "true") {
            updateThemeToggle(document.documentElement.getAttribute("data-theme"));
            return;
        }

        toggle.addEventListener("click", toggleTheme);
        toggle.dataset.bound = "true";
        updateThemeToggle(document.documentElement.getAttribute("data-theme"));
    }

    function bindSystemThemeListener() {
        if (hasBoundSystemThemeListener || typeof window.matchMedia !== "function") {
            return;
        }

        if (!systemThemeMediaQuery) {
            systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        }

        const handleChange = () => {
            if (!readStoredThemePreference()) {
                applyTheme(systemThemeMediaQuery.matches ? THEME_NIGHT : THEME_DAY);
            }
        };

        if (typeof systemThemeMediaQuery.addEventListener === "function") {
            systemThemeMediaQuery.addEventListener("change", handleChange);
            hasBoundSystemThemeListener = true;
            return;
        }

        if (typeof systemThemeMediaQuery.addListener === "function") {
            systemThemeMediaQuery.addListener(handleChange);
            hasBoundSystemThemeListener = true;
        }
    }

    function shouldApplyLocalRewardsReset() {
        const hostname = window.location.hostname;
        return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "";
    }

    function applyLocalRewardsResetOnce() {
        if (!shouldApplyLocalRewardsReset()) {
            return;
        }

        const appliedVersion = safeStorageGet(REWARDS_RESET_MARKER_KEY);
        if (appliedVersion === LOCAL_REWARDS_RESET_VERSION) {
            return;
        }

        safeStorageSet(REWARDS_STORAGE_KEY, "0");
        safeStorageSet(REWARDS_RESET_MARKER_KEY, LOCAL_REWARDS_RESET_VERSION);
    }

    function readCart() {
        try {
            const raw = localStorage.getItem(CART_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (error) {
            return [];
        }
    }

    function getCartItemCount(cart) {
        return cart.reduce((sum, item) => sum + item.qty, 0);
    }

    function refreshCartLabel() {
        const footerButton = getFooterAuthButton();
        if (!footerButton) {
            return;
        }

        const { link, label } = footerButton;

        if (isLoggedIn()) {
            label.textContent = `Cart (${getCartItemCount(readCart())})`;
            link.setAttribute("href", "checkout.html");
            link.setAttribute("aria-label", "Go to cart");
            link.setAttribute("title", "Cart");
            return;
        }

        label.textContent = "Login";
        link.setAttribute("href", "login.html");
        link.setAttribute("aria-label", "Go to login");
        link.setAttribute("title", "Login");
    }

    function getFooterAuthButton() {
        const label = document.getElementById("cart-button-label");
        if (!label) {
            return null;
        }

        const link = label.closest("a");
        if (!link) {
            return null;
        }

        return { link, label };
    }

    function readAuthToken() {
        const sessionValue = safeSessionGet(AUTH_TOKEN_STORAGE_KEY);
        if (typeof sessionValue === "string" && sessionValue.trim().length > 0) {
            return sessionValue.trim();
        }

        const localValue = safeStorageGet(AUTH_TOKEN_STORAGE_KEY);
        return typeof localValue === "string" ? localValue.trim() : "";
    }

    function isLoggedIn() {
        return readAuthToken().length > 0;
    }

    function syncHeaderAuthLink() {
        const nav = document.querySelector(".site-nav");
        if (!nav) {
            return;
        }

        const link = nav.querySelector('a[href="checkout.html"], a[href="login.html"], a[data-auth-nav="true"]');
        if (!link) {
            return;
        }

        link.setAttribute("data-auth-nav", "true");

        if (isLoggedIn()) {
            link.textContent = "Cart";
            link.setAttribute("href", "checkout.html");
            link.hidden = false;
            link.style.display = "";
            link.style.visibility = "visible";
            link.style.pointerEvents = "auto";
            link.removeAttribute("aria-hidden");
            link.removeAttribute("tabindex");
            return;
        }

        link.textContent = "Login";
        link.setAttribute("href", "login.html");
        link.hidden = false;
        link.style.display = "";
        link.style.visibility = "visible";
        link.style.pointerEvents = "auto";
        link.removeAttribute("aria-hidden");
        link.removeAttribute("tabindex");
    }

    function syncCateringAuthLink() {
        const nav = document.querySelector(".site-nav");
        if (!nav) {
            return;
        }

        const link = nav.querySelector('a[href="catering.html"], a[data-auth-catering-nav="true"]');
        if (!link) {
            return;
        }

        link.setAttribute("data-auth-catering-nav", "true");

        if (isLoggedIn()) {
            link.textContent = "Catering";
            link.setAttribute("href", "catering.html");
            link.hidden = false;
            link.style.display = "";
            link.style.visibility = "visible";
            link.style.pointerEvents = "auto";
            link.removeAttribute("aria-hidden");
            link.removeAttribute("tabindex");
            return;
        }

        link.hidden = true;
        link.style.display = "none";
        link.style.visibility = "hidden";
        link.style.pointerEvents = "none";
        link.setAttribute("aria-hidden", "true");
        link.setAttribute("tabindex", "-1");
    }

    function saveAuthSession(session, options) {
        const token = session && typeof session.token === "string" ? session.token.trim() : "";
        if (!token) {
            return false;
        }

        const remember = !(options && options.remember === false);

        safeStorageRemove(AUTH_TOKEN_STORAGE_KEY);
        safeStorageRemove(AUTH_EMAIL_STORAGE_KEY);
        safeSessionRemove(AUTH_TOKEN_STORAGE_KEY);
        safeSessionRemove(AUTH_EMAIL_STORAGE_KEY);

        if (remember) {
            safeStorageSet(AUTH_TOKEN_STORAGE_KEY, token);
        } else {
            safeSessionSet(AUTH_TOKEN_STORAGE_KEY, token);
        }

        if (session && typeof session.email === "string" && session.email.trim().length > 0) {
            const email = session.email.trim().toLowerCase();
            if (remember) {
                safeStorageSet(AUTH_EMAIL_STORAGE_KEY, email);
            } else {
                safeSessionSet(AUTH_EMAIL_STORAGE_KEY, email);
            }
        }

        syncHeaderAuthLink();
        syncCateringAuthLink();
        refreshCartLabel();
        return true;
    }

    function clearAuthSession() {
        safeStorageRemove(AUTH_TOKEN_STORAGE_KEY);
        safeStorageRemove(AUTH_EMAIL_STORAGE_KEY);
        safeSessionRemove(AUTH_TOKEN_STORAGE_KEY);
        safeSessionRemove(AUTH_EMAIL_STORAGE_KEY);
        syncHeaderAuthLink();
        syncCateringAuthLink();
        refreshCartLabel();
    }

    function readRewardOrders() {
        const raw = safeStorageGet(REWARDS_STORAGE_KEY);
        const parsed = Number.parseInt(raw == null ? "0" : raw, 10);
        return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
    }

    function getRewardProgress(totalOrders) {
        if (totalOrders > 0 && totalOrders % REWARD_GOAL === 0) {
            return REWARD_GOAL;
        }

        return totalOrders % REWARD_GOAL;
    }

    function renderRewards() {
        const rewardsText = document.getElementById("rewards-text");
        const progressPercentLabel = document.getElementById("rewards-progress-percent");
        const progressTrack = document.getElementById("rewards-progress-track");
        const progressFill = document.getElementById("rewards-progress-fill");
        const totalOrders = readRewardOrders();
        const progressPoints = getRewardProgress(totalOrders);
        const progressPercent = Math.round((progressPoints / REWARD_GOAL) * 100);
        const rewardsEarned = Math.floor(totalOrders / REWARD_GOAL);

        if (progressPercentLabel) {
            progressPercentLabel.textContent = `${progressPercent}%`;
        }

        if (progressTrack) {
            progressTrack.setAttribute("aria-valuenow", String(progressPoints));
            progressTrack.setAttribute("aria-label", `Reward progress: ${progressPoints} out of ${REWARD_GOAL} points`);
        }

        if (progressFill) {
            progressFill.style.width = `${progressPercent}%`;
        }

        if (!rewardsText) {
            return;
        }

        if (progressPoints === REWARD_GOAL) {
            rewardsText.textContent = rewardsEarned > 0
                ? `Reward unlocked. You have earned ${rewardsEarned} ${REWARD_DISCOUNT}% discount${rewardsEarned === 1 ? "" : "s"}.`
                : `Reward unlocked. You earned a ${REWARD_DISCOUNT}% discount.`;
            return;
        }

        const remainingPoints = REWARD_GOAL - progressPoints;
        rewardsText.textContent = totalOrders === 0
            ? "Place your first order to start earning. Every completed order adds 1 point."
            : `You are ${remainingPoints} point${remainingPoints === 1 ? "" : "s"} away from your next ${REWARD_DISCOUNT}% discount.`;
    }

    function initSiteChrome() {
        applyLocalRewardsResetOnce();
        applyTheme(resolveInitialTheme());
        bindThemeToggle();
        bindSystemThemeListener();
        enhanceCookieImageHoverCards();
        syncHeaderAuthLink();
        syncCateringAuthLink();
        refreshCartLabel();
        renderRewards();
    }

    function handleStorageChange(event) {
        if (!event) {
            return;
        }

        if (!event.key) {
            applyTheme(resolveInitialTheme());
            refreshCartLabel();
            renderRewards();
            return;
        }

        if (event.key === THEME_STORAGE_KEY) {
            applyTheme(resolveInitialTheme());
            return;
        }

        if (event.key === AUTH_TOKEN_STORAGE_KEY || event.key === AUTH_EMAIL_STORAGE_KEY) {
            syncHeaderAuthLink();
            syncCateringAuthLink();
            refreshCartLabel();
            return;
        }

        if (event.key === CART_STORAGE_KEY) {
            refreshCartLabel();
            return;
        }

        if (event.key === REWARDS_STORAGE_KEY || event.key === REWARDS_RESET_MARKER_KEY) {
            renderRewards();
        }
    }

    function enhanceCookieImageHoverCards() {
        const images = document.querySelectorAll("img.product-image");
        images.forEach((image) => {
            if (image.closest(".cookie-hover-card")) {
                return;
            }

            const originalParent = image.parentElement;
            if (!originalParent) {
                return;
            }
            const nextSibling = image.nextSibling;

            const card = document.createElement("div");
            card.className = "cookie-hover-card";

            const content = document.createElement("div");
            content.className = "cookie-hover-content";

            const front = document.createElement("div");
            front.className = "cookie-hover-front";
            front.appendChild(image);

            const back = document.createElement("div");
            back.className = "cookie-hover-back";
            back.setAttribute("aria-hidden", "true");

            const glowMain = document.createElement("span");
            glowMain.className = "cookie-hover-glow cookie-hover-glow-main";

            const glowBottom = document.createElement("span");
            glowBottom.className = "cookie-hover-glow cookie-hover-glow-bottom";

            const glowRight = document.createElement("span");
            glowRight.className = "cookie-hover-glow cookie-hover-glow-right";

            const backContent = document.createElement("div");
            backContent.className = "cookie-hover-back-content";

            const badge = document.createElement("span");
            badge.className = "cookie-hover-badge";
            badge.textContent = "Gone in a Bitee";

            const title = document.createElement("p");
            title.className = "cookie-hover-title";
            title.textContent = image.alt || "Cookie";

            backContent.appendChild(badge);
            backContent.appendChild(title);

            back.appendChild(glowMain);
            back.appendChild(glowBottom);
            back.appendChild(glowRight);
            back.appendChild(backContent);

            content.appendChild(front);
            content.appendChild(back);
            card.appendChild(content);

            if (nextSibling) {
                originalParent.insertBefore(card, nextSibling);
            } else {
                originalParent.appendChild(card);
            }
        });
    }

    window.GoneInABiteeSite = {
        refreshCartLabel,
        renderRewards,
        initSiteChrome,
        readRewardOrders,
        getRewardProgress,
        isLoggedIn,
        getAuthToken: readAuthToken,
        saveAuthSession,
        clearAuthSession,
        rewardGoal: REWARD_GOAL,
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initSiteChrome);
    } else {
        initSiteChrome();
    }

    window.addEventListener("storage", handleStorageChange);
}());