import { batchValidate, batchEvaluateOrders, getJobStatusById } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UI_STRINGS } from '../constants';
import { apiClient } from '../utils/api';

interface CsvFormatExample {
  name: string;
  description: string;
  headers: string[];
  sampleData: string[][];
  downloadFilename: string;
}

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
  const [csvType, setCsvType] = useState<'customers' | 'orders' | 'addresses' | 'taxids'>('customers');
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

  // CSV format examples
  const csvFormats: { [key in 'customers' | 'orders' | 'addresses' | 'taxids']: CsvFormatExample } = {
    customers: {
      name: 'Customers CSV (Validation)',
      description: 'Customer data with email and/or phone numbers for validation. Perfect for validating customer contact information before importing to your CRM or marketing platform.',
      headers: ['email', 'phone', 'name', 'address'],
      sampleData: [
        ['user1@example.com', '+1234567890', 'John Doe', '123 Main St, New York, NY 10001'],
        ['user2@example.com', '+0987654321', 'Jane Smith', '456 Oak Ave, Los Angeles, CA 90210'],
        ['user3@example.com', '', 'Bob Wilson', '789 Pine Rd, Chicago, IL 60601'],
        ['invalid-email', '+1555123456', 'Alice Brown', '321 Elm St, Miami, FL 33101'],
        ['test@gmail.com', '+1555987654', 'Charlie Davis', '654 Maple Dr, Seattle, WA 98101']
      ],
      downloadFilename: 'customers-validation-example.csv'
    },
    orders: {
      name: 'Orders CSV (Batch Evaluation)',
      description: 'Orders data for batch evaluation using rules and risk assessment. Perfect for analyzing order patterns, fraud detection, and compliance checks.',
      headers: ['order_id', 'customer_email', 'customer_phone', 'total_amount', 'currency', 'items', 'shipping_address'],
      sampleData: [
        ['ORD001', 'john.doe@example.com', '+1234567890', '99.99', 'USD', 'laptop,keyboard', '123 Main St, New York, NY 10001'],
        ['ORD002', 'jane.smith@example.com', '+0987654321', '149.50', 'USD', 'smartphone,case', '456 Oak Ave, Los Angeles, CA 90210'],
        ['ORD003', 'john.doe@example.com', '+1234567890', '75.00', 'USD', 'mouse,pad', '123 Main St, New York, NY 10001'],
        ['ORD004', 'alice.jones@example.com', '+1555123456', '299.99', 'USD', 'tablet,stylus', '789 Pine Rd, Chicago, IL 60601'],
        ['ORD005', 'bob.wilson@example.com', '+1555987654', '50.00', 'USD', 'headphones', '654 Maple Dr, Seattle, WA 98101']
      ],
      downloadFilename: 'orders-batch-evaluation-example.csv'
    },
    addresses: {
      name: 'Addresses CSV (Validation)',
      description: 'Address data for batch validation. Ensures addresses are properly formatted, valid, and deliverable.',
      headers: ['line1', 'line2', 'city', 'state', 'postal_code', 'country'],
      sampleData: [
        ['123 Main Street', 'Apt 4B', 'New York', 'NY', '10001', 'US'],
        ['456 Oak Avenue', '', 'Los Angeles', 'CA', '90210', 'US'],
        ['789 Pine Road', 'Suite 200', 'Chicago', 'IL', '60601', 'US'],
        ['321 Elm Street', 'Unit 5', 'Miami', 'FL', '33101', 'US'],
        ['654 Maple Drive', '', 'Seattle', 'WA', '98101', 'US']
      ],
      downloadFilename: 'addresses-validation-example.csv'
    },
    taxids: {
      name: 'Tax IDs CSV (Validation)',
      description: 'Tax identification numbers for validation and verification. Supports various international tax ID formats.',
      headers: ['tax_id', 'tax_id_type', 'name', 'country'],
      sampleData: [
        ['12-3456789', 'EIN', 'Acme Corporation', 'US'],
        ['12345678-9', 'VAT', 'Global Tech Ltd', 'DE'],
        ['AB123456789', 'GST', 'International Trade Co', 'AU'],
        ['98765432', 'RFC', 'Mexican Holdings', 'MX'],
        ['12345678901', 'CPF', 'Brazilian Services', 'BR']
      ],
      downloadFilename: 'taxids-validation-example.csv'
    }
  };

  // Download example CSV function
  const downloadExampleCsv = (type: 'customers' | 'orders' | 'addresses' | 'taxids') => {
    const format = csvFormats[type];
    const csvContent = [
      format.headers.join(','),
      ...format.sampleData.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format.downloadFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
        emails.push(String(row[emailIndex]).trim());
      }
      if (row.length > phoneIndex && row[phoneIndex]) {
        phones.push(String(row[phoneIndex]).trim());
      }
    }

    // Process validations with batchValidate
    if (emails.length > 0) {
      const result = await batchValidate({
        client: apiClient,
        body: {
          type: 'email',
          data: emails.map(email => ({ email }))
        }
      });
      if (result.data) {
        setJobId(result.data.job_id || 'completed');
        setJobStatus({ id: result.data.job_id || 'completed', status: 'pending' });
      }
    } else if (phones.length > 0) {
      const result = await batchValidate({
        client: apiClient,
        body: {
          type: 'phone',
          data: phones.map(phone => ({ phone }))
        }
      });
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
    const emailIndex = headers.findIndex(h => h.includes('email'));
    const phoneIndex = headers.findIndex(h => h.includes('phone'));
    const totalAmountIndex = headers.findIndex(h => h.includes('total_amount') || h.includes('total'));
    const currencyIndex = headers.findIndex(h => h.includes('currency'));
    const itemsIndex = headers.findIndex(h => h.includes('items'));
    const shippingAddressIndex = headers.findIndex(h => h.includes('shipping_address') || h.includes('address'));

    if (orderIdIndex === -1 || emailIndex === -1) {
      throw new Error('Orders CSV must contain order_id and customer_email columns');
    }

    // Collect order data for batch evaluation
    const orders: Array<{
      order_id: string;
      customer_email: string;
      customer_phone?: string;
      total_amount?: number;
      currency?: string;
      items?: string;
      shipping_address?: string;
    }> = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length > orderIdIndex && row[emailIndex]) {
        const order: {
          order_id: string;
          customer_email: string;
          customer_phone?: string;
          total_amount?: number;
          currency?: string;
          items?: string;
          shipping_address?: string;
        } = {
          order_id: String(row[orderIdIndex]).trim(),
          customer_email: String(row[emailIndex]).trim(),
        };

        if (phoneIndex !== -1 && row[phoneIndex]) {
          order.customer_phone = String(row[phoneIndex]).trim();
        }
        if (totalAmountIndex !== -1 && row[totalAmountIndex]) {
          order.total_amount = parseFloat(String(row[totalAmountIndex]).trim());
        }
        if (currencyIndex !== -1 && row[currencyIndex]) {
          order.currency = String(row[currencyIndex]).trim();
        }
        if (itemsIndex !== -1 && row[itemsIndex]) {
          order.items = String(row[itemsIndex]).trim();
        }
        if (shippingAddressIndex !== -1 && row[shippingAddressIndex]) {
          order.shipping_address = String(row[shippingAddressIndex]).trim();
        }

        orders.push(order);
      }
    }

    // Process orders with batchEvaluateOrders
    if (orders.length > 0) {
      const result = await batchEvaluateOrders({
        client: apiClient,
        body: {
          orders
        }
      });
      if (result.data) {
        setJobId(result.data.job_id || 'completed');
        setJobStatus({ id: result.data.job_id || 'completed', status: 'pending' });
      }
    }
  };

  const processAddressesCSV = async (data: string[][]): Promise<void> => {
    if (data.length < 2) throw new Error('CSV must have header and at least one data row');

    const headers = data[0].map(h => h.toLowerCase().trim());
    const line1Index = headers.findIndex(h => h.includes('line1'));
    const line2Index = headers.findIndex(h => h.includes('line2'));
    const cityIndex = headers.findIndex(h => h.includes('city'));
    const stateIndex = headers.findIndex(h => h.includes('state'));
    const postalCodeIndex = headers.findIndex(h => h.includes('postal_code') || h.includes('postal'));
    const countryIndex = headers.findIndex(h => h.includes('country'));

    if (line1Index === -1 || cityIndex === -1 || countryIndex === -1) {
      throw new Error('Addresses CSV must contain line1, city, and country columns');
    }

    // Collect address data for validation
    const addresses: Array<{
      line1?: string;
      line2?: string;
      city: string;
      state?: string;
      postal_code?: string;
      country: string;
    }> = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length > line1Index && row[cityIndex] && row[countryIndex]) {
        const address = {
          line1: line1Index !== -1 && row[line1Index] ? String(row[line1Index]).trim() : undefined,
          line2: line2Index !== -1 && row[line2Index] ? String(row[line2Index]).trim() : undefined,
          city: String(row[cityIndex]).trim(),
          state: stateIndex !== -1 && row[stateIndex] ? String(row[stateIndex]).trim() : undefined,
          postal_code: postalCodeIndex !== -1 && row[postalCodeIndex] ? String(row[postalCodeIndex]).trim() : undefined,
          country: String(row[countryIndex]).trim(),
        };

        addresses.push(address);
      }
    }

    // Process addresses with batchValidate (type: 'address')
    if (addresses.length > 0) {
      const result = await batchValidate({
        client: apiClient,
        body: {
          type: 'address',
          data: addresses
        }
      });
      if (result.data) {
        setJobId(result.data.job_id || 'completed');
        setJobStatus({ id: result.data.job_id || 'completed', status: 'pending' });
      }
    }
  };

  const processTaxIdsCSV = async (data: string[][]): Promise<void> => {
    if (data.length < 2) throw new Error('CSV must have header and at least one data row');

    const headers = data[0].map(h => h.toLowerCase().trim());
    const taxIdIndex = headers.findIndex(h => h.includes('tax_id') || h.includes('taxid'));
    const taxIdTypeIndex = headers.findIndex(h => h.includes('tax_id_type') || h.includes('type'));
    const nameIndex = headers.findIndex(h => h.includes('name'));
    const countryIndex = headers.findIndex(h => h.includes('country'));

    if (taxIdIndex === -1) {
      throw new Error('Tax IDs CSV must contain a tax_id column');
    }

    // Collect tax ID data for validation
    const taxIds: Array<{
      tax_id: string;
      tax_id_type?: string;
      name?: string;
      country?: string;
    }> = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length > taxIdIndex && row[taxIdIndex]) {
        const taxId: {
          tax_id: string;
          tax_id_type?: string;
          name?: string;
          country?: string;
        } = {
          tax_id: String(row[taxIdIndex]).trim(),
        };

        if (taxIdTypeIndex !== -1 && row[taxIdTypeIndex]) {
          taxId.tax_id_type = String(row[taxIdTypeIndex]).trim();
        }
        if (nameIndex !== -1 && row[nameIndex]) {
          taxId.name = String(row[nameIndex]).trim();
        }
        if (countryIndex !== -1 && row[countryIndex]) {
          taxId.country = String(row[countryIndex]).trim();
        }

        taxIds.push(taxId);
      }
    }

    // Process tax IDs with batchValidate (type: 'tax-id')
    if (taxIds.length > 0) {
      const result = await batchValidate({
        client: apiClient,
        body: {
          type: 'tax-id',
          data: taxIds
        }
      });
      if (result.data) {
        setJobId(result.data.job_id || 'completed');
        setJobStatus({ id: result.data.job_id || 'completed', status: 'pending' });
      }
    }
  };

  const handleFileUpload = async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setJobId(null);
    setJobStatus(null);
  };

  const handleProcessCSV = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const text = await file.text();
      const data = parseCSV(text);

      switch (csvType) {
        case 'customers':
          await processCustomersCSV(data);
          break;
        case 'orders':
          await processOrdersCSV(data);
          break;
        case 'addresses':
          await processAddressesCSV(data);
          break;
        case 'taxids':
          await processTaxIdsCSV(data);
          break;
        default:
          throw new Error('Unknown CSV type');
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
      const blob = new Blob([JSON.stringify(jobStatus.result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${csvType}_results.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (jobStatus.result_url) {
      // If result_url is provided, open it in a new tab/window
      window.open(jobStatus.result_url, '_blank');
    }
  };

  const handleRestart = () => {
    setFile(null);
    setJobId(null);
    setJobStatus(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{UI_STRINGS.BULK_CSV_TOOL}</h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm">
          Upload CSV files to process customer validations or order evaluations in bulk. Select the appropriate CSV type and format your data correctly.
        </p>
        
        {/* Feature Highlights */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4 border border-blue-200 dark:border-blue-700">
            <div className="flex items-center mb-2">
              <span className="text-2xl mr-2">📧</span>
              <h3 className="font-medium text-blue-900 dark:text-blue-100">Email Validation</h3>
            </div>
            <p className="text-blue-800 dark:text-blue-200 text-xs">
              Validate email syntax, deliverability, and identify disposable domains
            </p>
          </div>
          
          <div className="bg-green-50 dark:bg-green-900 rounded-lg p-4 border border-green-200 dark:border-green-700">
            <div className="flex items-center mb-2">
              <span className="text-2xl mr-2">📱</span>
              <h3 className="font-medium text-green-900 dark:text-green-100">Phone Validation</h3>
            </div>
            <p className="text-green-800 dark:text-green-200 text-xs">
              Check phone number format, carrier info, and international standards
            </p>
          </div>
          
          <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-4 border border-purple-200 dark:border-purple-700">
            <div className="flex items-center mb-2">
              <span className="text-2xl mr-2">📍</span>
              <h3 className="font-medium text-purple-900 dark:text-purple-100">Address Validation</h3>
            </div>
            <p className="text-purple-800 dark:text-purple-200 text-xs">
              Verify addresses for deliverability and proper formatting
            </p>
          </div>
          
          <div className="bg-yellow-50 dark:bg-yellow-900 rounded-lg p-4 border border-yellow-200 dark:border-yellow-700">
            <div className="flex items-center mb-2">
              <span className="text-2xl mr-2">🆔</span>
              <h3 className="font-medium text-yellow-900 dark:text-yellow-100">Tax ID Validation</h3>
            </div>
            <p className="text-yellow-800 dark:text-yellow-200 text-xs">
              Validate tax identification numbers and business registrations
            </p>
          </div>
          
          <div className="bg-indigo-50 dark:bg-indigo-900 rounded-lg p-4 border border-indigo-200 dark:border-indigo-700">
            <div className="flex items-center mb-2">
              <span className="text-2xl mr-2">🛒</span>
              <h3 className="font-medium text-indigo-900 dark:text-indigo-100">Order Evaluation</h3>
            </div>
            <p className="text-indigo-800 dark:text-indigo-200 text-xs">
              Batch evaluate orders for risk, rules compliance, and fraud detection
            </p>
          </div>
          
          <div className="bg-orange-50 dark:bg-orange-900 rounded-lg p-4 border border-orange-200 dark:border-orange-700">
            <div className="flex items-center mb-2">
              <span className="text-2xl mr-2">⚡</span>
              <h3 className="font-medium text-orange-900 dark:text-orange-100">Batch Processing</h3>
            </div>
            <p className="text-orange-800 dark:text-orange-200 text-xs">
              Process thousands of records efficiently with async job processing
            </p>
          </div>
        </div>
        
        {/* Use Cases */}
        <div className="mt-6 bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 dark:text-white mb-3">Common Use Cases:</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-2">Customer Validation:</h4>
              <ul className="text-gray-600 dark:text-gray-400 space-y-1">
                <li>• Clean customer databases before marketing campaigns</li>
                <li>• Validate contact info during customer onboarding</li>
                <li>• Ensure data quality in CRM imports</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-2">Order Deduplication:</h4>
              <ul className="text-gray-600 dark:text-gray-400 space-y-1">
                <li>• Merge customers who placed multiple orders</li>
                <li>• Consolidate customer profiles and preferences</li>
                <li>• Clean up order history and customer data</li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      {error && <div id="alert-danger" className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-6">Error: {error}</div>}

      <div className="mb-8">
        <div className="mb-4">
          <label htmlFor="csv-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{UI_STRINGS.SELECT_CSV_TYPE}</label>
          <select
            id="csv-type"
            value={csvType}
            onChange={(e) => setCsvType(e.target.value as 'customers' | 'orders' | 'addresses' | 'taxids')}
            disabled={loading}
            className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="customers">Customers (Email/Phone Validation)</option>
            <option value="orders">Orders (Batch Evaluation)</option>
            <option value="addresses">Addresses (Validation)</option>
            <option value="taxids">Tax IDs (Validation)</option>
          </select>
        </div>
      </div>

      <div className="mb-8">
        {/* CSV Format Visualization */}
        <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {csvFormats[csvType].name} Format
            </h3>
            <button
              onClick={() => downloadExampleCsv(csvType)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
            >
              📥 Download Example
            </button>
          </div>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {csvFormats[csvType].description}
          </p>

          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 overflow-x-auto">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Expected format:
            </div>
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  {csvFormats[csvType].headers.map((header, index) => (
                    <th key={index} className="text-left font-medium text-gray-900 dark:text-white px-3 py-2 border-b border-gray-200 dark:border-gray-600">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvFormats[csvType].sampleData.slice(0, 3).map((row, rowIndex) => (
                  <tr key={rowIndex} className="text-gray-700 dark:text-gray-300">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                        {cell || <span className="text-gray-400 italic">empty</span>}
                      </td>
                    ))}
                  </tr>
                ))}
                {csvFormats[csvType].sampleData.length > 3 && (
                  <tr className="text-gray-500 dark:text-gray-400">
                    <td colSpan={csvFormats[csvType].headers.length} className="px-3 py-2 italic text-center">
                      ... more rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

      {file && !loading && !jobStatus && (
        <div className="mb-8 flex justify-center">
          <button
            onClick={handleProcessCSV}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-lg transition-colors flex items-center gap-2"
          >
            🚀 {UI_STRINGS.PROCESS_CSV}
          </button>
        </div>
      )}

      {jobStatus && (
        <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-6 bg-white dark:bg-gray-800">
          <h3 className="text-base font-semibold mb-4 text-gray-900 dark:text-white">Processing Status</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 dark:text-white mb-2">Job Details</h4>
                <p className="text-gray-700 dark:text-gray-300 text-sm"><strong>ID:</strong> {jobStatus.id}</p>
                <p className="text-gray-700 dark:text-gray-300 text-sm"><strong>Status:</strong>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                    jobStatus.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                    jobStatus.status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                    jobStatus.status === 'running' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                  }`}>
                    {jobStatus.status}
                  </span>
                </p>
                {jobStatus.created_at && (
                  <p className="text-gray-700 dark:text-gray-300 text-sm"><strong>Created:</strong> {new Date(jobStatus.created_at).toLocaleString()}</p>
                )}
              </div>
              
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 dark:text-white mb-2">Process Info</h4>
                <p className="text-gray-700 dark:text-gray-300 text-sm">
                  <strong>Type:</strong> {csvType === 'customers' ? 'Email/Phone Validation' : 'Customer Deduplication'}
                </p>
                <p className="text-gray-700 dark:text-gray-300 text-sm">
                  <strong>Source:</strong> CSV File Upload
                </p>
                {jobStatus.request_id && (
                  <p className="text-gray-700 dark:text-gray-300 text-sm"><strong>Request ID:</strong> {jobStatus.request_id}</p>
                )}
              </div>
            </div>

            {jobStatus.progress !== undefined && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                <div
                  className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                  style={{ width: `${jobStatus.progress}%` }}
                ></div>
                <div className="text-center text-sm mt-1 text-gray-600 dark:text-gray-400">
                  {Math.floor((jobStatus.progress || 0) * 100 / 100)}% Complete
                </div>
              </div>
            )}

            {jobStatus.status === 'completed' && jobStatus.result && (
              <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg p-4">
                <h4 className="font-medium text-green-900 dark:text-green-100 mb-2 flex items-center">
                  ✅ Processing Complete
                </h4>
                <div className="text-sm text-green-800 dark:text-green-200">
                  <p className="mb-2">
                    {csvType === 'customers'
                      ? 'Email/Phone validation completed successfully. Results show validity status, normalized formats, and detailed validation information for each contact.'
                      : 'Customer deduplication completed. Found and merged duplicate customers based on email addresses and other identifying information.'
                    }
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className="bg-white dark:bg-green-800 rounded p-3">
                      <p className="font-medium">What this does:</p>
                      <ul className="text-xs mt-1 space-y-1">
                        {csvType === 'customers' ? (
                          <>
                            <li>• Validates email syntax and deliverability</li>
                            <li>• Checks phone number format and carrier</li>
                            <li>• Normalizes contact information</li>
                            <li>• Identifies disposable/dangerous emails</li>
                          </>
                        ) : (
                          <>
                            <li>• Identifies duplicate customers by email</li>
                            <li>• Merges customer information intelligently</li>
                            <li>• Consolidates contact preferences</li>
                            <li>• Preserves most recent data when conflicts</li>
                          </>
                        )}
                      </ul>
                    </div>
                    <div className="bg-white dark:bg-green-800 rounded p-3">
                      <p className="font-medium">Results include:</p>
                      <ul className="text-xs mt-1 space-y-1">
                        {csvType === 'customers' ? (
                          <>
                            <li>• Valid/Invalid status for each contact</li>
                            <li>• Normalized email addresses</li>
                            <li>• MX record validation results</li>
                            <li>• Detailed reason codes</li>
                          </>
                        ) : (
                          <>
                            <li>• List of duplicate customer groups</li>
                            <li>• Merged customer profiles</li>
                            <li>• Merge confidence scores</li>
                            <li>• Original vs. merged data comparison</li>
                          </>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={downloadResults} className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm">
                    📥 Download Detailed Results (JSON)
                  </button>
                  <button onClick={handleRestart} className="bg-gray-600 hover:bg-gray-700 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm">
                    🔄 Process Another File
                  </button>
                </div>
              </div>
            )}

            {jobStatus.status === 'failed' && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-4">
                <h4 className="font-medium text-red-900 dark:text-red-100 mb-2">❌ Processing Failed</h4>
                <p className="text-red-800 dark:text-red-200 text-sm">
                  The processing job encountered an error. Please check your CSV format and try again.
                </p>
                {jobStatus.error && (
                  <div className="mt-2 p-2 bg-red-100 dark:bg-red-800 rounded text-red-700 dark:text-red-300 text-xs font-mono">
                    Error: {jobStatus.error}
                  </div>
                )}
                <div className="mt-4">
                  <button onClick={handleRestart} className="bg-gray-600 hover:bg-gray-700 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm">
                    🔄 Try Again
                  </button>
                </div>
              </div>
            )}

            {(jobStatus.status === 'pending' || jobStatus.status === 'running') && (
              <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                  Processing in Progress
                </h4>
                <p className="text-blue-800 dark:text-blue-200 text-sm">
                  Your data is being processed. This may take a few moments depending on the file size and system load.
                  The page will automatically update when complete.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default BulkCsvTool;