import { X } from 'lucide-react';
import * as ButtonMod from './Button.jsx';
import '../../styles/ui-interactive.css';

const Button = ButtonMod.Button || ButtonMod.default;

/** FilterBar({ children, hasActive, onClear, className }) — row of filter controls. */
export function FilterBar({ children, hasActive = false, onClear, className = '', ...rest }) {
  return (
    <div className={`ui-filterbar ${className}`.trim()} role="group" aria-label="Filters" {...rest}>
      {children}
      {hasActive && onClear && (
        <Button variant="ghost" size="sm" icon={X} onClick={onClear} className="ui-filterbar__clear">
          Clear filters
        </Button>
      )}
    </div>
  );
}

export default FilterBar;
