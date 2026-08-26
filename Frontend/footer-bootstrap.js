(function () {
    const AUTH_TOKEN_STORAGE_KEY = "goneInABiteeAuthToken";
    const CART_STORAGE_KEY = "goneInABiteeCart";

    function readAuthToken() {
        try {
            const sessionValue = sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
            if (typeof sessionValue === "string" && sessionValue.trim().length > 0) {
                return sessionValue.trim();
            }
        } catch (error) {
            // Ignore storage access issues and fall back to local storage.
        }

        try {
            const localValue = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
            return typeof localValue === "string" ? localValue.trim() : "";
        } catch (error) {
            return "";
        }
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
        return cart.reduce((sum, item) => {
            const qty = Number(item && item.qty);
            return sum + (Number.isFinite(qty) ? qty : 0);
        }, 0);
    }

    const label = document.getElementById("cart-button-label");
    if (!label) {
        return;
    }

    const link = label.closest("a");
    if (!link) {
        return;
    }

    const loggedIn = readAuthToken().length > 0;

    if (loggedIn) {
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
}());
