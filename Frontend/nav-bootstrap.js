(function () {
    const AUTH_TOKEN_STORAGE_KEY = "goneInABiteeAuthToken";

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

    function showLink(link) {
        link.hidden = false;
        link.style.display = "";
        link.style.visibility = "visible";
        link.style.pointerEvents = "auto";
        link.removeAttribute("aria-hidden");
        link.removeAttribute("tabindex");
    }

    function hideLink(link) {
        link.hidden = true;
        link.style.display = "none";
        link.style.visibility = "hidden";
        link.style.pointerEvents = "none";
        link.setAttribute("aria-hidden", "true");
        link.setAttribute("tabindex", "-1");
    }

    const nav = document.querySelector(".site-nav");
    if (!nav) {
        return;
    }

    const loggedIn = readAuthToken().length > 0;

    const authLink = nav.querySelector('a[href="checkout.html"], a[href="login.html"], a[data-auth-nav="true"]');
    if (authLink) {
        authLink.setAttribute("data-auth-nav", "true");
        authLink.textContent = loggedIn ? "Cart" : "Login";
        authLink.setAttribute("href", loggedIn ? "checkout.html" : "login.html");
        showLink(authLink);
    }

    const cateringLink = nav.querySelector('a[href="catering.html"], a[data-auth-catering-nav="true"]');
    if (cateringLink) {
        cateringLink.setAttribute("data-auth-catering-nav", "true");

        if (loggedIn) {
            cateringLink.textContent = "Catering";
            cateringLink.setAttribute("href", "catering.html");
            showLink(cateringLink);
        } else {
            hideLink(cateringLink);
        }
    }
}());
