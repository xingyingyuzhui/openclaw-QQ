export type AccountLifecycleHooks = {
  onStart?: () => Promise<void> | void;
  onStop?: () => Promise<void> | void;
};
