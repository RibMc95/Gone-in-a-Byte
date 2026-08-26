(function () {
    const element = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const STAGGER_MS = 110;

    const introText = "Join the Gone in a Bitee ambassador program to share our cookies, earn perks, and help spread the word.";

    const perks = [
        {
            id: "campus-presence",
            title: "Campus Presence",
            text: "Build your personal brand by hosting pop-ups, sampling days, and cookie drops.",
        },
        {
            id: "exclusive-perks",
            title: "Exclusive Perks",
            text: "Get early flavor previews, ambassador-only rewards, and referral bonuses.",
        },
        {
            id: "growth-network",
            title: "Growth Network",
            text: "Collaborate with student creators and clubs to amplify events and campaigns.",
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

    function PerkCard(props) {
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
            element("div", { className: "feature-icon" }, "★"),
            element("div", { className: "feature-content" },
                element("h4", null, props.title),
                element("p", null, props.text),
            ),
        );
    }

    function AmbassadorContent() {
        return element(React.Fragment, null,
            element(RevealBlock, {
                delay: 0,
                tagName: "h2",
                className: "limelight-regular page-title",
            }, "Brand Ambassadors"),
            element(RevealBlock, {
                delay: STAGGER_MS,
                tagName: "p",
                className: "page-text",
            }, introText),
            element("section", { className: "why-choose-section" },
                element("div", { className: "why-choose-features" },
                    perks.map((perk, index) => element(PerkCard, {
                        key: perk.id,
                        title: perk.title,
                        text: perk.text,
                        delay: STAGGER_MS * (2 + index),
                    })),
                ),
            ),
        );
    }

    const rootNode = document.getElementById("ambassador-content-root");
    if (!rootNode) {
        return;
    }

    ReactDOM.createRoot(rootNode).render(element(AmbassadorContent));

    if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.initSiteChrome === "function") {
        window.GoneInABiteeSite.initSiteChrome();
    }
}());
