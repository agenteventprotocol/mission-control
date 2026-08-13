// Fleet filter bar: free-text search, status filter, pending-only toggle,
// and the severity lens (a floor — events below it render dimmed, lanes
// whose max severity is below it can be filtered out).
import { Search, BellRing } from 'lucide-react';
import type { Severity } from '@agenteventprotocol/sdk';
import { SEVERITIES } from '@/lib/aep';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SavedFiltersMenu } from './saved-filters-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeverityDot } from '@/components/event/severity-dot';

export type StatusFilter = 'all' | 'active' | 'ended';
export type FleetSort = 'activity' | 'attention' | 'agent';

export interface FleetFilter {
  query: string;
  status: StatusFilter;
  pendingOnly: boolean;
  /** Severity lens floor; 'debug' = lens off. */
  lens: Severity;
  sort: FleetSort;
  /** Owning relay URL, or 'all'. Only offered past one configured relay. */
  relay: string;
}

export const DEFAULT_FILTER: FleetFilter = {
  query: '',
  status: 'all',
  pendingOnly: false,
  lens: 'debug',
  sort: 'activity',
  relay: 'all',
};

export function FilterBar({
  filter,
  onChange,
  matches,
  total,
  relays = [],
}: {
  filter: FleetFilter;
  onChange: (next: FleetFilter) => void;
  matches: number;
  total: number;
  /** Configured relay choices; the control renders only past one. */
  relays?: Array<{ url: string; label?: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1 sm:max-w-72">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
        <Input
          className="pl-8"
          placeholder="Filter by agent, session, label…"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          aria-label="Filter sessions"
        />
      </div>
      <Select
        value={filter.status}
        onValueChange={(status) => onChange({ ...filter, status: status as StatusFilter })}
      >
        <SelectTrigger aria-label="Status filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sessions</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="ended">Ended</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filter.lens}
        onValueChange={(lens) => onChange({ ...filter, lens: lens as Severity })}
      >
        <SelectTrigger aria-label="Severity lens">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEVERITIES.map((sev) => (
            <SelectItem key={sev} value={sev}>
              <span className="inline-flex items-center gap-1.5">
                <SeverityDot severity={sev} />
                {sev === 'debug' ? 'lens off' : `${sev}+`}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filter.sort}
        onValueChange={(sort) => onChange({ ...filter, sort: sort as FleetSort })}
      >
        <SelectTrigger aria-label="Sort sessions">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="activity">Recent activity</SelectItem>
          <SelectItem value="attention">Needs you first</SelectItem>
          <SelectItem value="agent">Agent name</SelectItem>
        </SelectContent>
      </Select>
      {relays.length > 1 && (
        <Select
          value={filter.relay}
          onValueChange={(relay) => onChange({ ...filter, relay })}
        >
          <SelectTrigger aria-label="Relay filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All relays</SelectItem>
            {relays.map((r) => (
              <SelectItem key={r.url} value={r.url.trim().replace(/\/$/, '')}>
                {r.label ?? r.url.replace(/^[a-z]+:\/\//, '')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        variant={filter.pendingOnly ? 'default' : 'outline'}
        size="sm"
        aria-pressed={filter.pendingOnly}
        onClick={() => onChange({ ...filter, pendingOnly: !filter.pendingOnly })}
      >
        <BellRing aria-hidden />
        Needs attention
      </Button>
      <SavedFiltersMenu filter={filter} onApply={onChange} />
      {matches !== total && (
        <span className="text-xs text-faint">
          {matches} of {total}
        </span>
      )}
    </div>
  );
}
