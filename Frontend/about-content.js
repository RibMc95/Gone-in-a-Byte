(function () {
    const element = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const STAGGER_MS = 110;

    const intro = {
        title: "About Us",
        kicker: "Identity & Credibility",
        body: "Gone-In-a-Bitee is the campus cookie destination. Our brand fuses status, excitement, and nostalgia, channeling a grandma's warmth into a lively college scene. We're not just a treat; we're woven into campus culture. Students trust us because we're student-led, highly recommended, and we routinely sell out. Our free cookie guarantee eliminates risk, making people eager to try us. Ultimately, when everyone craves something, it's assumed to be exceptional.",
    };

    const features = [
        {
            id: "freshly-baked",
            title: "Freshly Baked",
            text: "Each batch is made to order for maximum freshness.",
        },
        {
            id: "handcrafted",
            title: "Handcrafted",
            text: "Baked in small batches to maintain quality and consistency.",
        },
        {
            id: "packaging-options",
            title: "Packaging Options",
            text: "Eco-friendly and customizable packaging available.",
        },
        {
            id: "allergen-transparency",
            title: "Allergen Transparency",
            text: "Clear labeling for nut-free, gluten-free, and other needs.",
        },
    ];

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
        const isRevealed = useReveal(props.delay);
        const classNames = [props.className || "", "react-product-item"];

        if (isRevealed) {
            classNames.push("react-product-item-visible");
        }

        return element(props.tagName || "div", { className: classNames.join(" ").trim() }, props.children);
    }

    function FeatureCard(props) {
        const [isHovered, setIsHovered] = useState(false);
        const isRevealed = useReveal(props.delay);
        const classNames = ["feature-card", "react-product-item"];

        if (isRevealed) {
            classNames.push("react-product-item-visible");
        }

        if (isHovered) {
            classNames.push("react-product-item-hover");
        }

        return element("div", {
            className: classNames.join(" "),
            onMouseEnter: () => setIsHovered(true),
            onMouseLeave: () => setIsHovered(false),
        },
            element("div", { className: "feature-icon" }, "→"),
            element("div", { className: "feature-content" },
                element("h4", null, props.title),
                element("p", null, props.text),
            ),
        );
    }

    function AboutContent() {
        return element(React.Fragment, null,
            element(RevealBlock, { delay: 0, tagName: "h2", className: "limelight-regular page-title" }, intro.title),
            element(RevealBlock, { delay: STAGGER_MS, tagName: "p", className: "page-text about-kicker" }, intro.kicker),
            element(RevealBlock, { delay: STAGGER_MS * 2, tagName: "p", className: "page-text" }, intro.body),
            element("section", { className: "why-choose-section" },
                element("div", { className: "why-choose-container" },
                    element("div", { className: "why-choose-features" },
                        element(RevealBlock, {
                            delay: STAGGER_MS * 3,
                            tagName: "h3",
                            className: "limelight-regular why-choose-title",
                        }, "Why Choose Our Cookies?"),
                        features.map((feature, index) => element(FeatureCard, {
                            key: feature.id,
                            title: feature.title,
                            text: feature.text,
                            delay: STAGGER_MS * (4 + index),
                        })),
                    ),
                    element(RevealBlock, { delay: STAGGER_MS * 6, className: "why-choose-image" },
                        element("img", {
                            src: "Cookies Images/classic-cookies.jpg",
                            alt: "Assorted fresh baked cookies",
                        }),
                    ),
                ),
            ),
        );
    }

    const rootNode = document.getElementById("about-content-root");
    if (!rootNode) {
        return;
    }

    ReactDOM.createRoot(rootNode).render(element(AboutContent));

    if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.initSiteChrome === "function") {
        window.GoneInABiteeSite.initSiteChrome();
    }
}());
