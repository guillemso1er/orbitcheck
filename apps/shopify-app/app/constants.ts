const getApiBase = () => {
  // Vite automatically replaces import.meta.env at build time
  // For session-based auth, use same origin /api path
  return import.meta.env?.VITE_API_BASE ?? '/_api';
};

export const API_BASE = getApiBase();