require('@testing-library/jest-dom');

// Mock import.meta.env for Jest
Object.defineProperty(globalThis, 'import', {
  value: {
    meta: {
      env: {
        VITE_API_BASE: '/_api',
        VITE_INFISICAL_SITE_URL: 'https://app.infisical.com',
        VITE_INFISICAL_PROJECT_ID: 'your_infisical_project_id',
        VITE_INFISICAL_ENVIRONMENT: 'dev',
      },
    },
  },
  writable: true,
});

// Mock the contracts module to avoid import.meta issues
// We need to mock the entire module including the routes
jest.mock('@orbitcheck/contracts', () => ({
  MGMT_V1_ROUTES: {
    API_KEYS: {
      LIST_API_KEYS: '/v1/api-keys',
    },
    DATA: {
      GET_USAGE_STATISTICS: '/v1/data/usage',
      GET_EVENT_LOGS: '/v1/data/logs',
    },
    WEBHOOKS: {
      TEST_WEBHOOK: '/v1/webhooks/test',
    },
    RULES: {
      GET_AVAILABLE_RULES: '/v1/rules/available',
      TEST_RULES_AGAINST_PAYLOAD: '/v1/rules/test',
      REGISTER_CUSTOM_RULES: '/v1/rules/register',
    },
  },
  API_V1_ROUTES: {
    BATCH: {
      BATCH_VALIDATE_DATA: '/v1/batch/validate',
      BATCH_DEDUPLICATE_DATA: '/v1/batch/dedupe',
    },
    JOBS: {
      GET_JOB_STATUS: '/v1/jobs/status',
    },
    ORDERS: {
      EVALUATE_ORDER_FOR_RISK_AND_RULES: '/v1/orders/evaluate',
    },
  },
  createApiClient: jest.fn(() => ({
    loginUser: jest.fn(),
    registerUser: jest.fn(),
  })),
  openapiYaml: 'mocked-yaml',
}));

// Mock canvas for Chart.js
const { Canvas } = require('canvas');

// Mock canvas-related modules
Object.defineProperty(global, 'HTMLCanvasElement', {
  value: Canvas,
  writable: true,
});

Object.defineProperty(global, 'CanvasRenderingContext2D', {
  value: class MockCanvasRenderingContext2D {
    constructor() {
      this.canvas = new Canvas();
    }
    fillRect() { }
    strokeRect() { }
    clearRect() { }
    beginPath() { }
    moveTo() { }
    lineTo() { }
    stroke() { }
    fill() { }
    arc() { }
    closePath() { }
  },
  writable: true,
});

// Mock Chart.js specifically
jest.mock('chart.js', () => {
  const mockChart = jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
  }));

  return {
    Chart: mockChart,
    // Mock the register function
    register: jest.fn(),
    // Mock all the scales and elements that might be registered
    CategoryScale: jest.fn(),
    LinearScale: jest.fn(),
    PointElement: jest.fn(),
    LineElement: jest.fn(),
    BarElement: jest.fn(),
    Title: jest.fn(),
    Tooltip: jest.fn(),
    Legend: jest.fn(),
    ArcElement: jest.fn(),
  };
});

// Mock react-chartjs-2 - simplified version
jest.mock('react-chartjs-2', () => ({
  Line: jest.fn().mockImplementation(() => ({
    type: 'div',
    props: { 'data-testid': 'line-chart', children: 'Mock Line Chart' }
  })),
  Bar: jest.fn().mockImplementation(() => ({
    type: 'div',
    props: { 'data-testid': 'bar-chart', children: 'Mock Bar Chart' }
  })),
  Pie: jest.fn().mockImplementation(() => ({
    type: 'div',
    props: { 'data-testid': 'pie-chart', children: 'Mock Pie Chart' }
  })),
}));

// Properly mock network requests to prevent network errors in tests
beforeAll(() => {
  // Mock global fetch to prevent network requests
  global.fetch = jest.fn();

  // Mock XMLHttpRequest to prevent jsdom errors
  const mockXHR = {
    open: jest.fn(),
    send: jest.fn(),
    setRequestHeader: jest.fn(),
    readyState: 4,
    status: 200,
    responseText: '{}',
    response: '{}',
    onreadystatechange: null,
    onerror: null,
    ontimeout: null,
    onprogress: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    abort: jest.fn(),
    getResponseHeader: jest.fn(() => 'application/json'),
    getAllResponseHeaders: jest.fn(() => 'Content-Type: application/json'),
    overrideMimeType: jest.fn(),
  };

  // Mock the XMLHttpRequest constructor
  global.XMLHttpRequest = jest.fn().mockImplementation(() => mockXHR);
});

afterAll(() => {
  // Clean up mocks
  global.fetch.mockClear();
  global.XMLHttpRequest.mockClear();
});


const { configure } = require('@testing-library/react');

configure({
  getElementError: (message, container) => {
    const error = new Error(message);
    error.name = 'TestingLibraryElementError';
    error.stack = null; // This is key to keeping the output clean
    return error;
  },
});