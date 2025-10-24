import React from 'react';
import { useTheme } from '../ThemeContext';

const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <span className="text-xl" role="img" aria-hidden="true">🌙</span>
      ) : (
        <span className="text-xl" role="img" aria-hidden="true">☀️</span>
      )}
    </button>
  );
};

export default ThemeToggle;