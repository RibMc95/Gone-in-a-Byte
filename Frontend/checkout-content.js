(function () {
    const element = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const STAGGER_MS = 110;

    function useReveal(delay) {
        const [isRevealed, setIsRevealed] = useState(false);

        useEffect(() => {
            const timer = window.setTimeout(() => {
                setIsRevealed(true);
            }, delay);

            return () => {
                window.clearTimeout(timer);
            };
        }, [delay]);

        return isRevealed;
    }

    function RevealBlock(props) {
        const isRevealed = useReveal(props.delay || 0);
        const classNames = [props.className || "", "react-product-item"];

        if (isRevealed) {
            classNames.push("react-product-item-visible");
        }

        return element(props.tagName || "div", { className: classNames.join(" ").trim() }, props.children);
    }

    function CheckoutContent() {
        return element(React.Fragment, null,
            element(RevealBlock, {
                delay: 0,
                tagName: "h2",
                className: "limelight-regular page-title",
            }, "Checkout"),
            element(RevealBlock, {
                delay: STAGGER_MS,
                className: "checkout-card",
                tagName: "section",
            },
                element("div", {
                    id: "cart-empty",
                    className: "checkout-empty",
                }, "Your cart is empty. Add cookies from the products page."),
                element("div", {
                    id: "cart-content",
                    hidden: true,
                },
                    element("div", { id: "cart-items", className: "checkout-items" }),
                    element("div", { className: "checkout-summary" },
                        element("p", null, "Total Items: ", element("strong", { id: "total-items" }, "0")),
                        element("p", null, "Total Price: ", element("strong", { id: "total-price" }, "$0.00")),
                    ),
                    element("div", { className: "checkout-actions" },
                        element("button", {
                            id: "clear-cart-btn",
                            type: "button",
                            className: "buy-button",
                        }, "Clear Cart"),
                        element("button", {
                            id: "square-card-btn",
                            type: "button",
                            className: "buy-button",
                        }, "Pay with Card (Square)"),
                        element("div", {
                            id: "card-container",
                            "aria-label": "Card details",
                        }),
                    ),
                ),
            ),
        );
    }

    const rootNode = document.getElementById("checkout-content-root");
    if (!rootNode) {
        return;
    }

    const root = ReactDOM.createRoot(rootNode);
    if (typeof ReactDOM.flushSync === "function") {
        ReactDOM.flushSync(() => {
            root.render(element(CheckoutContent));
        });
    } else {
        root.render(element(CheckoutContent));
    }

    if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.initSiteChrome === "function") {
        window.GoneInABiteeSite.initSiteChrome();
    }
}());
