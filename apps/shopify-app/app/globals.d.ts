declare module "*.css";
declare global {
    namespace JSX {
        interface IntrinsicElements {
            's-app-nav': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
            // Add other Shopify web components here as needed, e.g.:
            // 's-stack': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
            // 's-grid': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
        }
    }
}

export { };
