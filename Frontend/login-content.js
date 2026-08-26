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

    function LoginContent() {
        return element(React.Fragment, null,
            element(RevealBlock, {
                delay: 0,
                tagName: "h2",
                className: "limelight-regular page-title",
            }, "Account Login"),
            element(RevealBlock, {
                delay: STAGGER_MS,
                tagName: "section",
                className: "auth-card-layout",
            },
                element("div", { className: "login-uiverse wrapper" },
                    element("div", { className: "switch" },
                        element("input", {
                            className: "toggle",
                            type: "checkbox",
                            id: "auth-toggle",
                            "aria-label": "Switch between login and signup",
                        }),
                        element("label", { className: "slider", htmlFor: "auth-toggle" }),
                        element("span", { className: "card-side", "aria-hidden": "true" }),
                        element("div", { className: "flip-card__inner" },
                            element("form", {
                                id: "login-form",
                                className: "flip-card__form flip-card__front",
                                autoComplete: "on",
                            },
                                element("p", { className: "title" }, "Log in"),
                                element("input", {
                                    id: "login-email",
                                    className: "flip-card__input",
                                    name: "email",
                                    type: "email",
                                    placeholder: "Email",
                                    required: true,
                                }),
                                element("input", {
                                    id: "login-password",
                                    className: "flip-card__input",
                                    name: "password",
                                    type: "password",
                                    placeholder: "Password",
                                    minLength: 6,
                                    required: true,
                                }),
                                element("label", { className: "remember-row", htmlFor: "login-remember" },
                                    element("input", { id: "login-remember", type: "checkbox", defaultChecked: true }),
                                    element("span", null, "Remember me"),
                                ),
                                element("button", { className: "flip-card__btn", type: "submit" }, "Log in"),
                            ),
                            element("form", {
                                id: "register-form",
                                className: "flip-card__form flip-card__back",
                                autoComplete: "on",
                            },
                                element("p", { className: "title" }, "Sign up"),
                                element("input", {
                                    id: "register-email",
                                    className: "flip-card__input",
                                    name: "email",
                                    type: "email",
                                    placeholder: "Email",
                                    required: true,
                                }),
                                element("input", {
                                    id: "register-password",
                                    className: "flip-card__input",
                                    name: "password",
                                    type: "password",
                                    placeholder: "Password",
                                    minLength: 6,
                                    required: true,
                                }),
                                element("label", { className: "remember-row", htmlFor: "register-remember" },
                                    element("input", { id: "register-remember", type: "checkbox", defaultChecked: true }),
                                    element("span", null, "Remember me"),
                                ),
                                element("button", { className: "flip-card__btn", type: "submit" }, "Sign up"),
                            ),
                        ),
                    ),
                ),
                element("p", { id: "auth-status", className: "hero-subtitle auth-status" }),
            ),
        );
    }

    const rootNode = document.getElementById("login-content-root");
    if (!rootNode) {
        return;
    }

    const root = ReactDOM.createRoot(rootNode);
    if (typeof ReactDOM.flushSync === "function") {
        ReactDOM.flushSync(() => {
            root.render(element(LoginContent));
        });
    } else {
        root.render(element(LoginContent));
    }

    if (window.GoneInABiteeSite && typeof window.GoneInABiteeSite.initSiteChrome === "function") {
        window.GoneInABiteeSite.initSiteChrome();
    }
}());
