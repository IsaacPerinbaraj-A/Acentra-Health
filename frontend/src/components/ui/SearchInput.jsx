import { forwardRef, useRef } from 'react';
import { Search, X } from 'lucide-react';
import '../../styles/ui-interactive.css';

/**
 * SearchInput({ value, onChange(string), placeholder = 'Search…', width, className, ...rest })
 * Renders data-search-input so the global "/" shortcut can focus it. Esc clears, then blurs.
 */
export const SearchInput = forwardRef(function SearchInput(
  { value = '', onChange, placeholder = 'Search…', width, className = '', 'aria-label': ariaLabel, ...rest },
  ref
) {
  const innerRef = useRef(null);
  const setRef = (node) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  const clear = () => {
    onChange?.('');
    innerRef.current?.focus();
  };
  return (
    <div className={`ui-search ${className}`.trim()} style={width ? { width } : undefined}>
      <Search size={16} strokeWidth={1.75} className="ui-search__icon" aria-hidden="true" />
      <input
        ref={setRef}
        type="text"
        role="searchbox"
        className="ui-control ui-search__input"
        value={value ?? ''}
        placeholder={placeholder}
        aria-label={ariaLabel || String(placeholder || 'Search').replace(/…$/, '')}
        autoComplete="off"
        spellCheck={false}
        data-search-input=""
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (value) {
              e.stopPropagation();
              onChange?.('');
            } else {
              e.currentTarget.blur();
            }
          }
        }}
        {...rest}
      />
      {value ? (
        <button type="button" className="ui-search__clear" onClick={clear} aria-label="Clear search">
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});

export default SearchInput;
