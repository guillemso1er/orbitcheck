declare module "*.css";
declare global {
    namespace JSX {
        interface IntrinsicElements {
            's-app-nav': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
            's-page': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                heading?: string;
            };
            's-section': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                heading?: string;
                slot?: string;
            };
            's-stack': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                gap?: string;
                block?: boolean;
            };
            's-text': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                variant?: string;
                tone?: 'info' | 'success' | 'auto' | 'neutral' | 'caution' | 'warning' | 'critical';
            };
            's-paragraph': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
            's-banner': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                tone?: 'success' | 'warning' | 'critical' | 'info';
                heading?: string;
                dismissible?: boolean;
            };
            's-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                variant?: 'primary' | 'secondary' | 'plain';
                tone?: 'critical';
                loading?: boolean;
                disabled?: boolean;
                type?: string;
                onClick?: () => void;
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            's-select': any;
            's-choice': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                value?: string;
                selected?: boolean;
            };
            's-spinner': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
            's-link': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                href?: string;
                target?: string;
            };
            's-unordered-list': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
            's-list-item': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
        }
    }
}

export { };
