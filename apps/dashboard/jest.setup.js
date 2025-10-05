require('@testing-library/jest-dom');

// Suppress React act() warnings for tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    const errorMessage = args[0]?.toString() || '';
    
    if (
      errorMessage.includes('Warning: An update to') &&
      errorMessage.includes('inside a test was not wrapped in act(...)')
    ) {
      return; // Ignore act() warnings
    }
    if (
      errorMessage.includes('Error: Not implemented: HTMLCanvasElement.prototype.getContext')
    ) {
      return; // Ignore canvas warnings
    }
    if (
      errorMessage.includes('Failed to create chart:') ||
      errorMessage.includes('can\'t acquire context from the given item')
    ) {
      return; // Ignore chart creation warnings
    }
    if (
      errorMessage.includes('Warning: ReactDOM.render is no longer supported in React 18')
    ) {
      return; // Ignore ReactDOM.render warnings
    }
    
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});