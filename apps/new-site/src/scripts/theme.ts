/**
 * Theme toggle functionality
 * Handles light/dark mode switching with localStorage persistence
 */

export function initTheme(): void {
    const themeToggle = document.getElementById('theme-toggle');
    const themeToggleMobile = document.getElementById('theme-toggle-mobile');
    const themeIconLight = document.getElementById('theme-icon-light');
    const themeIconDark = document.getElementById('theme-icon-dark');

    function updateIcons(): void {
        const isDark = document.documentElement.classList.contains('dark');
        themeIconLight?.classList.toggle('hidden', isDark);
        themeIconDark?.classList.toggle('hidden', !isDark);
    }

    function toggleTheme(): void {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        updateIcons();
    }

    themeToggle?.addEventListener('click', toggleTheme);
    themeToggleMobile?.addEventListener('click', toggleTheme);
    updateIcons();
}
