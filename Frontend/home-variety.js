(function () {
    const element = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const CARD_REVEAL_STAGGER_MS = 110;

    const products = [
        {
            id: "home-classic-cookies",
            name: "Classic Cookies",
            price: 3,
            image: "Cookies Images/classic-cookies.jpg",
            alt: "Classic Cookies",
        },
        {
            id: "home-seasonal",
            name: "Seasonal",
            price: 4,
            image: "Cookies Images/seasonal.jpg",
            alt: "Seasonal Cookie",
        },
        {
            id: "home-gift-pack",
            name: "Gift Pack",
            price: 3,
            image: "Cookies Images/gift-box.jpg",
            alt: "Gift Pack Cookie",
        },
        {
            id: "home-gourmet-variety",
            name: "Gourmet Variety",
            price: 4,
            image: "Cookies Images/gourmet-cookie.jpg",
            alt: "Gourmet Variety Cookie",
        },
    ];

    function ProductTile(props) {
        const [isHovered, setIsHovered] = useState(false);
        const [isRevealed, setIsRevealed] = useState(false);

        useEffect(() => {
            const revealTimer = window.setTimeout(() => {
                setIsRevealed(true);
            }, props.revealDelay);

            return () => {
                window.clearTimeout(revealTimer);
            };
        }, [props.revealDelay]);

        const itemClasses = ["product-item", "react-product-item"];
        if (isHovered) {
            itemClasses.push("react-product-item-hover");
        }
        if (isRevealed) {
            itemClasses.push("react-product-item-visible");
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
                className: "buy-button",
                onClick: function () {
                    window.location.href = "product.html";
                },
            }, "Go to Products"),
        );
    }

    function HomeVariety() {
        return element("div", { className: "products-grid" },
            products.map((product, index) => element(ProductTile, {
                ...product,
                key: product.id,
                revealDelay: index * CARD_REVEAL_STAGGER_MS,
            })),
        );
    }

    const rootNode = document.getElementById("home-variety-root");
    if (!rootNode) {
        return;
    }

    ReactDOM.createRoot(rootNode).render(element(HomeVariety));

    // Re-run site chrome setup so hover enhancements include React-rendered images.
    if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.initSiteChrome === "function") {
        window.GoneInABiteeSite.initSiteChrome();
    }
}());
