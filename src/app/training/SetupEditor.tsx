import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { setupInputSchema } from '../../domain/training.ts';
import { loadSemanticsSchema } from '../../domain/primitives.ts';
import { normalizeManualDecimal } from '../../domain/numbers.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
export function SetupEditor({ initial, onApply, onClose }: { initial: z.infer<typeof setupInputSchema>; onApply: (input: z.infer<typeof setupInputSchema>) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation(), [value, setValue] = useState(initial), [load, setLoad] = useState(''), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  function change<K extends keyof typeof value>(key: K, next: typeof value[K]) { setValue(current => ({ ...current, [key]: next })); }
  async function apply() {
    setBusy(true); setError(false);
    try {
      const parsed = setupInputSchema.parse(value), origin = initial.defaultsOrigin;
      if (origin) {
        const changed = (['loadSemantics', 'loadUnit', 'includesBar', 'barWeightDecimal', 'barUnit', 'equipmentInstance', 'incrementDecimal', 'incrementUnit', 'availableLoads'] as const).filter(key => JSON.stringify(parsed[key]) !== JSON.stringify(initial[key]));
        parsed.defaultsOrigin = { ...origin, defaultedFields: origin.defaultedFields.filter(key => !changed.includes(key)), overriddenFields: [...new Set([...origin.overriddenFields, ...changed])] };
      }
      await onApply(parsed); onClose();
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <ConfirmDialog title={t('training:configuration')} onCancel={onClose}>
    <fieldset disabled={busy}>
      <label>{t('training:unit')}<select aria-label={t('training:unit')} value={value.loadUnit} onChange={event => change('loadUnit', event.target.value as 'kg' | 'lb')}><option>kg</option><option>lb</option></select></label>
      <label>{t('training:instance')}<input maxLength={120} value={value.equipmentInstance ?? ''} onChange={event => change('equipmentInstance', event.target.value || null)}/></label>
      <details><summary>{t('training:configurationOptions')}</summary>
        <label>{t('training:semantics')}<select aria-label={t('training:semantics')} value={value.loadSemantics} onChange={event => setValue(current => ({ ...current, loadSemantics: loadSemanticsSchema.parse(event.target.value), includesBar: null, barWeightDecimal: null, barUnit: null, ...(event.target.value === 'bodyweight_only' ? { incrementDecimal: null, incrementUnit: null, availableLoads: null } : {}) }))}>{loadSemanticsSchema.options.map(item => <option key={item} value={item}>{t('training:short_' + item)}</option>)}</select></label>
        {value.loadSemantics === 'external_total' && <>
          <label>{t('training:barIncluded')}<select value={value.includesBar === null ? '' : value.includesBar ? 'yes' : 'no'} onChange={event => change('includesBar', event.target.value === '' ? null : event.target.value === 'yes')}><option value="">{t('training:unknown')}</option><option value="yes">{t('training:yes')}</option><option value="no">{t('training:no')}</option></select></label>
          <label>{t('training:barWeight')}<div className="joined-input"><input inputMode="decimal" value={value.barWeightDecimal ?? ''} onChange={event => setValue(current => ({ ...current, barWeightDecimal: event.target.value || null, barUnit: event.target.value ? current.barUnit ?? current.loadUnit : null }))}/><select aria-label={t('training:barWeight') + ' ' + t('training:unit')} value={value.barUnit ?? value.loadUnit} onChange={event => change('barUnit', event.target.value as 'kg' | 'lb')}><option>kg</option><option>lb</option></select></div></label>
        </>}
        {value.loadSemantics !== 'bodyweight_only' && <>
          <label>{t('training:increment')}<div className="joined-input"><input inputMode="decimal" value={value.incrementDecimal ?? ''} onChange={event => setValue(current => ({ ...current, incrementDecimal: event.target.value || null, incrementUnit: event.target.value ? current.incrementUnit ?? current.loadUnit : null }))}/><select aria-label={t('training:increment') + ' ' + t('training:unit')} value={value.incrementUnit ?? value.loadUnit} onChange={event => change('incrementUnit', event.target.value as 'kg' | 'lb')}><option>kg</option><option>lb</option></select></div></label>
          <label>{t('training:available')}<select value={value.availableLoads?.unit ?? value.loadUnit} onChange={event => change('availableLoads', value.availableLoads ? { ...value.availableLoads, unit: event.target.value as 'kg' | 'lb' } : null)}><option>kg</option><option>lb</option></select></label>
          <div className="load-chips">{value.availableLoads?.values.map((item, index) => <button className="secondary numeric" key={index} onClick={() => { const values = value.availableLoads!.values.filter((_, i) => i !== index); change('availableLoads', values.length ? { ...value.availableLoads!, values } : null); }} aria-label={t('training:remove') + ' ' + item}>{item} ×</button>)}</div>
          <div className="joined-input"><input aria-label={t('training:loadStep')} inputMode="decimal" value={load} onChange={event => setLoad(event.target.value)}/><button className="secondary" onClick={() => { try { const next = normalizeManualDecimal(load); change('availableLoads', { schemaVersion: 1, unit: value.availableLoads?.unit ?? value.loadUnit, values: [...value.availableLoads?.values ?? [], next] }); setLoad(''); } catch { setError(true); } }}>{t('training:addLoad')}</button></div>
        </>}
        {value.defaultsOrigin && <p className="muted">{t('training:defaultSource', { version: value.defaultsOrigin.catalogVersion })}</p>}
      </details>
      {error && <p role="alert">{t('training:invalid')}</p>}
      <div className="actions"><button onClick={() => { void apply(); }}>{t('training:applySetup')}</button><button className="secondary" onClick={onClose}>{t('cancel')}</button></div>
    </fieldset>
  </ConfirmDialog>;
}
