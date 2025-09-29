import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  BarElement,
  ArcElement
} from 'chart.js';
import { Line, Bar, Pie } from 'react-chartjs-2';

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

const UsageDashboard: React.FC = () => {
  const { token } = useAuth();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/usage', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch usage data');
      }
      const usageData = await response.json();
      setData(usageData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  if (loading) return <div className="loading">Loading usage dashboard...</div>;
  if (error) return <div className="alert alert-danger">Error: {error}</div>;
  if (!data) return <div className="empty-state">No usage data available.</div>;

  // Prepare data for daily chart
  const dailyLabels = data.by_day.map(d => d.date);
  const dailyValidations = data.by_day.map(d => d.validations);
  const dailyOrders = data.by_day.map(d => d.orders);

  const dailyChartData = {
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

  // Top reason codes bar chart
  const reasonLabels = data.top_reason_codes.map(r => r.code);
  const reasonCounts = data.top_reason_codes.map(r => r.count);

  const reasonChartData = {
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

  // Cache hit ratio pie chart
  const cacheData = {
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

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const
      },
      title: {
        display: true,
        text: 'Usage Dashboard'
      }
    }
  };

  return (
    <div className="usage-dashboard">
      <header className="page-header">
        <h2>Usage Dashboard</h2>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <h3>Total Validations</h3>
          <p className="stat-value">{data.totals.validations.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🛒</div>
          <h3>Total Orders</h3>
          <p className="stat-value">{data.totals.orders.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <h3>Cache Hit Ratio</h3>
          <p className="stat-value">{data.cache_hit_ratio.toFixed(1)}%</p>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <h3 className="chart-title">Daily Usage</h3>
          <div className="chart-container">
            <Line options={options} data={dailyChartData} />
          </div>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Top Reason Codes</h3>
          <div className="chart-container">
            <Bar options={options} data={reasonChartData} />
          </div>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Cache Hit Ratio</h3>
          <div className="chart-container">
            <Pie data={cacheData} />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="usage-dashboard">
      <header className="page-header">
        <h2>Usage Dashboard</h2>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <h3>Total Validations</h3>
          <p className="stat-value">{data!.totals.validations.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🛒</div>
          <h3>Total Orders</h3>
          <p className="stat-value">{data!.totals.orders.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <h3>Cache Hit Ratio</h3>
          <p className="stat-value">{data!.cache_hit_ratio.toFixed(1)}%</p>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <h3 className="chart-title">Daily Usage</h3>
          <div className="chart-container">
            <Line options={options} data={dailyChartData} />
          </div>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Top Reason Codes</h3>
          <div className="chart-container">
            <Bar options={options} data={reasonChartData} />
          </div>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Cache Hit Ratio</h3>
          <div className="chart-container">
            <Pie data={cacheData} />
          </div>
        </div>
      </div>

      <style>{`
        .usage-dashboard {
          max-width: 1200px;
          margin: 0 auto;
        }
        .page-header {
          margin-bottom: var(--spacing-lg);
        }
        .page-header h2 {
          margin: 0;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--spacing-sm);
          margin-bottom: var(--spacing-lg);
        }
        .stat-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          padding: var(--spacing-md);
          text-align: center;
          box-shadow: var(--shadow-sm);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .stat-icon {
          font-size: 2.5rem;
          margin-bottom: var(--spacing-xs);
        }
        .stat-card h3 {
          margin: 0 0 var(--spacing-xs) 0;
          color: var(--text-primary);
          font-size: 1rem;
        }
        .stat-value {
          font-size: 2rem;
          font-weight: 700;
          color: #007bff;
          margin: 0;
          line-height: 1;
        }
        .charts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: var(--spacing-md);
        }
        .chart-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          padding: var(--spacing-md);
          box-shadow: var(--shadow-sm);
          height: 350px;
          display: flex;
          flex-direction: column;
        }
        .chart-title {
          margin: 0 0 var(--spacing-sm) 0;
          text-align: center;
          color: var(--text-primary);
          font-size: 1.125rem;
        }
        .chart-container {
          flex: 1;
          min-height: 250px;
        }
        .loading, .empty-state {
          text-align: center;
          padding: var(--spacing-xl);
          color: var(--text-secondary);
        }
        .alert {
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          border: 1px solid;
          margin: var(--spacing-lg) 0;
        }
        .alert-danger {
          background-color: #f8d7da;
          border-color: #f5c6cb;
          color: #721c24;
        }
        @media (max-width: 768px) {
          .stats-grid {
            grid-template-columns: 1fr;
            gap: var(--spacing-sm);
          }
          .charts-grid {
            grid-template-columns: 1fr;
            gap: var(--spacing-sm);
          }
          .chart-card {
            height: 300px;
          }
          .stat-value {
            font-size: 1.75rem;
          }
          .stat-icon {
            font-size: 2rem;
          }
        }
      `}</style>
    </div>
  );
};

export default UsageDashboard;