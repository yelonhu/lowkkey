// Compatibility exports for training modules; all domains share one edit queue.
export { serializeEdits as serializeTraining, commitEditingRegions as commitTrainingRows, advanceOwnBinding } from '../save-coordinator.ts';
