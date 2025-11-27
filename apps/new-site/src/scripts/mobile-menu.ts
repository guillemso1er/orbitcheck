/**
 * Mobile menu functionality
 * Handles hamburger menu toggle for mobile navigation
 */

export function initMobileMenu(): void {
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');
    const menuIconOpen = document.getElementById('menu-icon-open');
    const menuIconClose = document.getElementById('menu-icon-close');

    mobileMenuButton?.addEventListener('click', () => {
        const isExpanded = mobileMenuButton?.getAttribute('aria-expanded') === 'true';
        mobileMenuButton?.setAttribute('aria-expanded', String(!isExpanded));
        mobileMenu?.classList.toggle('hidden');
        menuIconOpen?.classList.toggle('hidden');
        menuIconClose?.classList.toggle('hidden');
    });

    // Close mobile menu when clicking a link
    mobileMenu?.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            mobileMenu?.classList.add('hidden');
            mobileMenuButton?.setAttribute('aria-expanded', 'false');
            menuIconOpen?.classList.remove('hidden');
            menuIconClose?.classList.add('hidden');
        });
    });
}
