import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp, Loader2, Search, SlidersHorizontal } from 'lucide-react';
import type { ChatHistoryFilter } from '@/shared/types';

type FilterUpdate = {
  [K in keyof ChatHistoryFilter]?: ChatHistoryFilter[K] | undefined;
};

type SortBy = NonNullable<ChatHistoryFilter['sortBy']>;
type SortOrder = NonNullable<ChatHistoryFilter['sortOrder']>;

const isSortBy = (value: string): value is SortBy => (
  value === 'createdAt' ||
  value === 'updatedAt' ||
  value === 'messageCount' ||
  value === 'title'
);

interface SearchAndFilterProps {
  filter: ChatHistoryFilter;
  onFilterChange: (filter: FilterUpdate) => void;
  availableTags: string[];
  onClearFilters: () => void;
  isLoading: boolean;
}

export const SearchAndFilter: React.FC<SearchAndFilterProps> = ({
  filter,
  onFilterChange,
  availableTags,
  onClearFilters,
  isLoading,
}) => {
  const [searchQuery, setSearchQuery] = useState(filter.query || '');
  const [showFilters, setShowFilters] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: filter.dateRange?.start ? new Date(filter.dateRange.start).toISOString().split('T')[0] : '',
    end: filter.dateRange?.end ? new Date(filter.dateRange.end).toISOString().split('T')[0] : '',
  });

  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const filtersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      onFilterChange({ query: searchQuery || undefined });
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, onFilterChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setShowFilters(false);
        setShowDatePicker(false);
      }
    };

    if (showFilters || showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }

    return undefined;
  }, [showFilters, showDatePicker]);

  const handleProviderChange = useCallback((provider: string) => {
    onFilterChange({ provider: provider || undefined });
  }, [onFilterChange]);

  const handleModelChange = useCallback((model: string) => {
    onFilterChange({ model: model || undefined });
  }, [onFilterChange]);

  const handleTagToggle = useCallback((tag: string) => {
    const currentTags = filter.tags || [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];

    onFilterChange({ tags: newTags.length > 0 ? newTags : undefined });
  }, [filter.tags, onFilterChange]);

  const handleSortChange = useCallback((sortBy: SortBy, sortOrder: SortOrder) => {
    onFilterChange({
      sortBy,
      sortOrder,
    });
  }, [onFilterChange]);

  const handleDateRangeChange = useCallback(() => {
    if (dateRange.start && dateRange.end) {
      const start = new Date(dateRange.start).getTime();
      const end = new Date(dateRange.end).getTime() + (24 * 60 * 60 * 1000 - 1);

      onFilterChange({
        dateRange: { start, end },
      });
    } else {
      onFilterChange({ dateRange: undefined });
    }
    setShowDatePicker(false);
  }, [dateRange, onFilterChange]);

  const handlePinnedToggle = useCallback(() => {
    const newValue = filter.isPinned === true ? undefined : true;
    onFilterChange({ isPinned: newValue });
  }, [filter.isPinned, onFilterChange]);

  const hasActiveFilters = Boolean(
    filter.query ||
    filter.provider ||
    filter.model ||
    filter.tags?.length ||
    filter.dateRange ||
    filter.isPinned !== undefined
  );

  const getActiveFilterCount = (): number => {
    let count = 0;
    if (filter.query) count++;
    if (filter.provider) count++;
    if (filter.model) count++;
    if (filter.tags?.length) count += filter.tags.length;
    if (filter.dateRange) count++;
    if (filter.isPinned !== undefined) count++;
    return count;
  };

  return (
    <div className="search-and-filter">
      <div className="search-input-container">
        <div className="search-input-wrapper">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="search-input"
            disabled={isLoading}
          />
          <div className="search-input-icon">
            {isLoading ? (
              <Loader2 size={16} className="spin-icon" aria-label="Searching" />
            ) : (
              <Search size={16} />
            )}
          </div>
        </div>

        <button
          className={`filter-toggle-btn ${showFilters ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          title="Toggle filters"
          aria-label="Toggle filters"
        >
          <SlidersHorizontal size={16} />
          {hasActiveFilters && (
            <span className="filter-badge">{getActiveFilterCount()}</span>
          )}
        </button>
      </div>

      {showFilters && (
        <div ref={filtersRef} className="filter-panel">
          <div className="filter-group">
            <label className="filter-label">Provider</label>
            <select
              value={filter.provider || ''}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="filter-select"
            >
              <option value="">All Providers</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama</option>
              <option value="lmstudio">LM Studio</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Model</label>
            <input
              type="text"
              value={filter.model || ''}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder="Filter by model..."
              className="filter-input"
            />
          </div>

          <div className="filter-group">
            <label className="filter-label">Sort By</label>
            <div className="sort-controls">
              <select
                value={filter.sortBy || 'updatedAt'}
                onChange={(e) => {
                  const nextSortBy = e.target.value;
                  if (isSortBy(nextSortBy)) {
                    handleSortChange(nextSortBy, filter.sortOrder || 'desc');
                  }
                }}
                className="sort-select filter-select"
              >
                <option value="updatedAt">Last Updated</option>
                <option value="createdAt">Created Date</option>
                <option value="messageCount">Message Count</option>
                <option value="title">Title</option>
              </select>
              <button
                className={`sort-order-btn ${filter.sortOrder === 'asc' ? 'asc' : 'desc'}`}
                onClick={() => handleSortChange(
                  filter.sortBy || 'updatedAt',
                  filter.sortOrder === 'asc' ? 'desc' : 'asc'
                )}
                title={`Sort ${filter.sortOrder === 'asc' ? 'descending' : 'ascending'}`}
              >
                {filter.sortOrder === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
              </button>
            </div>
          </div>

          <div className="filter-group">
            <label className="filter-label">Date Range</label>
            <button
              className={`date-range-btn ${filter.dateRange ? 'active' : ''}`}
              onClick={() => setShowDatePicker(!showDatePicker)}
            >
              {filter.dateRange
                ? `${new Date(filter.dateRange.start).toLocaleDateString()} - ${new Date(filter.dateRange.end).toLocaleDateString()}`
                : 'Select date range'
              }
            </button>

            {showDatePicker && (
              <div className="date-picker">
                <div className="date-inputs">
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                    className="date-input"
                  />
                  <span className="date-separator">to</span>
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                    className="date-input"
                  />
                </div>
                <div className="date-actions">
                  <button className="btn btn-sm btn-primary" onClick={handleDateRangeChange}>
                    Apply
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setDateRange({ start: '', end: '' });
                      onFilterChange({ dateRange: undefined });
                      setShowDatePicker(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="filter-group">
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={filter.isPinned === true}
                onChange={handlePinnedToggle}
              />
              <span className="checkbox-label">Show only pinned</span>
            </label>
          </div>

          {availableTags.length > 0 && (
            <div className="filter-group">
              <label className="filter-label">Tags</label>
              <div className="tag-filters">
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    className={`tag-filter ${filter.tags?.includes(tag) ? 'active' : ''}`}
                    onClick={() => handleTagToggle(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasActiveFilters && (
            <div className="filter-actions">
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  onClearFilters();
                  setSearchQuery('');
                  setDateRange({ start: '', end: '' });
                }}
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
