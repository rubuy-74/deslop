const CONTROLLER_KEY = '__deslopContentController';

export function startOnce(scope, start) {
  const existing = scope[CONTROLLER_KEY];
  if (existing) return existing;

  const controller = Promise.resolve().then(start);
  scope[CONTROLLER_KEY] = controller;
  controller.catch(() => {
    if (scope[CONTROLLER_KEY] === controller) delete scope[CONTROLLER_KEY];
  });
  return controller;
}
