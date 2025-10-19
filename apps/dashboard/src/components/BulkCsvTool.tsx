import { createApiClient } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, UI_STRINGS } from '../constants';

interface JobStatus {
  job_id?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: {
    total?: number;
    processed?: number;
    percentage?: number;
  };
  result_data?: string;
  error?: string;
  result_url?: string;
  created_at?: string;
  updated_at?: string;
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

  const apiClient = createApiClient({
    baseURL: API_BASE
  });

  // Poll for job status
  useEffect(() => {
    if (jobId && jobId !== 'completed') {
      const pollStatus = async () => {
        try {
          const status = await apiClient.getJobStatus(jobId);
          setJobStatus(status as JobStatus);

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
      const result = await apiClient.batchValidateData({
        type: 'email',
        data: emails as any
      });
      setJobId(result.job_id || 'completed');
      setJobStatus({ job_id: result.job_id || 'completed', status: 'pending' });
    }

    if (phones.length > 0) {
      const result = await apiClient.batchValidateData({
        type: 'phone',
        data: phones as any
      });
      setJobId(result.job_id || 'completed');
      setJobStatus({ job_id: result.job_id || 'completed', status: 'pending' });
    }
  };

  const processOrdersCSV = async (data: string[][]): Promise<void> => {
    if (data.length < 2) throw new Error('CSV must have header and at least one data row');

    // For now, just mark as completed - order evaluation would need more complex parsing
    setJobId('completed');
    setJobStatus({ job_id: 'completed', status: 'completed' });
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
    if (!jobStatus?.result_data && !jobStatus?.result_url) return;

    if (jobStatus.result_data) {
      const blob = new Blob([jobStatus.result_data], { type: 'text/csv' });
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
    <div className="bulk-csv-page">
      <header className="page-header">
        <h2>{UI_STRINGS.BULK_CSV_TOOL}</h2>
      </header>

      {error && <div className="alert alert-danger">Error: {error}</div>}

      <div className="csv-config">
        <div className="form-group">
          <label htmlFor="csv-type">{UI_STRINGS.SELECT_CSV_TYPE}</label>
          <select
            id="csv-type"
            value={csvType}
            onChange={(e) => setCsvType(e.target.value as 'customers' | 'orders')}
            disabled={loading}
          >
            <option value="customers">{UI_STRINGS.CSV_TYPE_CUSTOMERS}</option>
            <option value="orders">{UI_STRINGS.CSV_TYPE_ORDERS}</option>
          </select>
        </div>
      </div>

      <div className="upload-section">
        <div
          className={`upload-area ${dragOver ? 'drag-over' : ''} ${loading ? 'disabled' : ''}`}
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
            <div className="upload-content">
              <div className="spinner"></div>
              <p>{UI_STRINGS.PROCESSING_CSV}</p>
            </div>
          ) : (
            <div className="upload-content">
              <div className="upload-icon">📄</div>
              <p>{UI_STRINGS.DRAG_DROP_OR_CLICK}</p>
              {file && <p className="file-name">Selected: {file.name}</p>}
            </div>
          )}
        </div>
      </div>

      {jobStatus && (
        <div className="job-status">
          <h3>Processing Status</h3>
          <div className="status-info">
            <p>Job ID: {jobStatus.job_id}</p>
            <p>Status: {jobStatus.status}</p>
            {jobStatus.progress && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${jobStatus.progress.percentage}%` }}
                ></div>
                <span className="progress-text">
                  {jobStatus.progress.processed} / {jobStatus.progress.total}
                </span>
              </div>
            )}
            {jobStatus.status === 'completed' && (
              <button onClick={downloadResults} className="btn btn-primary">
                {UI_STRINGS.DOWNLOAD_RESULTS}
              </button>
            )}
            {jobStatus.error && (
              <div className="alert alert-danger">Error: {jobStatus.error}</div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .bulk-csv-page {
          max-width: 800px;
          margin: 0 auto;
        }
        .page-header {
          margin-bottom: var(--spacing-lg);
        }
        .csv-config {
          margin-bottom: var(--spacing-lg);
        }
        .upload-section {
          margin-bottom: var(--spacing-lg);
        }
        .upload-area {
          border: 2px dashed var(--border-color);
          border-radius: var(--border-radius);
          padding: var(--spacing-xl);
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s;
          min-height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .upload-area:hover,
        .upload-area.drag-over {
          border-color: var(--primary-color);
        }
        .upload-area.disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }
        .upload-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--spacing-md);
        }
        .upload-icon {
          font-size: 3rem;
          color: var(--text-secondary);
        }
        .file-name {
          font-weight: bold;
          color: var(--primary-color);
        }
        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid var(--border-color);
          border-top: 4px solid var(--primary-color);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .job-status {
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          padding: var(--spacing-lg);
          margin-top: var(--spacing-lg);
        }
        .status-info p {
          margin: var(--spacing-sm) 0;
        }
        .progress-bar {
          width: 100%;
          height: 24px;
          background: var(--bg-secondary);
          border-radius: var(--border-radius);
          overflow: hidden;
          position: relative;
          margin: var(--spacing-md) 0;
        }
        .progress-fill {
          height: 100%;
          background: var(--primary-color);
          transition: width 0.3s ease;
        }
        .progress-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: white;
          font-size: 0.875rem;
          font-weight: bold;
        }
        .alert {
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          border: 1px solid;
          margin-bottom: var(--spacing-lg);
        }
        .alert-danger {
          background-color: #f8d7da;
          border-color: #f5c6cb;
          color: #721c24;
        }
      `}</style>
    </div>
  );
};

export default BulkCsvTool;