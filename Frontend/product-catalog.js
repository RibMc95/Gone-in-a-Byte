(function () {
    const CART_STORAGE_KEY = "goneInABiteeCart";
    const element = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const SECTION_REVEAL_STAGGER_MS = 300;
    const CARD_REVEAL_STAGGER_MS = 110;
    const ADDED_LABEL_MS = 720;
    const ADD_PULSE_MS = 320;

    const catalog = [
        {
            title: "Classic",
            titleId: "classic-category-title",
            products: [
                { id: "classic-chip", name: "Classic Chip", price: 3, image: "Cookies Images/Chocolate-Chip.jpg", alt: "Classic Chip Cookie" },
                { id: "oatmeal-raisin", name: "Oatmeal Raisin", price: 3, image: "Cookies Images/Oatmeal-Raisin.jpg", alt: "Oatmeal Raisin Cookie" },
                { id: "peanut-butter-cookie", name: "Peanut Butter Cookie", price: 3, image: "Cookies Images/Peanut-Butter-cookie.jpg", alt: "Peanut Butter Cookie" },
                { id: "snickerdoodle", name: "Snickerdoodle", price: 3, image: "Cookies Images/Snickerdoodle.jpg", alt: "Snickerdoodle Cookie" },
            ],
        },
        {
            title: "Seasonal Special",
            titleId: "seasonal-special-category-title",
            products: [
                { id: "pumpkin-spice", name: "Pumpkin Spice", price: 4, image: "Cookies Images/pumkin-spice-cookies.jpg", alt: "Pumpkin Spice Cookie" },
                { id: "peppermin-bark", name: "Peppermin Bark", price: 4, image: "Cookies Images/peppermin-bark-cookie.jpg", alt: "Peppermin Bark Cookie" },
                { id: "holiday-cookie", name: "Holiday Cookie", price: 4, image: "Cookies Images/christmas-cookie.jpg", alt: "Holiday Cookie" },
                { id: "maple-snickerdoodle", name: "Maple Snickerdoodle", price: 4, image: "Cookies Images/Maple-Snickerdoodles-4.jpg", alt: "Maple Snickerdoodle Cookie" },
            ],
        },
        {
            title: "Gourmet Creation",
            titleId: "gourmet-creation-category-title",
            products: [
                { id: "sea-salt-caramel", name: "Sea Salt Caramel Cookie", price: 5, image: "Cookies Images/SeaSaltCaramelCookie.jpg", alt: "Sea Salt Caramel Cookie" },
                { id: "espresso-crunch", name: "Espresso Crunch", price: 5, image: "Cookies Images/Expresso Crunch Cookie.jpg", alt: "Espresso Crunch Cookie" },
                { id: "pistachio-cranberry", name: "Pistachio Cranberry", price: 5, image: "Cookies Images/Pistachio-Cranberry-Cookie.jpg", alt: "Pistachio Cranberry Cookie" },
            ],
        },
    ];

    function readCart() {
        try {
            const raw = localStorage.getItem(CART_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (error) {
            return [];
        }
    }

    function saveCart(cart) {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    }

    function getCartItemCount(cart) {
        return cart.reduce((sum, item) => sum + item.qty, 0);
    }

    function updateCartLabelFallback() {
        const cartLabel = document.getElementById("cart-button-label");
        if (!cartLabel) {
            return;
        }

        const cart = readCart();
        cartLabel.textContent = `Cart (${getCartItemCount(cart)})`;
    }

    function refreshCartLabel() {
        if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.refreshCartLabel === "function") {
            window.GoneInABiteeSite.refreshCartLabel();
            return;
        }

        updateCartLabelFallback();
    }

    function ensureLoggedInForCart() {
        if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.isLoggedIn === "function") {
            if (!window.GoneInABiteeSite.isLoggedIn()) {
                window.location.href = "login.html";
                return false;
            }

            return true;
        }

        return true;
    }

    function addToCart(product) {
        const cart = readCart();
        const existing = cart.find((item) => item.id === product.id);

        if (existing) {
            existing.qty += 1;
        } else {
            cart.push({ ...product, qty: 1 });
        }

        saveCart(cart);
        refreshCartLabel();
    }

    function ProductItem(props) {
        const [isHovered, setIsHovered] = useState(false);
        const [isAddedPulse, setIsAddedPulse] = useState(false);
        const [isRevealed, setIsRevealed] = useState(false);
        const [buttonLabel, setButtonLabel] = useState("Add to Cart");

        useEffect(() => {
            const revealTimer = window.setTimeout(() => {
                setIsRevealed(true);
            }, props.revealDelay);

            return () => {
                window.clearTimeout(revealTimer);
            };
        }, [props.revealDelay]);

        function handleAddToCart() {
            if (!ensureLoggedInForCart()) {
                return;
            }

            addToCart({
                id: props.id,
                name: props.name,
                price: props.price,
            });

            setButtonLabel("Added!");
            setIsAddedPulse(true);

            window.setTimeout(() => {
                setButtonLabel("Add to Cart");
            }, ADDED_LABEL_MS);

            window.setTimeout(() => {
                setIsAddedPulse(false);
            }, ADD_PULSE_MS);
        }

        const itemClasses = ["product-item", "react-product-item"];
        if (isHovered) {
            itemClasses.push("react-product-item-hover");
        }
        if (isRevealed) {
            itemClasses.push("react-product-item-visible");
        }

        const buttonClasses = ["buy-button", "add-to-cart", "react-add-button"];
        if (isAddedPulse) {
            buttonClasses.push("react-add-button-pulse");
        }

        return element("div", {
            className: itemClasses.join(" "),
            onMouseEnter: () => setIsHovered(true),
            onMouseLeave: () => setIsHovered(false),
        },
            element("p", { className: "product-name" }, `${props.name} $${props.price}`),
            element("img", { src: props.image, alt: props.alt, className: "product-image" }),
            element("button", {
                type: "button",
                className: buttonClasses.join(" "),
                onClick: handleAddToCart,
            }, buttonLabel),
        );
    }

    function ProductSection(props) {
        return element("section", { className: "product-category", "aria-labelledby": props.titleId },
            element("h3", { id: props.titleId, className: "limelight-regular product-category-title" }, props.title),
            element("div", { className: "products-grid" },
                props.products.map((product, index) => element(ProductItem, {
                    ...product,
                    key: product.id,
                    revealDelay: props.sectionIndex * SECTION_REVEAL_STAGGER_MS + index * CARD_REVEAL_STAGGER_MS,
                })),
            ),
        );
    }

    function ProductCatalog() {
        return element(React.Fragment, null,
            element("h2", { className: "limelight-regular page-title react-product-item react-product-item-visible" }, "Our Cookies"),
            catalog.map((section, sectionIndex) => element(ProductSection, {
                ...section,
                key: section.titleId,
                sectionIndex,
            })),
        );
    }

    const rootNode = document.getElementById("product-catalog-root");
    if (!rootNode) {
        return;
    }

    ReactDOM.createRoot(rootNode).render(element(ProductCatalog));

    // Re-run chrome setup so product image hover cards are enhanced after React mount.
    if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.initSiteChrome === "function") {
        window.GoneInABiteeSite.initSiteChrome();
    }

    refreshCartLabel();
}());
