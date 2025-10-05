import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../AuthContext';
import WebhookTester from '../components/WebhookTester';
import { UI_STRINGS } from '../constants';

// Mocks remain the same...
jest.mock('chart.js', () => ({
  Chart: { register: jest.fn(), defaults: { global: {} } },
  CategoryScale: jest.fn(),
  LinearScale: jest.fn(),
  PointElement: jest.fn(),
  LineElement: jest.fn(),
  BarElement: jest.fn(),
  ArcElement: jest.fn(),
  Title: jest.fn(),
  Tooltip: jest.fn(),
  Legend: jest.fn(),
}));
jest.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="line-chart">Mock Line Chart</div>,
  Bar: () => <div data-testid="bar-chart">Mock Bar Chart</div>,
  Pie: () => <div data-testid="pie-chart">Mock Pie Chart</div>,
}));
const mockApiClient = {
  getUsage: jest.fn().mockResolvedValue({}),
  getLogs: jest.fn().mockResolvedValue({ data: [], next_cursor: null, total_count: 0 }),
  getApiKeys: jest.fn().mockResolvedValue({ data: [] }),
  listApiKeys: jest.fn().mockResolvedValue({ data: [] }),
  createApiKey: jest.fn().mockResolvedValue({ prefix: 'new-prefix', full_key: 'new-full-key' }),
  revokeApiKey: jest.fn().mockResolvedValue({}),
  rotateApiKey: jest.fn().mockResolvedValue({ prefix: 'rotated-prefix', full_key: 'rotated-full-key' }),
  testWebhook: jest.fn(),
  loginUser: jest.fn().mockResolvedValue({ token: 'test-token', user: { id: 'user-id', email: 'test@example.com' } }),
};
jest.mock('@orbicheck/contracts', () => ({
  createApiClient: jest.fn(() => mockApiClient),
}));
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });
Object.defineProperty(window, 'ResizeObserver', {
  value: jest.fn(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  })),
});

const renderWithAuth = (component: React.ReactElement) => {
  return render(
    // Added future prop to address React Router warnings
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>{component}</AuthProvider>
    </BrowserRouter>
  );
};

describe('WebhookTester Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.testWebhook.mockResolvedValue({
      sent_to: 'https://example.com/webhook',
      payload: { event: 'test', data: 'test data' },
      response: {
        status: 200,
        status_text: 'OK',
        headers: { 'Content-Type': 'application/json' },
        body: '{"success": true}',
      },
      request_id: 'test-request-id',
    });
  });

  it('should render Webhook Tester page header', () => {
    renderWithAuth(<WebhookTester />);
    expect(screen.getByRole('heading', { name: UI_STRINGS.WEBHOOK_TESTER })).toBeInTheDocument();
  });

  it('should render test form with URL input', () => {
    renderWithAuth(<WebhookTester />);
    expect(screen.getByLabelText('Webhook URL')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://your-webhook-url.com/endpoint')).toBeInTheDocument();
  });

  it('should render payload type selector', () => {
    renderWithAuth(<WebhookTester />);
    expect(screen.getByLabelText('Payload Type')).toBeInTheDocument();
    expect(screen.getByText('Validation Result')).toBeInTheDocument();
    expect(screen.getByText('Order Evaluation')).toBeInTheDocument();
    expect(screen.getByText('Custom Payload')).toBeInTheDocument();
  });

  it('should show custom payload textarea when custom payload is selected', () => {
    renderWithAuth(<WebhookTester />);
    expect(screen.queryByLabelText('Custom Payload (JSON)')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payload Type'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('Custom Payload (JSON)')).toBeInTheDocument();
  });

  it('should handle URL input changes', () => {
    renderWithAuth(<WebhookTester />);
    const urlInput = screen.getByLabelText('Webhook URL');
    fireEvent.change(urlInput, { target: { value: 'https://new-url.com/webhook' } });
    expect(urlInput).toHaveValue('https://new-url.com/webhook');
  });

  it('should handle payload type changes', () => {
    renderWithAuth(<WebhookTester />);
    const payloadSelect = screen.getByLabelText('Payload Type');
    fireEvent.change(payloadSelect, { target: { value: 'order' } });
    expect(payloadSelect).toHaveValue('order');
  });

  it('should handle custom payload changes', () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Payload Type'), { target: { value: 'custom' } });
    const customPayloadInput = screen.getByLabelText('Custom Payload (JSON)');
    fireEvent.change(customPayloadInput, { target: { value: '{"event": "custom", "data": "test"}' } });
    expect(customPayloadInput).toHaveValue('{"event": "custom", "data": "test"}');
  });

  it('should validate required URL field', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Error: ${UI_STRINGS.URL_REQUIRED}`);
  });

  it('should send webhook test with validation payload', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));
    await waitFor(() => {
      expect(mockApiClient.testWebhook).toHaveBeenCalledWith('https://example.com/webhook', 'validation', undefined);
    });
  });

  it('should send webhook test with order payload', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.change(screen.getByLabelText('Payload Type'), { target: { value: 'order' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));
    await waitFor(() => {
      expect(mockApiClient.testWebhook).toHaveBeenCalledWith('https://example.com/webhook', 'order', undefined);
    });
  });

  it('should send webhook test with custom payload', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.change(screen.getByLabelText('Payload Type'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom Payload (JSON)'), { target: { value: '{"event": "custom", "data": "test"}' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));
    await waitFor(() => {
      expect(mockApiClient.testWebhook).toHaveBeenCalledWith('https://example.com/webhook', 'custom', { event: 'custom', data: 'test' });
    });
  });

  it('should display loading state while sending', async () => {
    mockApiClient.testWebhook.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({}), 100)));
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));
    expect(screen.getByText(UI_STRINGS.SENDING)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(UI_STRINGS.SENDING)).not.toBeInTheDocument();
    });
  });

  it('should display test results when received', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));
    await screen.findByText(UI_STRINGS.TEST_RESULT);
    expect(screen.getByRole('button', { name: UI_STRINGS.REQUEST })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: UI_STRINGS.RESPONSE })).toBeInTheDocument();
  });

  it('should display request tab content', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));
    await screen.findByText(UI_STRINGS.SENT_TO);
    expect(screen.getByText(UI_STRINGS.PAYLOAD)).toBeInTheDocument();
    expect(screen.getByText('https://example.com/webhook')).toBeInTheDocument();
  });

  it('should display response tab content', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));

    await screen.findByText(UI_STRINGS.TEST_RESULT);
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.RESPONSE }));

    await screen.findByText(UI_STRINGS.STATUS);
    expect(screen.getByText(UI_STRINGS.HEADERS)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.BODY)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.REQUEST_ID)).toBeInTheDocument();
    expect(screen.getByText('200 OK')).toBeInTheDocument();
  });

  it('should switch between request and response tabs', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));

    await screen.findByText(UI_STRINGS.PAYLOAD);

    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.RESPONSE }));
    await screen.findByText(UI_STRINGS.STATUS);
    expect(screen.queryByText(UI_STRINGS.PAYLOAD)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.REQUEST }));
    await screen.findByText(UI_STRINGS.PAYLOAD);
    expect(screen.queryByText(UI_STRINGS.STATUS)).not.toBeInTheDocument();
  });

  it('should clear test results', async () => {
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));

    await screen.findByText(UI_STRINGS.TEST_RESULT);

    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.CLEAR }));
    expect(screen.queryByText(UI_STRINGS.TEST_RESULT)).not.toBeInTheDocument();
  });

  it('should handle API errors gracefully', async () => {
    mockApiClient.testWebhook.mockRejectedValue(new Error('Webhook failed'));
    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error: Webhook failed');
  });

  it('should handle different response statuses', async () => {
    mockApiClient.testWebhook.mockResolvedValue({
      sent_to: 'https://example.com/webhook',
      payload: { event: 'test' },
      response: {
        status: 404,
        status_text: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
        body: '{"error": "Not found"}',
      },
      request_id: 'test-request-id',
    });

    renderWithAuth(<WebhookTester />);
    fireEvent.change(screen.getByLabelText('Webhook URL'), { target: { value: 'https://example.com/webhook' } });
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.SEND_TEST_PAYLOAD }));

    await screen.findByText(UI_STRINGS.TEST_RESULT);
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.RESPONSE }));

    await screen.findByText('404 Not Found');
    const bodyElement = screen.getByText((content, element) =>
      element.tagName.toLowerCase() === 'pre' && content.includes('{"error": "Not found"}')
    );
    expect(bodyElement).toBeInTheDocument();
  });
});