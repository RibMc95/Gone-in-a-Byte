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

    function HoverRevealSection(props) {
        const [isHovered, setIsHovered] = useState(false);
        const isRevealed = useReveal(props.delay || 0);
        const classNames = [props.className, "react-product-item"];

        if (isRevealed) {
            classNames.push("react-product-item-visible");
        }

        if (isHovered) {
            classNames.push("react-product-item-hover");
        }

        return element("section", {
            className: classNames.join(" "),
            "aria-labelledby": props.labelledBy,
            onMouseEnter: () => setIsHovered(true),
            onMouseLeave: () => setIsHovered(false),
        }, props.children);
    }

    function CateringContent() {
        return element(React.Fragment, null,
            element(RevealBlock, {
                delay: 0,
                tagName: "h2",
                className: "limelight-regular page-title",
            }, "Catering"),
            element(RevealBlock, {
                delay: STAGGER_MS,
                tagName: "p",
                className: "page-text",
            }, "Planning an event? We offer fresh cookie trays, custom flavor assortments, and local drop-off options."),
            element(HoverRevealSection, {
                className: "catering-schedule-card",
                labelledBy: "catering-schedule-title",
                delay: STAGGER_MS * 2,
            },
                element("h3", { id: "catering-schedule-title", className: "gift-pack-title" }, "Schedule Catering Date"),
                element("p", { className: "gift-pack-text" }, "Pick your preferred catering date. This is saved separately from gift packs."),
                element("div", { className: "catering-schedule" },
                    element("label", { htmlFor: "catering-date", className: "catering-schedule-label" }, "Catering Date"),
                    element("input", { type: "date", id: "catering-date", className: "catering-date-input" }),
                    element("p", { id: "catering-date-status", className: "catering-date-status" }, "Select your catering date."),
                ),
            ),
            element(HoverRevealSection, {
                className: "gift-pack-card",
                labelledBy: "gift-pack-title",
                delay: STAGGER_MS * 3,
            },
                element("h3", { id: "gift-pack-title", className: "gift-pack-title" }, "Make Your Own Gift Pack"),
                element("p", { className: "gift-pack-text" }, "Pick from our current cookies. Choose at least 5 and up to 10 cookies per pack."),
                element("div", { id: "gift-pack-options", className: "gift-pack-options" }),
                element("div", { className: "gift-pack-summary", "aria-live": "polite" },
                    element("p", null, "Total Cookies: ", element("strong", { id: "gift-pack-total-count" }, "0"), " / 10"),
                    element("p", null, "Pack Price: ", element("strong", { id: "gift-pack-total-price" }, "$0.00")),
                    element("p", { id: "gift-pack-status", className: "gift-pack-status" }, "Select at least 5 cookies to build your pack."),
                ),
                element("button", {
                    id: "add-gift-pack-btn",
                    type: "button",
                    className: "buy-button",
                    disabled: true,
                }, "Add Gift Pack to Cart"),
            ),
        );
    }

    const rootNode = document.getElementById("catering-content-root");
    if (!rootNode) {
        return;
    }

    const root = ReactDOM.createRoot(rootNode);
    if (typeof ReactDOM.flushSync === "function") {
        ReactDOM.flushSync(() => {
            root.render(element(CateringContent));
        });
    } else {
        root.render(element(CateringContent));
    }

    if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.initSiteChrome === "function") {
        window.GoneInABiteeSite.initSiteChrome();
    }
}());
