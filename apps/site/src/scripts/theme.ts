/**
 * Theme toggle functionality
 * Handles light/dark mode switching with localStorage persistence
 */

export function initTheme(): void {
    const themeToggle = document.getElementById('theme-toggle');
    const themeToggleMobile = document.getElementById('theme-toggle-mobile');

    function toggleTheme(): void {
        console.log('Toggle theme clicked. Current dark:', document.documentElement.classList.contains('dark'));
        const isDark = document.documentElement.classList.toggle('dark');
        console.log('After toggle, dark:', isDark);
        try {
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        } catch (e) {
            console.warn('Unable to save theme preference:', e);
        }
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
        console.log('Theme toggle listener attached');
    } else {
        console.warn('Theme toggle element not found');
    }

    if (themeToggleMobile) {
        themeToggleMobile.addEventListener('click', toggleTheme);
    }

    console.log('Theme initialized. Current mode:', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}
