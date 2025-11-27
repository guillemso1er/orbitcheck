/**
 * Animation and scroll functionality
 * Handles intersection observer animations, smooth scroll, and FAQ keyboard navigation
 */

export function initAnimations(): void {
    // Intersection Observer for animations
    const observerOptions: IntersectionObserverInit = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px',
    };

    const animateOnScroll = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate');
                animateOnScroll.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.count-up').forEach((el) => {
        animateOnScroll.observe(el);
    });
}

export function initSmoothScroll(): void {
    document.querySelectorAll('a[href^="#"]').forEach((anchor: Element) => {
        const anchorEl = anchor as HTMLAnchorElement;
        anchorEl.addEventListener('click', function (this: HTMLAnchorElement, e: Event) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;

            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });

                // Update URL without jumping
                history.pushState({}, '', href);
            }
        });
    });
}

export function initFAQKeyboard(): void {
    document.querySelectorAll('details summary').forEach((summary: Element) => {
        summary.addEventListener('keydown', (e: Event) => {
            const keyEvent = e as KeyboardEvent;
            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                e.preventDefault();
                (summary as HTMLElement).click();
            }
        });
    });
}

export function initCopyrightYear(): void {
    const copyrightYearEl = document.getElementById('copyright-year');
    if (copyrightYearEl) {
        copyrightYearEl.textContent = String(new Date().getFullYear());
    }
}
