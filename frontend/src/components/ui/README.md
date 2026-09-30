# RiskLens UI kit — props contract

Import everything from `src/components/ui` (barrel `index.js`). Each component lives in `src/components/ui/<Name>.jsx` and is a **named export** with the same name. Styles use only CSS variables from `src/styles/tokens.css`.

## Display (owner: ui-display)
| Component | Props |
|---|---|
| `Button` | `variant='secondary'` (`primary`\|`secondary`\|`ghost`\|`danger`\|`success`), `size='md'` (`sm`\|`md`), `icon` (lucide component, leading), `loading`, `disabled`, `fullWidth`, `type='button'`, `onClick`, `children`, `className`, `...rest` |
| `IconButton` | `icon` (lucide component), `label` (aria-label + tooltip), `onClick`, `size='md'`, `variant='ghost'`, `disabled`, `active` |
| `Card` | `title`, `subtitle`, `actions` (node, right side of header), `icon`, `children`, `className`, `padded=true`, `...rest` |
| `StatCard` | `label`, `value`, `sub`, `icon`, `color` (CSS color, e.g. `var(--level-critical)`), `to` (router link) or `onClick`, `loading` |
| `RiskBadge` | `level` (`LOW`\|`MEDIUM`\|`HIGH`\|`CRITICAL`), `size='md'` |
| `StatusBadge` | `status` (`PENDING_REVIEW`\|`REVIEWED`\|`CLEARED`\|`CONFIRMED_FRAUD`), `size='md'` |
| `RuleChip` | `name` (rule id), `label` (display name; defaults to prettified id), `points` (optional number) |
| `ScoreGauge` | `score`, `level`, `size=96` |
| `ScoreBar` | `score`, `level` |
| `ScoreBreakdown` | `results` (fired results `[{rule_name, display_name, score, reason}]`), `score`, `rawScore` |
| `Tooltip` | `content` (node), `children`, `placement='top'` |
| `Skeleton` | `width`, `height=16`, `radius`, `className`; also `SkeletonText({lines=3})`, `SkeletonRows({rows=5, columns=5})` |
| `EmptyState` | `icon`, `title`, `description`, `action` (node), `tone='neutral'` (`neutral`\|`success`\|`brand`) |
| `ErrorState` | `error` (Error or string), `onRetry`, `title='Something went wrong'` |
| `CopyButton` | `value`, `label='Copy'` |
| `PageHeader` | `title`, `description`, `actions` (node), `children` (extra row) |
| `Avatar` | `name`, `size=32` |
| `Pill` | `tone='neutral'` (`neutral`\|`brand`\|`success`\|`warning`\|`error`\|`info`), `icon`, `children`, `size='sm'` |
| `Spinner` | `size=16` |
| `Banner` | `tone='brand'` (`brand`\|`info`\|`warning`\|`error`\|`success`), `icon`, `children`, `action` (node), `onDismiss` |
| `KeyValueList` | `items=[{label, value, mono}]`, `columns=2` |
| `Kbd` | `children` |
| `ChartTooltip` | recharts `content` renderer: `<Tooltip content={<ChartTooltip formatter={(v)=>...} labelFormatter={(l)=>...} />} />` |

## Forms, tables, overlays (owner: ui-interactive)
| Component | Props |
|---|---|
| `DataTable` | `columns=[{key, header, render?(row), align?('left'\|'right'\|'center'), width?, mono?, sortable?, nowrap?}]`, `rows`, `rowKey` (string field or fn), `onRowClick(row)`, `getRowLevel(row)` → level or null (3 px left border + CRITICAL tint), `loading`, `error`, `onRetry`, `empty={icon, title, description, action}`, `sort={key, dir}`, `onSortChange({key, dir})`, `renderExpanded(row)` (expandable rows), `compact` |
| `FilterBar` | `children`, `hasActive`, `onClear` ("Clear filters" ghost button only when `hasActive`) |
| `SearchInput` | `value`, `onChange(string)`, `placeholder='Search…'` (renders `data-search-input` for the `/` shortcut) |
| `MultiSelect` | `label`, `options=[{value, label}]`, `value=[]`, `onChange(string[])` |
| `Select` | `label`, `options=[{value, label}]`, `value`, `onChange(value)`, `placeholder` |
| `DateRange` | `from`, `to` (`YYYY-MM-DD` strings), `onChange({from, to})` |
| `Tabs` | `tabs=[{key, label, count?}]`, `value`, `onChange(key)` |
| `SegmentedControl` | `options=[{value, label}]`, `value`, `onChange(value)` |
| `ToastProvider` / `useToast()` | `const toast = useToast(); toast({variant: 'success'\|'error'\|'info', title, message, action: {label, onClick}, duration=4000})` |
| `Modal` | `open`, `onClose`, `title`, `children`, `footer` (node), `size='md'` (`sm`\|`md`\|`lg`) — focus trap, Esc, backdrop click |
| `ConfirmModal` | `open`, `onClose`, `onConfirm`, `title`, `message`, `confirmLabel='Confirm'`, `variant='danger'`, `requireText` (e.g. `"RESET"`), `loading` |
| `Switch` | `checked`, `onChange(bool)`, `label`, `disabled` |
| `Input` | `label`, `hint`, `error`, + native input props |
| `Textarea` | `label`, `hint`, `error`, + native textarea props |
| `NumberInput` | `value`, `onChange(number)`, `min`, `max`, `step=1`, `disabled`, `label` |
| `Slider` | `value`, `onChange(number)`, `min=0`, `max=100`, `step=1`, `disabled` |

`src/components/Pagination.jsx` (default export, owner: ui-interactive): `page`, `pageSize`, `total`, `onPageChange(page)`.

## Hooks, utils, auth (already in `src/hooks`, owners noted)
- `useApi(path|null, {query, deps, keepPrevious=true})` → `{data, error, loading, refreshing, reload, setData}` — read `src/hooks/useApi.js`.
- `useUrlState`, `useDebounce(value, 300)`, `usePolling(fn, ms, {enabled})`, `useHotkeys`, `useLocalStorage`, `useDocumentTitle(title)` — read the files.
- `src/api/client.js`: `apiFetch(path, {method, body, formData, query})` — throws Error with `.status`, `.detail`.
- `src/auth/AuthContext.jsx` (owner: shell-auth): `useAuth()` → `{user: {id, username, role}, login(u, p), logout(), hasRole(...roles), loading}`; `AuthProvider`.
- `src/auth/RequireAuth.jsx` (owner: shell-auth): `<RequireAuth roles={['ADMIN']}>…</RequireAuth>`.
- `src/utils/format.js` (owner: shell-auth): `formatINR(amount, currency='INR')`, `formatNumber(n)`, `formatDateTime(iso)`, `formatDate(iso)`, `formatTime(iso)`, `relativeTime(iso)`, `formatDuration(minutes)`, `formatPercent(ratio, digits=0)`, `initials(name)`.
- `src/utils/chartTheme.js` (owner: shell-auth): `useChartTheme()` → `{level(l), status(s), rule(name), grid, axis, text, text2, surface, border, brand}` — resolved CSS color strings that update on theme change.
- `src/constants/levels.js`, `statuses.js`, `ruleMeta.js` (`getRuleMeta(name)` → `{color, icon, label}`) — read the files.
- `src/theme/ThemeContext.jsx`: `useTheme()` → `{theme, toggleTheme}`.
