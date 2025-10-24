import { createApiClient } from '@orbitcheck/contracts';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip
} from 'chart.js';

import React from 'react';
import { Bar, Line, Pie } from 'react-chartjs-2';
import { API_BASE, UI_STRINGS } from '../constants';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface UsageData {
  period: string;
  totals: { validations: number; orders: number };
  by_day: Array<{ date: string; validations: number; orders: number }>;
  top_reason_codes: Array<{ code: string; count: number }>;
  cache_hit_ratio: number;
  request_id: string;
}

function prepareDailyChartData(data: UsageData) {
  const dailyLabels = data.by_day.map(d => d.date);
  const dailyValidations = data.by_day.map(d => d.validations);
  const dailyOrders = data.by_day.map(d => d.orders);

  return {
    labels: dailyLabels,
    datasets: [
      {
        label: 'Validations',
        data: dailyValidations,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.1
      },
      {
        label: 'Orders',
        data: dailyOrders,
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        tension: 0.1
      }
    ]
  };
}

function prepareReasonChartData(data: UsageData) {
  const reasonLabels = data.top_reason_codes.map(r => r.code);
  const reasonCounts = data.top_reason_codes.map(r => r.count);

  return {
    labels: reasonLabels,
    datasets: [
      {
        label: 'Count',
        data: reasonCounts,
        backgroundColor: 'rgba(153, 102, 255, 0.6)',
        borderColor: 'rgba(153, 102, 255, 1)',
        borderWidth: 1
      }
    ]
  };
}

function prepareCacheChartData(data: UsageData) {
  return {
    labels: ['Cache Hits', 'Cache Misses'],
    datasets: [
      {
        data: [data.cache_hit_ratio, 100 - data.cache_hit_ratio],
        backgroundColor: [
          'rgba(75, 192, 192, 0.6)',
          'rgba(255, 99, 132, 0.6)'
        ],
        borderColor: [
          'rgba(75, 192, 192, 1)',
          'rgba(255, 99, 132, 1)'
        ],
        borderWidth: 1
      }
    ]
  };
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const
    },
    title: {
      display: false
    }
  }
};

const StatsGrid: React.FC<{ data: UsageData }> = ({ data }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
    <div className="bg-white p-6 rounded-lg shadow-md text-center transition-transform transform hover:-translate-y-1">
      <div className="text-4xl mb-2">📊</div>
      <h3 className="text-sm font-medium text-gray-500 uppercase">{UI_STRINGS.TOTAL_VALIDATIONS}</h3>
      <p className="text-3xl font-bold text-indigo-600">{data.totals.validations.toLocaleString()}</p>
    </div>
    <div className="bg-white p-6 rounded-lg shadow-md text-center transition-transform transform hover:-translate-y-1">
      <div className="text-4xl mb-2">🛒</div>
      <h3 className="text-sm font-medium text-gray-500 uppercase">{UI_STRINGS.TOTAL_ORDERS}</h3>
      <p className="text-3xl font-bold text-indigo-600">{data.totals.orders.toLocaleString()}</p>
    </div>
    <div className="bg-white p-6 rounded-lg shadow-md text-center transition-transform transform hover:-translate-y-1">
      <div className="text-4xl mb-2">⚡</div>
      <h3 className="text-sm font-medium text-gray-500 uppercase">{UI_STRINGS.CACHE_HIT_RATIO}</h3>
      <p className="text-3xl font-bold text-indigo-600">{data.cache_hit_ratio.toFixed(1)}%</p>
    </div>
  </div>
);

const DailyUsageChart: React.FC<{ data: UsageData }> = ({ data }) => {
  const chartData = prepareDailyChartData(data);
  return (
    <div className="bg-white p-6 rounded-lg shadow-md flex flex-col h-96">
      <h3 className="text-lg font-semibold text-gray-800 text-center mb-4">{UI_STRINGS.DAILY_USAGE}</h3>
      <div className="relative flex-1">
        <Line options={chartOptions} data={chartData} />
      </div>
    </div>
  );
};

const TopReasonCodesChart: React.FC<{ data: UsageData }> = ({ data }) => {
  const chartData = prepareReasonChartData(data);
  return (
    <div className="bg-white p-6 rounded-lg shadow-md flex flex-col h-96">
      <h3 className="text-lg font-semibold text-gray-800 text-center mb-4">{UI_STRINGS.TOP_REASON_CODES}</h3>
      <div className="relative flex-1">
        <Bar options={chartOptions} data={chartData} />
      </div>
    </div>
  );
};

const CacheHitRatioChart: React.FC<{ data: UsageData }> = ({ data }) => {
  const chartData = prepareCacheChartData(data);
  return (
    <div className="bg-white p-6 rounded-lg shadow-md flex flex-col h-96">
      <h3 className="text-lg font-semibold text-gray-800 text-center mb-4">{UI_STRINGS.CACHE_HIT_RATIO}</h3>
      <div className="relative flex-1 flex items-center justify-center">
        <Pie data={chartData} />
      </div>
    </div>
  );
};

const UsageDashboard: React.FC = () => {
  const [data, setData] = React.useState<UsageData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchUsage = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const apiClient = createApiClient({
        baseURL: API_BASE
      });

      const usageData = await apiClient.getUsage();

      if (!usageData) {
        setData(null);
        return;
      }

      setData({
        period: usageData.period || '',
        totals: {
          validations: usageData.totals?.validations ?? 0,
          orders: usageData.totals?.orders ?? 0
        },
        by_day: (usageData.by_day ?? []).map(day => ({
          date: day?.date ?? '',
          validations: day?.validations ?? 0,
          orders: day?.orders ?? 0
        })),
        top_reason_codes: (usageData.top_reason_codes ?? []).map(code => ({
          code: code?.code ?? '',
          count: code?.count ?? 0
        })),
        cache_hit_ratio: usageData.cache_hit_ratio ?? 0,
        request_id: usageData.request_id ?? ''
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  if (loading) return <div className="text-center p-10 text-gray-500">{UI_STRINGS.LOADING} usage dashboard...</div>;
  if (error) return <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded m-4" role="alert">Error: {error}</div>;
  if (!data || !data.period) return <div className="text-center p-10 text-gray-500">{UI_STRINGS.NO_DATA}</div>;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h2 className="text-3xl font-extrabold text-gray-900">{UI_STRINGS.USAGE_DASHBOARD}</h2>
      </header>

      <StatsGrid data={data} />

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <div className="lg:col-span-2 xl:col-span-3">
          <DailyUsageChart data={data} />
        </div>
        <div className="xl:col-span-2">
          <TopReasonCodesChart data={data} />
        </div>
        <div>
          <CacheHitRatioChart data={data} />
        </div>
      </div>
    </div>
  );
};

export default UsageDashboard;