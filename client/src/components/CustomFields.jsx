import { useState } from 'react';
import { api } from '../api.js';
import { formatDate } from '../dates.js';

export const FIELD_TYPES = [
  { id: 'text', label: 'Text' }, { id: 'number', label: 'Number' }, { id: 'date', label: 'Date' },
  { id: 'select', label: 'Dropdown' }, { id: 'checkbox', label: 'Checkbox' },
];

// How a value reads on card faces and in the List view.
export function fieldText(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'checkbox') return value === '1' ? `✓ ${field.name}` : '';
  if (field.type === 'date') return formatDate(value, { withTime: false });
  return value;
}

// Sort key for the List view: numbers as numbers, everything else as text, blanks last.
export function fieldSortKey(field, value) {
  if (value === undefined || value === '') return field.type === 'number' ? Infinity : '~';
  return field.type === 'number' ? Number(value) : String(value).toLowerCase();
}

function FieldInput({ field, value, onSave, readOnly }) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = (v) => { if ((v ?? '') !== (value ?? '')) onSave(v); };
  if (field.type === 'checkbox') {
    return <input type="checkbox" checked={value === '1'} disabled={readOnly} onChange={(e) => onSave(e.target.checked)} />;
  }
  if (field.type === 'select') {
    return (
      <select value={value ?? ''} disabled={readOnly} onChange={(e) => onSave(e.target.value)}>
        <option value="">—</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  return (
    <input type={type} value={draft} readOnly={readOnly} placeholder={readOnly ? '' : 'Add…'}
      onChange={(e) => { setDraft(e.target.value); if (type === 'date') commit(e.target.value); }}
      onBlur={() => type !== 'date' && commit(draft)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
  );
}

function NewField({ boardId, onDone }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const add = async () => {
    if (!name.trim()) return;
    await api.post(`/boards/${boardId}/fields`, { name, type, options: options.split(',').map((o) => o.trim()).filter(Boolean) });
    onDone();
  };
  return (
    <div className="field-new">
      <input autoFocus placeholder="Field name, e.g. Cost" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <select value={type} onChange={(e) => setType(e.target.value)}>{FIELD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
      {type === 'select' && <input placeholder="Options, comma separated" value={options} onChange={(e) => setOptions(e.target.value)} />}
      <button className="btn primary" onClick={add}>Add field</button>
      <button className="btn subtle" onClick={() => onDone(true)}>Cancel</button>
    </div>
  );
}

// "Fields" section of the card modal: every board field with its value on this card.
export function CardFields({ card, fields, run, readOnly }) {
  const [adding, setAdding] = useState(false);
  if (!fields.length && readOnly) return null;
  const save = (f) => (v) => run(() => api.put(`/cards/${card.id}/fields/${f.id}`, { value: v }));
  const removeField = (f) => confirm(`Remove the field "${f.name}" from every card on this board?`) && run(() => api.del(`/fields/${f.id}`));
  const toggleShow = (f) => run(() => api.patch(`/fields/${f.id}`, { show_on_card: !f.show_on_card }));
  return (
    <section className="section custom-fields">
      <div className="section-head">
        <h4>▦ Fields</h4>
        {!readOnly && !adding && <button className="btn" onClick={() => setAdding(true)}>+ Field</button>}
      </div>
      {fields.length > 0 && (
        <div className="field-grid">
          {fields.map((f) => (
            <label key={f.id} className="field-row">
              <span className="field-name">
                {f.name}
                {!readOnly && (
                  <span className="field-tools">
                    <button type="button" className="icon-btn" title={f.show_on_card ? 'Shown on card front (click to hide)' : 'Hidden on card front (click to show)'} onClick={(e) => { e.preventDefault(); toggleShow(f); }}>{f.show_on_card ? '👁' : '⊘'}</button>
                    <button type="button" className="icon-btn" title="Remove field" onClick={(e) => { e.preventDefault(); removeField(f); }}>✕</button>
                  </span>
                )}
              </span>
              <FieldInput key={`${f.id}:${card.field_values[f.id] ?? ''}`} field={f} value={card.field_values[f.id]} onSave={save(f)} readOnly={readOnly} />
            </label>
          ))}
        </div>
      )}
      {adding && <NewField boardId={card.board_id} onDone={(cancelled) => { setAdding(false); if (!cancelled) run(async () => {}); }} />}
    </section>
  );
}
