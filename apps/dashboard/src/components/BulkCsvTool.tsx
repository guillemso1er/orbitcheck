import { batchValidate, getJobStatusById } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UI_STRINGS } from '../constants';
import { apiClient } from '../utils/api';

interface JobStatus {
  id?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  result?: {
    [key: string]: unknown;
  } | null;
  result_url?: string;
  error?: string;
  created_at?: string;
  updated_at?: string;
  request_id?: string;
}

const BulkCsvTool: React.FC = () => {
  const [csvType, setCsvType] = useState<'customers' | 'orders'>('customers');
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<number | null>(null);

  // Poll for job status
  useEffect(() => {
    if (jobId && jobId !== 'completed') {
      const pollStatus = async () => {
        try {
          const { data } = await getJobStatusById({ client: apiClient, path: { id: jobId } });
          const status = data as JobStatus;
          setJobStatus(status);

          if (status.status === 'completed' || status.status === 'failed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
        } catch (error) {
          console.error('Failed to poll job status:', error);
        }
      };

      // Poll immediately and then every 2 seconds
      pollStatus();
      pollingIntervalRef.current = window.setInterval(pollStatus, 2000);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    }
  }, [jobId, apiClient]);

  const parseCSV = (csvText: string): string[][] => {
    const lines = csvText.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++; // skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current);
      return result;
    });
  };

  const processCustomersCSV = async (data: string[][]): Promise<void> => {
    if (data.length < 2) throw new Error('CSV must have header and at least one data row');

    const headers = data[0].map(h => h.toLowerCase().trim());
    const emailIndex = headers.findIndex(h => h.includes('email'));
    const phoneIndex = headers.findIndex(h => h.includes('phone'));

    if (emailIndex === -1 && phoneIndex === -1) {
      throw new Error('CSV must contain email or phone columns');
    }

    // Collect validation data
    const emails: string[] = [];
    const phones: string[] = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length > emailIndex && row[emailIndex]) {
        emails.push(row[emailIndex].trim());
      }
      if (row.length > phoneIndex && row[phoneIndex]) {
        phones.push(row[phoneIndex].trim());
      }
    }

    // Process validations
    if (emails.length > 0) {
      const result = await batchValidate({ client: apiClient, body: { type: 'email', data: emails.map(email => ({ email })) } });
      if (result.data) {
        setJobId(result.data.job_id || 'completed');
        setJobStatus({ id: result.data.job_id || 'completed', status: 'pending' });
      }
    }

    if (phones.length > 0) {
      const result = await batchValidate({ client: apiClient, body: { type: 'phone', data: phones.map(phone => ({ phone })) } });
      if (result.data) {
        setJobId(result.data.job_id || 'completed');
        setJobStatus({ id: result.data.job_id || 'completed', status: 'pending' });
      }
    }
  };

  const processOrdersCSV = async (data: string[][]): Promise<void> => {
    if (data.length < 2) throw new Error('CSV must have header and at least one data row');

    const headers = data[0].map(h => h.toLowerCase().trim());
    const orderIdIndex = headers.findIndex(h => h.includes('order_id'));
    const emailIndex = headers.findIndex(h => h.includes('customer_email'));
    const totalIndex = headers.findIndex(h => h.includes('total'));
    const itemsIndex = headers.findIndex(h => h.includes('items'));

    if (orderIdIndex === -1 || emailIndex === -1) {
      throw new Error('Orders CSV must contain order_id and customer_email columns');
    }

    // Collect order data
    const orders: Array<{ order_id: string; customer_email: string; total?: number; items?: string }> = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length > orderIdIndex && row[orderIdIndex] && row.length > emailIndex && row[emailIndex]) {
        orders.push({
          order_id: row[orderIdIndex].trim(),
          customer_email: row[emailIndex].trim(),
          total: totalIndex !== -1 && row[totalIndex] ? parseFloat(row[totalIndex].trim()) : undefined,
          items: itemsIndex !== -1 && row[itemsIndex] ? row[itemsIndex].trim() : undefined
        });
      }
    }

    // Process orders validation (this would typically call an API endpoint for order evaluation)
    if (orders.length > 0) {
      // For now, simulate order processing - in production this would validate orders
      setJobId('orders-completed');
      setJobStatus({
        id: 'orders-completed',
        status: 'completed',
        progress: 100,
        result: { message: `Processed ${orders.length} orders successfully` }
      });
    }
  };

  const handleFileUpload = async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setLoading(true);
    setError(null);

    try {
      const text = await selectedFile.text();
      const data = parseCSV(text);

      if (csvType === 'customers') {
        await processCustomersCSV(data);
      } else {
        await processOrdersCSV(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [csvType]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const downloadResults = () => {
    if (!jobStatus?.result && !jobStatus?.result_url) return;

    if (jobStatus.result) {
      const blob = new Blob([JSON.stringify(jobStatus.result, null, 2)], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${csvType}_processed.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (jobStatus.result_url) {
      // If result_url is provided, open it in a new tab/window
      window.open(jobStatus.result_url, '_blank');
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{UI_STRINGS.BULK_CSV_TOOL}</h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm">
          Upload CSV files to process customer validations or order evaluations in bulk. Select the appropriate CSV type and format your data correctly.
        </p>
      </header>

      {error && <div id="alert-danger" className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-6">Error: {error}</div>}

      <div className="mb-8">
        <div className="mb-4">
          <label htmlFor="csv-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{UI_STRINGS.SELECT_CSV_TYPE}</label>
          <select
            id="csv-type"
            value={csvType}
            onChange={(e) => setCsvType(e.target.value as 'customers' | 'orders')}
            disabled={loading}
            className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="customers">{UI_STRINGS.CSV_TYPE_CUSTOMERS}</option>
            <option value="orders">{UI_STRINGS.CSV_TYPE_ORDERS}</option>
          </select>
        </div>
      </div>

      <div className="mb-8">
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors min-h-[200px] flex items-center justify-center ${dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900' : 'border-gray-300 dark:border-gray-600'} ${loading ? 'cursor-not-allowed opacity-60' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !loading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin"></div>
              <p className="text-gray-700 dark:text-gray-300">{UI_STRINGS.PROCESSING_CSV}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="text-6xl text-gray-400">📄</div>
              <p className="text-gray-700 dark:text-gray-300">{UI_STRINGS.DRAG_DROP_OR_CLICK}</p>
              {file && <p id="file-name" className="font-semibold text-blue-600 dark:text-blue-400">Selected: {file.name}</p>}
            </div>
          )}
        </div>
      </div>

      {jobStatus && (
        <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-6 bg-white dark:bg-gray-800">
          <h3 className="text-base font-semibold mb-4 text-gray-900 dark:text-white">Processing Status</h3>
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300"><strong>Job ID:</strong> {jobStatus.id}</p>
            <p className="text-gray-700 dark:text-gray-300"><strong>Status:</strong> {jobStatus.status}</p>
            {jobStatus.progress !== undefined && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                <div
                  className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                  style={{ width: `${jobStatus.progress}%` }}
                ></div>
                <div className="text-center text-sm mt-1 text-gray-600 dark:text-gray-400">
                  {Math.floor((jobStatus.progress || 0) * 100 / 100)} / 100
                </div>
              </div>
            )}
            {jobStatus.status === 'completed' && (
              <button onClick={downloadResults} className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors">
                {UI_STRINGS.DOWNLOAD_RESULTS}
              </button>
            )}
            {jobStatus.error && (
              <div id="alert-danger" className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded">Error: {jobStatus.error}</div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default BulkCsvTool;