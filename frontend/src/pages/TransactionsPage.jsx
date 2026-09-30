import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Receipt, Smartphone, User, X } from 'lucide-react';
import {
  CopyButton,
  DataTable,
  DateRange,
  FilterBar,
  MultiSelect,
  PageHeader,
  Pill,
  RiskBadge,
  ScoreBar,
  SearchInput,
  StatusBadge,
  Tooltip,
} from '../components/ui';
import Pagination from '../components/Pagination';
import useApi from '../hooks/useApi';
import useUrlState from '../hooks/useUrlState';
import useDebounce from '../hooks/useDebounce';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { LEVEL_OPTIONS } from '../constants/levels';
import {
  DASH,
  formatDateTime,
  formatINR,
  formatNumber,
  relativeTime,
  toApiDateTime,
} from '../utils/format';
import '../styles/pages/transactions.css';

const DEFAULTS = {
  q: '',
  level: [],
  from: '',
  to: '',
  customer_id: '',
  device_id: '',
  page: 1,
  page_size: 25,
};

const stop = (e) => e.stopPropagation();

function FilterPill({ icon, label, value, onRemove }) {
  return (
    <Pill tone="brand" icon={icon}>
      <span className="tx-pill">
        <span className="tx-pill__label">{label}</span>
        <span className="mono nowrap">{value}</span>
        <button
          type="button"
          className="tx-pill__remove"
          aria-label={`Remove ${label.toLowerCase()} filter`}
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </span>
    </Pill>
  );
}

export function buildTransactionColumns({ onDeviceClick, showCustomer = true } = {}) {
  const cols = [
    {
      key: 'risk_level',
      header: 'Risk',
      width: 104,
      render: (row) => <RiskBadge level={row.risk_level} size="sm" />,
    },
    {
      key: 'risk_score',
      header: 'Score',
      width: 128,
      render: (row) => <ScoreBar score={row.risk_score} level={row.risk_level} />,
    },
    {
      key: 'transaction_id',
      header: 'Transaction',
      nowrap: true,
      render: (row) => (
        <span className="tx-id" onClick={stop}>
          <span className="mono nowrap">{row.transaction_id}</span>
          <CopyButton value={row.transaction_id} label="Copy transaction id" />
        </span>
      ),
    },
  ];
  if (showCustomer) {
    cols.push({
      key: 'customer_id',
      header: 'Customer',
      nowrap: true,
      render: (row) => (
        <Link className="tx-link mono nowrap" to={`/customers/${encodeURIComponent(row.customer_id)}`} onClick={stop}>
          {row.customer_id}
        </Link>
      ),
    });
  }
  cols.push(
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      nowrap: true,
      render: (row) => <span className="tabular-nums tx-amount">{formatINR(row.amount, row.currency)}</span>,
    },
    {
      key: 'merchant',
      header: 'Merchant · City',
      render: (row) => (
        <span className="tx-merchant">
          <span className="tx-merchant__name">{row.merchant || DASH}</span>
          {row.city ? <span className="tx-merchant__city"> · {row.city}</span> : null}
        </span>
      ),
    },
    {
      key: 'device_id',
      header: 'Device',
      nowrap: true,
      render: (row) =>
        row.device_id ? (
          onDeviceClick ? (
            <button
              type="button"
              className="tx-device mono nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onDeviceClick(row.device_id);
              }}
              title="Filter by this device"
            >
              {row.device_id}
            </button>
          ) : (
            <Link
              className="tx-device mono nowrap"
              to={`/transactions?device_id=${encodeURIComponent(row.device_id)}`}
              onClick={stop}
            >
              {row.device_id}
            </Link>
          )
        ) : (
          <span className="tx-muted">{DASH}</span>
        ),
    },
    {
      key: 'timestamp',
      header: 'Time',
      nowrap: true,
      render: (row) => (
        <Tooltip content={formatDateTime(row.timestamp)}>
          <span className="tx-time nowrap">{relativeTime(row.timestamp)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'flag',
      header: 'Flag',
      nowrap: true,
      align: 'right',
      render: (row) =>
        row.flag_id ? (
          <span className="tx-flag" onClick={stop}>
            {row.flag_status ? <StatusBadge status={row.flag_status} size="sm" /> : null}
            <Link className="tx-flag__link nowrap" to={`/flags/${row.flag_id}`}>
              Flag <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </span>
        ) : (
          <span className="tx-muted">{DASH}</span>
        ),
    }
  );
  return cols;
}

export default function TransactionsPage() {
  useDocumentTitle('Transactions');
  const [filters, setFilters] = useUrlState(DEFAULTS);

  const [search, setSearch] = useState(filters.q);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (debouncedSearch !== filters.q) setFilters({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useMemo(
    () => ({
      q: filters.q || undefined,
      level: filters.level,
      customer_id: filters.customer_id || undefined,
      device_id: filters.device_id || undefined,
      from: toApiDateTime(filters.from),
      to: toApiDateTime(filters.to, true),
      page: filters.page,
      page_size: filters.page_size,
    }),
    [filters]
  );

  const { data, error, loading, reload } = useApi('/api/transactions', { query });

  const rows = data?.items || [];
  const total = data?.total ?? 0;

  const hasActive = Boolean(
    filters.q || filters.level.length || filters.from || filters.to || filters.customer_id || filters.device_id
  );

  const clearAll = () => {
    setSearch('');
    setFilters.reset();
  };

  const columns = useMemo(
    () => buildTransactionColumns({ onDeviceClick: (device_id) => setFilters({ device_id }) }),
    [setFilters]
  );

  return (
    <div className="page tx-page">
      <PageHeader
        title="Transactions"
        description="Every evaluated payment and its risk score"
        actions={
          <span className="tx-total tabular-nums">
            {data ? `${formatNumber(total)} ${total === 1 ? 'transaction' : 'transactions'}` : ' '}
          </span>
        }
      />

      <FilterBar hasActive={hasActive} onClear={clearAll}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search transaction or customer id…" />
        <MultiSelect
          label="Level"
          options={LEVEL_OPTIONS}
          value={filters.level}
          onChange={(level) => setFilters({ level })}
        />
        <DateRange from={filters.from} to={filters.to} onChange={({ from, to }) => setFilters({ from: from || '', to: to || '' })} />
        {filters.customer_id ? (
          <FilterPill
            icon={User}
            label="Customer"
            value={filters.customer_id}
            onRemove={() => setFilters({ customer_id: '' })}
          />
        ) : null}
        {filters.device_id ? (
          <FilterPill
            icon={Smartphone}
            label="Device"
            value={filters.device_id}
            onRemove={() => setFilters({ device_id: '' })}
          />
        ) : null}
      </FilterBar>

      <div className="tx-table">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="transaction_id"
          getRowLevel={(row) => (row.flag_id ? row.risk_level : null)}
          loading={loading && !data}
          error={error}
          onRetry={() => reload()}
          empty={
            hasActive
              ? {
                  icon: Receipt,
                  title: 'No matching transactions',
                  description: 'Try a different search, level or date range.',
                }
              : {
                  icon: Receipt,
                  title: 'No transactions yet',
                  description: 'Evaluated payments will appear here once data is ingested.',
                  action: (
                    <Link className="tx-link" to="/data">
                      Load demo data
                    </Link>
                  ),
                }
          }
        />
      </div>

      {data && total > 0 ? (
        <Pagination
          page={filters.page}
          pageSize={filters.page_size}
          total={total}
          onPageChange={(page) => setFilters({ page }, { keepPage: true })}
        />
      ) : null}
    </div>
  );
}
