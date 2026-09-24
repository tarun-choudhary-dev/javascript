import {EngineController} from './lifecycle/controller.js';
export {EngineError} from './api/errors.js';

export class JavaScriptEngine {
  #controller = new EngineController(new URL('./worker.js', import.meta.url));
  initialize() { return this.#controller.initialize(); }
  run(request) { return this.#controller.run(request); }
  cancel() { return this.#controller.cancel(); }
  reset() { return this.#controller.reset(); }
  dispose() { this.#controller.dispose(); }
  isReady() { return this.#controller.isReady(); }
  isBusy() { return this.#controller.isBusy(); }
  getState() { return this.#controller.getState(); }
  getRuntimeInfo() { return this.#controller.getRuntimeInfo(); }
}
