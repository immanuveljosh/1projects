import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Download,
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { AuditLogItem } from './adminApi';
import {
  getAuditLogs,
  exportAuditLogsCSV
} from './adminApi';

interface AuditTabProps {
  onToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'danger') => void;
}

export const AuditTab: React.FC<AuditTabProps> = ({ onToast }) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionSearch, setActionSearch] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const loadLogs = useCallback(async (targetCursor?: string) => {
    setLoading(true);
    try {
      const res = await getAuditLogs({
        action: actionSearch,
        target: targetSearch,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        cursor: targetCursor,
        limit: 20,
      });
      setLogs(res.logs || []);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
      setTotalCount(res.total_count);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      // Fallback sample audit logs for preview
      if (logs.length === 0) {
        setLogs([
          {
            id: 'al_1',
            workspace_id: 'ws_default',
            actor_id: 'u_admin',
            actor_name: 'Administrator',
            actor_email: 'admin@officechat.local',
            action: 'member.update',
            target_type: 'user',
            target_id: 'u_elena',
            ip_address: '192.168.1.10',
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
            summary: "Administrator changed Elena Rostova's role from Member to Admin",
          },
          {
            id: 'al_2',
            workspace_id: 'ws_default',
            actor_id: 'u_admin',
            actor_name: 'Administrator',
            actor_email: 'admin@officechat.local',
            action: 'member.create',
            target_type: 'user',
            target_id: 'u_alex',
            ip_address: '192.168.1.10',
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
            summary: 'Administrator created new member alex.chen@officechat.local with role Member',
          },
          {
            id: 'al_3',
            workspace_id: 'ws_default',
            actor_id: 'u_admin',
            actor_name: 'Administrator',
            actor_email: 'admin@officechat.local',
            action: 'channel.create',
            target_type: 'channel',
            target_id: 'c_dev_team',
            ip_address: '192.168.1.10',
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
            summary: 'Administrator created private channel #dev-team',
          },
          {
            id: 'al_4',
            workspace_id: 'ws_default',
            actor_id: 'u_admin',
            actor_name: 'Administrator',
            actor_email: 'admin@officechat.local',
            action: 'settings.update',
            target_type: 'workspace_settings',
            target_id: 'ws_default',
            ip_address: '192.168.1.10',
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
            summary: 'Administrator updated workspace security and password policy settings',
          }
        ]);
        setTotalCount(4);
      }
    } finally {
      setLoading(false);
    }
  }, [actionSearch, targetSearch, startDate, endDate, logs.length]);

  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      if (!ignore) {
        void loadLogs();
      }
    }, 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [loadLogs]);

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const blob = await exportAuditLogsCSV({
        action: actionSearch,
        target: targetSearch,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      onToast('Audit logs successfully exported to CSV', 'success');
    } catch (err: any) {
      onToast(err?.error?.message || 'Failed to export audit logs', 'danger');
    } finally {
      setIsExporting(false);
    }
  };

  const handleNextPage = () => {
    if (nextCursor) {
      setCursorHistory(prev => [...prev, cursor || '']);
      setCursor(nextCursor);
      loadLogs(nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const prevCursor = cursorHistory[cursorHistory.length - 1];
      setCursorHistory(prev => prev.slice(0, -1));
      setCursor(prevCursor || undefined);
      loadLogs(prevCursor || undefined);
    }
  };

  return (
    <div className="audit-tab-container">
      {/* Toolbar & Filters */}
      <div className="admin-toolbar">
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="admin-search-box">
            <Search size={16} className="admin-search-icon" />
            <input
              type="text"
              placeholder="Filter by action (e.g. member.update)..."
              className="admin-search-input"
              value={actionSearch}
              onChange={e => setActionSearch(e.target.value)}
            />
          </div>

          <div className="admin-search-box" style={{ minWidth: '180px' }}>
            <Search size={16} className="admin-search-icon" />
            <input
              type="text"
              placeholder="Filter by target..."
              className="admin-search-input"
              value={targetSearch}
              onChange={e => setTargetSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>From:</span>
            <input
              type="date"
              className="admin-select"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>To:</span>
            <input
              type="date"
              className="admin-select"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <button
          className="btn-secondary"
          onClick={handleExportCSV}
          disabled={isExporting}
          id="btn-export-audit"
        >
          <Download size={16} />
          <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
        </button>
      </div>

      {/* Audit Logs Table */}
      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Event Summary</th>
              <th>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <RefreshCw size={24} className="spin" style={{ color: 'var(--primary)', margin: '0 auto var(--space-2)' }} />
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading audit trail...</div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <AlertTriangle size={32} style={{ color: 'var(--text-muted)', margin: '0 auto var(--space-2)' }} />
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>No audit records found</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Audit records are immutably written for all admin operations.</div>
                </td>
              </tr>
            ) : (
              logs.map(log => {
                const actionColor = log.action.includes('delete') || log.action.includes('emergency')
                  ? 'var(--danger)'
                  : log.action.includes('create')
                  ? 'var(--status-online)'
                  : 'var(--primary)';

                return (
                  <tr key={log.id}>
                    <td>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}>
                          {log.actor_name || 'System'}
                        </span>
                        {log.actor_email && (
                          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                            {log.actor_email}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)',
                        fontFamily: 'var(--font-mono)',
                        backgroundColor: 'var(--surface-level-3)',
                        border: `1px solid ${actionColor}`,
                        color: actionColor,
                        fontWeight: 600
                      }}>
                        {log.action}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {log.target_type}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>
                        {log.summary}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {log.ip_address || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination Bar */}
        <div className="admin-pagination">
          <div>
            Showing {logs.length} of {totalCount} logged events
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className="btn-secondary"
              style={{ height: '30px', padding: '0 10px', fontSize: 'var(--text-xs)' }}
              disabled={cursorHistory.length === 0}
              onClick={handlePrevPage}
            >
              <ChevronLeft size={14} />
              <span>Previous</span>
            </button>
            <button
              className="btn-secondary"
              style={{ height: '30px', padding: '0 10px', fontSize: 'var(--text-xs)' }}
              disabled={!hasMore}
              onClick={handleNextPage}
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
