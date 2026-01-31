var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class EventDispatcherBase {
  constructor() {
    this.subscribable = new Subscribable(this);
    this.subscribers = /* @__PURE__ */ new Set();
  }
  /**
   * {@inheritDoc Subscribable.subscribe}
   */
  subscribe(handler) {
    this.subscribers.add(handler);
    return () => this.unsubscribe(handler);
  }
  /**
   * {@inheritDoc Subscribable.unsubscribe}
   */
  unsubscribe(handler) {
    this.subscribers.delete(handler);
  }
  /**
   * Unsubscribe all subscribers from the event.
   */
  clear() {
    this.subscribers.clear();
  }
  notifySubscribers(value) {
    return [...this.subscribers].map((handler) => handler(value));
  }
}
class Subscribable {
  constructor(dispatcher) {
    this.dispatcher = dispatcher;
  }
  /**
   * Subscribe to the event.
   *
   * @param handler - The handler to invoke when the event occurs.
   *
   * @returns A callback function that cancels the subscription.
   */
  subscribe(handler) {
    return this.dispatcher.subscribe(handler);
  }
  /**
   * Unsubscribe from the event.
   *
   * @param handler - The handler to unsubscribe.
   */
  unsubscribe(handler) {
    this.dispatcher.unsubscribe(handler);
  }
}
class EventDispatcher extends EventDispatcherBase {
  dispatch(value) {
    this.notifySubscribers(value);
  }
}
class FlagDispatcher extends EventDispatcherBase {
  constructor() {
    super(...arguments);
    this.value = false;
  }
  /**
   * Notify all current and future subscribers.
   */
  raise() {
    if (!this.value) {
      this.value = true;
      this.notifySubscribers();
    }
  }
  /**
   * Stop notifying future subscribers.
   */
  reset() {
    this.value = false;
  }
  /**
   * Are subscribers being notified?
   */
  isRaised() {
    return this.value;
  }
  subscribe(handler) {
    const unsubscribe = super.subscribe(handler);
    if (this.value) {
      handler();
    }
    return unsubscribe;
  }
}
class ValueDispatcher extends EventDispatcherBase {
  /**
   * {@inheritDoc SubscribableValueEvent.current}
   */
  get current() {
    return this.value;
  }
  /**
   * Set the current value of this dispatcher.
   *
   * @remarks
   * Setting the value will immediately notify all subscribers.
   *
   * @param value - The new value.
   */
  set current(value) {
    this.value = value;
    this.notifySubscribers(value);
  }
  /**
   * @param value - The initial value.
   */
  constructor(value) {
    super();
    this.value = value;
    this.subscribable = new SubscribableValueEvent(this);
  }
  /**
   * {@inheritDoc SubscribableValueEvent.subscribe}
   */
  subscribe(handler, dispatchImmediately = true) {
    const unsubscribe = super.subscribe(handler);
    if (dispatchImmediately) {
      handler(this.value);
    }
    return unsubscribe;
  }
}
class SubscribableValueEvent extends Subscribable {
  /**
   * Get the most recent value of this dispatcher.
   */
  get current() {
    return this.dispatcher.current;
  }
  /**
   * Subscribe to the event.
   *
   * Subscribing will immediately invoke the handler with the most recent value.
   *
   * @param handler - The handler to invoke when the event occurs.
   * @param dispatchImmediately - Whether the handler should be immediately
   *                              invoked with the most recent value.
   *
   * @returns Callback function that cancels the subscription.
   */
  subscribe(handler, dispatchImmediately = true) {
    return this.dispatcher.subscribe(handler, dispatchImmediately);
  }
}
class MetaField {
  /**
   * Triggered when the data of this field changes.
   *
   * @eventProperty
   */
  get onChanged() {
    return this.value.subscribable;
  }
  /**
   * Triggered when the field becomes disabled or enabled.
   *
   * @eventProperty
   */
  get onDisabled() {
    return this.disabled.subscribable;
  }
  /**
   * @param name - The name of this field displayed in the editor.
   * @param initial - The initial value of this field.
   */
  constructor(name, initial2) {
    this.name = name;
    this.initial = initial2;
    this.type = void 0;
    this.spacing = false;
    this.description = "";
    this.disabled = new ValueDispatcher(false);
    this.value = new ValueDispatcher(initial2);
  }
  /**
   * Get the current value.
   */
  get() {
    return this.value.current;
  }
  /**
   * Set the current value.
   *
   * @param value - The new value.
   */
  set(value) {
    this.value.current = this.parse(value);
  }
  /**
   * Convert a serialized value into a runtime type.
   *
   * @param value - The serialized value.
   */
  parse(value) {
    return value;
  }
  /**
   * Serialize the value of this field.
   */
  serialize() {
    return this.value.current;
  }
  /**
   * Create a clone of this field.
   */
  clone() {
    return new this.constructor(this.name, this.get());
  }
  /**
   * Disable or enable the field in the editor.
   *
   * @param value - Whether the field should be disabled.
   */
  disable(value = true) {
    this.disabled.current = value;
    return this;
  }
  /**
   * Add or remove spacing at the beginning of this field.
   *
   * @param value - Whether to include the spacing.
   */
  space(value = true) {
    this.spacing = value;
    return this;
  }
  /**
   * Set the description of this field.
   *
   * @param description - The description.
   */
  describe(description2) {
    this.description = description2;
    return this;
  }
}
class ObjectMetaFieldInternal extends MetaField {
  /**
   * Triggered when the nested fields change.
   *
   * @eventProperty
   */
  get onFieldsChanged() {
    return this.event.subscribable;
  }
  constructor(name, fields) {
    const map2 = new Map(Object.entries(fields));
    super(name, Object.fromEntries(Array.from(map2, ([name2, field]) => [name2, field.get()])));
    this.type = Object;
    this.ignoreChange = false;
    this.customFields = {};
    this.handleChange = () => {
      if (this.ignoreChange)
        return;
      this.value.current = {
        ...this.transform("get"),
        ...this.customFields
      };
    };
    this.event = new ValueDispatcher([...map2.values()]);
    this.fields = map2;
    for (const [key, field] of this.fields) {
      Object.defineProperty(this, key, { value: field });
      field.onChanged.subscribe(this.handleChange);
    }
  }
  set(value) {
    this.ignoreChange = true;
    for (const [key, fieldValue] of Object.entries(value)) {
      const field = this.fields.get(key);
      if (field) {
        field.set(fieldValue);
      } else {
        this.customFields[key] = fieldValue;
      }
    }
    this.ignoreChange = false;
    this.handleChange();
  }
  serialize() {
    return {
      ...this.transform("serialize"),
      ...this.customFields
    };
  }
  clone() {
    const cloned = new this.constructor(this.name, this.transform("clone"));
    cloned.set(structuredClone(this.customFields));
    return cloned;
  }
  transform(fn) {
    const transformed = Object.fromEntries(Array.from(this.fields, ([name, field]) => [name, field[fn]()]));
    return transformed;
  }
}
const ObjectMetaField = ObjectMetaFieldInternal;
class BoolMetaField extends MetaField {
  constructor() {
    super(...arguments);
    this.type = Boolean;
  }
  parse(value) {
    return !!value;
  }
}
class DetailedError extends Error {
  constructor(props, remarks) {
    if (typeof props === "string") {
      super(props);
      this.remarks = remarks;
    } else {
      super(props.message);
      this.remarks = props.remarks;
      this.object = props.object;
      this.durationMs = props.durationMs;
      this.inspect = props.inspect;
    }
  }
}
class Semaphore {
  constructor() {
    this.resolveCurrent = null;
    this.current = null;
  }
  async acquire() {
    while (this.current) {
      await this.current;
    }
    this.current = new Promise((resolve) => {
      this.resolveCurrent = resolve;
    });
  }
  release() {
    var _a2;
    this.current = null;
    (_a2 = this.resolveCurrent) == null ? void 0 : _a2.call(this);
    this.resolveCurrent = null;
  }
}
const SceneStack = [];
function useScene() {
  const scene = SceneStack.at(-1);
  if (!scene) {
    throw new Error("The scene is not available in the current context.");
  }
  return scene;
}
function startScene(scene) {
  SceneStack.push(scene);
}
function endScene(scene) {
  if (SceneStack.pop() !== scene) {
    throw new Error("startScene/endScene were called out of order.");
  }
}
function useLogger() {
  var _a2;
  return ((_a2 = SceneStack.at(-1)) == null ? void 0 : _a2.logger) ?? console;
}
const ThreadStack = [];
function useThread() {
  const thread = ThreadStack.at(-1);
  if (!thread) {
    throw new DetailedError("The thread is not available in the current context.", "<p><code>useThread()</code> can only be called from within generator functions.\n      It&#39;s not available during rendering.</p>\n");
  }
  return thread;
}
function startThread(thread) {
  ThreadStack.push(thread);
}
function endThread(thread) {
  if (ThreadStack.pop() !== thread) {
    throw new Error("startThread/endThread was called out of order.");
  }
}
function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
function createRef() {
  let value;
  const ref = (newValue) => {
    if (newValue !== void 0) {
      value = newValue;
    } else {
      return value;
    }
  };
  return ref;
}
function errorToLog(error) {
  return {
    message: error.message,
    stack: error.stack,
    remarks: error.remarks
  };
}
const Scales = [
  { value: 0.25, text: "0.25x (Quarter)" },
  { value: 0.5, text: `0.5x (Half)` },
  { value: 1, text: `1.0x (Full)` },
  { value: 2, text: `2.0x (Double)` }
];
const ColorSpaces = [
  { value: "srgb", text: "sRGB" },
  { value: "display-p3", text: "DCI-P3" }
];
const FrameRates = [
  { value: 30, text: "30 FPS" },
  { value: 60, text: "60 FPS" }
];
var LogLevel;
(function(LogLevel2) {
  LogLevel2["Error"] = "error";
  LogLevel2["Warn"] = "warn";
  LogLevel2["Info"] = "info";
  LogLevel2["Http"] = "http";
  LogLevel2["Verbose"] = "verbose";
  LogLevel2["Debug"] = "debug";
  LogLevel2["Silly"] = "silly";
})(LogLevel || (LogLevel = {}));
class Logger {
  constructor() {
    this.logged = new EventDispatcher();
    this.history = [];
    this.profilers = {};
  }
  /**
   * Triggered when a new message is logged.
   */
  get onLogged() {
    return this.logged.subscribable;
  }
  log(payload) {
    this.logged.dispatch(payload);
    this.history.push(payload);
  }
  error(payload) {
    this.logLevel(LogLevel.Error, payload);
  }
  warn(payload) {
    this.logLevel(LogLevel.Warn, payload);
  }
  info(payload) {
    this.logLevel(LogLevel.Info, payload);
  }
  http(payload) {
    this.logLevel(LogLevel.Http, payload);
  }
  verbose(payload) {
    this.logLevel(LogLevel.Verbose, payload);
  }
  debug(payload) {
    this.logLevel(LogLevel.Debug, payload);
  }
  silly(payload) {
    this.logLevel(LogLevel.Silly, payload);
  }
  logLevel(level, payload) {
    const result = typeof payload === "string" ? { message: payload } : payload;
    result.level = level;
    this.log(result);
  }
  profile(id, payload) {
    const time = performance.now();
    if (this.profilers[id]) {
      const timeEnd = this.profilers[id];
      delete this.profilers[id];
      const result = payload ?? { message: id };
      result.level ?? (result.level = LogLevel.Debug);
      result.durationMs = time - timeEnd;
      this.log(result);
      return;
    }
    this.profilers[id] = time;
  }
}
var PlaybackState;
(function(PlaybackState2) {
  PlaybackState2[PlaybackState2["Playing"] = 0] = "Playing";
  PlaybackState2[PlaybackState2["Rendering"] = 1] = "Rendering";
  PlaybackState2[PlaybackState2["Paused"] = 2] = "Paused";
  PlaybackState2[PlaybackState2["Presenting"] = 3] = "Presenting";
})(PlaybackState || (PlaybackState = {}));
function makeProject(settings2) {
  return settings2;
}
function createProjectMetadata(project2) {
  const meta2 = {
    version: new MetaField("version", 1),
    shared: new ObjectMetaField("General", {
      background: new ColorMetaField("background", null),
      range: new RangeMetaField("range", [0, Infinity]),
      size: new Vector2MetaField("resolution", new Vector2(1920, 1080)),
      audioOffset: new NumberMetaField("audio offset", 0)
    }),
    preview: new ObjectMetaField("Preview", {
      fps: new NumberMetaField("frame rate", 30).setPresets(FrameRates).setRange(1),
      resolutionScale: new EnumMetaField("scale", Scales, 1)
    }),
    rendering: new ObjectMetaField("Rendering", {
      fps: new NumberMetaField("frame rate", 60).setPresets(FrameRates).setRange(1),
      resolutionScale: new EnumMetaField("scale", Scales, 1),
      colorSpace: new EnumMetaField("color space", ColorSpaces),
      exporter: new ExporterMetaField("exporter", project2)
    })
  };
  meta2.shared.audioOffset.disable(!project2.audio);
  return meta2;
}
class ProjectMetadata extends ObjectMetaField {
  constructor(project2) {
    super("project", createProjectMetadata(project2));
  }
  getFullPreviewSettings() {
    return {
      ...this.shared.get(),
      ...this.preview.get()
    };
  }
  getFullRenderingSettings() {
    return {
      ...this.shared.get(),
      ...this.rendering.get()
    };
  }
}
function createSettingsMetadata() {
  return new ObjectMetaField("Application Settings", {
    version: new MetaField("version", 1),
    appearance: new ObjectMetaField("Appearance", {
      color: new ColorMetaField("accent color", new ExtendedColor("#33a6ff")).describe("The accent color for the user interface. (Leave empty to use the default color)"),
      font: new BoolMetaField("legacy font", false).describe("Use the 'JetBrains Mono' font for the user interface."),
      coordinates: new BoolMetaField("coordinates", true).describe("Display mouse coordinates within the preview window.")
    }),
    defaults: new ObjectMetaField("Defaults", {
      background: new ColorMetaField("background", null).describe("The default background color used in new projects."),
      size: new Vector2MetaField("resolution", new Vector2(1920, 1080)).describe("The default resolution used in new projects.")
    })
  });
}
function bootstrap(name, versions, plugins, config2, metaFile2, settingsFile, logger = config2.logger ?? new Logger()) {
  const settings2 = createSettingsMetadata();
  settingsFile.attach(settings2);
  const project2 = {
    name,
    ...config2,
    plugins,
    versions,
    settings: settings2,
    logger
  };
  project2.meta = new ProjectMetadata(project2);
  project2.meta.shared.set(settings2.defaults.get());
  project2.experimentalFeatures ?? (project2.experimentalFeatures = false);
  metaFile2.attach(project2.meta);
  return project2;
}
function experimentalLog(message, remarks) {
  return {
    level: LogLevel.Error,
    message,
    remarks: `<p>This feature requires enabling the <code>experimentalFeatures</code> flag in your project
configuration:</p>
<pre class=""><code class="language-ts"><span class="hljs-keyword">export</span> <span class="hljs-keyword">default</span> <span class="hljs-title function_">makeProject</span>({
  <span class="hljs-attr">experimentalFeatures</span>: <span class="hljs-literal">true</span>,
  <span class="hljs-comment">// ...</span>
});</code></pre><p><a href='https://motioncanvas.io/docs/experimental' target='_blank'>Learn more</a> about experimental
features.</p>
`
  };
}
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const __vite_import_meta_env__ = {};
function viaProxy(url) {
  if (!isProxyEnabled()) {
    return url;
  }
  if (url.startsWith("/cors-proxy/")) {
    return url;
  }
  const selfUrl = new URL(window.location.toString());
  try {
    const expandedUrl = new URL(url, selfUrl);
    if (!expandedUrl.protocol.startsWith("http")) {
      return url;
    }
    if (selfUrl.host === expandedUrl.host) {
      return url;
    }
    if (!isInsideAllowList(expandedUrl.host)) {
      return url;
    }
  } catch (_) {
    return url;
  }
  return `/cors-proxy/${encodeURIComponent(url)}`;
}
function isInsideAllowList(host) {
  const allowList = getAllowList();
  if (allowList.length === 0) {
    return true;
  }
  for (const entry of allowList) {
    if (entry.toLowerCase().trim() === host) {
      return true;
    }
  }
  return false;
}
function isProxyEnabled() {
  if (__vite_import_meta_env__) {
    return false;
  }
  return false;
}
let AllowListCache = void 0;
function getAllowList() {
  {
    if (AllowListCache) {
      return [...AllowListCache];
    }
  }
  const result = function() {
    if (!isProxyEnabled() || !__vite_import_meta_env__) {
      return [];
    }
    const valueJson = "[]";
    const parsedJson = JSON.parse(valueJson);
    if (!Array.isArray(parsedJson)) {
      useLogger().error("Parsed Allow List expected to be an Array, but is " + typeof parsedJson);
    }
    const validatedEntries = [];
    for (const entry of parsedJson) {
      if (typeof entry !== "string") {
        useLogger().warn("Unexpected Value in Allow List: " + entry + ". Expected a String. Skipping.");
        continue;
      }
      validatedEntries.push(entry);
    }
    return validatedEntries;
  }();
  AllowListCache = result;
  return [...AllowListCache];
}
function range(first, second, step) {
  let from = 0;
  let to = first;
  step = step === void 0 ? from < to ? 1 : -1 : step;
  const array = [];
  let length = Math.max(Math.ceil((to - from) / step), 0);
  let index = 0;
  while (length--) {
    array[index++] = from;
    from += step;
  }
  return array;
}
function useDuration(name) {
  const scene = useScene();
  const thread = useThread();
  return scene.timeEvents.register(name, thread.time());
}
const PlaybackStack = [];
function usePlayback() {
  const playback = PlaybackStack.at(-1);
  if (!playback) {
    throw new Error("The playback is not available in the current context.");
  }
  return playback;
}
function startPlayback(playback) {
  PlaybackStack.push(playback);
}
function endPlayback(playback) {
  if (PlaybackStack.pop() !== playback) {
    throw new Error("startPlayback/endPlayback were called out of order.");
  }
}
function decorate(fn, ...decorators) {
  const target = { [fn.name]: fn };
  const descriptor = Object.getOwnPropertyDescriptor(target, fn.name);
  if (descriptor) {
    for (let i = decorators.length - 1; i >= 0; i--) {
      decorators[i](target, fn.name, descriptor);
    }
  }
}
const UNINITIALIZED = Symbol.for("@motion-canvas/core/decorators/UNINITIALIZED");
function lazy(factory) {
  return (target, propertyKey) => {
    let value = UNINITIALIZED;
    Object.defineProperty(target, propertyKey, {
      get() {
        if (value === UNINITIALIZED) {
          value = factory.call(this);
        }
        return value;
      }
    });
  };
}
function threadable(customName) {
  return function(_, propertyKey, descriptor) {
    descriptor.value.prototype.name = customName ?? propertyKey;
    descriptor.value.prototype.threadable = true;
  };
}
decorate(all, threadable());
function* all(...tasks) {
  for (const task of tasks) {
    yield task;
  }
  yield* join(...tasks);
}
decorate(waitUntil, threadable());
function* waitUntil(event, after) {
  yield* waitFor(useDuration(event));
  if (after) {
    yield* after;
  }
}
decorate(waitFor, threadable());
function* waitFor(seconds = 0, after) {
  const thread = useThread();
  const step = usePlayback().framesToSeconds(1);
  const targetTime = thread.time() + seconds;
  while (targetTime - step > thread.fixed) {
    yield;
  }
  thread.time(targetTime);
  if (after) {
    yield* after;
  }
}
decorate(noop, threadable());
function* noop() {
}
function run(firstArg, runner) {
  let task;
  if (typeof firstArg === "string") {
    task = runner();
    setTaskName(task, firstArg);
  } else {
    task = firstArg();
    setTaskName(task, task);
  }
  return task;
}
function isPromisable(value) {
  return value && (typeof value === "object" || typeof value === "function") && "toPromise" in value;
}
function isThreadGenerator(value) {
  return value !== null && typeof value === "object" && Symbol.iterator in value && "next" in value;
}
function setTaskName(task, source) {
  const prototype = Object.getPrototypeOf(task);
  if (!prototype.threadable) {
    prototype.threadable = true;
    prototype.name = typeof source === "string" ? source : getTaskName(source);
  }
}
function getTaskName(task) {
  return Object.getPrototypeOf(task).name ?? null;
}
class Thread {
  get onDeferred() {
    return this.deferred.subscribable;
  }
  /**
   * The fixed time of this thread.
   *
   * @remarks
   * Fixed time is a multiple of the frame duration. It can be used to account
   * for the difference between this thread's {@link time} and the time of the
   * current animation frame.
   */
  get fixed() {
    return this.fixedTime;
  }
  /**
   * Check if this thread or any of its ancestors has been canceled.
   */
  get canceled() {
    var _a2;
    return this.isCanceled || (((_a2 = this.parent) == null ? void 0 : _a2.canceled) ?? false);
  }
  get paused() {
    var _a2;
    return this.isPaused || (((_a2 = this.parent) == null ? void 0 : _a2.paused) ?? false);
  }
  get root() {
    var _a2;
    return ((_a2 = this.parent) == null ? void 0 : _a2.root) ?? this;
  }
  constructor(runner) {
    this.runner = runner;
    this.deferred = new EventDispatcher();
    this.children = [];
    this.time = createSignal(0);
    this.parent = null;
    this.isCanceled = false;
    this.isPaused = false;
    this.fixedTime = 0;
    this.queue = [];
    if (this.runner.task) {
      useLogger().error({
        message: `The generator "${getTaskName(this.runner)}" is already being executed by another thread.`,
        remarks: '<p>This usually happens when you mistakenly reuse a generator that is already\nrunning.</p>\n<p>For example, using <code>yield</code> here will run the opacity generator concurrently and\nstore it in the <code>task</code> variable (in case you want to cancel or await it later):</p>\n<pre class=""><code class="language-ts"><span class="hljs-keyword">const</span> task = <span class="hljs-keyword">yield</span> <span class="hljs-title function_">rect</span>().<span class="hljs-title function_">opacity</span>(<span class="hljs-number">1</span>, <span class="hljs-number">1</span>);</code></pre><p>Trying to <code>yield</code> this task again will cause the current error:</p>\n<pre class=""><code class="language-ts"><span class="hljs-keyword">yield</span> task;</code></pre><p>Passing it to other flow functions will also cause the error:</p>\n<pre class=""><code class="language-ts"><span class="hljs-keyword">yield</span>* <span class="hljs-title function_">all</span>(task);</code></pre><p>Try to investigate your code looking for <code>yield</code> statements whose return value\nis reused in this way. Here&#39;s an example of a common mistake:</p>\n<pre class="wrong"><code class="language-ts"><span class="hljs-keyword">yield</span>* <span class="hljs-title function_">all</span>(\n  <span class="hljs-keyword">yield</span> <span class="hljs-title function_">rect</span>().<span class="hljs-title function_">opacity</span>(<span class="hljs-number">1</span>, <span class="hljs-number">1</span>), \n  <span class="hljs-keyword">yield</span> <span class="hljs-title function_">rect</span>().<span class="hljs-title function_">x</span>(<span class="hljs-number">200</span>, <span class="hljs-number">1</span>),\n);</code></pre><pre class="correct"><code class="language-ts"><span class="hljs-keyword">yield</span>* <span class="hljs-title function_">all</span>(\n  <span class="hljs-title function_">rect</span>().<span class="hljs-title function_">opacity</span>(<span class="hljs-number">1</span>, <span class="hljs-number">1</span>), \n  <span class="hljs-title function_">rect</span>().<span class="hljs-title function_">x</span>(<span class="hljs-number">200</span>, <span class="hljs-number">1</span>),\n);</code></pre>'
      });
      this.runner = noop();
    }
    this.runner.task = this;
  }
  /**
   * Progress the wrapped generator once.
   */
  next() {
    if (this.paused) {
      return {
        value: null,
        done: false
      };
    }
    startThread(this);
    const result = this.runner.next(this.value);
    endThread(this);
    this.value = null;
    return result;
  }
  /**
   * Prepare the thread for the next update cycle.
   *
   * @param dt - The delta time of the next cycle.
   */
  update(dt) {
    if (!this.paused) {
      this.time(this.time() + dt);
      this.fixedTime += dt;
    }
    this.children = this.children.filter((child) => !child.canceled);
  }
  spawn(child) {
    if (!isThreadGenerator(child)) {
      child = child();
    }
    this.queue.push(child);
    return child;
  }
  add(child) {
    child.parent = this;
    child.isCanceled = false;
    child.time(this.time());
    child.fixedTime = this.fixedTime;
    this.children.push(child);
    setTaskName(child.runner, `unknown ${this.children.length}`);
  }
  drain(callback) {
    this.queue.forEach(callback);
    this.queue = [];
  }
  cancel() {
    this.deferred.clear();
    this.runner.return();
    this.isCanceled = true;
    this.parent = null;
    this.drain((task) => task.return());
  }
  pause(value) {
    this.isPaused = value;
  }
  runDeferred() {
    startThread(this);
    this.deferred.dispatch();
    endThread(this);
  }
}
decorate(join, threadable());
function* join(first, ...tasks) {
  let all2 = true;
  if (typeof first === "boolean") {
    all2 = first;
  } else {
    tasks.push(first);
  }
  const parent = useThread();
  const threads2 = tasks.map((task) => parent.children.find((thread) => thread.runner === task)).filter((thread) => thread);
  const startTime = parent.time();
  let childTime;
  if (all2) {
    while (threads2.find((thread) => !thread.canceled)) {
      yield;
    }
    childTime = Math.max(...threads2.map((thread) => thread.time()));
  } else {
    while (!threads2.find((thread) => thread.canceled)) {
      yield;
    }
    const canceled = threads2.filter((thread) => thread.canceled);
    childTime = Math.min(...canceled.map((thread) => thread.time()));
  }
  parent.time(Math.max(startTime, childTime));
}
function isPromise(value) {
  return typeof (value == null ? void 0 : value.then) === "function";
}
decorate(threads, threadable());
function* threads(factory, callback) {
  const playback = usePlayback();
  const root = factory();
  setTaskName(root, "root");
  const rootThread = new Thread(root);
  callback == null ? void 0 : callback(rootThread);
  let threads2 = [rootThread];
  while (threads2.length > 0) {
    const newThreads = [];
    const queue = [...threads2];
    const dt = playback.deltaTime;
    while (queue.length > 0) {
      const thread = queue.pop();
      if (!thread || thread.canceled) {
        continue;
      }
      const result = thread.next();
      if (result.done) {
        thread.cancel();
        continue;
      }
      if (isThreadGenerator(result.value)) {
        const child = new Thread(result.value);
        thread.value = result.value;
        thread.add(child);
        queue.push(thread);
        queue.push(child);
      } else if (result.value) {
        thread.value = yield result.value;
        queue.push(thread);
      } else {
        thread.update(dt);
        thread.drain((task) => {
          const child = new Thread(task);
          thread.add(child);
          newThreads.unshift(child);
        });
        newThreads.unshift(thread);
      }
    }
    threads2 = [];
    for (const thread of newThreads) {
      if (!thread.canceled) {
        threads2.push(thread);
        thread.runDeferred();
      }
    }
    if (threads2.length > 0)
      yield;
  }
}
var SceneRenderEvent;
(function(SceneRenderEvent2) {
  SceneRenderEvent2[SceneRenderEvent2["BeforeRender"] = 0] = "BeforeRender";
  SceneRenderEvent2[SceneRenderEvent2["BeginRender"] = 1] = "BeginRender";
  SceneRenderEvent2[SceneRenderEvent2["FinishRender"] = 2] = "FinishRender";
  SceneRenderEvent2[SceneRenderEvent2["AfterRender"] = 3] = "AfterRender";
})(SceneRenderEvent || (SceneRenderEvent = {}));
class LifecycleEvents {
  get onBeforeRender() {
    return this.beforeRender.subscribable;
  }
  get onBeginRender() {
    return this.beginRender.subscribable;
  }
  get onFinishRender() {
    return this.finishRender.subscribable;
  }
  get onAfterRender() {
    return this.afterRender.subscribable;
  }
  constructor(scene) {
    this.scene = scene;
    this.beforeRender = new EventDispatcher();
    this.beginRender = new EventDispatcher();
    this.finishRender = new EventDispatcher();
    this.afterRender = new EventDispatcher();
    this.scene.onRenderLifecycle.subscribe(([event, ctx]) => {
      switch (event) {
        case SceneRenderEvent.BeforeRender:
          return this.beforeRender.dispatch(ctx);
        case SceneRenderEvent.BeginRender:
          return this.beginRender.dispatch(ctx);
        case SceneRenderEvent.FinishRender:
          return this.finishRender.dispatch(ctx);
        case SceneRenderEvent.AfterRender:
          return this.afterRender.dispatch(ctx);
      }
    });
    this.scene.onReset.subscribe(() => {
      this.beforeRender.clear();
      this.beginRender.clear();
      this.finishRender.clear();
      this.afterRender.clear();
    });
  }
}
class Random {
  constructor(state) {
    this.state = state;
    this.nextGauss = null;
  }
  /**
   * @internal
   */
  static createSeed() {
    return Math.floor(Math.random() * 4294967296);
  }
  /**
   * Get the next random float in the given range.
   *
   * @param from - The start of the range.
   * @param to - The end of the range.
   */
  nextFloat(from = 0, to = 1) {
    return map(from, to, this.next());
  }
  /**
   * Get the next random integer in the given range.
   *
   * @param from - The start of the range.
   * @param to - The end of the range. Exclusive.
   */
  nextInt(from = 0, to = 4294967296) {
    let value = Math.floor(map(from, to, this.next()));
    if (value === to) {
      value = from;
    }
    return value;
  }
  /**
   * Get a random float from a gaussian distribution.
   * @param mean - The mean of the distribution.
   * @param stdev - The standard deviation of the distribution.
   */
  gauss(mean = 0, stdev = 1) {
    let z = this.nextGauss;
    this.nextGauss = null;
    if (z === null) {
      const x2pi = this.next() * 2 * Math.PI;
      const g2rad = Math.sqrt(-2 * Math.log(1 - this.next()));
      z = Math.cos(x2pi) * g2rad;
      this.nextGauss = Math.sin(x2pi) * g2rad;
    }
    return mean + z * stdev;
  }
  /**
   * Get an array filled with random floats in the given range.
   *
   * @param size - The size of the array.
   * @param from - The start of the range.
   * @param to - The end of the range.
   */
  floatArray(size, from = 0, to = 1) {
    return range(size).map(() => this.nextFloat(from, to));
  }
  /**
   Get an array filled with random integers in the given range.
   *
   * @param size - The size of the array.
   * @param from - The start of the range.
   * @param to - The end of the range. Exclusive.
   */
  intArray(size, from = 0, to = 4294967296) {
    return range(size).map(() => this.nextInt(from, to));
  }
  /**
   * Create a new independent generator.
   */
  spawn() {
    return new Random(this.nextInt());
  }
  next() {
    this.state |= 0;
    this.state = this.state + 1831565813 | 0;
    let t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
var SceneState;
(function(SceneState2) {
  SceneState2[SceneState2["Initial"] = 0] = "Initial";
  SceneState2[SceneState2["AfterTransitionIn"] = 1] = "AfterTransitionIn";
  SceneState2[SceneState2["CanTransitionOut"] = 2] = "CanTransitionOut";
  SceneState2[SceneState2["Finished"] = 3] = "Finished";
})(SceneState || (SceneState = {}));
const UNIFORM_RESOLUTION = "resolution";
const UNIFORM_DESTINATION_TEXTURE = "destinationTexture";
const UNIFORM_SOURCE_TEXTURE = "sourceTexture";
const UNIFORM_TIME = "time";
const UNIFORM_DELTA_TIME = "deltaTime";
const UNIFORM_FRAMERATE = "framerate";
const UNIFORM_SOURCE_MATRIX = "sourceMatrix";
const UNIFORM_DESTINATION_MATRIX = "destinationMatrix";
const FragmentShader = `#version 300 es

in vec2 position;

out vec2 screenUV;
out vec2 sourceUV;
out vec2 destinationUV;

uniform mat4 sourceMatrix;
uniform mat4 destinationMatrix;

void main() {
    vec2 position_source = position * 0.5 + 0.5;
    vec4 position_screen = sourceMatrix * vec4(position_source, 0, 1);

    screenUV = position_screen.xy;
    sourceUV = position_source;
    destinationUV = (destinationMatrix * position_screen).xy;

    gl_Position = (position_screen - 0.5) * 2.0;
}
`;
class Shaders {
  constructor(scene, sharedContext) {
    this.scene = scene;
    this.sharedContext = sharedContext;
    this.gl = null;
    this.positionBuffer = null;
    this.sourceTexture = null;
    this.destinationTexture = null;
    this.positionLocation = 0;
    this.quadPositions = new Float32Array([
      -1,
      1,
      -1,
      -1,
      1,
      1,
      1,
      -1
    ]);
    this.handleReload = () => {
      if (this.gl) {
        this.updateViewport();
      }
    };
    scene.onReloaded.subscribe(this.handleReload);
  }
  setup(gl) {
    this.gl = gl;
    this.updateViewport();
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.quadPositions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.positionLocation);
    this.sourceTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.destinationTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.destinationTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  teardown(gl) {
    gl.deleteBuffer(this.positionBuffer);
    gl.disableVertexAttribArray(this.positionLocation);
    gl.deleteTexture(this.sourceTexture);
    gl.deleteTexture(this.destinationTexture);
    this.positionBuffer = null;
    this.sourceTexture = null;
    this.destinationTexture = null;
    this.gl = null;
  }
  updateViewport() {
    if (this.gl) {
      const size = this.scene.getRealSize();
      this.gl.canvas.width = size.width;
      this.gl.canvas.height = size.height;
      this.gl.viewport(0, 0, size.width, size.height);
    }
  }
  getGL() {
    return this.gl ?? this.sharedContext.borrow(this);
  }
  getProgram(fragment) {
    const program = this.sharedContext.getProgram(fragment, FragmentShader);
    if (!program) {
      return null;
    }
    const size = this.scene.getRealSize();
    const gl = this.getGL();
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, UNIFORM_SOURCE_TEXTURE), 0);
    gl.uniform1i(gl.getUniformLocation(program, UNIFORM_DESTINATION_TEXTURE), 1);
    gl.uniform2f(gl.getUniformLocation(program, UNIFORM_RESOLUTION), size.x, size.y);
    gl.uniform1f(gl.getUniformLocation(program, UNIFORM_DELTA_TIME), this.scene.playback.deltaTime);
    gl.uniform1f(gl.getUniformLocation(program, UNIFORM_FRAMERATE), this.scene.playback.fps);
    return program;
  }
  copyTextures(destination, source) {
    this.copyTexture(source, this.sourceTexture);
    this.copyTexture(destination, this.destinationTexture);
  }
  clear() {
    const gl = this.getGL();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  render() {
    const gl = this.getGL();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  copyTexture(source, texture) {
    const gl = this.getGL();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}
class Slides {
  get onChanged() {
    return this.slides.subscribable;
  }
  constructor(scene) {
    this.scene = scene;
    this.slides = new ValueDispatcher([]);
    this.lookup = /* @__PURE__ */ new Map();
    this.collisionLookup = /* @__PURE__ */ new Set();
    this.current = null;
    this.canResume = false;
    this.waitsForId = null;
    this.targetId = null;
    this.handleReload = () => {
      this.lookup.clear();
      this.collisionLookup.clear();
      this.current = null;
      this.waitsForId = null;
      this.targetId = null;
    };
    this.handleReset = () => {
      this.collisionLookup.clear();
      this.current = null;
      this.waitsForId = null;
    };
    this.handleRecalculated = () => {
      this.slides.current = [...this.lookup.values()];
    };
    this.scene.onReloaded.subscribe(this.handleReload);
    this.scene.onReset.subscribe(this.handleReset);
    this.scene.onRecalculated.subscribe(this.handleRecalculated);
  }
  setTarget(target) {
    this.targetId = target;
  }
  resume() {
    this.canResume = true;
  }
  isWaitingFor(slide) {
    return this.waitsForId === slide;
  }
  isWaiting() {
    return this.waitsForId !== null;
  }
  didHappen(slide) {
    var _a2;
    if (this.current === null) {
      return false;
    }
    for (const key of this.lookup.keys()) {
      if (key === slide) {
        return true;
      }
      if (key === ((_a2 = this.current) == null ? void 0 : _a2.id)) {
        return false;
      }
    }
    return false;
  }
  getCurrent() {
    return this.current;
  }
  register(name, initialTime) {
    if (this.waitsForId !== null) {
      throw new Error(`The animation already waits for a slide: ${this.waitsForId}.`);
    }
    const id = this.toId(name);
    if (this.scene.playback.state !== PlaybackState.Presenting) {
      if (!this.lookup.has(id)) {
        this.lookup.set(id, {
          id,
          name,
          time: initialTime,
          scene: this.scene,
          stack: new Error().stack
        });
      }
      if (this.collisionLookup.has(name)) {
        this.scene.logger.warn({
          message: `A slide named "${name}" already exists.`,
          stack: new Error().stack
        });
      } else {
        this.collisionLookup.add(name);
      }
    }
    this.waitsForId = id;
    this.current = this.lookup.get(id) ?? null;
    this.canResume = false;
  }
  shouldWait(name) {
    const id = this.toId(name);
    if (this.waitsForId !== id) {
      throw new Error(`The animation waits for a different slide: ${this.waitsForId}.`);
    }
    const data = this.lookup.get(id);
    if (!data) {
      throw new Error(`Could not find the "${name}" slide.`);
    }
    let canResume = this.canResume;
    if (this.scene.playback.state !== PlaybackState.Presenting) {
      canResume = id !== this.targetId;
    }
    if (canResume) {
      this.waitsForId = null;
    }
    return !canResume;
  }
  toId(name) {
    return `${this.scene.name}:${name}`;
  }
}
class Variables {
  constructor(scene) {
    this.scene = scene;
    this.signals = {};
    this.variables = {};
    this.handleReset = () => {
      this.signals = {};
    };
    scene.onReset.subscribe(this.handleReset);
  }
  /**
   * Get variable signal if exists or create signal if not
   *
   * @param name - The name of the variable.
   * @param initial - The initial value of the variable. It will be used if the
   *                  variable was not configured from the outside.
   */
  get(name, initial2) {
    var _a2;
    (_a2 = this.signals)[name] ?? (_a2[name] = createSignal(this.variables[name] ?? initial2));
    return () => this.signals[name]();
  }
  /**
   * Update all signals with new project variable values.
   */
  updateSignals(variables) {
    this.variables = variables;
    Object.keys(variables).map((variableName) => {
      if (variableName in this.signals) {
        this.signals[variableName](variables[variableName]);
      }
    });
  }
}
class GeneratorScene {
  get firstFrame() {
    return this.cache.current.firstFrame;
  }
  get lastFrame() {
    return this.firstFrame + this.cache.current.duration;
  }
  get onCacheChanged() {
    return this.cache.subscribable;
  }
  get onReloaded() {
    return this.reloaded.subscribable;
  }
  get onRecalculated() {
    return this.recalculated.subscribable;
  }
  get onThreadChanged() {
    return this.thread.subscribable;
  }
  get onRenderLifecycle() {
    return this.renderLifecycle.subscribable;
  }
  get onReset() {
    return this.afterReset.subscribable;
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  get LifecycleEvents() {
    this.logger.warn("LifecycleEvents is deprecated. Use lifecycleEvents instead.");
    return this.lifecycleEvents;
  }
  get previous() {
    return this.previousScene;
  }
  constructor(description2) {
    this.cache = new ValueDispatcher({
      firstFrame: 0,
      transitionDuration: 0,
      duration: 0,
      lastFrame: 0
    });
    this.reloaded = new EventDispatcher();
    this.recalculated = new EventDispatcher();
    this.thread = new ValueDispatcher(null);
    this.renderLifecycle = new EventDispatcher();
    this.afterReset = new EventDispatcher();
    this.lifecycleEvents = new LifecycleEvents(this);
    this.previousScene = null;
    this.runner = null;
    this.state = SceneState.Initial;
    this.cached = false;
    this.counters = {};
    this.name = description2.name;
    this.size = description2.size;
    this.resolutionScale = description2.resolutionScale;
    this.logger = description2.logger;
    this.playback = description2.playback;
    this.meta = description2.meta;
    this.runnerFactory = description2.config;
    this.creationStack = description2.stack;
    this.experimentalFeatures = description2.experimentalFeatures ?? false;
    decorate(this.runnerFactory, threadable(this.name));
    this.timeEvents = new description2.timeEventsClass(this);
    this.variables = new Variables(this);
    this.shaders = new Shaders(this, description2.sharedWebGLContext);
    this.slides = new Slides(this);
    this.random = new Random(this.meta.seed.get());
    this.previousOnTop = false;
  }
  /**
   * Update the view.
   *
   * Invoked after each step of the main generator.
   * Can be used for calculating layout.
   *
   * Can modify the state of the view.
   */
  update() {
  }
  async render(context) {
    let iterations = 0;
    do {
      iterations++;
      await DependencyContext.consumePromises();
      context.save();
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      this.execute(() => this.draw(context));
      context.restore();
    } while (DependencyContext.hasPromises() && iterations < 10);
    if (iterations > 1) {
      this.logger.debug(`render iterations: ${iterations}`);
    }
  }
  reload({ config: config2, size, stack, resolutionScale } = {}) {
    if (config2) {
      this.runnerFactory = config2;
    }
    if (size) {
      this.size = size;
    }
    if (resolutionScale) {
      this.resolutionScale = resolutionScale;
    }
    if (stack) {
      this.creationStack = stack;
    }
    this.cached = false;
    this.reloaded.dispatch();
  }
  async recalculate(setFrame) {
    const cached = this.cache.current;
    cached.firstFrame = this.playback.frame;
    cached.lastFrame = cached.firstFrame + cached.duration;
    if (this.isCached()) {
      setFrame(cached.lastFrame);
      this.cache.current = { ...cached };
      return;
    }
    cached.transitionDuration = -1;
    await this.reset();
    while (!this.canTransitionOut()) {
      if (cached.transitionDuration < 0 && this.state === SceneState.AfterTransitionIn) {
        cached.transitionDuration = this.playback.frame - cached.firstFrame;
      }
      setFrame(this.playback.frame + 1);
      await this.next();
    }
    if (cached.transitionDuration === -1) {
      cached.transitionDuration = 0;
    }
    cached.lastFrame = this.playback.frame;
    cached.duration = cached.lastFrame - cached.firstFrame;
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.cached = true;
    this.cache.current = { ...cached };
    this.recalculated.dispatch();
  }
  async next() {
    var _a2;
    if (!this.runner) {
      return;
    }
    let result = this.execute(() => this.runner.next());
    this.update();
    while (result.value) {
      if (isPromisable(result.value)) {
        const value = await result.value.toPromise();
        result = this.execute(() => this.runner.next(value));
      } else if (isPromise(result.value)) {
        const value = await result.value;
        result = this.execute(() => this.runner.next(value));
      } else {
        this.logger.warn({
          message: "Invalid value yielded by the scene.",
          object: result.value
        });
        result = this.execute(() => this.runner.next(result.value));
      }
      this.update();
    }
    if (DependencyContext.hasPromises()) {
      const promises = await DependencyContext.consumePromises();
      this.logger.error({
        message: "Tried to access an asynchronous property before the node was ready. Make sure to yield the node before accessing the property.",
        stack: promises[0].stack,
        inspect: ((_a2 = promises[0].owner) == null ? void 0 : _a2.key) ?? void 0
      });
    }
    if (result.done) {
      this.state = SceneState.Finished;
    }
  }
  async reset(previousScene = null) {
    this.counters = {};
    this.previousScene = previousScene;
    this.previousOnTop = false;
    this.random = new Random(this.meta.seed.get());
    this.runner = threads(() => this.runnerFactory(this.getView()), (thread) => {
      this.thread.current = thread;
    });
    this.state = SceneState.AfterTransitionIn;
    this.afterReset.dispatch();
    await this.next();
  }
  getSize() {
    return this.size;
  }
  getRealSize() {
    return this.size.mul(this.resolutionScale);
  }
  isAfterTransitionIn() {
    return this.state === SceneState.AfterTransitionIn;
  }
  canTransitionOut() {
    return this.state === SceneState.CanTransitionOut || this.state === SceneState.Finished;
  }
  isFinished() {
    return this.state === SceneState.Finished;
  }
  enterInitial() {
    if (this.state === SceneState.AfterTransitionIn) {
      this.state = SceneState.Initial;
    } else {
      this.logger.warn(`Scene ${this.name} entered initial in an unexpected state: ${this.state}`);
    }
  }
  enterAfterTransitionIn() {
    if (this.state === SceneState.Initial) {
      this.state = SceneState.AfterTransitionIn;
    } else {
      this.logger.warn(`Scene ${this.name} transitioned in an unexpected state: ${this.state}`);
    }
  }
  enterCanTransitionOut() {
    if (this.state === SceneState.AfterTransitionIn || this.state === SceneState.Initial) {
      this.state = SceneState.CanTransitionOut;
    } else {
      this.logger.warn(`Scene ${this.name} was marked as finished in an unexpected state: ${this.state}`);
    }
  }
  isCached() {
    return this.cached;
  }
  /**
   * Invoke the given callback in the context of this scene.
   *
   * @remarks
   * This method makes sure that the context of this scene is globally available
   * during the execution of the callback.
   *
   * @param callback - The callback to invoke.
   */
  execute(callback) {
    let result;
    startScene(this);
    startPlayback(this.playback);
    try {
      result = callback();
    } finally {
      endPlayback(this.playback);
      endScene(this);
    }
    return result;
  }
}
function createSceneMetadata() {
  return new ObjectMetaField("scene", {
    version: new MetaField("version", 1),
    timeEvents: new MetaField("time events", []),
    seed: new MetaField("seed", Random.createSeed())
  });
}
function textLerp(fromString, toString, value) {
  const from = [...fromString];
  const to = [...toString];
  if (to.length >= from.length) {
    const current = Math.floor(to.length * value);
    const currentLength = Math.floor(map(from.length - 1, to.length, value));
    let text = "";
    for (let i = 0; i < to.length; i++) {
      if (i < current) {
        text += to[i];
      } else if (from[i] || i <= currentLength) {
        text += from[i] ?? to[i];
      }
    }
    return text;
  } else {
    const current = Math.round(from.length * (1 - value));
    const currentLength = Math.floor(map(from.length + 1, to.length, value));
    const text = [];
    for (let i = from.length - 1; i >= 0; i--) {
      if (i < current) {
        text.unshift(from[i]);
      } else if (to[i] || i < currentLength) {
        text.unshift(to[i] ?? from[i]);
      }
    }
    return text.join("");
  }
}
function deepLerp(from, to, value, suppressWarnings = false) {
  if (value === 0)
    return from;
  if (value === 1)
    return to;
  if (from == null || to == null) {
    if (!suppressWarnings) {
      useLogger().warn(`Attempting to lerp ${from} -> ${to} may result in unexpected behavior.`);
    }
    return void 0;
  }
  if (typeof from === "number" && typeof to === "number") {
    return map(from, to, value);
  }
  if (typeof from === "string" && typeof to === "string") {
    return textLerp(from, to, value);
  }
  if (typeof from === "boolean" && typeof to === "boolean") {
    return value < 0.5 ? from : to;
  }
  if ("lerp" in from) {
    return from.lerp(to, value);
  }
  if (from && to && typeof from === "object" && typeof to === "object") {
    if (Array.isArray(from) && Array.isArray(to)) {
      if (from.length === to.length) {
        return from.map((f, i) => deepLerp(f, to[i], value));
      }
    } else {
      let toObject = false;
      if (!(from instanceof Map) && !(to instanceof Map)) {
        toObject = true;
        from = new Map(Object.entries(from));
        to = new Map(Object.entries(to));
      }
      if (from instanceof Map && to instanceof Map) {
        const result = /* @__PURE__ */ new Map();
        for (const key of /* @__PURE__ */ new Set([...from.keys(), ...to.keys()])) {
          const inter = deepLerp(from.get(key), to.get(key), value, true);
          if (inter !== void 0)
            result.set(key, inter);
        }
        return toObject ? Object.fromEntries(result) : result;
      }
    }
  }
  return to;
}
function boolLerp(from, to, value) {
  return value < 0.5 ? from : to;
}
function map(from, to, value) {
  return from + (to - from) * value;
}
function remap(fromIn, toIn, fromOut, toOut, value) {
  return fromOut + (value - fromIn) * (toOut - fromOut) / (toIn - fromIn);
}
function clamp(min, max, value) {
  return value < min ? min : value > max ? max : value;
}
function arcLerp(value, reverse, ratio) {
  let flip = reverse;
  if (ratio > 1) {
    ratio = 1 / ratio;
  } else {
    flip = !flip;
  }
  const normalized = flip ? Math.acos(clamp(-1, 1, 1 - value)) : Math.asin(value);
  const radians = map(normalized, map(0, Math.PI / 2, value), ratio);
  let xValue = Math.sin(radians);
  let yValue = 1 - Math.cos(radians);
  if (reverse) {
    [xValue, yValue] = [yValue, xValue];
  }
  return new Vector2(xValue, yValue);
}
function easeInCubic(value, from = 0, to = 1) {
  value = value * value * value;
  return map(from, to, value);
}
function easeOutCubic(value, from = 0, to = 1) {
  value = 1 - Math.pow(1 - value, 3);
  return map(from, to, value);
}
function easeInOutCubic(value, from = 0, to = 1) {
  value = value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  return map(from, to, value);
}
function easeOutExpo(value, from = 0, to = 1) {
  value = value === 1 ? 1 : 1 - Math.pow(2, -10 * value);
  return map(from, to, value);
}
function linear(value, from = 0, to = 1) {
  return map(from, to, value);
}
decorate(tween, threadable());
function* tween(seconds, onProgress, onEnd) {
  const thread = useThread();
  const startTime = thread.time();
  const endTime = thread.time() + seconds;
  onProgress(0, 0);
  while (endTime > thread.fixed) {
    const time = thread.fixed - startTime;
    const value = time / seconds;
    if (time > 0) {
      onProgress(value, time);
    }
    yield;
  }
  thread.time(endTime);
  onProgress(1, seconds);
  onEnd == null ? void 0 : onEnd(1, seconds);
}
class DependencyContext {
  static collectPromise(promise, initialValue = null) {
    const handle = {
      promise,
      value: initialValue,
      stack: new Error().stack
    };
    const context = this.collectionStack.at(-1);
    if (context) {
      handle.owner = context.owner;
    }
    promise.then((value) => {
      handle.value = value;
      context == null ? void 0 : context.markDirty();
    });
    this.promises.push(handle);
    return handle;
  }
  static hasPromises() {
    return this.promises.length > 0;
  }
  static async consumePromises() {
    const promises = [...this.promises];
    await Promise.all(promises.map((handle) => handle.promise));
    this.promises = this.promises.filter((v) => !promises.includes(v));
    return promises;
  }
  constructor(owner) {
    this.owner = owner;
    this.dependencies = /* @__PURE__ */ new Set();
    this.event = new FlagDispatcher();
    this.markDirty = () => this.event.raise();
    this.invokable = this.invoke.bind(this);
    Object.defineProperty(this.invokable, "context", {
      value: this
    });
    Object.defineProperty(this.invokable, "toPromise", {
      value: this.toPromise.bind(this)
    });
  }
  invoke() {
  }
  startCollecting() {
    if (DependencyContext.collectionSet.has(this)) {
      throw new DetailedError("A circular dependency occurred between signals.", `This can happen when signals reference each other in a loop.
        Try using the attached stack trace to locate said loop.`);
    }
    DependencyContext.collectionSet.add(this);
    DependencyContext.collectionStack.push(this);
  }
  finishCollecting() {
    DependencyContext.collectionSet.delete(this);
    if (DependencyContext.collectionStack.pop() !== this) {
      throw new Error("collectStart/collectEnd was called out of order.");
    }
  }
  clearDependencies() {
    this.dependencies.forEach((dep) => dep.unsubscribe(this.markDirty));
    this.dependencies.clear();
  }
  collect() {
    const signal2 = DependencyContext.collectionStack.at(-1);
    if (signal2) {
      signal2.dependencies.add(this.event.subscribable);
      this.event.subscribe(signal2.markDirty);
    }
  }
  dispose() {
    this.clearDependencies();
    this.event.clear();
    this.owner = null;
  }
  async toPromise() {
    do {
      await DependencyContext.consumePromises();
      this.invokable();
    } while (DependencyContext.hasPromises());
    return this.invokable;
  }
}
DependencyContext.collectionSet = /* @__PURE__ */ new Set();
DependencyContext.collectionStack = [];
DependencyContext.promises = [];
const DEFAULT = Symbol.for("@motion-canvas/core/signals/default");
function isReactive(value) {
  return typeof value === "function";
}
function modify(value, modification) {
  return isReactive(value) ? () => modification(value()) : modification(value);
}
function unwrap(value) {
  return isReactive(value) ? value() : value;
}
class SignalContext extends DependencyContext {
  constructor(initial2, interpolation2, owner = void 0, parser2 = (value) => value, extensions = {}) {
    super(owner);
    this.initial = initial2;
    this.interpolation = interpolation2;
    this.parser = parser2;
    this.tweening = false;
    Object.defineProperty(this.invokable, "reset", {
      value: this.reset.bind(this)
    });
    Object.defineProperty(this.invokable, "save", {
      value: this.save.bind(this)
    });
    Object.defineProperty(this.invokable, "isInitial", {
      value: this.isInitial.bind(this)
    });
    if (this.initial !== void 0) {
      this.current = this.initial;
      this.markDirty();
      if (!isReactive(this.initial)) {
        this.last = this.parse(this.initial);
      }
    }
    this.extensions = {
      getter: this.getter.bind(this),
      setter: this.setter.bind(this),
      tweener: this.tweener.bind(this),
      ...extensions
    };
  }
  toSignal() {
    return this.invokable;
  }
  parse(value) {
    return this.parser(value);
  }
  set(value) {
    this.extensions.setter(value);
    return this.owner;
  }
  setter(value) {
    if (value === DEFAULT) {
      value = this.initial;
    }
    if (this.current === value) {
      return this.owner;
    }
    this.current = value;
    this.clearDependencies();
    if (!isReactive(value)) {
      this.last = this.parse(value);
    }
    this.markDirty();
    return this.owner;
  }
  get() {
    return this.extensions.getter();
  }
  getter() {
    var _a2;
    if (this.event.isRaised() && isReactive(this.current)) {
      this.clearDependencies();
      this.startCollecting();
      try {
        this.last = this.parse(this.current());
      } catch (e) {
        useLogger().error({
          ...errorToLog(e),
          inspect: (_a2 = this.owner) == null ? void 0 : _a2.key
        });
      }
      this.finishCollecting();
    }
    this.event.reset();
    this.collect();
    return this.last;
  }
  invoke(value, duration, timingFunction = easeInOutCubic, interpolationFunction = this.interpolation) {
    if (value === void 0) {
      return this.get();
    }
    if (duration === void 0) {
      return this.set(value);
    }
    const queue = this.createQueue(timingFunction, interpolationFunction);
    return queue.to(value, duration);
  }
  createQueue(defaultTimingFunction, defaultInterpolationFunction) {
    const initial2 = this.get();
    const queue = [];
    const task = run("animation chain", function* animate() {
      while (queue.length > 0) {
        yield* queue.shift();
      }
    });
    task.to = (value, duration, timingFunction = defaultTimingFunction, interpolationFunction = defaultInterpolationFunction) => {
      defaultTimingFunction = timingFunction;
      defaultInterpolationFunction = interpolationFunction;
      queue.push(this.tween(value, duration, timingFunction, interpolationFunction));
      return task;
    };
    task.back = (time, timingFunction = defaultTimingFunction, interpolationFunction = defaultInterpolationFunction) => {
      defaultTimingFunction = timingFunction;
      defaultInterpolationFunction = interpolationFunction;
      queue.push(this.tween(initial2, time, defaultTimingFunction, defaultInterpolationFunction));
      return task;
    };
    task.wait = (duration) => {
      queue.push(waitFor(duration));
      return task;
    };
    task.run = (generator) => {
      queue.push(generator);
      return task;
    };
    task.do = (callback) => {
      queue.push(run(function* () {
        callback();
      }));
      return task;
    };
    return task;
  }
  *tween(value, duration, timingFunction, interpolationFunction) {
    if (value === DEFAULT) {
      value = this.initial;
    }
    this.tweening = true;
    yield* this.extensions.tweener(value, duration, timingFunction, interpolationFunction);
    this.set(value);
    this.tweening = false;
  }
  *tweener(value, duration, timingFunction, interpolationFunction) {
    const from = this.get();
    yield* tween(duration, (v) => {
      this.set(interpolationFunction(from, this.parse(unwrap(value)), timingFunction(v)));
    });
  }
  dispose() {
    super.dispose();
    this.initial = void 0;
    this.current = void 0;
    this.last = void 0;
  }
  /**
   * Reset the signal to its initial value (if one has been set).
   *
   * @example
   * ```ts
   * const signal = createSignal(7);
   *
   * signal.reset();
   * // same as:
   * signal(7);
   * ```
   */
  reset() {
    if (this.initial !== void 0) {
      this.set(this.initial);
    }
    return this.owner;
  }
  /**
   * Compute the current value of the signal and immediately set it.
   *
   * @remarks
   * This method can be used to stop the signal from updating while keeping its
   * current value.
   *
   * @example
   * ```ts
   * signal.save();
   * // same as:
   * signal(signal());
   * ```
   */
  save() {
    return this.set(this.get());
  }
  /**
   * Check if the signal is currently using its initial value.
   *
   * @example
   * ```ts
   *
   * const signal = createSignal(0);
   * signal.isInitial(); // true
   *
   * signal(5);
   * signal.isInitial(); // false
   *
   * signal(DEFAULT);
   * signal.isInitial(); // true
   * ```
   */
  isInitial() {
    this.collect();
    return this.current === this.initial;
  }
  /**
   * Get the initial value of this signal.
   */
  getInitial() {
    return this.initial;
  }
  /**
   * Get the raw value of this signal.
   *
   * @remarks
   * If the signal was provided with a factory function, the function itself
   * will be returned, without invoking it.
   *
   * This method can be used to create copies of signals.
   *
   * @example
   * ```ts
   * const a = createSignal(2);
   * const b = createSignal(() => a);
   * // b() == 2
   *
   * const bClone = createSignal(b.raw());
   * // bClone() == 2
   *
   * a(4);
   * // b() == 4
   * // bClone() == 4
   * ```
   */
  raw() {
    return this.current;
  }
  /**
   * Is the signal undergoing a tween?
   */
  isTweening() {
    return this.tweening;
  }
}
class CompoundSignalContext extends SignalContext {
  constructor(entries, parser2, initial2, interpolation2, owner = void 0, extensions = {}) {
    var _a2;
    super(void 0, interpolation2, owner, parser2, extensions);
    this.entries = entries;
    this.signals = [];
    this.parser = parser2;
    for (const entry of entries) {
      let key;
      let signal2;
      if (Array.isArray(entry)) {
        [key, signal2] = entry;
        (_a2 = signal2.context).owner ?? (_a2.owner = this);
      } else {
        key = entry;
        signal2 = new SignalContext(modify(initial2, (value) => parser2(value)[entry]), map, owner ?? this.invokable).toSignal();
      }
      this.signals.push([key, signal2]);
      Object.defineProperty(this.invokable, key, { value: signal2 });
    }
  }
  toSignal() {
    return this.invokable;
  }
  parse(value) {
    return this.parser(value);
  }
  getter() {
    return this.parse(Object.fromEntries(this.signals.map(([key, property]) => [key, property()])));
  }
  setter(value) {
    if (isReactive(value)) {
      for (const [key, property] of this.signals) {
        property(() => this.parser(value())[key]);
      }
    } else {
      const parsed = this.parse(value);
      for (const [key, property] of this.signals) {
        property(parsed[key]);
      }
    }
    return this.owner;
  }
  reset() {
    for (const [, signal2] of this.signals) {
      signal2.reset();
    }
    return this.owner;
  }
  save() {
    for (const [, signal2] of this.signals) {
      signal2.save();
    }
    return this.owner;
  }
  isInitial() {
    for (const [, signal2] of this.signals) {
      if (!signal2.isInitial()) {
        return false;
      }
    }
    return true;
  }
  raw() {
    return Object.fromEntries(this.signals.map(([key, property]) => [key, property.context.raw()]));
  }
}
class ComputedContext extends DependencyContext {
  constructor(factory, owner) {
    super(owner);
    this.factory = factory;
    this.markDirty();
  }
  toSignal() {
    return this.invokable;
  }
  dispose() {
    super.dispose();
    this.last = void 0;
  }
  invoke(...args) {
    var _a2;
    if (this.event.isRaised()) {
      this.clearDependencies();
      this.startCollecting();
      try {
        this.last = this.factory(...args);
      } catch (e) {
        useLogger().error({
          ...errorToLog(e),
          inspect: (_a2 = this.owner) == null ? void 0 : _a2.key
        });
      }
      this.finishCollecting();
    }
    this.event.reset();
    this.collect();
    return this.last;
  }
}
class Vector2SignalContext extends CompoundSignalContext {
  constructor(entries, parser2, initial2, interpolation2, owner = void 0, extensions = {}) {
    super(entries, parser2, initial2, interpolation2, owner, extensions);
    Object.defineProperty(this.invokable, "edit", {
      value: this.edit.bind(this)
    });
    Object.defineProperty(this.invokable, "mul", {
      value: this.mul.bind(this)
    });
    Object.defineProperty(this.invokable, "div", {
      value: this.div.bind(this)
    });
    Object.defineProperty(this.invokable, "add", {
      value: this.add.bind(this)
    });
    Object.defineProperty(this.invokable, "sub", {
      value: this.sub.bind(this)
    });
    Object.defineProperty(this.invokable, "dot", {
      value: this.dot.bind(this)
    });
    Object.defineProperty(this.invokable, "cross", {
      value: this.cross.bind(this)
    });
    Object.defineProperty(this.invokable, "mod", {
      value: this.mod.bind(this)
    });
  }
  toSignal() {
    return this.invokable;
  }
  edit(callback, duration, timingFunction, interpolationFunction) {
    const newValue = callback(this.get());
    return this.invoke(newValue, duration, timingFunction, interpolationFunction);
  }
  mul(value, duration, timingFunction, interpolationFunction) {
    const callback = (current) => current.mul(value);
    if (duration === void 0)
      return this.edit(callback);
    return this.edit(callback, duration, timingFunction, interpolationFunction);
  }
  div(value, duration, timingFunction, interpolationFunction) {
    const callback = (current) => current.div(value);
    if (duration === void 0)
      return this.edit(callback);
    return this.edit(callback, duration, timingFunction, interpolationFunction);
  }
  add(value, duration, timingFunction, interpolationFunction) {
    const callback = (current) => current.add(value);
    if (duration === void 0)
      return this.edit(callback);
    return this.edit(callback, duration, timingFunction, interpolationFunction);
  }
  sub(value, duration, timingFunction, interpolationFunction) {
    const callback = (current) => current.sub(value);
    if (duration === void 0)
      return this.edit(callback);
    return this.edit(callback, duration, timingFunction, interpolationFunction);
  }
  dot(value, duration, timingFunction, interpolationFunction) {
    const callback = (current) => current.dot(value);
    if (duration === void 0)
      return this.edit(callback);
    return this.edit(callback, duration, timingFunction, interpolationFunction);
  }
  cross(value, duration, timingFunction, interpolationFunction) {
    const callback = (current) => current.cross(value);
    if (duration === void 0)
      return this.edit(callback);
    return this.edit(callback, duration, timingFunction, interpolationFunction);
  }
  mod(value, duration, timingFunction, interpolationFunction) {
    const callback = (current) => current.mod(value);
    if (duration === void 0)
      return this.edit(callback);
    return this.edit(callback, duration, timingFunction, interpolationFunction);
  }
}
function createComputed(factory, owner) {
  return new ComputedContext(factory, owner).toSignal();
}
function createSignal(initial2, interpolation2 = deepLerp, owner) {
  return new SignalContext(initial2, interpolation2, owner).toSignal();
}
class Spacing {
  static createSignal(initial2, interpolation2 = Spacing.lerp) {
    return new CompoundSignalContext(["top", "right", "bottom", "left"], (value) => new Spacing(value), initial2, interpolation2).toSignal();
  }
  static lerp(from, to, value) {
    return new Spacing(map(from.top, to.top, value), map(from.right, to.right, value), map(from.bottom, to.bottom, value), map(from.left, to.left, value));
  }
  get x() {
    return this.left + this.right;
  }
  get y() {
    return this.top + this.bottom;
  }
  constructor(one = 0, two, three, four) {
    this.top = 0;
    this.right = 0;
    this.bottom = 0;
    this.left = 0;
    if (one === void 0 || one === null) {
      return;
    }
    if (Array.isArray(one)) {
      four = one[3];
      three = one[2];
      two = one[1];
      one = one[0];
    }
    if (typeof one === "number") {
      this.top = one;
      this.right = two !== void 0 ? two : one;
      this.bottom = three !== void 0 ? three : one;
      this.left = four !== void 0 ? four : two !== void 0 ? two : one;
      return;
    }
    this.top = one.top;
    this.right = one.right;
    this.bottom = one.bottom;
    this.left = one.left;
  }
  lerp(to, value) {
    return Spacing.lerp(this, to, value);
  }
  scale(value) {
    return new Spacing(this.top * value, this.right * value, this.bottom * value, this.left * value);
  }
  addScalar(value) {
    return new Spacing(this.top + value, this.right + value, this.bottom + value, this.left + value);
  }
  toSymbol() {
    return Spacing.symbol;
  }
  toString() {
    return `Spacing(${this.top}, ${this.right}, ${this.bottom}, ${this.left})`;
  }
  toUniform(gl, location) {
    gl.uniform4f(location, this.top, this.right, this.bottom, this.left);
  }
  serialize() {
    return {
      top: this.top,
      right: this.right,
      bottom: this.bottom,
      left: this.left
    };
  }
}
Spacing.symbol = Symbol.for("@motion-canvas/core/types/Spacing");
const EPSILON = 1e-6;
class Matrix2D {
  static fromRotation(angle) {
    return Matrix2D.identity.rotate(angle);
  }
  static fromTranslation(translation) {
    return Matrix2D.identity.translate(new Vector2(translation));
  }
  static fromScaling(scale) {
    return Matrix2D.identity.scale(new Vector2(scale));
  }
  get x() {
    return new Vector2(this.values[0], this.values[1]);
  }
  get y() {
    return new Vector2(this.values[2], this.values[3]);
  }
  get scaleX() {
    return this.values[0];
  }
  set scaleX(value) {
    this.values[0] = this.x.normalized.scale(value).x;
  }
  get skewX() {
    return this.values[1];
  }
  set skewX(value) {
    this.values[1] = value;
  }
  get scaleY() {
    return this.values[3];
  }
  set scaleY(value) {
    this.values[3] = this.y.normalized.scale(value).y;
  }
  get skewY() {
    return this.values[2];
  }
  set skewY(value) {
    this.values[2] = value;
  }
  get translateX() {
    return this.values[4];
  }
  set translateX(value) {
    this.values[4] = value;
  }
  get translateY() {
    return this.values[5];
  }
  set translateY(value) {
    this.values[5] = value;
  }
  get rotation() {
    return Vector2.degrees(this.values[0], this.values[1]);
  }
  set rotation(angle) {
    const result = this.rotate(angle - this.rotation);
    this.values[0] = result.values[0];
    this.values[1] = result.values[1];
    this.values[2] = result.values[2];
    this.values[3] = result.values[3];
  }
  get translation() {
    return new Vector2(this.values[4], this.values[5]);
  }
  set translation(translation) {
    const vec = new Vector2(translation);
    this.values[4] = vec.x;
    this.values[5] = vec.y;
  }
  get scaling() {
    return new Vector2(this.values[0], this.values[3]);
  }
  set scaling(value) {
    const scale = new Vector2(value);
    const x = new Vector2(this.values[0], this.values[1]).normalized;
    const y = new Vector2(this.values[2], this.values[3]).normalized;
    this.values[0] = x.x * scale.x;
    this.values[1] = x.y * scale.y;
    this.values[2] = y.x * scale.x;
    this.values[3] = y.y * scale.y;
  }
  /**
   * Get the inverse of the matrix.
   *
   * @remarks
   * If the matrix is not invertible, i.e. its determinant is `0`, this will
   * return `null`, instead.
   *
   * @example
   * ```ts
   * const matrix = new Matrix2D(
   *   [1, 2],
   *   [3, 4],
   *   [5, 6],
   * );
   *
   * const inverse = matrix.inverse;
   * // => Matrix2D(
   * //      [-2, 1],
   * //      [1.5, -0.5],
   * //      [1, -2],
   * //   )
   * ```
   */
  get inverse() {
    const aa = this.values[0], ab = this.values[1], ac = this.values[2], ad = this.values[3];
    const atx = this.values[4], aty = this.values[5];
    let det = aa * ad - ab * ac;
    if (!det) {
      return null;
    }
    det = 1 / det;
    return new Matrix2D(ad * det, -ab * det, -ac * det, aa * det, (ac * aty - ad * atx) * det, (ab * atx - aa * aty) * det);
  }
  /**
   * Get the determinant of the matrix.
   */
  get determinant() {
    return this.values[0] * this.values[3] - this.values[1] * this.values[2];
  }
  get domMatrix() {
    return new DOMMatrix([
      this.values[0],
      this.values[1],
      this.values[2],
      this.values[3],
      this.values[4],
      this.values[5]
    ]);
  }
  constructor(a, b, c, d, tx, ty) {
    this.values = new Float32Array(6);
    if (arguments.length === 0) {
      this.values = new Float32Array([1, 0, 0, 1, 0, 0]);
      return;
    }
    if (arguments.length === 6) {
      this.values[0] = a;
      this.values[1] = b;
      this.values[2] = c;
      this.values[3] = d;
      this.values[4] = tx;
      this.values[5] = ty;
      return;
    }
    if (a instanceof DOMMatrix) {
      this.values[0] = a.m11;
      this.values[1] = a.m12;
      this.values[2] = a.m21;
      this.values[3] = a.m22;
      this.values[4] = a.m41;
      this.values[5] = a.m42;
      return;
    }
    if (a instanceof Matrix2D) {
      this.values = a.values;
      return;
    }
    if (Array.isArray(a)) {
      if (a.length === 2) {
        this.values[0] = a[0];
        this.values[1] = a[1];
        this.values[2] = b[0];
        this.values[3] = b[1];
        this.values[4] = c[0];
        this.values[5] = c[1];
        return;
      }
      if (a.length === 3) {
        const x2 = new Vector2(a[0]);
        const y2 = new Vector2(a[1]);
        const z2 = new Vector2(a[2]);
        this.values[0] = x2.x;
        this.values[1] = x2.y;
        this.values[2] = y2.x;
        this.values[3] = y2.y;
        this.values[4] = z2.x;
        this.values[5] = z2.y;
        return;
      }
      this.values[0] = a[0];
      this.values[1] = a[1];
      this.values[2] = a[2];
      this.values[3] = a[3];
      this.values[4] = a[4];
      this.values[5] = a[5];
      return;
    }
    const x = new Vector2(a);
    const y = new Vector2(b);
    const z = new Vector2(c);
    this.values[0] = x.x;
    this.values[1] = x.y;
    this.values[2] = y.x;
    this.values[3] = y.y;
    this.values[4] = z.x;
    this.values[5] = z.y;
  }
  /**
   * Get the nth component vector of the matrix. Only defined for 0, 1, and 2.
   *
   * @example
   * ```ts
   * const matrix = new Matrix2D(
   *   [1, 0],
   *   [0, 0],
   *   [1, 0],
   * );
   *
   * const x = matrix.column(0);
   * // Vector2(1, 0)
   *
   * const y = matrix.column(1);
   * // Vector2(0, 0)
   *
   * const z = matrix.column(1);
   * // Vector2(1, 0)
   * ```
   *
   * @param index - The index of the component vector to retrieve.
   */
  column(index) {
    return new Vector2(this.values[index * 2], this.values[index * 2 + 1]);
  }
  /**
   * Returns the nth row of the matrix. Only defined for 0 and 1.
   *
   * @example
   * ```ts
   * const matrix = new Matrix2D(
   *   [1, 0],
   *   [0, 0],
   *   [1, 0],
   * );
   *
   * const firstRow = matrix.column(0);
   * // [1, 0, 1]
   *
   * const secondRow = matrix.column(1);
   * // [0, 0, 0]
   * ```
   *
   * @param index - The index of the row to retrieve.
   */
  row(index) {
    return [this.values[index], this.values[index + 2], this.values[index + 4]];
  }
  /**
   * Returns the matrix product of this matrix with the provided matrix.
   *
   * @remarks
   * This method returns a new matrix representing the result of the
   * computation. It will not modify the source matrix.
   *
   * @example
   * ```ts
   * const a = new Matrix2D(
   *   [1, 2],
   *   [0, 1],
   *   [1, 1],
   * );
   * const b = new Matrix2D(
   *   [2, 1],
   *   [1, 1],
   *   [1, 1],
   * );
   *
   * const result = a.mul(b);
   * // => Matrix2D(
   * //     [2, 5],
   * //     [1, 3],
   * //     [2, 4],
   * //   )
   * ```
   *
   * @param other - The matrix to multiply with
   */
  mul(other) {
    const a0 = this.values[0], a1 = this.values[1], a2 = this.values[2], a3 = this.values[3], a4 = this.values[4], a5 = this.values[5];
    const b0 = other.values[0], b1 = other.values[1], b2 = other.values[2], b3 = other.values[3], b4 = other.values[4], b5 = other.values[5];
    return new Matrix2D(a0 * b0 + a2 * b1, a1 * b0 + a3 * b1, a0 * b2 + a2 * b3, a1 * b2 + a3 * b3, a0 * b4 + a2 * b5 + a4, a1 * b4 + a3 * b5 + a5);
  }
  /**
   * Rotate the matrix by the provided angle. By default, the angle is
   * provided in degrees.
   *
   * @remarks
   * This method returns a new matrix representing the result of the
   * computation. It will not modify the source matrix.
   *
   * @example
   * ```ts
   * const a = new Matrix2D(
   *   [1, 2],
   *   [3, 4],
   *   [5, 6],
   * );
   *
   * const result = a.rotate(90);
   * // => Matrix2D(
   * //     [3, 4],
   * //     [-1, -2],
   * //     [5, 6],
   * //   )
   *
   * // Provide the angle in radians
   * const result = a.rotate(Math.PI * 0.5, true);
   * // => Matrix2D(
   * //     [3, 4],
   * //     [-1, -2],
   * //     [5, 6],
   * //   )
   * ```
   *
   * @param angle - The angle by which to rotate the matrix.
   * @param degrees - Whether the angle is provided in degrees.
   */
  rotate(angle, degrees = true) {
    if (degrees) {
      angle *= DEG2RAD;
    }
    const a0 = this.values[0], a1 = this.values[1], a2 = this.values[2], a3 = this.values[3], a4 = this.values[4], a5 = this.values[5];
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    return new Matrix2D(a0 * c + a2 * s, a1 * c + a3 * s, a0 * -s + a2 * c, a1 * -s + a3 * c, a4, a5);
  }
  /**
   * Scale the x and y component vectors of the matrix.
   *
   * @remarks
   * If `vec` is provided as a vector, the x and y component vectors of the
   * matrix will be scaled by the x and y parts of the vector, respectively.
   *
   * If `vec` is provided as a scalar, the x and y component vectors will be
   * scaled uniformly by this factor.
   *
   * This method returns a new matrix representing the result of the
   * computation. It will not modify the source matrix.
   *
   * @example
   * ```ts
   * const matrix = new Matrix2D(
   *   [1, 2],
   *   [3, 4],
   *   [5, 6],
   * );
   *
   * const result1 = matrix.scale([2, 3]);
   * // => new Matrix2D(
   * //      [2, 4],
   * //      [9, 12],
   * //      [5, 6],
   * //    )
   *
   * const result2 = matrix.scale(2);
   * // => new Matrix2D(
   * //      [2, 4],
   * //      [6, 8],
   * //      [5, 6],
   * //    )
   * ```
   *
   * @param vec - The factor by which to scale the matrix
   */
  scale(vec) {
    const v = new Vector2(vec);
    return new Matrix2D(this.values[0] * v.x, this.values[1] * v.x, this.values[2] * v.y, this.values[3] * v.y, this.values[4], this.values[5]);
  }
  /**
   * Multiply each value of the matrix by a scalar.
   *
   * * @example
   * ```ts
   * const matrix = new Matrix2D(
   *   [1, 2],
   *   [3, 4],
   *   [5, 6],
   * );
   *
   * const result1 = matrix.mulScalar(2);
   * // => new Matrix2D(
   * //      [2, 4],
   * //      [6, 8],
   * //      [10, 12],
   * //    )
   * ```
   *
   * @param s - The value by which to scale each term
   */
  mulScalar(s) {
    return new Matrix2D(this.values[0] * s, this.values[1] * s, this.values[2] * s, this.values[3] * s, this.values[4] * s, this.values[5] * s);
  }
  /**
   * Translate the matrix by the dimensions of the provided vector.
   *
   * @remarks
   * If `vec` is provided as a scalar, matrix will be translated uniformly
   * by this factor.
   *
   * This method returns a new matrix representing the result of the
   * computation. It will not modify the source matrix.
   *
   * @example
   * ```ts
   * const matrix = new Matrix2D(
   *   [1, 2],
   *   [3, 4],
   *   [5, 6],
   * );
   *
   * const result1 = matrix.translate([2, 3]);
   * // => new Matrix2D(
   * //      [1, 2],
   * //      [3, 4],
   * //      [16, 22],
   * //    )
   *
   * const result2 = matrix.translate(2);
   * // => new Matrix2D(
   * //      [1, 2],
   * //      [3, 4],
   * //      [13, 18],
   * //    )
   * ```
   *
   * @param vec - The vector by which to translate the matrix
   */
  translate(vec) {
    const v = new Vector2(vec);
    return new Matrix2D(this.values[0], this.values[1], this.values[2], this.values[3], this.values[0] * v.x + this.values[2] * v.y + this.values[4], this.values[1] * v.x + this.values[3] * v.y + this.values[5]);
  }
  /**
   * Add the provided matrix to this matrix.
   *
   * @remarks
   * This method returns a new matrix representing the result of the
   * computation. It will not modify the source matrix.
   *
   * @example
   * ```ts
   * const a = new Matrix2D(
   *   [1, 2],
   *   [3, 4],
   *   [5, 6],
   * );
   * const a = new Matrix2D(
   *   [7, 8],
   *   [9, 10],
   *   [11, 12],
   * );
   *
   * const result = a.add(b);
   * // => Matrix2D(
   * //      [8, 10],
   * //      [12, 14],
   * //      [16, 18],
   * //    )
   * ```
   *
   * @param other - The matrix to add
   */
  add(other) {
    return new Matrix2D(this.values[0] + other.values[0], this.values[1] + other.values[1], this.values[2] + other.values[2], this.values[3] + other.values[3], this.values[4] + other.values[4], this.values[5] + other.values[5]);
  }
  /**
   * Subtract the provided matrix from this matrix.
   *
   * @remarks
   * This method returns a new matrix representing the result of the
   * computation. It will not modify the source matrix.
   *
   * @example
   * ```ts
   * const a = new Matrix2D(
   *   [1, 2],
   *   [3, 4],
   *   [5, 6],
   * );
   * const a = new Matrix2D(
   *   [7, 8],
   *   [9, 10],
   *   [11, 12],
   * );
   *
   * const result = a.sub(b);
   * // => Matrix2D(
   * //      [-6, -6],
   * //      [-6, -6],
   * //      [-6, -6],
   * //    )
   * ```
   *
   * @param other - The matrix to subract
   */
  sub(other) {
    return new Matrix2D(this.values[0] - other.values[0], this.values[1] - other.values[1], this.values[2] - other.values[2], this.values[3] - other.values[3], this.values[4] - other.values[4], this.values[5] - other.values[5]);
  }
  toSymbol() {
    return Matrix2D.symbol;
  }
  toUniform(gl, location) {
    gl.uniformMatrix3fv(location, false, [
      this.values[0],
      this.values[1],
      0,
      this.values[2],
      this.values[3],
      0,
      this.values[4],
      this.values[5],
      1
    ]);
  }
  equals(other, threshold = EPSILON) {
    return Math.abs(this.values[0] - other.values[0]) <= threshold + Number.EPSILON && Math.abs(this.values[1] - other.values[1]) <= threshold + Number.EPSILON && Math.abs(this.values[2] - other.values[2]) <= threshold + Number.EPSILON && Math.abs(this.values[3] - other.values[3]) <= threshold + Number.EPSILON && Math.abs(this.values[4] - other.values[4]) <= threshold + Number.EPSILON && Math.abs(this.values[5] - other.values[5]) <= threshold + Number.EPSILON;
  }
  exactlyEquals(other) {
    return this.values[0] === other.values[0] && this.values[1] === other.values[1] && this.values[2] === other.values[2] && this.values[3] === other.values[3] && this.values[4] === other.values[4] && this.values[5] === other.values[5];
  }
}
Matrix2D.symbol = Symbol.for("@motion-canvas/core/types/Matrix2D");
Matrix2D.identity = new Matrix2D(1, 0, 0, 1, 0, 0);
Matrix2D.zero = new Matrix2D(0, 0, 0, 0, 0, 0);
var Center;
(function(Center2) {
  Center2[Center2["Vertical"] = 1] = "Vertical";
  Center2[Center2["Horizontal"] = 2] = "Horizontal";
})(Center || (Center = {}));
var Direction;
(function(Direction2) {
  Direction2[Direction2["Top"] = 4] = "Top";
  Direction2[Direction2["Bottom"] = 8] = "Bottom";
  Direction2[Direction2["Left"] = 16] = "Left";
  Direction2[Direction2["Right"] = 32] = "Right";
})(Direction || (Direction = {}));
var Origin;
(function(Origin2) {
  Origin2[Origin2["Middle"] = 3] = "Middle";
  Origin2[Origin2["Top"] = 5] = "Top";
  Origin2[Origin2["Bottom"] = 9] = "Bottom";
  Origin2[Origin2["Left"] = 18] = "Left";
  Origin2[Origin2["Right"] = 34] = "Right";
  Origin2[Origin2["TopLeft"] = 20] = "TopLeft";
  Origin2[Origin2["TopRight"] = 36] = "TopRight";
  Origin2[Origin2["BottomLeft"] = 24] = "BottomLeft";
  Origin2[Origin2["BottomRight"] = 40] = "BottomRight";
})(Origin || (Origin = {}));
function originToOffset(origin) {
  if (origin === Origin.Middle) {
    return Vector2.zero;
  }
  let x = 0;
  if (origin & Direction.Left) {
    x = -1;
  } else if (origin & Direction.Right) {
    x = 1;
  }
  let y = 0;
  if (origin & Direction.Top) {
    y = -1;
  } else if (origin & Direction.Bottom) {
    y = 1;
  }
  return new Vector2(x, y);
}
class Vector2 {
  static createSignal(initial2, interpolation2 = Vector2.lerp, owner) {
    return new Vector2SignalContext(["x", "y"], (value) => new Vector2(value), initial2, interpolation2, owner).toSignal();
  }
  static lerp(from, to, value) {
    let valueX;
    let valueY;
    if (typeof value === "number") {
      valueX = valueY = value;
    } else {
      valueX = value.x;
      valueY = value.y;
    }
    return new Vector2(map(from.x, to.x, valueX), map(from.y, to.y, valueY));
  }
  static arcLerp(from, to, value, reverse = false, ratio) {
    ratio ?? (ratio = from.sub(to).ctg);
    return Vector2.lerp(from, to, arcLerp(value, reverse, ratio));
  }
  static createArcLerp(reverse, ratio) {
    return (from, to, value) => Vector2.arcLerp(from, to, value, reverse, ratio);
  }
  /**
   * Interpolates between two vectors on the polar plane by interpolating
   * the angles and magnitudes of the vectors individually.
   *
   * @param from - The starting vector.
   * @param to - The target vector.
   * @param value - The t-value of the interpolation.
   * @param counterclockwise - Whether the vector should get rotated
   *                           counterclockwise. Defaults to `false`.
   * @param origin - The center of rotation. Defaults to the origin.
   *
   * @remarks
   * This function is useful when used in conjunction with {@link rotate} to
   * animate an object's position on a circular arc (see examples).
   *
   * @example
   * Animating an object in a circle around the origin
   * ```tsx
   * circle().position(
   *   circle().position().rotate(180),
   *   1,
   *   easeInOutCubic,
   *   Vector2.polarLerp
   * );
   * ```
   * @example
   * Rotating an object around the point `[-200, 100]`
   * ```ts
   * circle().position(
   *   circle().position().rotate(180, [-200, 100]),
   *   1,
   *   easeInOutCubic,
   *   Vector2.createPolarLerp(false, [-200, 100]),
   * );
   * ```
   * @example
   * Rotating an object counterclockwise around the origin
   * ```ts
   * circle().position(
   *   circle().position().rotate(180),
   *   1,
   *   easeInOutCubic,
   *   Vector2.createPolarLerp(true),
   * );
   * ```
   */
  static polarLerp(from, to, value, counterclockwise = false, origin = Vector2.zero) {
    from = from.sub(origin);
    to = to.sub(origin);
    const fromAngle = from.degrees;
    let toAngle = to.degrees;
    const isCounterclockwise = fromAngle > toAngle;
    if (isCounterclockwise !== counterclockwise) {
      toAngle = toAngle + (counterclockwise ? -360 : 360);
    }
    const angle = map(fromAngle, toAngle, value) * DEG2RAD;
    const magnitude = map(from.magnitude, to.magnitude, value);
    return new Vector2(magnitude * Math.cos(angle) + origin.x, magnitude * Math.sin(angle) + origin.y);
  }
  /**
   * Helper function to create a {@link Vector2.polarLerp} interpolation
   * function with additional parameters.
   *
   * @param counterclockwise - Whether the point should get rotated
   *                           counterclockwise.
   * @param center - The center of rotation. Defaults to the origin.
   */
  static createPolarLerp(counterclockwise = false, center = Vector2.zero) {
    return (from, to, value) => Vector2.polarLerp(from, to, value, counterclockwise, new Vector2(center));
  }
  static fromOrigin(origin) {
    const position = new Vector2();
    if (origin === Origin.Middle) {
      return position;
    }
    if (origin & Direction.Left) {
      position.x = -1;
    } else if (origin & Direction.Right) {
      position.x = 1;
    }
    if (origin & Direction.Top) {
      position.y = -1;
    } else if (origin & Direction.Bottom) {
      position.y = 1;
    }
    return position;
  }
  static fromScalar(value) {
    return new Vector2(value, value);
  }
  static fromRadians(radians) {
    return new Vector2(Math.cos(radians), Math.sin(radians));
  }
  static fromDegrees(degrees) {
    return Vector2.fromRadians(degrees * DEG2RAD);
  }
  /**
   * Return the angle in radians between the vector described by x and y and the
   * positive x-axis.
   *
   * @param x - The x component of the vector.
   * @param y - The y component of the vector.
   */
  static radians(x, y) {
    return Math.atan2(y, x);
  }
  /**
   * Return the angle in degrees between the vector described by x and y and the
   * positive x-axis.
   *
   * @param x - The x component of the vector.
   * @param y - The y component of the vector.
   *
   * @remarks
   * The returned angle will be between -180 and 180 degrees.
   */
  static degrees(x, y) {
    return Vector2.radians(x, y) * RAD2DEG;
  }
  static magnitude(x, y) {
    return Math.sqrt(x * x + y * y);
  }
  static squaredMagnitude(x, y) {
    return x * x + y * y;
  }
  static angleBetween(u, v) {
    return Math.acos(clamp(-1, 1, u.dot(v) / (u.magnitude * v.magnitude))) * (u.cross(v) >= 0 ? 1 : -1);
  }
  get width() {
    return this.x;
  }
  set width(value) {
    this.x = value;
  }
  get height() {
    return this.y;
  }
  set height(value) {
    this.y = value;
  }
  get magnitude() {
    return Vector2.magnitude(this.x, this.y);
  }
  get squaredMagnitude() {
    return Vector2.squaredMagnitude(this.x, this.y);
  }
  get normalized() {
    return this.scale(1 / Vector2.magnitude(this.x, this.y));
  }
  get safe() {
    return new Vector2(isNaN(this.x) ? 0 : this.x, isNaN(this.y) ? 0 : this.y);
  }
  get flipped() {
    return new Vector2(-this.x, -this.y);
  }
  get floored() {
    return new Vector2(Math.floor(this.x), Math.floor(this.y));
  }
  get rounded() {
    return new Vector2(Math.round(this.x), Math.round(this.y));
  }
  get ceiled() {
    return new Vector2(Math.ceil(this.x), Math.ceil(this.y));
  }
  get perpendicular() {
    return new Vector2(this.y, -this.x);
  }
  /**
   * Return the angle in radians between the vector and the positive x-axis.
   */
  get radians() {
    return Vector2.radians(this.x, this.y);
  }
  /**
   * Return the angle in degrees between the vector and the positive x-axis.
   *
   * @remarks
   * The returned angle will be between -180 and 180 degrees.
   */
  get degrees() {
    return Vector2.degrees(this.x, this.y);
  }
  get ctg() {
    return this.x / this.y;
  }
  constructor(one, two) {
    this.x = 0;
    this.y = 0;
    if (one === void 0 || one === null) {
      return;
    }
    if (typeof one !== "object") {
      this.x = one;
      this.y = two ?? one;
      return;
    }
    if (Array.isArray(one)) {
      this.x = one[0];
      this.y = one[1];
      return;
    }
    if ("width" in one) {
      this.x = one.width;
      this.y = one.height;
      return;
    }
    this.x = one.x;
    this.y = one.y;
  }
  lerp(to, value) {
    return Vector2.lerp(this, to, value);
  }
  getOriginOffset(origin) {
    const offset = Vector2.fromOrigin(origin);
    offset.x *= this.x / 2;
    offset.y *= this.y / 2;
    return offset;
  }
  scale(value) {
    return new Vector2(this.x * value, this.y * value);
  }
  transformAsPoint(matrix) {
    const m = new Matrix2D(matrix);
    return new Vector2(this.x * m.scaleX + this.y * m.skewY + m.translateX, this.x * m.skewX + this.y * m.scaleY + m.translateY);
  }
  transform(matrix) {
    const m = new Matrix2D(matrix);
    return new Vector2(this.x * m.scaleX + this.y * m.skewY, this.x * m.skewX + this.y * m.scaleY);
  }
  mul(possibleVector) {
    const vector = new Vector2(possibleVector);
    return new Vector2(this.x * vector.x, this.y * vector.y);
  }
  div(possibleVector) {
    const vector = new Vector2(possibleVector);
    return new Vector2(this.x / vector.x, this.y / vector.y);
  }
  add(possibleVector) {
    const vector = new Vector2(possibleVector);
    return new Vector2(this.x + vector.x, this.y + vector.y);
  }
  sub(possibleVector) {
    const vector = new Vector2(possibleVector);
    return new Vector2(this.x - vector.x, this.y - vector.y);
  }
  dot(possibleVector) {
    const vector = new Vector2(possibleVector);
    return this.x * vector.x + this.y * vector.y;
  }
  cross(possibleVector) {
    const vector = new Vector2(possibleVector);
    return this.x * vector.y - this.y * vector.x;
  }
  mod(possibleVector) {
    const vector = new Vector2(possibleVector);
    return new Vector2(this.x % vector.x, this.y % vector.y);
  }
  /**
   * Rotate the vector around a point by the provided angle.
   *
   * @param angle - The angle by which to rotate in degrees.
   * @param center - The center of rotation. Defaults to the origin.
   */
  rotate(angle, center = Vector2.zero) {
    const originVector = new Vector2(center);
    const matrix = Matrix2D.fromTranslation(originVector).rotate(angle).translate(originVector.flipped);
    return this.transformAsPoint(matrix);
  }
  addX(value) {
    return new Vector2(this.x + value, this.y);
  }
  addY(value) {
    return new Vector2(this.x, this.y + value);
  }
  /**
   * Transform the components of the vector.
   *
   * @example
   * Raise the components to the power of 2.
   * ```ts
   * const vector = new Vector2(2, 3);
   * const result = vector.transform(value => value ** 2);
   * ```
   *
   * @param callback - A callback to apply to each component.
   */
  map(callback) {
    return new Vector2(callback(this.x, 0), callback(this.y, 1));
  }
  toSymbol() {
    return Vector2.symbol;
  }
  toString() {
    return `Vector2(${this.x}, ${this.y})`;
  }
  toArray() {
    return [this.x, this.y];
  }
  toUniform(gl, location) {
    gl.uniform2f(location, this.x, this.y);
  }
  serialize() {
    return { x: this.x, y: this.y };
  }
  /**
   * Check if two vectors are exactly equal to each other.
   *
   * @remarks
   * If you need to compensate for floating point inaccuracies, use the
   * {@link equals} method, instead.
   *
   * @param other - The vector to compare.
   */
  exactlyEquals(other) {
    return this.x === other.x && this.y === other.y;
  }
  /**
   * Check if two vectors are equal to each other.
   *
   * @remarks
   * This method allows passing an allowed error margin when comparing vectors
   * to compensate for floating point inaccuracies. To check if two vectors are
   * exactly equal, use the {@link exactlyEquals} method, instead.
   *
   * @param other - The vector to compare.
   * @param threshold - The allowed error threshold when comparing the vectors.
   */
  equals(other, threshold = EPSILON) {
    return Math.abs(this.x - other.x) <= threshold + Number.EPSILON && Math.abs(this.y - other.y) <= threshold + Number.EPSILON;
  }
  *[Symbol.iterator]() {
    yield this.x;
    yield this.y;
  }
}
Vector2.symbol = Symbol.for("@motion-canvas/core/types/Vector2");
Vector2.zero = new Vector2();
Vector2.one = new Vector2(1, 1);
Vector2.right = new Vector2(1, 0);
Vector2.left = new Vector2(-1, 0);
Vector2.up = new Vector2(0, 1);
Vector2.down = new Vector2(0, -1);
Vector2.top = new Vector2(0, -1);
Vector2.bottom = new Vector2(0, 1);
Vector2.topLeft = new Vector2(-1, -1);
Vector2.topRight = new Vector2(1, -1);
Vector2.bottomLeft = new Vector2(-1, 1);
Vector2.bottomRight = new Vector2(1, 1);
class BBox {
  static createSignal(initial2, interpolation2 = BBox.lerp) {
    return new CompoundSignalContext(["x", "y", "width", "height"], (value) => new BBox(value), initial2, interpolation2).toSignal();
  }
  static lerp(from, to, value) {
    let valueX;
    let valueY;
    let valueWidth;
    let valueHeight;
    if (typeof value === "number") {
      valueX = valueY = valueWidth = valueHeight = value;
    } else if (value instanceof Vector2) {
      valueX = valueWidth = value.x;
      valueY = valueHeight = value.y;
    } else {
      valueX = value.x;
      valueY = value.y;
      valueWidth = value.width;
      valueHeight = value.height;
    }
    return new BBox(map(from.x, to.x, valueX), map(from.y, to.y, valueY), map(from.width, to.width, valueWidth), map(from.height, to.height, valueHeight));
  }
  static arcLerp(from, to, value, reverse = false, ratio) {
    ratio ?? (ratio = (from.position.sub(to.position).ctg + from.size.sub(to.size).ctg) / 2);
    return BBox.lerp(from, to, arcLerp(value, reverse, ratio));
  }
  static fromSizeCentered(size) {
    return new BBox(-size.width / 2, -size.height / 2, size.width, size.height);
  }
  static fromPoints(...points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (point.x > maxX) {
        maxX = point.x;
      }
      if (point.x < minX) {
        minX = point.x;
      }
      if (point.y > maxY) {
        maxY = point.y;
      }
      if (point.y < minY) {
        minY = point.y;
      }
    }
    return new BBox(minX, minY, maxX - minX, maxY - minY);
  }
  static fromBBoxes(...boxes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const box of boxes) {
      const right = box.x + box.width;
      if (right > maxX) {
        maxX = right;
      }
      if (box.x < minX) {
        minX = box.x;
      }
      const bottom = box.y + box.height;
      if (bottom > maxY) {
        maxY = bottom;
      }
      if (box.y < minY) {
        minY = box.y;
      }
    }
    return new BBox(minX, minY, maxX - minX, maxY - minY);
  }
  lerp(to, value) {
    return BBox.lerp(this, to, value);
  }
  get position() {
    return new Vector2(this.x, this.y);
  }
  set position(value) {
    this.x = value.x;
    this.y = value.y;
  }
  get size() {
    return new Vector2(this.width, this.height);
  }
  get center() {
    return new Vector2(this.x + this.width / 2, this.y + this.height / 2);
  }
  get left() {
    return this.x;
  }
  set left(value) {
    this.width += this.x - value;
    this.x = value;
  }
  get right() {
    return this.x + this.width;
  }
  set right(value) {
    this.width = value - this.x;
  }
  get top() {
    return this.y;
  }
  set top(value) {
    this.height += this.y - value;
    this.y = value;
  }
  get bottom() {
    return this.y + this.height;
  }
  set bottom(value) {
    this.height = value - this.y;
  }
  get topLeft() {
    return this.position;
  }
  get topRight() {
    return new Vector2(this.x + this.width, this.y);
  }
  get bottomLeft() {
    return new Vector2(this.x, this.y + this.height);
  }
  get bottomRight() {
    return new Vector2(this.x + this.width, this.y + this.height);
  }
  get corners() {
    return [this.topLeft, this.topRight, this.bottomRight, this.bottomLeft];
  }
  get pixelPerfect() {
    return new BBox(Math.floor(this.x), Math.floor(this.y), Math.ceil(this.width + 1), Math.ceil(this.height + 1));
  }
  constructor(one, two = 0, three = 0, four = 0) {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    if (one === void 0 || one === null) {
      return;
    }
    if (typeof one === "number") {
      this.x = one;
      this.y = two;
      this.width = three;
      this.height = four;
      return;
    }
    if (one instanceof Vector2) {
      this.x = one.x;
      this.y = one.y;
      if (two instanceof Vector2) {
        this.width = two.x;
        this.height = two.y;
      }
      return;
    }
    if (Array.isArray(one)) {
      this.x = one[0];
      this.y = one[1];
      this.width = one[2];
      this.height = one[3];
      return;
    }
    this.x = one.x;
    this.y = one.y;
    this.width = one.width;
    this.height = one.height;
  }
  transform(matrix) {
    return new BBox(this.position.transformAsPoint(matrix), this.size.transform(matrix));
  }
  transformCorners(matrix) {
    return this.corners.map((corner) => corner.transformAsPoint(matrix));
  }
  /**
   * Expand the bounding box to accommodate the given spacing.
   *
   * @param value - The value to expand the bounding box by.
   */
  expand(value) {
    const spacing = new Spacing(value);
    const result = new BBox(this);
    result.left -= spacing.left;
    result.top -= spacing.top;
    result.right += spacing.right;
    result.bottom += spacing.bottom;
    return result;
  }
  /**
   * {@inheritDoc expand}
   *
   * @deprecated Use {@link expand} instead.
   */
  addSpacing(value) {
    return this.expand(value);
  }
  includes(point) {
    return point.x >= this.x && point.x <= this.x + this.width && point.y >= this.y && point.y <= this.y + this.height;
  }
  intersects(other) {
    return this.left < other.right && this.right > other.left && this.top < other.bottom && this.bottom > other.top;
  }
  intersection(other) {
    const bbox = new BBox();
    if (this.intersects(other)) {
      bbox.left = Math.max(this.left, other.left);
      bbox.top = Math.max(this.top, other.top);
      bbox.right = Math.min(this.right, other.right);
      bbox.bottom = Math.min(this.bottom, other.bottom);
    }
    return bbox;
  }
  union(other) {
    const bbox = new BBox();
    bbox.left = Math.min(this.left, other.left);
    bbox.top = Math.min(this.top, other.top);
    bbox.right = Math.max(this.right, other.right);
    bbox.bottom = Math.max(this.bottom, other.bottom);
    return bbox;
  }
  toSymbol() {
    return BBox.symbol;
  }
  toString() {
    return `BBox(${this.x}, ${this.y}, ${this.width}, ${this.height})`;
  }
  toUniform(gl, location) {
    gl.uniform4f(location, this.x, this.y, this.width, this.height);
  }
  serialize() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }
}
BBox.symbol = Symbol.for("@motion-canvas/core/types/Rect");
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
var chroma = { exports: {} };
/**
 * chroma.js - JavaScript library for color conversions
 *
 * Copyright (c) 2011-2019, Gregor Aisch
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. The name Gregor Aisch may not be used to endorse or promote products
 * derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL GREGOR AISCH OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * -------------------------------------------------------
 *
 * chroma.js includes colors from colorbrewer2.org, which are released under
 * the following license:
 *
 * Copyright (c) 2002 Cynthia Brewer, Mark Harrower,
 * and The Pennsylvania State University.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied. See the License for the specific
 * language governing permissions and limitations under the License.
 *
 * ------------------------------------------------------
 *
 * Named colors are taken from X11 Color Names.
 * http://www.w3.org/TR/css3-color/#svg-color
 *
 * @preserve
 */
(function(module, exports$1) {
  (function(global2, factory) {
    module.exports = factory();
  })(commonjsGlobal, function() {
    var limit$2 = function(x, min2, max2) {
      if (min2 === void 0) min2 = 0;
      if (max2 === void 0) max2 = 1;
      return x < min2 ? min2 : x > max2 ? max2 : x;
    };
    var limit$1 = limit$2;
    var clip_rgb$3 = function(rgb2) {
      rgb2._clipped = false;
      rgb2._unclipped = rgb2.slice(0);
      for (var i2 = 0; i2 <= 3; i2++) {
        if (i2 < 3) {
          if (rgb2[i2] < 0 || rgb2[i2] > 255) {
            rgb2._clipped = true;
          }
          rgb2[i2] = limit$1(rgb2[i2], 0, 255);
        } else if (i2 === 3) {
          rgb2[i2] = limit$1(rgb2[i2], 0, 1);
        }
      }
      return rgb2;
    };
    var classToType = {};
    for (var i$1 = 0, list$1 = ["Boolean", "Number", "String", "Function", "Array", "Date", "RegExp", "Undefined", "Null"]; i$1 < list$1.length; i$1 += 1) {
      var name = list$1[i$1];
      classToType["[object " + name + "]"] = name.toLowerCase();
    }
    var type$p = function(obj) {
      return classToType[Object.prototype.toString.call(obj)] || "object";
    };
    var type$o = type$p;
    var unpack$B = function(args, keyOrder) {
      if (keyOrder === void 0) keyOrder = null;
      if (args.length >= 3) {
        return Array.prototype.slice.call(args);
      }
      if (type$o(args[0]) == "object" && keyOrder) {
        return keyOrder.split("").filter(function(k) {
          return args[0][k] !== void 0;
        }).map(function(k) {
          return args[0][k];
        });
      }
      return args[0];
    };
    var type$n = type$p;
    var last$4 = function(args) {
      if (args.length < 2) {
        return null;
      }
      var l = args.length - 1;
      if (type$n(args[l]) == "string") {
        return args[l].toLowerCase();
      }
      return null;
    };
    var PI$2 = Math.PI;
    var utils = {
      clip_rgb: clip_rgb$3,
      limit: limit$2,
      type: type$p,
      unpack: unpack$B,
      last: last$4,
      TWOPI: PI$2 * 2,
      PITHIRD: PI$2 / 3,
      DEG2RAD: PI$2 / 180,
      RAD2DEG: 180 / PI$2
    };
    var input$h = {
      format: {},
      autodetect: []
    };
    var last$3 = utils.last;
    var clip_rgb$2 = utils.clip_rgb;
    var type$m = utils.type;
    var _input = input$h;
    var Color$D = function Color2() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var me = this;
      if (type$m(args[0]) === "object" && args[0].constructor && args[0].constructor === this.constructor) {
        return args[0];
      }
      var mode = last$3(args);
      var autodetect = false;
      if (!mode) {
        autodetect = true;
        if (!_input.sorted) {
          _input.autodetect = _input.autodetect.sort(function(a, b) {
            return b.p - a.p;
          });
          _input.sorted = true;
        }
        for (var i2 = 0, list2 = _input.autodetect; i2 < list2.length; i2 += 1) {
          var chk = list2[i2];
          mode = chk.test.apply(chk, args);
          if (mode) {
            break;
          }
        }
      }
      if (_input.format[mode]) {
        var rgb2 = _input.format[mode].apply(null, autodetect ? args : args.slice(0, -1));
        me._rgb = clip_rgb$2(rgb2);
      } else {
        throw new Error("unknown format: " + args);
      }
      if (me._rgb.length === 3) {
        me._rgb.push(1);
      }
    };
    Color$D.prototype.toString = function toString() {
      if (type$m(this.hex) == "function") {
        return this.hex();
      }
      return "[" + this._rgb.join(",") + "]";
    };
    var Color_1 = Color$D;
    var chroma$k = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(chroma$k.Color, [null].concat(args)))();
    };
    chroma$k.Color = Color_1;
    chroma$k.version = "2.4.2";
    var chroma_1 = chroma$k;
    var unpack$A = utils.unpack;
    var max$2 = Math.max;
    var rgb2cmyk$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$A(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      r = r / 255;
      g = g / 255;
      b = b / 255;
      var k = 1 - max$2(r, max$2(g, b));
      var f = k < 1 ? 1 / (1 - k) : 0;
      var c = (1 - r - k) * f;
      var m = (1 - g - k) * f;
      var y = (1 - b - k) * f;
      return [c, m, y, k];
    };
    var rgb2cmyk_1 = rgb2cmyk$1;
    var unpack$z = utils.unpack;
    var cmyk2rgb = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$z(args, "cmyk");
      var c = args[0];
      var m = args[1];
      var y = args[2];
      var k = args[3];
      var alpha = args.length > 4 ? args[4] : 1;
      if (k === 1) {
        return [0, 0, 0, alpha];
      }
      return [
        c >= 1 ? 0 : 255 * (1 - c) * (1 - k),
        // r
        m >= 1 ? 0 : 255 * (1 - m) * (1 - k),
        // g
        y >= 1 ? 0 : 255 * (1 - y) * (1 - k),
        // b
        alpha
      ];
    };
    var cmyk2rgb_1 = cmyk2rgb;
    var chroma$j = chroma_1;
    var Color$C = Color_1;
    var input$g = input$h;
    var unpack$y = utils.unpack;
    var type$l = utils.type;
    var rgb2cmyk = rgb2cmyk_1;
    Color$C.prototype.cmyk = function() {
      return rgb2cmyk(this._rgb);
    };
    chroma$j.cmyk = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$C, [null].concat(args, ["cmyk"])))();
    };
    input$g.format.cmyk = cmyk2rgb_1;
    input$g.autodetect.push({
      p: 2,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$y(args, "cmyk");
        if (type$l(args) === "array" && args.length === 4) {
          return "cmyk";
        }
      }
    });
    var unpack$x = utils.unpack;
    var last$2 = utils.last;
    var rnd = function(a) {
      return Math.round(a * 100) / 100;
    };
    var hsl2css$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var hsla = unpack$x(args, "hsla");
      var mode = last$2(args) || "lsa";
      hsla[0] = rnd(hsla[0] || 0);
      hsla[1] = rnd(hsla[1] * 100) + "%";
      hsla[2] = rnd(hsla[2] * 100) + "%";
      if (mode === "hsla" || hsla.length > 3 && hsla[3] < 1) {
        hsla[3] = hsla.length > 3 ? hsla[3] : 1;
        mode = "hsla";
      } else {
        hsla.length = 3;
      }
      return mode + "(" + hsla.join(",") + ")";
    };
    var hsl2css_1 = hsl2css$1;
    var unpack$w = utils.unpack;
    var rgb2hsl$3 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$w(args, "rgba");
      var r = args[0];
      var g = args[1];
      var b = args[2];
      r /= 255;
      g /= 255;
      b /= 255;
      var min2 = Math.min(r, g, b);
      var max2 = Math.max(r, g, b);
      var l = (max2 + min2) / 2;
      var s, h;
      if (max2 === min2) {
        s = 0;
        h = Number.NaN;
      } else {
        s = l < 0.5 ? (max2 - min2) / (max2 + min2) : (max2 - min2) / (2 - max2 - min2);
      }
      if (r == max2) {
        h = (g - b) / (max2 - min2);
      } else if (g == max2) {
        h = 2 + (b - r) / (max2 - min2);
      } else if (b == max2) {
        h = 4 + (r - g) / (max2 - min2);
      }
      h *= 60;
      if (h < 0) {
        h += 360;
      }
      if (args.length > 3 && args[3] !== void 0) {
        return [h, s, l, args[3]];
      }
      return [h, s, l];
    };
    var rgb2hsl_1 = rgb2hsl$3;
    var unpack$v = utils.unpack;
    var last$1 = utils.last;
    var hsl2css = hsl2css_1;
    var rgb2hsl$2 = rgb2hsl_1;
    var round$6 = Math.round;
    var rgb2css$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var rgba = unpack$v(args, "rgba");
      var mode = last$1(args) || "rgb";
      if (mode.substr(0, 3) == "hsl") {
        return hsl2css(rgb2hsl$2(rgba), mode);
      }
      rgba[0] = round$6(rgba[0]);
      rgba[1] = round$6(rgba[1]);
      rgba[2] = round$6(rgba[2]);
      if (mode === "rgba" || rgba.length > 3 && rgba[3] < 1) {
        rgba[3] = rgba.length > 3 ? rgba[3] : 1;
        mode = "rgba";
      }
      return mode + "(" + rgba.slice(0, mode === "rgb" ? 3 : 4).join(",") + ")";
    };
    var rgb2css_1 = rgb2css$1;
    var unpack$u = utils.unpack;
    var round$5 = Math.round;
    var hsl2rgb$1 = function() {
      var assign;
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$u(args, "hsl");
      var h = args[0];
      var s = args[1];
      var l = args[2];
      var r, g, b;
      if (s === 0) {
        r = g = b = l * 255;
      } else {
        var t3 = [0, 0, 0];
        var c = [0, 0, 0];
        var t2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var t1 = 2 * l - t2;
        var h_ = h / 360;
        t3[0] = h_ + 1 / 3;
        t3[1] = h_;
        t3[2] = h_ - 1 / 3;
        for (var i2 = 0; i2 < 3; i2++) {
          if (t3[i2] < 0) {
            t3[i2] += 1;
          }
          if (t3[i2] > 1) {
            t3[i2] -= 1;
          }
          if (6 * t3[i2] < 1) {
            c[i2] = t1 + (t2 - t1) * 6 * t3[i2];
          } else if (2 * t3[i2] < 1) {
            c[i2] = t2;
          } else if (3 * t3[i2] < 2) {
            c[i2] = t1 + (t2 - t1) * (2 / 3 - t3[i2]) * 6;
          } else {
            c[i2] = t1;
          }
        }
        assign = [round$5(c[0] * 255), round$5(c[1] * 255), round$5(c[2] * 255)], r = assign[0], g = assign[1], b = assign[2];
      }
      if (args.length > 3) {
        return [r, g, b, args[3]];
      }
      return [r, g, b, 1];
    };
    var hsl2rgb_1 = hsl2rgb$1;
    var hsl2rgb = hsl2rgb_1;
    var input$f = input$h;
    var RE_RGB = /^rgb\(\s*(-?\d+),\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;
    var RE_RGBA = /^rgba\(\s*(-?\d+),\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*([01]|[01]?\.\d+)\)$/;
    var RE_RGB_PCT = /^rgb\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/;
    var RE_RGBA_PCT = /^rgba\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)$/;
    var RE_HSL = /^hsl\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/;
    var RE_HSLA = /^hsla\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)$/;
    var round$4 = Math.round;
    var css2rgb$1 = function(css) {
      css = css.toLowerCase().trim();
      var m;
      if (input$f.format.named) {
        try {
          return input$f.format.named(css);
        } catch (e) {
        }
      }
      if (m = css.match(RE_RGB)) {
        var rgb2 = m.slice(1, 4);
        for (var i2 = 0; i2 < 3; i2++) {
          rgb2[i2] = +rgb2[i2];
        }
        rgb2[3] = 1;
        return rgb2;
      }
      if (m = css.match(RE_RGBA)) {
        var rgb$1 = m.slice(1, 5);
        for (var i$12 = 0; i$12 < 4; i$12++) {
          rgb$1[i$12] = +rgb$1[i$12];
        }
        return rgb$1;
      }
      if (m = css.match(RE_RGB_PCT)) {
        var rgb$2 = m.slice(1, 4);
        for (var i$2 = 0; i$2 < 3; i$2++) {
          rgb$2[i$2] = round$4(rgb$2[i$2] * 2.55);
        }
        rgb$2[3] = 1;
        return rgb$2;
      }
      if (m = css.match(RE_RGBA_PCT)) {
        var rgb$3 = m.slice(1, 5);
        for (var i$3 = 0; i$3 < 3; i$3++) {
          rgb$3[i$3] = round$4(rgb$3[i$3] * 2.55);
        }
        rgb$3[3] = +rgb$3[3];
        return rgb$3;
      }
      if (m = css.match(RE_HSL)) {
        var hsl2 = m.slice(1, 4);
        hsl2[1] *= 0.01;
        hsl2[2] *= 0.01;
        var rgb$4 = hsl2rgb(hsl2);
        rgb$4[3] = 1;
        return rgb$4;
      }
      if (m = css.match(RE_HSLA)) {
        var hsl$1 = m.slice(1, 4);
        hsl$1[1] *= 0.01;
        hsl$1[2] *= 0.01;
        var rgb$5 = hsl2rgb(hsl$1);
        rgb$5[3] = +m[4];
        return rgb$5;
      }
    };
    css2rgb$1.test = function(s) {
      return RE_RGB.test(s) || RE_RGBA.test(s) || RE_RGB_PCT.test(s) || RE_RGBA_PCT.test(s) || RE_HSL.test(s) || RE_HSLA.test(s);
    };
    var css2rgb_1 = css2rgb$1;
    var chroma$i = chroma_1;
    var Color$B = Color_1;
    var input$e = input$h;
    var type$k = utils.type;
    var rgb2css = rgb2css_1;
    var css2rgb = css2rgb_1;
    Color$B.prototype.css = function(mode) {
      return rgb2css(this._rgb, mode);
    };
    chroma$i.css = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$B, [null].concat(args, ["css"])))();
    };
    input$e.format.css = css2rgb;
    input$e.autodetect.push({
      p: 5,
      test: function(h) {
        var rest = [], len = arguments.length - 1;
        while (len-- > 0) rest[len] = arguments[len + 1];
        if (!rest.length && type$k(h) === "string" && css2rgb.test(h)) {
          return "css";
        }
      }
    });
    var Color$A = Color_1;
    var chroma$h = chroma_1;
    var input$d = input$h;
    var unpack$t = utils.unpack;
    input$d.format.gl = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var rgb2 = unpack$t(args, "rgba");
      rgb2[0] *= 255;
      rgb2[1] *= 255;
      rgb2[2] *= 255;
      return rgb2;
    };
    chroma$h.gl = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$A, [null].concat(args, ["gl"])))();
    };
    Color$A.prototype.gl = function() {
      var rgb2 = this._rgb;
      return [rgb2[0] / 255, rgb2[1] / 255, rgb2[2] / 255, rgb2[3]];
    };
    var unpack$s = utils.unpack;
    var rgb2hcg$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$s(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      var min2 = Math.min(r, g, b);
      var max2 = Math.max(r, g, b);
      var delta = max2 - min2;
      var c = delta * 100 / 255;
      var _g = min2 / (255 - delta) * 100;
      var h;
      if (delta === 0) {
        h = Number.NaN;
      } else {
        if (r === max2) {
          h = (g - b) / delta;
        }
        if (g === max2) {
          h = 2 + (b - r) / delta;
        }
        if (b === max2) {
          h = 4 + (r - g) / delta;
        }
        h *= 60;
        if (h < 0) {
          h += 360;
        }
      }
      return [h, c, _g];
    };
    var rgb2hcg_1 = rgb2hcg$1;
    var unpack$r = utils.unpack;
    var floor$3 = Math.floor;
    var hcg2rgb = function() {
      var assign, assign$1, assign$2, assign$3, assign$4, assign$5;
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$r(args, "hcg");
      var h = args[0];
      var c = args[1];
      var _g = args[2];
      var r, g, b;
      _g = _g * 255;
      var _c = c * 255;
      if (c === 0) {
        r = g = b = _g;
      } else {
        if (h === 360) {
          h = 0;
        }
        if (h > 360) {
          h -= 360;
        }
        if (h < 0) {
          h += 360;
        }
        h /= 60;
        var i2 = floor$3(h);
        var f = h - i2;
        var p = _g * (1 - c);
        var q = p + _c * (1 - f);
        var t = p + _c * f;
        var v = p + _c;
        switch (i2) {
          case 0:
            assign = [v, t, p], r = assign[0], g = assign[1], b = assign[2];
            break;
          case 1:
            assign$1 = [q, v, p], r = assign$1[0], g = assign$1[1], b = assign$1[2];
            break;
          case 2:
            assign$2 = [p, v, t], r = assign$2[0], g = assign$2[1], b = assign$2[2];
            break;
          case 3:
            assign$3 = [p, q, v], r = assign$3[0], g = assign$3[1], b = assign$3[2];
            break;
          case 4:
            assign$4 = [t, p, v], r = assign$4[0], g = assign$4[1], b = assign$4[2];
            break;
          case 5:
            assign$5 = [v, p, q], r = assign$5[0], g = assign$5[1], b = assign$5[2];
            break;
        }
      }
      return [r, g, b, args.length > 3 ? args[3] : 1];
    };
    var hcg2rgb_1 = hcg2rgb;
    var unpack$q = utils.unpack;
    var type$j = utils.type;
    var chroma$g = chroma_1;
    var Color$z = Color_1;
    var input$c = input$h;
    var rgb2hcg = rgb2hcg_1;
    Color$z.prototype.hcg = function() {
      return rgb2hcg(this._rgb);
    };
    chroma$g.hcg = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$z, [null].concat(args, ["hcg"])))();
    };
    input$c.format.hcg = hcg2rgb_1;
    input$c.autodetect.push({
      p: 1,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$q(args, "hcg");
        if (type$j(args) === "array" && args.length === 3) {
          return "hcg";
        }
      }
    });
    var unpack$p = utils.unpack;
    var last = utils.last;
    var round$3 = Math.round;
    var rgb2hex$2 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$p(args, "rgba");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      var a = ref[3];
      var mode = last(args) || "auto";
      if (a === void 0) {
        a = 1;
      }
      if (mode === "auto") {
        mode = a < 1 ? "rgba" : "rgb";
      }
      r = round$3(r);
      g = round$3(g);
      b = round$3(b);
      var u = r << 16 | g << 8 | b;
      var str = "000000" + u.toString(16);
      str = str.substr(str.length - 6);
      var hxa = "0" + round$3(a * 255).toString(16);
      hxa = hxa.substr(hxa.length - 2);
      switch (mode.toLowerCase()) {
        case "rgba":
          return "#" + str + hxa;
        case "argb":
          return "#" + hxa + str;
        default:
          return "#" + str;
      }
    };
    var rgb2hex_1 = rgb2hex$2;
    var RE_HEX = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    var RE_HEXA = /^#?([A-Fa-f0-9]{8}|[A-Fa-f0-9]{4})$/;
    var hex2rgb$1 = function(hex) {
      if (hex.match(RE_HEX)) {
        if (hex.length === 4 || hex.length === 7) {
          hex = hex.substr(1);
        }
        if (hex.length === 3) {
          hex = hex.split("");
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        var u = parseInt(hex, 16);
        var r = u >> 16;
        var g = u >> 8 & 255;
        var b = u & 255;
        return [r, g, b, 1];
      }
      if (hex.match(RE_HEXA)) {
        if (hex.length === 5 || hex.length === 9) {
          hex = hex.substr(1);
        }
        if (hex.length === 4) {
          hex = hex.split("");
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        var u$1 = parseInt(hex, 16);
        var r$1 = u$1 >> 24 & 255;
        var g$1 = u$1 >> 16 & 255;
        var b$1 = u$1 >> 8 & 255;
        var a = Math.round((u$1 & 255) / 255 * 100) / 100;
        return [r$1, g$1, b$1, a];
      }
      throw new Error("unknown hex color: " + hex);
    };
    var hex2rgb_1 = hex2rgb$1;
    var chroma$f = chroma_1;
    var Color$y = Color_1;
    var type$i = utils.type;
    var input$b = input$h;
    var rgb2hex$1 = rgb2hex_1;
    Color$y.prototype.hex = function(mode) {
      return rgb2hex$1(this._rgb, mode);
    };
    chroma$f.hex = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$y, [null].concat(args, ["hex"])))();
    };
    input$b.format.hex = hex2rgb_1;
    input$b.autodetect.push({
      p: 4,
      test: function(h) {
        var rest = [], len = arguments.length - 1;
        while (len-- > 0) rest[len] = arguments[len + 1];
        if (!rest.length && type$i(h) === "string" && [3, 4, 5, 6, 7, 8, 9].indexOf(h.length) >= 0) {
          return "hex";
        }
      }
    });
    var unpack$o = utils.unpack;
    var TWOPI$2 = utils.TWOPI;
    var min$2 = Math.min;
    var sqrt$4 = Math.sqrt;
    var acos = Math.acos;
    var rgb2hsi$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$o(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      r /= 255;
      g /= 255;
      b /= 255;
      var h;
      var min_ = min$2(r, g, b);
      var i2 = (r + g + b) / 3;
      var s = i2 > 0 ? 1 - min_ / i2 : 0;
      if (s === 0) {
        h = NaN;
      } else {
        h = (r - g + (r - b)) / 2;
        h /= sqrt$4((r - g) * (r - g) + (r - b) * (g - b));
        h = acos(h);
        if (b > g) {
          h = TWOPI$2 - h;
        }
        h /= TWOPI$2;
      }
      return [h * 360, s, i2];
    };
    var rgb2hsi_1 = rgb2hsi$1;
    var unpack$n = utils.unpack;
    var limit = utils.limit;
    var TWOPI$1 = utils.TWOPI;
    var PITHIRD = utils.PITHIRD;
    var cos$4 = Math.cos;
    var hsi2rgb = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$n(args, "hsi");
      var h = args[0];
      var s = args[1];
      var i2 = args[2];
      var r, g, b;
      if (isNaN(h)) {
        h = 0;
      }
      if (isNaN(s)) {
        s = 0;
      }
      if (h > 360) {
        h -= 360;
      }
      if (h < 0) {
        h += 360;
      }
      h /= 360;
      if (h < 1 / 3) {
        b = (1 - s) / 3;
        r = (1 + s * cos$4(TWOPI$1 * h) / cos$4(PITHIRD - TWOPI$1 * h)) / 3;
        g = 1 - (b + r);
      } else if (h < 2 / 3) {
        h -= 1 / 3;
        r = (1 - s) / 3;
        g = (1 + s * cos$4(TWOPI$1 * h) / cos$4(PITHIRD - TWOPI$1 * h)) / 3;
        b = 1 - (r + g);
      } else {
        h -= 2 / 3;
        g = (1 - s) / 3;
        b = (1 + s * cos$4(TWOPI$1 * h) / cos$4(PITHIRD - TWOPI$1 * h)) / 3;
        r = 1 - (g + b);
      }
      r = limit(i2 * r * 3);
      g = limit(i2 * g * 3);
      b = limit(i2 * b * 3);
      return [r * 255, g * 255, b * 255, args.length > 3 ? args[3] : 1];
    };
    var hsi2rgb_1 = hsi2rgb;
    var unpack$m = utils.unpack;
    var type$h = utils.type;
    var chroma$e = chroma_1;
    var Color$x = Color_1;
    var input$a = input$h;
    var rgb2hsi = rgb2hsi_1;
    Color$x.prototype.hsi = function() {
      return rgb2hsi(this._rgb);
    };
    chroma$e.hsi = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$x, [null].concat(args, ["hsi"])))();
    };
    input$a.format.hsi = hsi2rgb_1;
    input$a.autodetect.push({
      p: 2,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$m(args, "hsi");
        if (type$h(args) === "array" && args.length === 3) {
          return "hsi";
        }
      }
    });
    var unpack$l = utils.unpack;
    var type$g = utils.type;
    var chroma$d = chroma_1;
    var Color$w = Color_1;
    var input$9 = input$h;
    var rgb2hsl$1 = rgb2hsl_1;
    Color$w.prototype.hsl = function() {
      return rgb2hsl$1(this._rgb);
    };
    chroma$d.hsl = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$w, [null].concat(args, ["hsl"])))();
    };
    input$9.format.hsl = hsl2rgb_1;
    input$9.autodetect.push({
      p: 2,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$l(args, "hsl");
        if (type$g(args) === "array" && args.length === 3) {
          return "hsl";
        }
      }
    });
    var unpack$k = utils.unpack;
    var min$1 = Math.min;
    var max$1 = Math.max;
    var rgb2hsl = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$k(args, "rgb");
      var r = args[0];
      var g = args[1];
      var b = args[2];
      var min_ = min$1(r, g, b);
      var max_ = max$1(r, g, b);
      var delta = max_ - min_;
      var h, s, v;
      v = max_ / 255;
      if (max_ === 0) {
        h = Number.NaN;
        s = 0;
      } else {
        s = delta / max_;
        if (r === max_) {
          h = (g - b) / delta;
        }
        if (g === max_) {
          h = 2 + (b - r) / delta;
        }
        if (b === max_) {
          h = 4 + (r - g) / delta;
        }
        h *= 60;
        if (h < 0) {
          h += 360;
        }
      }
      return [h, s, v];
    };
    var rgb2hsv$1 = rgb2hsl;
    var unpack$j = utils.unpack;
    var floor$2 = Math.floor;
    var hsv2rgb = function() {
      var assign, assign$1, assign$2, assign$3, assign$4, assign$5;
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$j(args, "hsv");
      var h = args[0];
      var s = args[1];
      var v = args[2];
      var r, g, b;
      v *= 255;
      if (s === 0) {
        r = g = b = v;
      } else {
        if (h === 360) {
          h = 0;
        }
        if (h > 360) {
          h -= 360;
        }
        if (h < 0) {
          h += 360;
        }
        h /= 60;
        var i2 = floor$2(h);
        var f = h - i2;
        var p = v * (1 - s);
        var q = v * (1 - s * f);
        var t = v * (1 - s * (1 - f));
        switch (i2) {
          case 0:
            assign = [v, t, p], r = assign[0], g = assign[1], b = assign[2];
            break;
          case 1:
            assign$1 = [q, v, p], r = assign$1[0], g = assign$1[1], b = assign$1[2];
            break;
          case 2:
            assign$2 = [p, v, t], r = assign$2[0], g = assign$2[1], b = assign$2[2];
            break;
          case 3:
            assign$3 = [p, q, v], r = assign$3[0], g = assign$3[1], b = assign$3[2];
            break;
          case 4:
            assign$4 = [t, p, v], r = assign$4[0], g = assign$4[1], b = assign$4[2];
            break;
          case 5:
            assign$5 = [v, p, q], r = assign$5[0], g = assign$5[1], b = assign$5[2];
            break;
        }
      }
      return [r, g, b, args.length > 3 ? args[3] : 1];
    };
    var hsv2rgb_1 = hsv2rgb;
    var unpack$i = utils.unpack;
    var type$f = utils.type;
    var chroma$c = chroma_1;
    var Color$v = Color_1;
    var input$8 = input$h;
    var rgb2hsv = rgb2hsv$1;
    Color$v.prototype.hsv = function() {
      return rgb2hsv(this._rgb);
    };
    chroma$c.hsv = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$v, [null].concat(args, ["hsv"])))();
    };
    input$8.format.hsv = hsv2rgb_1;
    input$8.autodetect.push({
      p: 2,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$i(args, "hsv");
        if (type$f(args) === "array" && args.length === 3) {
          return "hsv";
        }
      }
    });
    var labConstants = {
      // Corresponds roughly to RGB brighter/darker
      Kn: 18,
      // D65 standard referent
      Xn: 0.95047,
      Yn: 1,
      Zn: 1.08883,
      t0: 0.137931034,
      // 4 / 29
      t1: 0.206896552,
      // 6 / 29
      t2: 0.12841855,
      // 3 * t1 * t1
      t3: 8856452e-9
      // t1 * t1 * t1
    };
    var LAB_CONSTANTS$3 = labConstants;
    var unpack$h = utils.unpack;
    var pow$a = Math.pow;
    var rgb2lab$2 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$h(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      var ref$1 = rgb2xyz(r, g, b);
      var x = ref$1[0];
      var y = ref$1[1];
      var z = ref$1[2];
      var l = 116 * y - 16;
      return [l < 0 ? 0 : l, 500 * (x - y), 200 * (y - z)];
    };
    var rgb_xyz = function(r) {
      if ((r /= 255) <= 0.04045) {
        return r / 12.92;
      }
      return pow$a((r + 0.055) / 1.055, 2.4);
    };
    var xyz_lab = function(t) {
      if (t > LAB_CONSTANTS$3.t3) {
        return pow$a(t, 1 / 3);
      }
      return t / LAB_CONSTANTS$3.t2 + LAB_CONSTANTS$3.t0;
    };
    var rgb2xyz = function(r, g, b) {
      r = rgb_xyz(r);
      g = rgb_xyz(g);
      b = rgb_xyz(b);
      var x = xyz_lab((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / LAB_CONSTANTS$3.Xn);
      var y = xyz_lab((0.2126729 * r + 0.7151522 * g + 0.072175 * b) / LAB_CONSTANTS$3.Yn);
      var z = xyz_lab((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / LAB_CONSTANTS$3.Zn);
      return [x, y, z];
    };
    var rgb2lab_1 = rgb2lab$2;
    var LAB_CONSTANTS$2 = labConstants;
    var unpack$g = utils.unpack;
    var pow$9 = Math.pow;
    var lab2rgb$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$g(args, "lab");
      var l = args[0];
      var a = args[1];
      var b = args[2];
      var x, y, z, r, g, b_;
      y = (l + 16) / 116;
      x = isNaN(a) ? y : y + a / 500;
      z = isNaN(b) ? y : y - b / 200;
      y = LAB_CONSTANTS$2.Yn * lab_xyz(y);
      x = LAB_CONSTANTS$2.Xn * lab_xyz(x);
      z = LAB_CONSTANTS$2.Zn * lab_xyz(z);
      r = xyz_rgb(3.2404542 * x - 1.5371385 * y - 0.4985314 * z);
      g = xyz_rgb(-0.969266 * x + 1.8760108 * y + 0.041556 * z);
      b_ = xyz_rgb(0.0556434 * x - 0.2040259 * y + 1.0572252 * z);
      return [r, g, b_, args.length > 3 ? args[3] : 1];
    };
    var xyz_rgb = function(r) {
      return 255 * (r <= 304e-5 ? 12.92 * r : 1.055 * pow$9(r, 1 / 2.4) - 0.055);
    };
    var lab_xyz = function(t) {
      return t > LAB_CONSTANTS$2.t1 ? t * t * t : LAB_CONSTANTS$2.t2 * (t - LAB_CONSTANTS$2.t0);
    };
    var lab2rgb_1 = lab2rgb$1;
    var unpack$f = utils.unpack;
    var type$e = utils.type;
    var chroma$b = chroma_1;
    var Color$u = Color_1;
    var input$7 = input$h;
    var rgb2lab$1 = rgb2lab_1;
    Color$u.prototype.lab = function() {
      return rgb2lab$1(this._rgb);
    };
    chroma$b.lab = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$u, [null].concat(args, ["lab"])))();
    };
    input$7.format.lab = lab2rgb_1;
    input$7.autodetect.push({
      p: 2,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$f(args, "lab");
        if (type$e(args) === "array" && args.length === 3) {
          return "lab";
        }
      }
    });
    var unpack$e = utils.unpack;
    var RAD2DEG2 = utils.RAD2DEG;
    var sqrt$3 = Math.sqrt;
    var atan2$2 = Math.atan2;
    var round$2 = Math.round;
    var lab2lch$2 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$e(args, "lab");
      var l = ref[0];
      var a = ref[1];
      var b = ref[2];
      var c = sqrt$3(a * a + b * b);
      var h = (atan2$2(b, a) * RAD2DEG2 + 360) % 360;
      if (round$2(c * 1e4) === 0) {
        h = Number.NaN;
      }
      return [l, c, h];
    };
    var lab2lch_1 = lab2lch$2;
    var unpack$d = utils.unpack;
    var rgb2lab = rgb2lab_1;
    var lab2lch$1 = lab2lch_1;
    var rgb2lch$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$d(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      var ref$1 = rgb2lab(r, g, b);
      var l = ref$1[0];
      var a = ref$1[1];
      var b_ = ref$1[2];
      return lab2lch$1(l, a, b_);
    };
    var rgb2lch_1 = rgb2lch$1;
    var unpack$c = utils.unpack;
    var DEG2RAD2 = utils.DEG2RAD;
    var sin$3 = Math.sin;
    var cos$3 = Math.cos;
    var lch2lab$2 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$c(args, "lch");
      var l = ref[0];
      var c = ref[1];
      var h = ref[2];
      if (isNaN(h)) {
        h = 0;
      }
      h = h * DEG2RAD2;
      return [l, cos$3(h) * c, sin$3(h) * c];
    };
    var lch2lab_1 = lch2lab$2;
    var unpack$b = utils.unpack;
    var lch2lab$1 = lch2lab_1;
    var lab2rgb = lab2rgb_1;
    var lch2rgb$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$b(args, "lch");
      var l = args[0];
      var c = args[1];
      var h = args[2];
      var ref = lch2lab$1(l, c, h);
      var L = ref[0];
      var a = ref[1];
      var b_ = ref[2];
      var ref$1 = lab2rgb(L, a, b_);
      var r = ref$1[0];
      var g = ref$1[1];
      var b = ref$1[2];
      return [r, g, b, args.length > 3 ? args[3] : 1];
    };
    var lch2rgb_1 = lch2rgb$1;
    var unpack$a = utils.unpack;
    var lch2rgb = lch2rgb_1;
    var hcl2rgb = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var hcl = unpack$a(args, "hcl").reverse();
      return lch2rgb.apply(void 0, hcl);
    };
    var hcl2rgb_1 = hcl2rgb;
    var unpack$9 = utils.unpack;
    var type$d = utils.type;
    var chroma$a = chroma_1;
    var Color$t = Color_1;
    var input$6 = input$h;
    var rgb2lch = rgb2lch_1;
    Color$t.prototype.lch = function() {
      return rgb2lch(this._rgb);
    };
    Color$t.prototype.hcl = function() {
      return rgb2lch(this._rgb).reverse();
    };
    chroma$a.lch = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$t, [null].concat(args, ["lch"])))();
    };
    chroma$a.hcl = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$t, [null].concat(args, ["hcl"])))();
    };
    input$6.format.lch = lch2rgb_1;
    input$6.format.hcl = hcl2rgb_1;
    ["lch", "hcl"].forEach(function(m) {
      return input$6.autodetect.push({
        p: 2,
        test: function() {
          var args = [], len = arguments.length;
          while (len--) args[len] = arguments[len];
          args = unpack$9(args, m);
          if (type$d(args) === "array" && args.length === 3) {
            return m;
          }
        }
      });
    });
    var w3cx11$1 = {
      aliceblue: "#f0f8ff",
      antiquewhite: "#faebd7",
      aqua: "#00ffff",
      aquamarine: "#7fffd4",
      azure: "#f0ffff",
      beige: "#f5f5dc",
      bisque: "#ffe4c4",
      black: "#000000",
      blanchedalmond: "#ffebcd",
      blue: "#0000ff",
      blueviolet: "#8a2be2",
      brown: "#a52a2a",
      burlywood: "#deb887",
      cadetblue: "#5f9ea0",
      chartreuse: "#7fff00",
      chocolate: "#d2691e",
      coral: "#ff7f50",
      cornflower: "#6495ed",
      cornflowerblue: "#6495ed",
      cornsilk: "#fff8dc",
      crimson: "#dc143c",
      cyan: "#00ffff",
      darkblue: "#00008b",
      darkcyan: "#008b8b",
      darkgoldenrod: "#b8860b",
      darkgray: "#a9a9a9",
      darkgreen: "#006400",
      darkgrey: "#a9a9a9",
      darkkhaki: "#bdb76b",
      darkmagenta: "#8b008b",
      darkolivegreen: "#556b2f",
      darkorange: "#ff8c00",
      darkorchid: "#9932cc",
      darkred: "#8b0000",
      darksalmon: "#e9967a",
      darkseagreen: "#8fbc8f",
      darkslateblue: "#483d8b",
      darkslategray: "#2f4f4f",
      darkslategrey: "#2f4f4f",
      darkturquoise: "#00ced1",
      darkviolet: "#9400d3",
      deeppink: "#ff1493",
      deepskyblue: "#00bfff",
      dimgray: "#696969",
      dimgrey: "#696969",
      dodgerblue: "#1e90ff",
      firebrick: "#b22222",
      floralwhite: "#fffaf0",
      forestgreen: "#228b22",
      fuchsia: "#ff00ff",
      gainsboro: "#dcdcdc",
      ghostwhite: "#f8f8ff",
      gold: "#ffd700",
      goldenrod: "#daa520",
      gray: "#808080",
      green: "#008000",
      greenyellow: "#adff2f",
      grey: "#808080",
      honeydew: "#f0fff0",
      hotpink: "#ff69b4",
      indianred: "#cd5c5c",
      indigo: "#4b0082",
      ivory: "#fffff0",
      khaki: "#f0e68c",
      laserlemon: "#ffff54",
      lavender: "#e6e6fa",
      lavenderblush: "#fff0f5",
      lawngreen: "#7cfc00",
      lemonchiffon: "#fffacd",
      lightblue: "#add8e6",
      lightcoral: "#f08080",
      lightcyan: "#e0ffff",
      lightgoldenrod: "#fafad2",
      lightgoldenrodyellow: "#fafad2",
      lightgray: "#d3d3d3",
      lightgreen: "#90ee90",
      lightgrey: "#d3d3d3",
      lightpink: "#ffb6c1",
      lightsalmon: "#ffa07a",
      lightseagreen: "#20b2aa",
      lightskyblue: "#87cefa",
      lightslategray: "#778899",
      lightslategrey: "#778899",
      lightsteelblue: "#b0c4de",
      lightyellow: "#ffffe0",
      lime: "#00ff00",
      limegreen: "#32cd32",
      linen: "#faf0e6",
      magenta: "#ff00ff",
      maroon: "#800000",
      maroon2: "#7f0000",
      maroon3: "#b03060",
      mediumaquamarine: "#66cdaa",
      mediumblue: "#0000cd",
      mediumorchid: "#ba55d3",
      mediumpurple: "#9370db",
      mediumseagreen: "#3cb371",
      mediumslateblue: "#7b68ee",
      mediumspringgreen: "#00fa9a",
      mediumturquoise: "#48d1cc",
      mediumvioletred: "#c71585",
      midnightblue: "#191970",
      mintcream: "#f5fffa",
      mistyrose: "#ffe4e1",
      moccasin: "#ffe4b5",
      navajowhite: "#ffdead",
      navy: "#000080",
      oldlace: "#fdf5e6",
      olive: "#808000",
      olivedrab: "#6b8e23",
      orange: "#ffa500",
      orangered: "#ff4500",
      orchid: "#da70d6",
      palegoldenrod: "#eee8aa",
      palegreen: "#98fb98",
      paleturquoise: "#afeeee",
      palevioletred: "#db7093",
      papayawhip: "#ffefd5",
      peachpuff: "#ffdab9",
      peru: "#cd853f",
      pink: "#ffc0cb",
      plum: "#dda0dd",
      powderblue: "#b0e0e6",
      purple: "#800080",
      purple2: "#7f007f",
      purple3: "#a020f0",
      rebeccapurple: "#663399",
      red: "#ff0000",
      rosybrown: "#bc8f8f",
      royalblue: "#4169e1",
      saddlebrown: "#8b4513",
      salmon: "#fa8072",
      sandybrown: "#f4a460",
      seagreen: "#2e8b57",
      seashell: "#fff5ee",
      sienna: "#a0522d",
      silver: "#c0c0c0",
      skyblue: "#87ceeb",
      slateblue: "#6a5acd",
      slategray: "#708090",
      slategrey: "#708090",
      snow: "#fffafa",
      springgreen: "#00ff7f",
      steelblue: "#4682b4",
      tan: "#d2b48c",
      teal: "#008080",
      thistle: "#d8bfd8",
      tomato: "#ff6347",
      turquoise: "#40e0d0",
      violet: "#ee82ee",
      wheat: "#f5deb3",
      white: "#ffffff",
      whitesmoke: "#f5f5f5",
      yellow: "#ffff00",
      yellowgreen: "#9acd32"
    };
    var w3cx11_1 = w3cx11$1;
    var Color$s = Color_1;
    var input$5 = input$h;
    var type$c = utils.type;
    var w3cx11 = w3cx11_1;
    var hex2rgb = hex2rgb_1;
    var rgb2hex = rgb2hex_1;
    Color$s.prototype.name = function() {
      var hex = rgb2hex(this._rgb, "rgb");
      for (var i2 = 0, list2 = Object.keys(w3cx11); i2 < list2.length; i2 += 1) {
        var n = list2[i2];
        if (w3cx11[n] === hex) {
          return n.toLowerCase();
        }
      }
      return hex;
    };
    input$5.format.named = function(name2) {
      name2 = name2.toLowerCase();
      if (w3cx11[name2]) {
        return hex2rgb(w3cx11[name2]);
      }
      throw new Error("unknown color name: " + name2);
    };
    input$5.autodetect.push({
      p: 5,
      test: function(h) {
        var rest = [], len = arguments.length - 1;
        while (len-- > 0) rest[len] = arguments[len + 1];
        if (!rest.length && type$c(h) === "string" && w3cx11[h.toLowerCase()]) {
          return "named";
        }
      }
    });
    var unpack$8 = utils.unpack;
    var rgb2num$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$8(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      return (r << 16) + (g << 8) + b;
    };
    var rgb2num_1 = rgb2num$1;
    var type$b = utils.type;
    var num2rgb = function(num2) {
      if (type$b(num2) == "number" && num2 >= 0 && num2 <= 16777215) {
        var r = num2 >> 16;
        var g = num2 >> 8 & 255;
        var b = num2 & 255;
        return [r, g, b, 1];
      }
      throw new Error("unknown num color: " + num2);
    };
    var num2rgb_1 = num2rgb;
    var chroma$9 = chroma_1;
    var Color$r = Color_1;
    var input$4 = input$h;
    var type$a = utils.type;
    var rgb2num = rgb2num_1;
    Color$r.prototype.num = function() {
      return rgb2num(this._rgb);
    };
    chroma$9.num = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$r, [null].concat(args, ["num"])))();
    };
    input$4.format.num = num2rgb_1;
    input$4.autodetect.push({
      p: 5,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        if (args.length === 1 && type$a(args[0]) === "number" && args[0] >= 0 && args[0] <= 16777215) {
          return "num";
        }
      }
    });
    var chroma$8 = chroma_1;
    var Color$q = Color_1;
    var input$3 = input$h;
    var unpack$7 = utils.unpack;
    var type$9 = utils.type;
    var round$1 = Math.round;
    Color$q.prototype.rgb = function(rnd2) {
      if (rnd2 === void 0) rnd2 = true;
      if (rnd2 === false) {
        return this._rgb.slice(0, 3);
      }
      return this._rgb.slice(0, 3).map(round$1);
    };
    Color$q.prototype.rgba = function(rnd2) {
      if (rnd2 === void 0) rnd2 = true;
      return this._rgb.slice(0, 4).map(function(v, i2) {
        return i2 < 3 ? rnd2 === false ? v : round$1(v) : v;
      });
    };
    chroma$8.rgb = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$q, [null].concat(args, ["rgb"])))();
    };
    input$3.format.rgb = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var rgba = unpack$7(args, "rgba");
      if (rgba[3] === void 0) {
        rgba[3] = 1;
      }
      return rgba;
    };
    input$3.autodetect.push({
      p: 3,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$7(args, "rgba");
        if (type$9(args) === "array" && (args.length === 3 || args.length === 4 && type$9(args[3]) == "number" && args[3] >= 0 && args[3] <= 1)) {
          return "rgb";
        }
      }
    });
    var log$1 = Math.log;
    var temperature2rgb$1 = function(kelvin) {
      var temp = kelvin / 100;
      var r, g, b;
      if (temp < 66) {
        r = 255;
        g = temp < 6 ? 0 : -155.25485562709179 - 0.44596950469579133 * (g = temp - 2) + 104.49216199393888 * log$1(g);
        b = temp < 20 ? 0 : -254.76935184120902 + 0.8274096064007395 * (b = temp - 10) + 115.67994401066147 * log$1(b);
      } else {
        r = 351.97690566805693 + 0.114206453784165 * (r = temp - 55) - 40.25366309332127 * log$1(r);
        g = 325.4494125711974 + 0.07943456536662342 * (g = temp - 50) - 28.0852963507957 * log$1(g);
        b = 255;
      }
      return [r, g, b, 1];
    };
    var temperature2rgb_1 = temperature2rgb$1;
    var temperature2rgb = temperature2rgb_1;
    var unpack$6 = utils.unpack;
    var round = Math.round;
    var rgb2temperature$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var rgb2 = unpack$6(args, "rgb");
      var r = rgb2[0], b = rgb2[2];
      var minTemp = 1e3;
      var maxTemp = 4e4;
      var eps = 0.4;
      var temp;
      while (maxTemp - minTemp > eps) {
        temp = (maxTemp + minTemp) * 0.5;
        var rgb$1 = temperature2rgb(temp);
        if (rgb$1[2] / rgb$1[0] >= b / r) {
          maxTemp = temp;
        } else {
          minTemp = temp;
        }
      }
      return round(temp);
    };
    var rgb2temperature_1 = rgb2temperature$1;
    var chroma$7 = chroma_1;
    var Color$p = Color_1;
    var input$2 = input$h;
    var rgb2temperature = rgb2temperature_1;
    Color$p.prototype.temp = Color$p.prototype.kelvin = Color$p.prototype.temperature = function() {
      return rgb2temperature(this._rgb);
    };
    chroma$7.temp = chroma$7.kelvin = chroma$7.temperature = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$p, [null].concat(args, ["temp"])))();
    };
    input$2.format.temp = input$2.format.kelvin = input$2.format.temperature = temperature2rgb_1;
    var unpack$5 = utils.unpack;
    var cbrt = Math.cbrt;
    var pow$8 = Math.pow;
    var sign$1 = Math.sign;
    var rgb2oklab$2 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$5(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      var ref$1 = [rgb2lrgb(r / 255), rgb2lrgb(g / 255), rgb2lrgb(b / 255)];
      var lr = ref$1[0];
      var lg = ref$1[1];
      var lb = ref$1[2];
      var l = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
      var m = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
      var s = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
      return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
      ];
    };
    var rgb2oklab_1 = rgb2oklab$2;
    function rgb2lrgb(c) {
      var abs2 = Math.abs(c);
      if (abs2 < 0.04045) {
        return c / 12.92;
      }
      return (sign$1(c) || 1) * pow$8((abs2 + 0.055) / 1.055, 2.4);
    }
    var unpack$4 = utils.unpack;
    var pow$7 = Math.pow;
    var sign = Math.sign;
    var oklab2rgb$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$4(args, "lab");
      var L = args[0];
      var a = args[1];
      var b = args[2];
      var l = pow$7(L + 0.3963377774 * a + 0.2158037573 * b, 3);
      var m = pow$7(L - 0.1055613458 * a - 0.0638541728 * b, 3);
      var s = pow$7(L - 0.0894841775 * a - 1.291485548 * b, 3);
      return [
        255 * lrgb2rgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        255 * lrgb2rgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        255 * lrgb2rgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
        args.length > 3 ? args[3] : 1
      ];
    };
    var oklab2rgb_1 = oklab2rgb$1;
    function lrgb2rgb(c) {
      var abs2 = Math.abs(c);
      if (abs2 > 31308e-7) {
        return (sign(c) || 1) * (1.055 * pow$7(abs2, 1 / 2.4) - 0.055);
      }
      return c * 12.92;
    }
    var unpack$3 = utils.unpack;
    var type$8 = utils.type;
    var chroma$6 = chroma_1;
    var Color$o = Color_1;
    var input$1 = input$h;
    var rgb2oklab$1 = rgb2oklab_1;
    Color$o.prototype.oklab = function() {
      return rgb2oklab$1(this._rgb);
    };
    chroma$6.oklab = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$o, [null].concat(args, ["oklab"])))();
    };
    input$1.format.oklab = oklab2rgb_1;
    input$1.autodetect.push({
      p: 3,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack$3(args, "oklab");
        if (type$8(args) === "array" && args.length === 3) {
          return "oklab";
        }
      }
    });
    var unpack$2 = utils.unpack;
    var rgb2oklab = rgb2oklab_1;
    var lab2lch = lab2lch_1;
    var rgb2oklch$1 = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      var ref = unpack$2(args, "rgb");
      var r = ref[0];
      var g = ref[1];
      var b = ref[2];
      var ref$1 = rgb2oklab(r, g, b);
      var l = ref$1[0];
      var a = ref$1[1];
      var b_ = ref$1[2];
      return lab2lch(l, a, b_);
    };
    var rgb2oklch_1 = rgb2oklch$1;
    var unpack$1 = utils.unpack;
    var lch2lab = lch2lab_1;
    var oklab2rgb = oklab2rgb_1;
    var oklch2rgb = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      args = unpack$1(args, "lch");
      var l = args[0];
      var c = args[1];
      var h = args[2];
      var ref = lch2lab(l, c, h);
      var L = ref[0];
      var a = ref[1];
      var b_ = ref[2];
      var ref$1 = oklab2rgb(L, a, b_);
      var r = ref$1[0];
      var g = ref$1[1];
      var b = ref$1[2];
      return [r, g, b, args.length > 3 ? args[3] : 1];
    };
    var oklch2rgb_1 = oklch2rgb;
    var unpack = utils.unpack;
    var type$7 = utils.type;
    var chroma$5 = chroma_1;
    var Color$n = Color_1;
    var input = input$h;
    var rgb2oklch = rgb2oklch_1;
    Color$n.prototype.oklch = function() {
      return rgb2oklch(this._rgb);
    };
    chroma$5.oklch = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      return new (Function.prototype.bind.apply(Color$n, [null].concat(args, ["oklch"])))();
    };
    input.format.oklch = oklch2rgb_1;
    input.autodetect.push({
      p: 3,
      test: function() {
        var args = [], len = arguments.length;
        while (len--) args[len] = arguments[len];
        args = unpack(args, "oklch");
        if (type$7(args) === "array" && args.length === 3) {
          return "oklch";
        }
      }
    });
    var Color$m = Color_1;
    var type$6 = utils.type;
    Color$m.prototype.alpha = function(a, mutate) {
      if (mutate === void 0) mutate = false;
      if (a !== void 0 && type$6(a) === "number") {
        if (mutate) {
          this._rgb[3] = a;
          return this;
        }
        return new Color$m([this._rgb[0], this._rgb[1], this._rgb[2], a], "rgb");
      }
      return this._rgb[3];
    };
    var Color$l = Color_1;
    Color$l.prototype.clipped = function() {
      return this._rgb._clipped || false;
    };
    var Color$k = Color_1;
    var LAB_CONSTANTS$1 = labConstants;
    Color$k.prototype.darken = function(amount) {
      if (amount === void 0) amount = 1;
      var me = this;
      var lab2 = me.lab();
      lab2[0] -= LAB_CONSTANTS$1.Kn * amount;
      return new Color$k(lab2, "lab").alpha(me.alpha(), true);
    };
    Color$k.prototype.brighten = function(amount) {
      if (amount === void 0) amount = 1;
      return this.darken(-amount);
    };
    Color$k.prototype.darker = Color$k.prototype.darken;
    Color$k.prototype.brighter = Color$k.prototype.brighten;
    var Color$j = Color_1;
    Color$j.prototype.get = function(mc) {
      var ref = mc.split(".");
      var mode = ref[0];
      var channel = ref[1];
      var src = this[mode]();
      if (channel) {
        var i2 = mode.indexOf(channel) - (mode.substr(0, 2) === "ok" ? 2 : 0);
        if (i2 > -1) {
          return src[i2];
        }
        throw new Error("unknown channel " + channel + " in mode " + mode);
      } else {
        return src;
      }
    };
    var Color$i = Color_1;
    var type$5 = utils.type;
    var pow$6 = Math.pow;
    var EPS = 1e-7;
    var MAX_ITER = 20;
    Color$i.prototype.luminance = function(lum) {
      if (lum !== void 0 && type$5(lum) === "number") {
        if (lum === 0) {
          return new Color$i([0, 0, 0, this._rgb[3]], "rgb");
        }
        if (lum === 1) {
          return new Color$i([255, 255, 255, this._rgb[3]], "rgb");
        }
        var cur_lum = this.luminance();
        var mode = "rgb";
        var max_iter = MAX_ITER;
        var test = function(low, high) {
          var mid = low.interpolate(high, 0.5, mode);
          var lm = mid.luminance();
          if (Math.abs(lum - lm) < EPS || !max_iter--) {
            return mid;
          }
          return lm > lum ? test(low, mid) : test(mid, high);
        };
        var rgb2 = (cur_lum > lum ? test(new Color$i([0, 0, 0]), this) : test(this, new Color$i([255, 255, 255]))).rgb();
        return new Color$i(rgb2.concat([this._rgb[3]]));
      }
      return rgb2luminance.apply(void 0, this._rgb.slice(0, 3));
    };
    var rgb2luminance = function(r, g, b) {
      r = luminance_x(r);
      g = luminance_x(g);
      b = luminance_x(b);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    var luminance_x = function(x) {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : pow$6((x + 0.055) / 1.055, 2.4);
    };
    var interpolator$1 = {};
    var Color$h = Color_1;
    var type$4 = utils.type;
    var interpolator = interpolator$1;
    var mix$1 = function(col1, col2, f) {
      if (f === void 0) f = 0.5;
      var rest = [], len = arguments.length - 3;
      while (len-- > 0) rest[len] = arguments[len + 3];
      var mode = rest[0] || "lrgb";
      if (!interpolator[mode] && !rest.length) {
        mode = Object.keys(interpolator)[0];
      }
      if (!interpolator[mode]) {
        throw new Error("interpolation mode " + mode + " is not defined");
      }
      if (type$4(col1) !== "object") {
        col1 = new Color$h(col1);
      }
      if (type$4(col2) !== "object") {
        col2 = new Color$h(col2);
      }
      return interpolator[mode](col1, col2, f).alpha(col1.alpha() + f * (col2.alpha() - col1.alpha()));
    };
    var Color$g = Color_1;
    var mix = mix$1;
    Color$g.prototype.mix = Color$g.prototype.interpolate = function(col2, f) {
      if (f === void 0) f = 0.5;
      var rest = [], len = arguments.length - 2;
      while (len-- > 0) rest[len] = arguments[len + 2];
      return mix.apply(void 0, [this, col2, f].concat(rest));
    };
    var Color$f = Color_1;
    Color$f.prototype.premultiply = function(mutate) {
      if (mutate === void 0) mutate = false;
      var rgb2 = this._rgb;
      var a = rgb2[3];
      if (mutate) {
        this._rgb = [rgb2[0] * a, rgb2[1] * a, rgb2[2] * a, a];
        return this;
      } else {
        return new Color$f([rgb2[0] * a, rgb2[1] * a, rgb2[2] * a, a], "rgb");
      }
    };
    var Color$e = Color_1;
    var LAB_CONSTANTS = labConstants;
    Color$e.prototype.saturate = function(amount) {
      if (amount === void 0) amount = 1;
      var me = this;
      var lch2 = me.lch();
      lch2[1] += LAB_CONSTANTS.Kn * amount;
      if (lch2[1] < 0) {
        lch2[1] = 0;
      }
      return new Color$e(lch2, "lch").alpha(me.alpha(), true);
    };
    Color$e.prototype.desaturate = function(amount) {
      if (amount === void 0) amount = 1;
      return this.saturate(-amount);
    };
    var Color$d = Color_1;
    var type$3 = utils.type;
    Color$d.prototype.set = function(mc, value, mutate) {
      if (mutate === void 0) mutate = false;
      var ref = mc.split(".");
      var mode = ref[0];
      var channel = ref[1];
      var src = this[mode]();
      if (channel) {
        var i2 = mode.indexOf(channel) - (mode.substr(0, 2) === "ok" ? 2 : 0);
        if (i2 > -1) {
          if (type$3(value) == "string") {
            switch (value.charAt(0)) {
              case "+":
                src[i2] += +value;
                break;
              case "-":
                src[i2] += +value;
                break;
              case "*":
                src[i2] *= +value.substr(1);
                break;
              case "/":
                src[i2] /= +value.substr(1);
                break;
              default:
                src[i2] = +value;
            }
          } else if (type$3(value) === "number") {
            src[i2] = value;
          } else {
            throw new Error("unsupported value for Color.set");
          }
          var out = new Color$d(src, mode);
          if (mutate) {
            this._rgb = out._rgb;
            return this;
          }
          return out;
        }
        throw new Error("unknown channel " + channel + " in mode " + mode);
      } else {
        return src;
      }
    };
    var Color$c = Color_1;
    var rgb = function(col1, col2, f) {
      var xyz0 = col1._rgb;
      var xyz1 = col2._rgb;
      return new Color$c(
        xyz0[0] + f * (xyz1[0] - xyz0[0]),
        xyz0[1] + f * (xyz1[1] - xyz0[1]),
        xyz0[2] + f * (xyz1[2] - xyz0[2]),
        "rgb"
      );
    };
    interpolator$1.rgb = rgb;
    var Color$b = Color_1;
    var sqrt$2 = Math.sqrt;
    var pow$5 = Math.pow;
    var lrgb = function(col1, col2, f) {
      var ref = col1._rgb;
      var x1 = ref[0];
      var y1 = ref[1];
      var z1 = ref[2];
      var ref$1 = col2._rgb;
      var x2 = ref$1[0];
      var y2 = ref$1[1];
      var z2 = ref$1[2];
      return new Color$b(
        sqrt$2(pow$5(x1, 2) * (1 - f) + pow$5(x2, 2) * f),
        sqrt$2(pow$5(y1, 2) * (1 - f) + pow$5(y2, 2) * f),
        sqrt$2(pow$5(z1, 2) * (1 - f) + pow$5(z2, 2) * f),
        "rgb"
      );
    };
    interpolator$1.lrgb = lrgb;
    var Color$a = Color_1;
    var lab = function(col1, col2, f) {
      var xyz0 = col1.lab();
      var xyz1 = col2.lab();
      return new Color$a(
        xyz0[0] + f * (xyz1[0] - xyz0[0]),
        xyz0[1] + f * (xyz1[1] - xyz0[1]),
        xyz0[2] + f * (xyz1[2] - xyz0[2]),
        "lab"
      );
    };
    interpolator$1.lab = lab;
    var Color$9 = Color_1;
    var _hsx = function(col1, col2, f, m) {
      var assign, assign$1;
      var xyz0, xyz1;
      if (m === "hsl") {
        xyz0 = col1.hsl();
        xyz1 = col2.hsl();
      } else if (m === "hsv") {
        xyz0 = col1.hsv();
        xyz1 = col2.hsv();
      } else if (m === "hcg") {
        xyz0 = col1.hcg();
        xyz1 = col2.hcg();
      } else if (m === "hsi") {
        xyz0 = col1.hsi();
        xyz1 = col2.hsi();
      } else if (m === "lch" || m === "hcl") {
        m = "hcl";
        xyz0 = col1.hcl();
        xyz1 = col2.hcl();
      } else if (m === "oklch") {
        xyz0 = col1.oklch().reverse();
        xyz1 = col2.oklch().reverse();
      }
      var hue0, hue1, sat0, sat1, lbv0, lbv1;
      if (m.substr(0, 1) === "h" || m === "oklch") {
        assign = xyz0, hue0 = assign[0], sat0 = assign[1], lbv0 = assign[2];
        assign$1 = xyz1, hue1 = assign$1[0], sat1 = assign$1[1], lbv1 = assign$1[2];
      }
      var sat, hue, lbv, dh;
      if (!isNaN(hue0) && !isNaN(hue1)) {
        if (hue1 > hue0 && hue1 - hue0 > 180) {
          dh = hue1 - (hue0 + 360);
        } else if (hue1 < hue0 && hue0 - hue1 > 180) {
          dh = hue1 + 360 - hue0;
        } else {
          dh = hue1 - hue0;
        }
        hue = hue0 + f * dh;
      } else if (!isNaN(hue0)) {
        hue = hue0;
        if ((lbv1 == 1 || lbv1 == 0) && m != "hsv") {
          sat = sat0;
        }
      } else if (!isNaN(hue1)) {
        hue = hue1;
        if ((lbv0 == 1 || lbv0 == 0) && m != "hsv") {
          sat = sat1;
        }
      } else {
        hue = Number.NaN;
      }
      if (sat === void 0) {
        sat = sat0 + f * (sat1 - sat0);
      }
      lbv = lbv0 + f * (lbv1 - lbv0);
      return m === "oklch" ? new Color$9([lbv, sat, hue], m) : new Color$9([hue, sat, lbv], m);
    };
    var interpolate_hsx$5 = _hsx;
    var lch = function(col1, col2, f) {
      return interpolate_hsx$5(col1, col2, f, "lch");
    };
    interpolator$1.lch = lch;
    interpolator$1.hcl = lch;
    var Color$8 = Color_1;
    var num = function(col1, col2, f) {
      var c1 = col1.num();
      var c2 = col2.num();
      return new Color$8(c1 + f * (c2 - c1), "num");
    };
    interpolator$1.num = num;
    var interpolate_hsx$4 = _hsx;
    var hcg = function(col1, col2, f) {
      return interpolate_hsx$4(col1, col2, f, "hcg");
    };
    interpolator$1.hcg = hcg;
    var interpolate_hsx$3 = _hsx;
    var hsi = function(col1, col2, f) {
      return interpolate_hsx$3(col1, col2, f, "hsi");
    };
    interpolator$1.hsi = hsi;
    var interpolate_hsx$2 = _hsx;
    var hsl = function(col1, col2, f) {
      return interpolate_hsx$2(col1, col2, f, "hsl");
    };
    interpolator$1.hsl = hsl;
    var interpolate_hsx$1 = _hsx;
    var hsv = function(col1, col2, f) {
      return interpolate_hsx$1(col1, col2, f, "hsv");
    };
    interpolator$1.hsv = hsv;
    var Color$7 = Color_1;
    var oklab = function(col1, col2, f) {
      var xyz0 = col1.oklab();
      var xyz1 = col2.oklab();
      return new Color$7(
        xyz0[0] + f * (xyz1[0] - xyz0[0]),
        xyz0[1] + f * (xyz1[1] - xyz0[1]),
        xyz0[2] + f * (xyz1[2] - xyz0[2]),
        "oklab"
      );
    };
    interpolator$1.oklab = oklab;
    var interpolate_hsx = _hsx;
    var oklch = function(col1, col2, f) {
      return interpolate_hsx(col1, col2, f, "oklch");
    };
    interpolator$1.oklch = oklch;
    var Color$6 = Color_1;
    var clip_rgb$1 = utils.clip_rgb;
    var pow$4 = Math.pow;
    var sqrt$1 = Math.sqrt;
    var PI$1 = Math.PI;
    var cos$2 = Math.cos;
    var sin$2 = Math.sin;
    var atan2$1 = Math.atan2;
    var average = function(colors, mode, weights) {
      if (mode === void 0) mode = "lrgb";
      if (weights === void 0) weights = null;
      var l = colors.length;
      if (!weights) {
        weights = Array.from(new Array(l)).map(function() {
          return 1;
        });
      }
      var k = l / weights.reduce(function(a, b) {
        return a + b;
      });
      weights.forEach(function(w, i3) {
        weights[i3] *= k;
      });
      colors = colors.map(function(c) {
        return new Color$6(c);
      });
      if (mode === "lrgb") {
        return _average_lrgb(colors, weights);
      }
      var first = colors.shift();
      var xyz = first.get(mode);
      var cnt = [];
      var dx = 0;
      var dy = 0;
      for (var i2 = 0; i2 < xyz.length; i2++) {
        xyz[i2] = (xyz[i2] || 0) * weights[0];
        cnt.push(isNaN(xyz[i2]) ? 0 : weights[0]);
        if (mode.charAt(i2) === "h" && !isNaN(xyz[i2])) {
          var A = xyz[i2] / 180 * PI$1;
          dx += cos$2(A) * weights[0];
          dy += sin$2(A) * weights[0];
        }
      }
      var alpha = first.alpha() * weights[0];
      colors.forEach(function(c, ci) {
        var xyz2 = c.get(mode);
        alpha += c.alpha() * weights[ci + 1];
        for (var i3 = 0; i3 < xyz.length; i3++) {
          if (!isNaN(xyz2[i3])) {
            cnt[i3] += weights[ci + 1];
            if (mode.charAt(i3) === "h") {
              var A2 = xyz2[i3] / 180 * PI$1;
              dx += cos$2(A2) * weights[ci + 1];
              dy += sin$2(A2) * weights[ci + 1];
            } else {
              xyz[i3] += xyz2[i3] * weights[ci + 1];
            }
          }
        }
      });
      for (var i$12 = 0; i$12 < xyz.length; i$12++) {
        if (mode.charAt(i$12) === "h") {
          var A$1 = atan2$1(dy / cnt[i$12], dx / cnt[i$12]) / PI$1 * 180;
          while (A$1 < 0) {
            A$1 += 360;
          }
          while (A$1 >= 360) {
            A$1 -= 360;
          }
          xyz[i$12] = A$1;
        } else {
          xyz[i$12] = xyz[i$12] / cnt[i$12];
        }
      }
      alpha /= l;
      return new Color$6(xyz, mode).alpha(alpha > 0.99999 ? 1 : alpha, true);
    };
    var _average_lrgb = function(colors, weights) {
      var l = colors.length;
      var xyz = [0, 0, 0, 0];
      for (var i2 = 0; i2 < colors.length; i2++) {
        var col = colors[i2];
        var f = weights[i2] / l;
        var rgb2 = col._rgb;
        xyz[0] += pow$4(rgb2[0], 2) * f;
        xyz[1] += pow$4(rgb2[1], 2) * f;
        xyz[2] += pow$4(rgb2[2], 2) * f;
        xyz[3] += rgb2[3] * f;
      }
      xyz[0] = sqrt$1(xyz[0]);
      xyz[1] = sqrt$1(xyz[1]);
      xyz[2] = sqrt$1(xyz[2]);
      if (xyz[3] > 0.9999999) {
        xyz[3] = 1;
      }
      return new Color$6(clip_rgb$1(xyz));
    };
    var chroma$4 = chroma_1;
    var type$2 = utils.type;
    var pow$3 = Math.pow;
    var scale$2 = function(colors) {
      var _mode = "rgb";
      var _nacol = chroma$4("#ccc");
      var _spread = 0;
      var _domain = [0, 1];
      var _pos = [];
      var _padding = [0, 0];
      var _classes = false;
      var _colors = [];
      var _out = false;
      var _min = 0;
      var _max = 1;
      var _correctLightness = false;
      var _colorCache = {};
      var _useCache = true;
      var _gamma = 1;
      var setColors = function(colors2) {
        colors2 = colors2 || ["#fff", "#000"];
        if (colors2 && type$2(colors2) === "string" && chroma$4.brewer && chroma$4.brewer[colors2.toLowerCase()]) {
          colors2 = chroma$4.brewer[colors2.toLowerCase()];
        }
        if (type$2(colors2) === "array") {
          if (colors2.length === 1) {
            colors2 = [colors2[0], colors2[0]];
          }
          colors2 = colors2.slice(0);
          for (var c = 0; c < colors2.length; c++) {
            colors2[c] = chroma$4(colors2[c]);
          }
          _pos.length = 0;
          for (var c$1 = 0; c$1 < colors2.length; c$1++) {
            _pos.push(c$1 / (colors2.length - 1));
          }
        }
        resetCache();
        return _colors = colors2;
      };
      var getClass = function(value) {
        if (_classes != null) {
          var n = _classes.length - 1;
          var i2 = 0;
          while (i2 < n && value >= _classes[i2]) {
            i2++;
          }
          return i2 - 1;
        }
        return 0;
      };
      var tMapLightness = function(t) {
        return t;
      };
      var tMapDomain = function(t) {
        return t;
      };
      var getColor = function(val, bypassMap) {
        var col, t;
        if (bypassMap == null) {
          bypassMap = false;
        }
        if (isNaN(val) || val === null) {
          return _nacol;
        }
        if (!bypassMap) {
          if (_classes && _classes.length > 2) {
            var c = getClass(val);
            t = c / (_classes.length - 2);
          } else if (_max !== _min) {
            t = (val - _min) / (_max - _min);
          } else {
            t = 1;
          }
        } else {
          t = val;
        }
        t = tMapDomain(t);
        if (!bypassMap) {
          t = tMapLightness(t);
        }
        if (_gamma !== 1) {
          t = pow$3(t, _gamma);
        }
        t = _padding[0] + t * (1 - _padding[0] - _padding[1]);
        t = Math.min(1, Math.max(0, t));
        var k = Math.floor(t * 1e4);
        if (_useCache && _colorCache[k]) {
          col = _colorCache[k];
        } else {
          if (type$2(_colors) === "array") {
            for (var i2 = 0; i2 < _pos.length; i2++) {
              var p = _pos[i2];
              if (t <= p) {
                col = _colors[i2];
                break;
              }
              if (t >= p && i2 === _pos.length - 1) {
                col = _colors[i2];
                break;
              }
              if (t > p && t < _pos[i2 + 1]) {
                t = (t - p) / (_pos[i2 + 1] - p);
                col = chroma$4.interpolate(_colors[i2], _colors[i2 + 1], t, _mode);
                break;
              }
            }
          } else if (type$2(_colors) === "function") {
            col = _colors(t);
          }
          if (_useCache) {
            _colorCache[k] = col;
          }
        }
        return col;
      };
      var resetCache = function() {
        return _colorCache = {};
      };
      setColors(colors);
      var f = function(v) {
        var c = chroma$4(getColor(v));
        if (_out && c[_out]) {
          return c[_out]();
        } else {
          return c;
        }
      };
      f.classes = function(classes) {
        if (classes != null) {
          if (type$2(classes) === "array") {
            _classes = classes;
            _domain = [classes[0], classes[classes.length - 1]];
          } else {
            var d = chroma$4.analyze(_domain);
            if (classes === 0) {
              _classes = [d.min, d.max];
            } else {
              _classes = chroma$4.limits(d, "e", classes);
            }
          }
          return f;
        }
        return _classes;
      };
      f.domain = function(domain) {
        if (!arguments.length) {
          return _domain;
        }
        _min = domain[0];
        _max = domain[domain.length - 1];
        _pos = [];
        var k = _colors.length;
        if (domain.length === k && _min !== _max) {
          for (var i2 = 0, list2 = Array.from(domain); i2 < list2.length; i2 += 1) {
            var d = list2[i2];
            _pos.push((d - _min) / (_max - _min));
          }
        } else {
          for (var c = 0; c < k; c++) {
            _pos.push(c / (k - 1));
          }
          if (domain.length > 2) {
            var tOut = domain.map(function(d2, i3) {
              return i3 / (domain.length - 1);
            });
            var tBreaks = domain.map(function(d2) {
              return (d2 - _min) / (_max - _min);
            });
            if (!tBreaks.every(function(val, i3) {
              return tOut[i3] === val;
            })) {
              tMapDomain = function(t) {
                if (t <= 0 || t >= 1) {
                  return t;
                }
                var i3 = 0;
                while (t >= tBreaks[i3 + 1]) {
                  i3++;
                }
                var f2 = (t - tBreaks[i3]) / (tBreaks[i3 + 1] - tBreaks[i3]);
                var out = tOut[i3] + f2 * (tOut[i3 + 1] - tOut[i3]);
                return out;
              };
            }
          }
        }
        _domain = [_min, _max];
        return f;
      };
      f.mode = function(_m) {
        if (!arguments.length) {
          return _mode;
        }
        _mode = _m;
        resetCache();
        return f;
      };
      f.range = function(colors2, _pos2) {
        setColors(colors2);
        return f;
      };
      f.out = function(_o) {
        _out = _o;
        return f;
      };
      f.spread = function(val) {
        if (!arguments.length) {
          return _spread;
        }
        _spread = val;
        return f;
      };
      f.correctLightness = function(v) {
        if (v == null) {
          v = true;
        }
        _correctLightness = v;
        resetCache();
        if (_correctLightness) {
          tMapLightness = function(t) {
            var L0 = getColor(0, true).lab()[0];
            var L1 = getColor(1, true).lab()[0];
            var pol = L0 > L1;
            var L_actual = getColor(t, true).lab()[0];
            var L_ideal = L0 + (L1 - L0) * t;
            var L_diff = L_actual - L_ideal;
            var t0 = 0;
            var t1 = 1;
            var max_iter = 20;
            while (Math.abs(L_diff) > 0.01 && max_iter-- > 0) {
              (function() {
                if (pol) {
                  L_diff *= -1;
                }
                if (L_diff < 0) {
                  t0 = t;
                  t += (t1 - t) * 0.5;
                } else {
                  t1 = t;
                  t += (t0 - t) * 0.5;
                }
                L_actual = getColor(t, true).lab()[0];
                return L_diff = L_actual - L_ideal;
              })();
            }
            return t;
          };
        } else {
          tMapLightness = function(t) {
            return t;
          };
        }
        return f;
      };
      f.padding = function(p) {
        if (p != null) {
          if (type$2(p) === "number") {
            p = [p, p];
          }
          _padding = p;
          return f;
        } else {
          return _padding;
        }
      };
      f.colors = function(numColors, out) {
        if (arguments.length < 2) {
          out = "hex";
        }
        var result = [];
        if (arguments.length === 0) {
          result = _colors.slice(0);
        } else if (numColors === 1) {
          result = [f(0.5)];
        } else if (numColors > 1) {
          var dm = _domain[0];
          var dd = _domain[1] - dm;
          result = __range__(0, numColors).map(function(i3) {
            return f(dm + i3 / (numColors - 1) * dd);
          });
        } else {
          colors = [];
          var samples = [];
          if (_classes && _classes.length > 2) {
            for (var i2 = 1, end = _classes.length, asc = 1 <= end; asc ? i2 < end : i2 > end; asc ? i2++ : i2--) {
              samples.push((_classes[i2 - 1] + _classes[i2]) * 0.5);
            }
          } else {
            samples = _domain;
          }
          result = samples.map(function(v) {
            return f(v);
          });
        }
        if (chroma$4[out]) {
          result = result.map(function(c) {
            return c[out]();
          });
        }
        return result;
      };
      f.cache = function(c) {
        if (c != null) {
          _useCache = c;
          return f;
        } else {
          return _useCache;
        }
      };
      f.gamma = function(g) {
        if (g != null) {
          _gamma = g;
          return f;
        } else {
          return _gamma;
        }
      };
      f.nodata = function(d) {
        if (d != null) {
          _nacol = chroma$4(d);
          return f;
        } else {
          return _nacol;
        }
      };
      return f;
    };
    function __range__(left, right, inclusive) {
      var range2 = [];
      var ascending = left < right;
      var end = right;
      for (var i2 = left; ascending ? i2 < end : i2 > end; ascending ? i2++ : i2--) {
        range2.push(i2);
      }
      return range2;
    }
    var Color$5 = Color_1;
    var scale$1 = scale$2;
    var binom_row = function(n) {
      var row = [1, 1];
      for (var i2 = 1; i2 < n; i2++) {
        var newrow = [1];
        for (var j = 1; j <= row.length; j++) {
          newrow[j] = (row[j] || 0) + row[j - 1];
        }
        row = newrow;
      }
      return row;
    };
    var bezier = function(colors) {
      var assign, assign$1, assign$2;
      var I, lab0, lab1, lab2;
      colors = colors.map(function(c) {
        return new Color$5(c);
      });
      if (colors.length === 2) {
        assign = colors.map(function(c) {
          return c.lab();
        }), lab0 = assign[0], lab1 = assign[1];
        I = function(t) {
          var lab4 = [0, 1, 2].map(function(i2) {
            return lab0[i2] + t * (lab1[i2] - lab0[i2]);
          });
          return new Color$5(lab4, "lab");
        };
      } else if (colors.length === 3) {
        assign$1 = colors.map(function(c) {
          return c.lab();
        }), lab0 = assign$1[0], lab1 = assign$1[1], lab2 = assign$1[2];
        I = function(t) {
          var lab4 = [0, 1, 2].map(function(i2) {
            return (1 - t) * (1 - t) * lab0[i2] + 2 * (1 - t) * t * lab1[i2] + t * t * lab2[i2];
          });
          return new Color$5(lab4, "lab");
        };
      } else if (colors.length === 4) {
        var lab3;
        assign$2 = colors.map(function(c) {
          return c.lab();
        }), lab0 = assign$2[0], lab1 = assign$2[1], lab2 = assign$2[2], lab3 = assign$2[3];
        I = function(t) {
          var lab4 = [0, 1, 2].map(function(i2) {
            return (1 - t) * (1 - t) * (1 - t) * lab0[i2] + 3 * (1 - t) * (1 - t) * t * lab1[i2] + 3 * (1 - t) * t * t * lab2[i2] + t * t * t * lab3[i2];
          });
          return new Color$5(lab4, "lab");
        };
      } else if (colors.length >= 5) {
        var labs, row, n;
        labs = colors.map(function(c) {
          return c.lab();
        });
        n = colors.length - 1;
        row = binom_row(n);
        I = function(t) {
          var u = 1 - t;
          var lab4 = [0, 1, 2].map(function(i2) {
            return labs.reduce(function(sum, el, j) {
              return sum + row[j] * Math.pow(u, n - j) * Math.pow(t, j) * el[i2];
            }, 0);
          });
          return new Color$5(lab4, "lab");
        };
      } else {
        throw new RangeError("No point in running bezier with only one color.");
      }
      return I;
    };
    var bezier_1 = function(colors) {
      var f = bezier(colors);
      f.scale = function() {
        return scale$1(f);
      };
      return f;
    };
    var chroma$3 = chroma_1;
    var blend = function(bottom, top, mode) {
      if (!blend[mode]) {
        throw new Error("unknown blend mode " + mode);
      }
      return blend[mode](bottom, top);
    };
    var blend_f = function(f) {
      return function(bottom, top) {
        var c0 = chroma$3(top).rgb();
        var c1 = chroma$3(bottom).rgb();
        return chroma$3.rgb(f(c0, c1));
      };
    };
    var each = function(f) {
      return function(c0, c1) {
        var out = [];
        out[0] = f(c0[0], c1[0]);
        out[1] = f(c0[1], c1[1]);
        out[2] = f(c0[2], c1[2]);
        return out;
      };
    };
    var normal = function(a) {
      return a;
    };
    var multiply = function(a, b) {
      return a * b / 255;
    };
    var darken = function(a, b) {
      return a > b ? b : a;
    };
    var lighten = function(a, b) {
      return a > b ? a : b;
    };
    var screen = function(a, b) {
      return 255 * (1 - (1 - a / 255) * (1 - b / 255));
    };
    var overlay = function(a, b) {
      return b < 128 ? 2 * a * b / 255 : 255 * (1 - 2 * (1 - a / 255) * (1 - b / 255));
    };
    var burn = function(a, b) {
      return 255 * (1 - (1 - b / 255) / (a / 255));
    };
    var dodge = function(a, b) {
      if (a === 255) {
        return 255;
      }
      a = 255 * (b / 255) / (1 - a / 255);
      return a > 255 ? 255 : a;
    };
    blend.normal = blend_f(each(normal));
    blend.multiply = blend_f(each(multiply));
    blend.screen = blend_f(each(screen));
    blend.overlay = blend_f(each(overlay));
    blend.darken = blend_f(each(darken));
    blend.lighten = blend_f(each(lighten));
    blend.dodge = blend_f(each(dodge));
    blend.burn = blend_f(each(burn));
    var blend_1 = blend;
    var type$1 = utils.type;
    var clip_rgb = utils.clip_rgb;
    var TWOPI = utils.TWOPI;
    var pow$2 = Math.pow;
    var sin$1 = Math.sin;
    var cos$1 = Math.cos;
    var chroma$2 = chroma_1;
    var cubehelix = function(start, rotations, hue, gamma, lightness) {
      if (start === void 0) start = 300;
      if (rotations === void 0) rotations = -1.5;
      if (hue === void 0) hue = 1;
      if (gamma === void 0) gamma = 1;
      if (lightness === void 0) lightness = [0, 1];
      var dh = 0, dl;
      if (type$1(lightness) === "array") {
        dl = lightness[1] - lightness[0];
      } else {
        dl = 0;
        lightness = [lightness, lightness];
      }
      var f = function(fract) {
        var a = TWOPI * ((start + 120) / 360 + rotations * fract);
        var l = pow$2(lightness[0] + dl * fract, gamma);
        var h = dh !== 0 ? hue[0] + fract * dh : hue;
        var amp = h * l * (1 - l) / 2;
        var cos_a = cos$1(a);
        var sin_a = sin$1(a);
        var r = l + amp * (-0.14861 * cos_a + 1.78277 * sin_a);
        var g = l + amp * (-0.29227 * cos_a - 0.90649 * sin_a);
        var b = l + amp * (1.97294 * cos_a);
        return chroma$2(clip_rgb([r * 255, g * 255, b * 255, 1]));
      };
      f.start = function(s) {
        if (s == null) {
          return start;
        }
        start = s;
        return f;
      };
      f.rotations = function(r) {
        if (r == null) {
          return rotations;
        }
        rotations = r;
        return f;
      };
      f.gamma = function(g) {
        if (g == null) {
          return gamma;
        }
        gamma = g;
        return f;
      };
      f.hue = function(h) {
        if (h == null) {
          return hue;
        }
        hue = h;
        if (type$1(hue) === "array") {
          dh = hue[1] - hue[0];
          if (dh === 0) {
            hue = hue[1];
          }
        } else {
          dh = 0;
        }
        return f;
      };
      f.lightness = function(h) {
        if (h == null) {
          return lightness;
        }
        if (type$1(h) === "array") {
          lightness = h;
          dl = h[1] - h[0];
        } else {
          lightness = [h, h];
          dl = 0;
        }
        return f;
      };
      f.scale = function() {
        return chroma$2.scale(f);
      };
      f.hue(hue);
      return f;
    };
    var Color$4 = Color_1;
    var digits = "0123456789abcdef";
    var floor$1 = Math.floor;
    var random = Math.random;
    var random_1 = function() {
      var code = "#";
      for (var i2 = 0; i2 < 6; i2++) {
        code += digits.charAt(floor$1(random() * 16));
      }
      return new Color$4(code, "hex");
    };
    var type = type$p;
    var log = Math.log;
    var pow$1 = Math.pow;
    var floor = Math.floor;
    var abs$1 = Math.abs;
    var analyze = function(data, key2) {
      if (key2 === void 0) key2 = null;
      var r = {
        min: Number.MAX_VALUE,
        max: Number.MAX_VALUE * -1,
        sum: 0,
        values: [],
        count: 0
      };
      if (type(data) === "object") {
        data = Object.values(data);
      }
      data.forEach(function(val) {
        if (key2 && type(val) === "object") {
          val = val[key2];
        }
        if (val !== void 0 && val !== null && !isNaN(val)) {
          r.values.push(val);
          r.sum += val;
          if (val < r.min) {
            r.min = val;
          }
          if (val > r.max) {
            r.max = val;
          }
          r.count += 1;
        }
      });
      r.domain = [r.min, r.max];
      r.limits = function(mode, num2) {
        return limits(r, mode, num2);
      };
      return r;
    };
    var limits = function(data, mode, num2) {
      if (mode === void 0) mode = "equal";
      if (num2 === void 0) num2 = 7;
      if (type(data) == "array") {
        data = analyze(data);
      }
      var min2 = data.min;
      var max2 = data.max;
      var values = data.values.sort(function(a, b) {
        return a - b;
      });
      if (num2 === 1) {
        return [min2, max2];
      }
      var limits2 = [];
      if (mode.substr(0, 1) === "c") {
        limits2.push(min2);
        limits2.push(max2);
      }
      if (mode.substr(0, 1) === "e") {
        limits2.push(min2);
        for (var i2 = 1; i2 < num2; i2++) {
          limits2.push(min2 + i2 / num2 * (max2 - min2));
        }
        limits2.push(max2);
      } else if (mode.substr(0, 1) === "l") {
        if (min2 <= 0) {
          throw new Error("Logarithmic scales are only possible for values > 0");
        }
        var min_log = Math.LOG10E * log(min2);
        var max_log = Math.LOG10E * log(max2);
        limits2.push(min2);
        for (var i$12 = 1; i$12 < num2; i$12++) {
          limits2.push(pow$1(10, min_log + i$12 / num2 * (max_log - min_log)));
        }
        limits2.push(max2);
      } else if (mode.substr(0, 1) === "q") {
        limits2.push(min2);
        for (var i$2 = 1; i$2 < num2; i$2++) {
          var p = (values.length - 1) * i$2 / num2;
          var pb = floor(p);
          if (pb === p) {
            limits2.push(values[pb]);
          } else {
            var pr = p - pb;
            limits2.push(values[pb] * (1 - pr) + values[pb + 1] * pr);
          }
        }
        limits2.push(max2);
      } else if (mode.substr(0, 1) === "k") {
        var cluster;
        var n = values.length;
        var assignments = new Array(n);
        var clusterSizes = new Array(num2);
        var repeat = true;
        var nb_iters = 0;
        var centroids = null;
        centroids = [];
        centroids.push(min2);
        for (var i$3 = 1; i$3 < num2; i$3++) {
          centroids.push(min2 + i$3 / num2 * (max2 - min2));
        }
        centroids.push(max2);
        while (repeat) {
          for (var j = 0; j < num2; j++) {
            clusterSizes[j] = 0;
          }
          for (var i$4 = 0; i$4 < n; i$4++) {
            var value = values[i$4];
            var mindist = Number.MAX_VALUE;
            var best = void 0;
            for (var j$1 = 0; j$1 < num2; j$1++) {
              var dist = abs$1(centroids[j$1] - value);
              if (dist < mindist) {
                mindist = dist;
                best = j$1;
              }
              clusterSizes[best]++;
              assignments[i$4] = best;
            }
          }
          var newCentroids = new Array(num2);
          for (var j$2 = 0; j$2 < num2; j$2++) {
            newCentroids[j$2] = null;
          }
          for (var i$5 = 0; i$5 < n; i$5++) {
            cluster = assignments[i$5];
            if (newCentroids[cluster] === null) {
              newCentroids[cluster] = values[i$5];
            } else {
              newCentroids[cluster] += values[i$5];
            }
          }
          for (var j$3 = 0; j$3 < num2; j$3++) {
            newCentroids[j$3] *= 1 / clusterSizes[j$3];
          }
          repeat = false;
          for (var j$4 = 0; j$4 < num2; j$4++) {
            if (newCentroids[j$4] !== centroids[j$4]) {
              repeat = true;
              break;
            }
          }
          centroids = newCentroids;
          nb_iters++;
          if (nb_iters > 200) {
            repeat = false;
          }
        }
        var kClusters = {};
        for (var j$5 = 0; j$5 < num2; j$5++) {
          kClusters[j$5] = [];
        }
        for (var i$6 = 0; i$6 < n; i$6++) {
          cluster = assignments[i$6];
          kClusters[cluster].push(values[i$6]);
        }
        var tmpKMeansBreaks = [];
        for (var j$6 = 0; j$6 < num2; j$6++) {
          tmpKMeansBreaks.push(kClusters[j$6][0]);
          tmpKMeansBreaks.push(kClusters[j$6][kClusters[j$6].length - 1]);
        }
        tmpKMeansBreaks = tmpKMeansBreaks.sort(function(a, b) {
          return a - b;
        });
        limits2.push(tmpKMeansBreaks[0]);
        for (var i$7 = 1; i$7 < tmpKMeansBreaks.length; i$7 += 2) {
          var v = tmpKMeansBreaks[i$7];
          if (!isNaN(v) && limits2.indexOf(v) === -1) {
            limits2.push(v);
          }
        }
      }
      return limits2;
    };
    var analyze_1 = { analyze, limits };
    var Color$3 = Color_1;
    var contrast = function(a, b) {
      a = new Color$3(a);
      b = new Color$3(b);
      var l1 = a.luminance();
      var l2 = b.luminance();
      return l1 > l2 ? (l1 + 0.05) / (l2 + 0.05) : (l2 + 0.05) / (l1 + 0.05);
    };
    var Color$2 = Color_1;
    var sqrt = Math.sqrt;
    var pow = Math.pow;
    var min = Math.min;
    var max = Math.max;
    var atan2 = Math.atan2;
    var abs = Math.abs;
    var cos = Math.cos;
    var sin = Math.sin;
    var exp = Math.exp;
    var PI = Math.PI;
    var deltaE = function(a, b, Kl, Kc, Kh) {
      if (Kl === void 0) Kl = 1;
      if (Kc === void 0) Kc = 1;
      if (Kh === void 0) Kh = 1;
      var rad2deg = function(rad) {
        return 360 * rad / (2 * PI);
      };
      var deg2rad = function(deg) {
        return 2 * PI * deg / 360;
      };
      a = new Color$2(a);
      b = new Color$2(b);
      var ref = Array.from(a.lab());
      var L1 = ref[0];
      var a1 = ref[1];
      var b1 = ref[2];
      var ref$1 = Array.from(b.lab());
      var L2 = ref$1[0];
      var a2 = ref$1[1];
      var b2 = ref$1[2];
      var avgL = (L1 + L2) / 2;
      var C1 = sqrt(pow(a1, 2) + pow(b1, 2));
      var C2 = sqrt(pow(a2, 2) + pow(b2, 2));
      var avgC = (C1 + C2) / 2;
      var G = 0.5 * (1 - sqrt(pow(avgC, 7) / (pow(avgC, 7) + pow(25, 7))));
      var a1p = a1 * (1 + G);
      var a2p = a2 * (1 + G);
      var C1p = sqrt(pow(a1p, 2) + pow(b1, 2));
      var C2p = sqrt(pow(a2p, 2) + pow(b2, 2));
      var avgCp = (C1p + C2p) / 2;
      var arctan1 = rad2deg(atan2(b1, a1p));
      var arctan2 = rad2deg(atan2(b2, a2p));
      var h1p = arctan1 >= 0 ? arctan1 : arctan1 + 360;
      var h2p = arctan2 >= 0 ? arctan2 : arctan2 + 360;
      var avgHp = abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
      var T = 1 - 0.17 * cos(deg2rad(avgHp - 30)) + 0.24 * cos(deg2rad(2 * avgHp)) + 0.32 * cos(deg2rad(3 * avgHp + 6)) - 0.2 * cos(deg2rad(4 * avgHp - 63));
      var deltaHp = h2p - h1p;
      deltaHp = abs(deltaHp) <= 180 ? deltaHp : h2p <= h1p ? deltaHp + 360 : deltaHp - 360;
      deltaHp = 2 * sqrt(C1p * C2p) * sin(deg2rad(deltaHp) / 2);
      var deltaL = L2 - L1;
      var deltaCp = C2p - C1p;
      var sl = 1 + 0.015 * pow(avgL - 50, 2) / sqrt(20 + pow(avgL - 50, 2));
      var sc = 1 + 0.045 * avgCp;
      var sh = 1 + 0.015 * avgCp * T;
      var deltaTheta = 30 * exp(-pow((avgHp - 275) / 25, 2));
      var Rc = 2 * sqrt(pow(avgCp, 7) / (pow(avgCp, 7) + pow(25, 7)));
      var Rt = -Rc * sin(2 * deg2rad(deltaTheta));
      var result = sqrt(pow(deltaL / (Kl * sl), 2) + pow(deltaCp / (Kc * sc), 2) + pow(deltaHp / (Kh * sh), 2) + Rt * (deltaCp / (Kc * sc)) * (deltaHp / (Kh * sh)));
      return max(0, min(100, result));
    };
    var Color$1 = Color_1;
    var distance = function(a, b, mode) {
      if (mode === void 0) mode = "lab";
      a = new Color$1(a);
      b = new Color$1(b);
      var l1 = a.get(mode);
      var l2 = b.get(mode);
      var sum_sq = 0;
      for (var i2 in l1) {
        var d = (l1[i2] || 0) - (l2[i2] || 0);
        sum_sq += d * d;
      }
      return Math.sqrt(sum_sq);
    };
    var Color = Color_1;
    var valid = function() {
      var args = [], len = arguments.length;
      while (len--) args[len] = arguments[len];
      try {
        new (Function.prototype.bind.apply(Color, [null].concat(args)))();
        return true;
      } catch (e) {
        return false;
      }
    };
    var chroma$1 = chroma_1;
    var scale = scale$2;
    var scales = {
      cool: function cool() {
        return scale([chroma$1.hsl(180, 1, 0.9), chroma$1.hsl(250, 0.7, 0.4)]);
      },
      hot: function hot() {
        return scale(["#000", "#f00", "#ff0", "#fff"]).mode("rgb");
      }
    };
    var colorbrewer = {
      // sequential
      OrRd: ["#fff7ec", "#fee8c8", "#fdd49e", "#fdbb84", "#fc8d59", "#ef6548", "#d7301f", "#b30000", "#7f0000"],
      PuBu: ["#fff7fb", "#ece7f2", "#d0d1e6", "#a6bddb", "#74a9cf", "#3690c0", "#0570b0", "#045a8d", "#023858"],
      BuPu: ["#f7fcfd", "#e0ecf4", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#810f7c", "#4d004b"],
      Oranges: ["#fff5eb", "#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#a63603", "#7f2704"],
      BuGn: ["#f7fcfd", "#e5f5f9", "#ccece6", "#99d8c9", "#66c2a4", "#41ae76", "#238b45", "#006d2c", "#00441b"],
      YlOrBr: ["#ffffe5", "#fff7bc", "#fee391", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#993404", "#662506"],
      YlGn: ["#ffffe5", "#f7fcb9", "#d9f0a3", "#addd8e", "#78c679", "#41ab5d", "#238443", "#006837", "#004529"],
      Reds: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"],
      RdPu: ["#fff7f3", "#fde0dd", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177", "#49006a"],
      Greens: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#006d2c", "#00441b"],
      YlGnBu: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"],
      Purples: ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"],
      GnBu: ["#f7fcf0", "#e0f3db", "#ccebc5", "#a8ddb5", "#7bccc4", "#4eb3d3", "#2b8cbe", "#0868ac", "#084081"],
      Greys: ["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525", "#000000"],
      YlOrRd: ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"],
      PuRd: ["#f7f4f9", "#e7e1ef", "#d4b9da", "#c994c7", "#df65b0", "#e7298a", "#ce1256", "#980043", "#67001f"],
      Blues: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"],
      PuBuGn: ["#fff7fb", "#ece2f0", "#d0d1e6", "#a6bddb", "#67a9cf", "#3690c0", "#02818a", "#016c59", "#014636"],
      Viridis: ["#440154", "#482777", "#3f4a8a", "#31678e", "#26838f", "#1f9d8a", "#6cce5a", "#b6de2b", "#fee825"],
      // diverging
      Spectral: ["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"],
      RdYlGn: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837"],
      RdBu: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"],
      PiYG: ["#8e0152", "#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#f7f7f7", "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221", "#276419"],
      PRGn: ["#40004b", "#762a83", "#9970ab", "#c2a5cf", "#e7d4e8", "#f7f7f7", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837", "#00441b"],
      RdYlBu: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee090", "#ffffbf", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4", "#313695"],
      BrBG: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"],
      RdGy: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#ffffff", "#e0e0e0", "#bababa", "#878787", "#4d4d4d", "#1a1a1a"],
      PuOr: ["#7f3b08", "#b35806", "#e08214", "#fdb863", "#fee0b6", "#f7f7f7", "#d8daeb", "#b2abd2", "#8073ac", "#542788", "#2d004b"],
      // qualitative
      Set2: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"],
      Accent: ["#7fc97f", "#beaed4", "#fdc086", "#ffff99", "#386cb0", "#f0027f", "#bf5b17", "#666666"],
      Set1: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628", "#f781bf", "#999999"],
      Set3: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f"],
      Dark2: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#666666"],
      Paired: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"],
      Pastel2: ["#b3e2cd", "#fdcdac", "#cbd5e8", "#f4cae4", "#e6f5c9", "#fff2ae", "#f1e2cc", "#cccccc"],
      Pastel1: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc", "#e5d8bd", "#fddaec", "#f2f2f2"]
    };
    for (var i = 0, list = Object.keys(colorbrewer); i < list.length; i += 1) {
      var key = list[i];
      colorbrewer[key.toLowerCase()] = colorbrewer[key];
    }
    var colorbrewer_1 = colorbrewer;
    var chroma2 = chroma_1;
    chroma2.average = average;
    chroma2.bezier = bezier_1;
    chroma2.blend = blend_1;
    chroma2.cubehelix = cubehelix;
    chroma2.mix = chroma2.interpolate = mix$1;
    chroma2.random = random_1;
    chroma2.scale = scale$2;
    chroma2.analyze = analyze_1.analyze;
    chroma2.contrast = contrast;
    chroma2.deltaE = deltaE;
    chroma2.distance = distance;
    chroma2.limits = analyze_1.limits;
    chroma2.valid = valid;
    chroma2.scales = scales;
    chroma2.colors = w3cx11_1;
    chroma2.brewer = colorbrewer_1;
    var chroma_js = chroma2;
    return chroma_js;
  });
})(chroma);
var chromaExports = chroma.exports;
const ExtendedColor = (() => {
  chromaExports.Color.symbol = chromaExports.Color.prototype.symbol = Symbol.for("@motion-canvas/core/types/Color");
  chromaExports.Color.lerp = chromaExports.Color.prototype.lerp = (from, to, value, colorSpace = "lch") => {
    if (typeof from === "string") {
      from = new chromaExports.Color(from);
    }
    if (typeof to === "string") {
      to = new chromaExports.Color(to);
    }
    const fromIsColor = from instanceof chromaExports.Color;
    const toIsColor = to instanceof chromaExports.Color;
    if (!fromIsColor) {
      from = toIsColor ? to.alpha(0) : new chromaExports.Color("rgba(0, 0, 0, 0)");
    }
    if (!toIsColor) {
      to = fromIsColor ? from.alpha(0) : new chromaExports.Color("rgba(0, 0, 0, 0)");
    }
    return chromaExports.mix(from, to, value, colorSpace);
  };
  chromaExports.Color.createLerp = chromaExports.Color.prototype.createLerp = (colorSpace) => (from, to, value) => chromaExports.Color.lerp(from, to, value, colorSpace);
  chromaExports.Color.createSignal = (initial2, interpolation2 = chromaExports.Color.lerp) => {
    return new SignalContext(initial2, interpolation2, void 0, (value) => new chromaExports.Color(value)).toSignal();
  };
  chromaExports.Color.prototype.toSymbol = () => {
    return chromaExports.Color.symbol;
  };
  chromaExports.Color.prototype.toUniform = function(gl, location) {
    gl.uniform4fv(location, this.gl());
  };
  chromaExports.Color.prototype.serialize = function() {
    return this.css();
  };
  chromaExports.Color.prototype.lerp = function(to, value, colorSpace) {
    return chromaExports.Color.lerp(this, to, value, colorSpace);
  };
  return chromaExports.Color;
})();
function transformAngle(angle, matrix) {
  return Vector2.fromDegrees(angle).transform(matrix).degrees;
}
function transformScalar(scalar, matrix) {
  return Vector2.magnitude(matrix.m11, matrix.m12) * scalar;
}
class ColorMetaField extends MetaField {
  constructor() {
    super(...arguments);
    this.type = ExtendedColor.symbol;
  }
  parse(value) {
    return value === null ? null : new ExtendedColor(value);
  }
  serialize() {
    var _a2;
    return ((_a2 = this.value.current) == null ? void 0 : _a2.serialize()) ?? null;
  }
}
class EnumMetaField extends MetaField {
  constructor(name, options, initial2 = ((_a2) => (_a2 = options[0]) == null ? void 0 : _a2.value)()) {
    super(name, initial2);
    this.options = options;
    this.type = EnumMetaField.symbol;
  }
  set(value) {
    var _a2;
    super.set((_a2 = this.getOption(value)) == null ? void 0 : _a2.value);
  }
  parse(value) {
    var _a2;
    return (_a2 = this.getOption(value)) == null ? void 0 : _a2.value;
  }
  getOption(value) {
    return this.options.find((option) => option.value === value) ?? this.options[0];
  }
}
EnumMetaField.symbol = Symbol.for("@motion-canvas/core/meta/EnumMetaField");
class ExporterMetaField extends MetaField {
  /**
   * Triggered when the nested fields change.
   *
   * @eventProperty
   */
  get onFieldsChanged() {
    return this.fields.subscribable;
  }
  get options() {
    return this.optionFields[this.current];
  }
  constructor(name, project2, current = 0) {
    var _a2, _b;
    const exporters = project2.plugins.flatMap((plugin) => {
      var _a3;
      return ((_a3 = plugin.exporters) == null ? void 0 : _a3.call(plugin, project2)) ?? [];
    });
    const optionFields = exporters.map((exporter) => exporter.meta(project2));
    const exporterField = new EnumMetaField("exporter", exporters.map((exporter) => ({
      value: exporter.id,
      text: exporter.displayName
    })), (_a2 = exporters[current]) == null ? void 0 : _a2.id);
    super(name, {
      name: exporterField.get(),
      options: (_b = optionFields[current]) == null ? void 0 : _b.get()
    });
    this.current = current;
    this.type = Object;
    this.handleChange = () => {
      var _a3, _b2, _c;
      const value = this.exporterField.get();
      const index = Math.max(this.exporters.findIndex((exporter) => exporter.id === value), 0);
      if (this.current !== index) {
        (_a3 = this.options) == null ? void 0 : _a3.onChanged.unsubscribe(this.handleChange);
        this.current = index;
        (_b2 = this.options) == null ? void 0 : _b2.onChanged.subscribe(this.handleChange, false);
        this.fields.current = this.options ? [this.exporterField, this.options] : [this.exporterField];
      }
      this.value.current = {
        name: this.exporterField.get(),
        options: ((_c = this.options) == null ? void 0 : _c.get()) ?? null
      };
    };
    this.exporters = exporters;
    this.exporterField = exporterField;
    this.exporterField.onChanged.subscribe(this.handleChange, false);
    this.exporterField.disable(optionFields.length < 2).space();
    this.optionFields = optionFields;
    this.fields = new ValueDispatcher([this.exporterField]);
    if (this.options) {
      this.options.onChanged.subscribe(this.handleChange, false);
      this.fields.current = [this.exporterField, this.options];
    }
  }
  set(value) {
    var _a2;
    this.exporterField.set(value.name);
    (_a2 = this.options) == null ? void 0 : _a2.set(value.options ?? {});
  }
  serialize() {
    var _a2;
    return {
      name: this.exporterField.serialize(),
      options: ((_a2 = this.options) == null ? void 0 : _a2.serialize()) ?? null
    };
  }
  clone() {
    return new this.constructor(this.name, this.exporters, this.current);
  }
}
var _a;
class MetaFile {
  constructor(name, source = false) {
    this.name = name;
    this.source = source;
    this.lock = new Semaphore();
    this.ignoreChange = false;
    this.cache = null;
    this.metaField = null;
    this.handleChanged = async () => {
    };
  }
  attach(field) {
    var _a2;
    if (this.metaField)
      return;
    this.metaField = field;
    if (this.cache) {
      this.metaField.set(this.cache);
    }
    (_a2 = this.metaField) == null ? void 0 : _a2.onChanged.subscribe(this.handleChanged);
  }
  async saveData(data) {
    if (this.source === false) {
      return;
    }
    if (!this.source) {
      throw new Error(`The meta file for ${this.name} is missing.`);
    }
    if (_a.sourceLookup[this.source]) {
      throw new Error(`Metadata for ${this.name} is already being updated`);
    }
    const source = this.source;
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        delete _a.sourceLookup[source];
        reject(`Connection timeout when updating metadata for ${this.name}`);
      }, 1e3);
      _a.sourceLookup[source] = () => {
        delete _a.sourceLookup[source];
        resolve();
      };
      (void 0).send("motion-canvas:meta", {
        source,
        data
      });
    });
  }
  /**
   * Load new metadata from a file.
   *
   * @remarks
   * This method is called during hot module replacement.
   *
   * @param data - New metadata.
   */
  loadData(data) {
    var _a2;
    this.ignoreChange = true;
    this.cache = data;
    (_a2 = this.metaField) == null ? void 0 : _a2.set(data);
    this.ignoreChange = false;
  }
}
_a = MetaFile;
MetaFile.sourceLookup = {};
class NumberMetaField extends MetaField {
  constructor() {
    super(...arguments);
    this.type = Number;
    this.presets = [];
  }
  parse(value) {
    let parsed = parseFloat(value);
    if (this.min !== void 0 && parsed < this.min) {
      parsed = this.min;
    }
    if (this.max !== void 0 && parsed > this.max) {
      parsed = this.max;
    }
    return parsed;
  }
  getPresets() {
    return this.presets;
  }
  setPresets(options) {
    this.presets = options;
    return this;
  }
  setRange(min, max) {
    this.min = min;
    this.max = max;
    return this;
  }
  getMin() {
    return this.min ?? -Infinity;
  }
  getMax() {
    return this.max ?? Infinity;
  }
}
class RangeMetaField extends MetaField {
  constructor() {
    super(...arguments);
    this.type = RangeMetaField.symbol;
  }
  parse(value) {
    return this.parseRange(Infinity, value[0], value[1] ?? Infinity);
  }
  /**
   * Convert the given range from frames to seconds and update this field.
   *
   * @remarks
   * This helper method applies additional validation to the range, preventing
   * it from overflowing the timeline.
   *
   * @param startFrame - The beginning of the range.
   * @param endFrame - The end of the range.
   * @param duration - The current duration in frames.
   * @param fps - The current framerate.
   */
  update(startFrame, endFrame, duration, fps) {
    this.value.current = this.parseRange(duration / fps - EPSILON, startFrame / fps - EPSILON, endFrame / fps - EPSILON);
  }
  parseRange(duration, startFrame = this.value.current[0], endFrame = this.value.current[1]) {
    startFrame = clamp(0, duration, startFrame);
    endFrame = clamp(0, duration, endFrame ?? Infinity);
    if (startFrame > endFrame) {
      [startFrame, endFrame] = [endFrame, startFrame];
    }
    if (endFrame >= duration) {
      endFrame = Infinity;
    }
    return [startFrame, endFrame];
  }
}
RangeMetaField.symbol = Symbol.for("@motion-canvas/core/meta/RangeMetaField");
class Vector2MetaField extends MetaField {
  constructor() {
    super(...arguments);
    this.type = Vector2.symbol;
  }
  parse(value) {
    return new Vector2(value);
  }
  serialize() {
    return this.value.current.serialize();
  }
}
let meta$2;
meta$2 ?? (meta$2 = new MetaFile("project", false));
meta$2.loadData(
  {
    "version": 0,
    "shared": {
      "background": null,
      "range": [0, null],
      "size": { "x": 1080, "y": 720 },
      "audioOffset": 0
    },
    "preview": {
      "fps": 30,
      "resolutionScale": 1
    },
    "rendering": {
      "fps": 30,
      "resolutionScale": 2,
      "colorSpace": "srgb",
      "exporter": {
        "name": "@motion-canvas/core/image-sequence",
        "options": {
          "fileType": "image/png",
          "quality": 100,
          "groupByScene": false
        }
      }
    }
  }
);
const metaFile$1 = meta$2;
let meta$1;
meta$1 ?? (meta$1 = new MetaFile("nle_timeline", false));
meta$1.loadData({
  "version": 0
});
const metaFile = meta$1;
function isClassComponent(fn) {
  var _a2;
  return !!((_a2 = fn.prototype) == null ? void 0 : _a2.isClass);
}
const Fragment = Symbol.for("@motion-canvas/2d/fragment");
function jsx(type, config2, key) {
  const { ref, children, ...rest } = config2;
  const flatChildren = Array.isArray(children) ? children.flat() : children;
  if (type === Fragment) {
    return flatChildren;
  }
  if (isClassComponent(type)) {
    const node = new type({ ...rest, children: flatChildren, key });
    ref == null ? void 0 : ref(node);
    return node;
  } else {
    return type({ ...rest, ref, children: flatChildren, key });
  }
}
const FILTERS = {
  invert: {
    name: "invert"
  },
  sepia: {
    name: "sepia"
  },
  grayscale: {
    name: "grayscale"
  },
  brightness: {
    name: "brightness",
    default: 1
  },
  contrast: {
    name: "contrast",
    default: 1
  },
  saturate: {
    name: "saturate",
    default: 1
  },
  hue: {
    name: "hue-rotate",
    unit: "deg",
    scale: 1
  },
  blur: {
    name: "blur",
    transform: true,
    unit: "px",
    scale: 1
  }
};
class Filter {
  get name() {
    return this.props.name;
  }
  get default() {
    return this.props.default;
  }
  constructor(props) {
    this.props = {
      name: "invert",
      default: 0,
      unit: "%",
      scale: 100,
      transform: false,
      ...props,
      value: props.value ?? props.default ?? 0
    };
    this.value = createSignal(this.props.value, map, this);
  }
  isActive() {
    return this.value() !== this.props.default;
  }
  serialize(matrix) {
    let value = this.value();
    if (this.props.transform) {
      value = transformScalar(value, matrix);
    }
    return `${this.props.name}(${value * this.props.scale}${this.props.unit})`;
  }
}
const INITIALIZERS = Symbol.for("@motion-canvas/2d/decorators/initializers");
function addInitializer(target, initializer) {
  if (!target[INITIALIZERS]) {
    target[INITIALIZERS] = [];
  } else if (
    // if one of the prototypes has initializers
    target[INITIALIZERS] && // and it's not the target object itself
    !Object.prototype.hasOwnProperty.call(target, INITIALIZERS)
  ) {
    const base = Object.getPrototypeOf(target);
    target[INITIALIZERS] = [...base[INITIALIZERS]];
  }
  target[INITIALIZERS].push(initializer);
}
function initialize(target, context) {
  if (target[INITIALIZERS]) {
    try {
      target[INITIALIZERS].forEach((initializer) => initializer(target, context));
    } catch (e) {
      e.inspect ?? (e.inspect = target.key);
      throw e;
    }
  }
}
function computed() {
  return (target, key) => {
    addInitializer(target, (instance) => {
      const method = Object.getPrototypeOf(instance)[key];
      instance[key] = createComputed(method.bind(instance), instance);
    });
  };
}
function makeSignalExtensions(meta2 = {}, owner, name) {
  const extensions = {};
  if (name && owner) {
    const setter = meta2.setter ?? (owner == null ? void 0 : owner[`set${capitalize(name)}`]);
    if (setter) {
      extensions.setter = setter.bind(owner);
    }
    const getter = meta2.getter ?? (owner == null ? void 0 : owner[`get${capitalize(name)}`]);
    if (getter) {
      extensions.getter = getter.bind(owner);
    }
    const tweener = meta2.tweener ?? (owner == null ? void 0 : owner[`tween${capitalize(name)}`]);
    if (tweener) {
      extensions.tweener = tweener.bind(owner);
    }
  }
  return extensions;
}
const PROPERTIES = Symbol.for("@motion-canvas/2d/decorators/properties");
function getPropertyMeta(object, key) {
  var _a2;
  return ((_a2 = object[PROPERTIES]) == null ? void 0 : _a2[key]) ?? null;
}
function getPropertyMetaOrCreate(object, key) {
  let lookup;
  if (!object[PROPERTIES]) {
    object[PROPERTIES] = lookup = {};
  } else if (object[PROPERTIES] && !Object.prototype.hasOwnProperty.call(object, PROPERTIES)) {
    object[PROPERTIES] = lookup = Object.fromEntries(Object.entries(object[PROPERTIES]).map(([key2, meta2]) => [key2, { ...meta2 }]));
  } else {
    lookup = object[PROPERTIES];
  }
  lookup[key] ?? (lookup[key] = {
    cloneable: true,
    inspectable: true,
    compoundEntries: []
  });
  return lookup[key];
}
function getPropertiesOf(value) {
  if (value && typeof value === "object") {
    return value[PROPERTIES] ?? {};
  }
  return {};
}
function initializeSignals(instance, props) {
  initialize(instance);
  for (const [key, meta2] of Object.entries(getPropertiesOf(instance))) {
    const signal2 = instance[key];
    signal2.reset();
    if (props[key] !== void 0) {
      signal2(props[key]);
    }
    if (meta2.compoundEntries !== void 0) {
      for (const [key2, property] of meta2.compoundEntries) {
        if (property in props) {
          signal2[key2](props[property]);
        }
      }
    }
  }
}
function signal() {
  return (target, key) => {
    const meta2 = getPropertyMetaOrCreate(target, key);
    addInitializer(target, (instance) => {
      var _a2;
      let initial2 = meta2.default;
      const defaultMethod = instance[`getDefault${capitalize(key)}`];
      if (defaultMethod) {
        initial2 = () => defaultMethod.call(instance, meta2.default);
      }
      const signal2 = new SignalContext(initial2, meta2.interpolationFunction ?? deepLerp, instance, (_a2 = meta2.parser) == null ? void 0 : _a2.bind(instance), makeSignalExtensions(meta2, instance, key));
      instance[key] = signal2.toSignal();
    });
  };
}
function initial(value) {
  return (target, key) => {
    const meta2 = getPropertyMeta(target, key);
    if (!meta2) {
      useLogger().error(`Missing property decorator for "${key.toString()}"`);
      return;
    }
    meta2.default = value;
  };
}
function interpolation(value) {
  return (target, key) => {
    const meta2 = getPropertyMeta(target, key);
    if (!meta2) {
      useLogger().error(`Missing property decorator for "${key.toString()}"`);
      return;
    }
    meta2.interpolationFunction = value;
  };
}
function parser(value) {
  return (target, key) => {
    const meta2 = getPropertyMeta(target, key);
    if (!meta2) {
      useLogger().error(`Missing property decorator for "${key.toString()}"`);
      return;
    }
    meta2.parser = value;
  };
}
function wrapper(value) {
  return (target, key) => {
    const meta2 = getPropertyMeta(target, key);
    if (!meta2) {
      useLogger().error(`Missing property decorator for "${key.toString()}"`);
      return;
    }
    meta2.parser = (raw) => new value(raw);
    if ("lerp" in value) {
      meta2.interpolationFunction ?? (meta2.interpolationFunction = value.lerp);
    }
  };
}
function cloneable(value = true) {
  return (target, key) => {
    const meta2 = getPropertyMeta(target, key);
    if (!meta2) {
      useLogger().error(`Missing property decorator for "${key.toString()}"`);
      return;
    }
    meta2.cloneable = value;
  };
}
function inspectable(value = true) {
  return (target, key) => {
    const meta2 = getPropertyMeta(target, key);
    if (!meta2) {
      useLogger().error(`Missing property decorator for "${key.toString()}"`);
      return;
    }
    meta2.inspectable = value;
  };
}
function compound(entries, klass = CompoundSignalContext) {
  return (target, key) => {
    const meta2 = getPropertyMetaOrCreate(target, key);
    meta2.compound = true;
    meta2.compoundEntries = Object.entries(entries);
    addInitializer(target, (instance) => {
      if (!meta2.parser) {
        useLogger().error(`Missing parser decorator for "${key.toString()}"`);
        return;
      }
      const initial2 = meta2.default;
      const parser2 = meta2.parser.bind(instance);
      const signalContext = new klass(meta2.compoundEntries.map(([key2, property]) => {
        const signal2 = new SignalContext(modify(initial2, (value) => parser2(value)[key2]), map, instance, void 0, makeSignalExtensions(void 0, instance, property)).toSignal();
        return [key2, signal2];
      }), parser2, initial2, meta2.interpolationFunction ?? deepLerp, instance, makeSignalExtensions(meta2, instance, key));
      instance[key] = signalContext.toSignal();
    });
  };
}
function vector2Signal(prefix) {
  return (target, key) => {
    compound(typeof prefix === "object" ? prefix : {
      x: prefix ? `${prefix}X` : "x",
      y: prefix ? `${prefix}Y` : "y"
    }, Vector2SignalContext)(target, key);
    wrapper(Vector2)(target, key);
  };
}
var __decorate$d = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
class Gradient {
  constructor(props) {
    initializeSignals(this, props);
  }
  canvasGradient(context) {
    let gradient;
    switch (this.type()) {
      case "linear":
        gradient = context.createLinearGradient(this.from.x(), this.from.y(), this.to.x(), this.to.y());
        break;
      case "conic":
        gradient = context.createConicGradient(this.angle(), this.from.x(), this.from.y());
        break;
      case "radial":
        gradient = context.createRadialGradient(this.from.x(), this.from.y(), this.fromRadius(), this.to.x(), this.to.y(), this.toRadius());
        break;
    }
    for (const { offset, color } of this.stops()) {
      gradient.addColorStop(unwrap(offset), new ExtendedColor(unwrap(color)).serialize());
    }
    return gradient;
  }
}
__decorate$d([
  initial("linear"),
  signal()
], Gradient.prototype, "type", void 0);
__decorate$d([
  vector2Signal("from")
], Gradient.prototype, "from", void 0);
__decorate$d([
  vector2Signal("to")
], Gradient.prototype, "to", void 0);
__decorate$d([
  initial(0),
  signal()
], Gradient.prototype, "angle", void 0);
__decorate$d([
  initial(0),
  signal()
], Gradient.prototype, "fromRadius", void 0);
__decorate$d([
  initial(0),
  signal()
], Gradient.prototype, "toRadius", void 0);
__decorate$d([
  initial([]),
  signal()
], Gradient.prototype, "stops", void 0);
__decorate$d([
  computed()
], Gradient.prototype, "canvasGradient", null);
var __decorate$c = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
class Pattern {
  constructor(props) {
    initializeSignals(this, props);
  }
  canvasPattern(context) {
    return context.createPattern(this.image(), this.repetition());
  }
}
__decorate$c([
  signal()
], Pattern.prototype, "image", void 0);
__decorate$c([
  initial(null),
  signal()
], Pattern.prototype, "repetition", void 0);
__decorate$c([
  computed()
], Pattern.prototype, "canvasPattern", null);
function canvasStyleParser(style) {
  if (style === null) {
    return null;
  }
  if (style instanceof Gradient) {
    return style;
  }
  if (style instanceof Pattern) {
    return style;
  }
  return new ExtendedColor(style);
}
function resolveCanvasStyle(style, context) {
  if (style === null) {
    return "";
  }
  if (style instanceof ExtendedColor) {
    return style.serialize();
  }
  if (style instanceof Gradient) {
    return style.canvasGradient(context);
  }
  if (style instanceof Pattern) {
    return style.canvasPattern(context) ?? "";
  }
  return "";
}
function drawRoundRect(context, rect, radius, smoothCorners, cornerSharpness) {
  if (radius.top === 0 && radius.right === 0 && radius.bottom === 0 && radius.left === 0) {
    drawRect(context, rect);
    return;
  }
  const topLeft = adjustRectRadius(radius.top, radius.right, radius.left, rect);
  const topRight = adjustRectRadius(radius.right, radius.top, radius.bottom, rect);
  const bottomRight = adjustRectRadius(radius.bottom, radius.left, radius.right, rect);
  const bottomLeft = adjustRectRadius(radius.left, radius.bottom, radius.top, rect);
  if (smoothCorners) {
    const sharpness = (radius2) => {
      const val = radius2 * cornerSharpness;
      return radius2 - val;
    };
    context.moveTo(rect.left + topLeft, rect.top);
    context.lineTo(rect.right - topRight, rect.top);
    context.bezierCurveTo(rect.right - sharpness(topRight), rect.top, rect.right, rect.top + sharpness(topRight), rect.right, rect.top + topRight);
    context.lineTo(rect.right, rect.bottom - bottomRight);
    context.bezierCurveTo(rect.right, rect.bottom - sharpness(bottomRight), rect.right - sharpness(bottomRight), rect.bottom, rect.right - bottomRight, rect.bottom);
    context.lineTo(rect.left + bottomLeft, rect.bottom);
    context.bezierCurveTo(rect.left + sharpness(bottomLeft), rect.bottom, rect.left, rect.bottom - sharpness(bottomLeft), rect.left, rect.bottom - bottomLeft);
    context.lineTo(rect.left, rect.top + topLeft);
    context.bezierCurveTo(rect.left, rect.top + sharpness(topLeft), rect.left + sharpness(topLeft), rect.top, rect.left + topLeft, rect.top);
    return;
  }
  context.moveTo(rect.left + topLeft, rect.top);
  context.arcTo(rect.right, rect.top, rect.right, rect.bottom, topRight);
  context.arcTo(rect.right, rect.bottom, rect.left, rect.bottom, bottomRight);
  context.arcTo(rect.left, rect.bottom, rect.left, rect.top, bottomLeft);
  context.arcTo(rect.left, rect.top, rect.right, rect.top, topLeft);
}
function adjustRectRadius(radius, horizontal, vertical, rect) {
  const width = radius + horizontal > rect.width ? rect.width * (radius / (radius + horizontal)) : radius;
  const height = radius + vertical > rect.height ? rect.height * (radius / (radius + vertical)) : radius;
  return Math.min(width, height);
}
function drawRect(context, rect) {
  context.rect(rect.x, rect.y, rect.width, rect.height);
}
function drawImage(context, image, first, second) {
  {
    context.drawImage(image, first.x, first.y, first.width, first.height);
  }
}
function moveTo(context, position) {
  context.moveTo(position.x, position.y);
}
function lineTo(context, position) {
  context.lineTo(position.x, position.y);
}
function drawLine(context, points) {
  if (points.length < 2)
    return;
  moveTo(context, points[0]);
  for (const point of points.slice(1)) {
    lineTo(context, point);
  }
}
function drawPivot(context, offset, radius = 8) {
  lineTo(context, offset.addY(-radius));
  lineTo(context, offset.addY(radius));
  lineTo(context, offset);
  lineTo(context, offset.addX(-radius));
  arc(context, offset, radius);
}
function arc(context, center, radius, startAngle = 0, endAngle = Math.PI * 2, counterclockwise = false) {
  context.arc(center.x, center.y, radius, startAngle, endAngle, counterclockwise);
}
function bezierCurveTo(context, controlPoint1, controlPoint2, to) {
  context.bezierCurveTo(controlPoint1.x, controlPoint1.y, controlPoint2.x, controlPoint2.y, to.x, to.y);
}
function is(klass) {
  return (object) => object instanceof klass;
}
function canvasStyleSignal() {
  return (target, key) => {
    signal()(target, key);
    parser(canvasStyleParser)(target, key);
    interpolation(ExtendedColor.lerp)(target, key);
    initial(null)(target, key);
  };
}
function colorSignal() {
  return (target, key) => {
    signal()(target, key);
    wrapper(ExtendedColor)(target, key);
  };
}
function defaultStyle(styleName, parse = (value) => value) {
  return (target, key) => {
    target[`getDefault${capitalize(key)}`] = function() {
      this.requestLayoutUpdate();
      const old = this.element.style[styleName];
      this.element.style[styleName] = "";
      const ret = parse.call(this, this.styles.getPropertyValue(styleName));
      this.element.style[styleName] = old;
      return ret;
    };
  };
}
class FiltersSignalContext extends SignalContext {
  constructor(initial2, owner) {
    super(initial2, deepLerp, owner);
    for (const filter in FILTERS) {
      const props = FILTERS[filter];
      Object.defineProperty(this.invokable, filter, {
        value: (newValue, duration, timingFunction = easeInOutCubic) => {
          var _a2, _b, _c;
          if (newValue === void 0) {
            return ((_b = (_a2 = this.get()) == null ? void 0 : _a2.find((filter2) => filter2.name === props.name)) == null ? void 0 : _b.value()) ?? props.default ?? 0;
          }
          let instance = (_c = this.get()) == null ? void 0 : _c.find((filter2) => filter2.name === props.name);
          if (!instance) {
            instance = new Filter(props);
            this.set([...this.get(), instance]);
          }
          if (duration === void 0) {
            instance.value(newValue);
            return this.owner;
          }
          return instance.value(newValue, duration, timingFunction);
        }
      });
    }
  }
  *tweener(value, duration, timingFunction) {
    const from = this.get();
    const to = unwrap(value);
    if (areFiltersCompatible(from, to)) {
      yield* all(...from.map((filter, i) => filter.value(to[i].value(), duration, timingFunction)));
      this.set(to);
      return;
    }
    for (const filter of to) {
      filter.value(filter.default);
    }
    const toValues = to.map((filter) => filter.value.context.raw());
    const partialDuration = from.length > 0 && to.length > 0 ? duration / 2 : duration;
    if (from.length > 0) {
      yield* all(...from.map((filter) => filter.value(filter.default, partialDuration, timingFunction)));
    }
    this.set(to);
    if (to.length > 0) {
      yield* all(...to.map((filter, index) => filter.value(toValues[index], partialDuration, timingFunction)));
    }
  }
}
function filtersSignal() {
  return (target, key) => {
    const meta2 = getPropertyMetaOrCreate(target, key);
    addInitializer(target, (instance) => {
      instance[key] = new FiltersSignalContext(meta2.default ?? [], instance).toSignal();
    });
  };
}
function areFiltersCompatible(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) {
      return false;
    }
  }
  return true;
}
const NODE_NAME = Symbol.for("@motion-canvas/2d/nodeName");
function nodeName(name) {
  return function(target) {
    target.prototype[NODE_NAME] = name;
  };
}
function getPointAtDistance(profile, distance) {
  const clamped = clamp(0, profile.arcLength, distance);
  let length = 0;
  for (const segment of profile.segments) {
    const previousLength = length;
    length += segment.arcLength;
    if (length >= clamped) {
      const relative = (clamped - previousLength) / segment.arcLength;
      return segment.getPoint(clamp(0, 1, relative));
    }
  }
  return { position: Vector2.zero, tangent: Vector2.up, normal: Vector2.up };
}
function spacingSignal(prefix) {
  return (target, key) => {
    compound({
      top: prefix ? `${prefix}Top` : "top",
      right: prefix ? `${prefix}Right` : "right",
      bottom: prefix ? `${prefix}Bottom` : "bottom",
      left: prefix ? `${prefix}Left` : "left"
    })(target, key);
    wrapper(Spacing)(target, key);
  };
}
function parseShader(value) {
  let result;
  if (!value) {
    result = [];
  } else if (typeof value === "string") {
    result = [{ fragment: value }];
  } else if (Array.isArray(value)) {
    result = value.map((item) => typeof item === "string" ? { fragment: item } : item);
  } else {
    result = [value];
  }
  if (!useScene().experimentalFeatures && result.length > 0) {
    result = [];
    useLogger().log({
      ...experimentalLog(`Node uses experimental shaders.`),
      inspect: this.key
    });
  }
  return result;
}
function useScene2D() {
  return useScene();
}
var __decorate$b = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var Node_1;
let Node = Node_1 = class Node2 {
  get x() {
    return this.position.x;
  }
  get y() {
    return this.position.y;
  }
  getAbsolutePosition() {
    return new Vector2(this.parentToWorld().transformPoint(this.position()));
  }
  setAbsolutePosition(value) {
    this.position(modify(value, (unwrapped) => new Vector2(unwrapped).transformAsPoint(this.worldToParent())));
  }
  getAbsoluteRotation() {
    const matrix = this.localToWorld();
    return Vector2.degrees(matrix.m11, matrix.m12);
  }
  setAbsoluteRotation(value) {
    this.rotation(modify(value, (unwrapped) => transformAngle(unwrapped, this.worldToParent())));
  }
  getAbsoluteScale() {
    const matrix = this.localToWorld();
    return new Vector2(Vector2.magnitude(matrix.m11, matrix.m12), Vector2.magnitude(matrix.m21, matrix.m22));
  }
  setAbsoluteScale(value) {
    this.scale(modify(value, (unwrapped) => this.getRelativeScale(new Vector2(unwrapped))));
  }
  getRelativeScale(scale) {
    var _a2;
    const parentScale = ((_a2 = this.parent()) == null ? void 0 : _a2.absoluteScale()) ?? Vector2.one;
    return scale.div(parentScale);
  }
  *tweenCompositeOperation(value, time, timingFunction) {
    const nextValue = unwrap(value);
    if (nextValue === "source-over") {
      yield* this.compositeOverride(1, time, timingFunction);
      this.compositeOverride(0);
      this.compositeOperation(nextValue);
    } else {
      this.compositeOperation(nextValue);
      this.compositeOverride(1);
      yield* this.compositeOverride(0, time, timingFunction);
    }
  }
  absoluteOpacity() {
    var _a2;
    return (((_a2 = this.parent()) == null ? void 0 : _a2.absoluteOpacity()) ?? 1) * this.opacity();
  }
  hasFilters() {
    return !!this.filters().find((filter) => filter.isActive());
  }
  hasShadow() {
    return !!this.shadowColor() && (this.shadowBlur() > 0 || this.shadowOffset.x() !== 0 || this.shadowOffset.y() !== 0);
  }
  filterString() {
    let filters = "";
    const matrix = this.compositeToWorld();
    for (const filter of this.filters()) {
      if (filter.isActive()) {
        filters += " " + filter.serialize(matrix);
      }
    }
    return filters;
  }
  getSpawner() {
    return this.children();
  }
  setSpawner(value) {
    this.children(value);
  }
  setChildren(value) {
    if (this.children.context.raw() === value) {
      return;
    }
    this.children.context.setter(value);
    if (!isReactive(value)) {
      this.spawnChildren(false, value);
    } else if (!this.hasSpawnedChildren) {
      for (const oldChild of this.realChildren) {
        oldChild.parent(null);
      }
    }
  }
  getChildren() {
    this.children.context.getter();
    return this.spawnedChildren();
  }
  spawnedChildren() {
    const children = this.children.context.getter();
    if (isReactive(this.children.context.raw())) {
      this.spawnChildren(true, children);
    }
    return this.realChildren;
  }
  sortedChildren() {
    return [...this.children()].sort((a, b) => Math.sign(a.zIndex() - b.zIndex()));
  }
  constructor({ children, spawner, key, ...rest }) {
    this.compositeOverride = createSignal(0);
    this.stateStack = [];
    this.realChildren = [];
    this.hasSpawnedChildren = false;
    this.parent = createSignal(null);
    this.properties = getPropertiesOf(this);
    const scene = useScene2D();
    [this.key, this.unregister] = scene.registerNode(this, key);
    this.view2D = scene.getView();
    this.creationStack = new Error().stack;
    initializeSignals(this, rest);
    if (spawner) {
      useLogger().warn({
        message: "Node.spawner() has been deprecated.",
        remarks: "Use <code>Node.children()</code> instead.",
        inspect: this.key,
        stack: new Error().stack
      });
    }
    this.children(spawner ?? children);
  }
  /**
   * Get the local-to-world matrix for this node.
   *
   * @remarks
   * This matrix transforms vectors from local space of this node to world
   * space.
   *
   * @example
   * Calculate the absolute position of a point located 200 pixels to the right
   * of the node:
   * ```ts
   * const local = new Vector2(0, 200);
   * const world = local.transformAsPoint(node.localToWorld());
   * ```
   */
  localToWorld() {
    const parent = this.parent();
    return parent ? parent.localToWorld().multiply(this.localToParent()) : this.localToParent();
  }
  /**
   * Get the world-to-local matrix for this node.
   *
   * @remarks
   * This matrix transforms vectors from world space to local space of this
   * node.
   *
   * @example
   * Calculate the position relative to this node for a point located in the
   * top-left corner of the screen:
   * ```ts
   * const world = new Vector2(0, 0);
   * const local = world.transformAsPoint(node.worldToLocal());
   * ```
   */
  worldToLocal() {
    return this.localToWorld().inverse();
  }
  /**
   * Get the world-to-parent matrix for this node.
   *
   * @remarks
   * This matrix transforms vectors from world space to local space of this
   * node's parent.
   */
  worldToParent() {
    var _a2;
    return ((_a2 = this.parent()) == null ? void 0 : _a2.worldToLocal()) ?? new DOMMatrix();
  }
  /**
   * Get the parent-to-world matrix for this node.
   *
   * @remarks
   * This matrix transforms vectors from local space of this node's parent to
   * world space.
   */
  parentToWorld() {
    var _a2;
    return ((_a2 = this.parent()) == null ? void 0 : _a2.localToWorld()) ?? new DOMMatrix();
  }
  /**
   * Get the local-to-parent matrix for this node.
   *
   * @remarks
   * This matrix transforms vectors from local space of this node to local space
   * of this node's parent.
   */
  localToParent() {
    const matrix = new DOMMatrix();
    matrix.translateSelf(this.x(), this.y());
    matrix.rotateSelf(0, 0, this.rotation());
    matrix.scaleSelf(this.scale.x(), this.scale.y());
    matrix.skewXSelf(this.skew.x());
    matrix.skewYSelf(this.skew.y());
    return matrix;
  }
  /**
   * A matrix mapping composite space to world space.
   *
   * @remarks
   * Certain effects such as blur and shadows ignore the current transformation.
   * This matrix can be used to transform their parameters so that the effect
   * appears relative to the closest composite root.
   */
  compositeToWorld() {
    var _a2;
    return ((_a2 = this.compositeRoot()) == null ? void 0 : _a2.localToWorld()) ?? new DOMMatrix();
  }
  compositeRoot() {
    var _a2;
    if (this.composite()) {
      return this;
    }
    return ((_a2 = this.parent()) == null ? void 0 : _a2.compositeRoot()) ?? null;
  }
  compositeToLocal() {
    const root = this.compositeRoot();
    if (root) {
      const worldToLocal = this.worldToLocal();
      worldToLocal.m44 = 1;
      return root.localToWorld().multiply(worldToLocal);
    }
    return new DOMMatrix();
  }
  view() {
    return this.view2D;
  }
  /**
   * Add the given node(s) as the children of this node.
   *
   * @remarks
   * The nodes will be appended at the end of the children list.
   *
   * @example
   * ```tsx
   * const node = <Layout />;
   * node.add(<Rect />);
   * node.add(<Circle />);
   * ```
   * Result:
   * ```mermaid
   * graph TD;
   *   layout([Layout])
   *   circle([Circle])
   *   rect([Rect])
   *     layout-->rect;
   *     layout-->circle;
   * ```
   *
   * @param node - A node or an array of nodes to append.
   */
  add(node) {
    return this.insert(node, Infinity);
  }
  /**
   * Insert the given node(s) at the specified index in the children list.
   *
   * @example
   * ```tsx
   * const node = (
   *   <Layout>
   *     <Rect />
   *     <Circle />
   *   </Layout>
   * );
   *
   * node.insert(<Txt />, 1);
   * ```
   *
   * Result:
   * ```mermaid
   * graph TD;
   *   layout([Layout])
   *   circle([Circle])
   *   text([Text])
   *   rect([Rect])
   *     layout-->rect;
   *     layout-->text;
   *     layout-->circle;
   * ```
   *
   * @param node - A node or an array of nodes to insert.
   * @param index - An index at which to insert the node(s).
   */
  insert(node, index = 0) {
    const array = Array.isArray(node) ? node : [node];
    if (array.length === 0) {
      return this;
    }
    const children = this.children();
    const newChildren = children.slice(0, index);
    for (const node2 of array) {
      if (node2 instanceof Node_1) {
        newChildren.push(node2);
        node2.remove();
        node2.parent(this);
      }
    }
    newChildren.push(...children.slice(index));
    this.setParsedChildren(newChildren);
    return this;
  }
  /**
   * Remove this node from the tree.
   */
  remove() {
    const current = this.parent();
    if (current === null) {
      return this;
    }
    current.removeChild(this);
    this.parent(null);
    return this;
  }
  /**
   * Rearrange this node in relation to its siblings.
   *
   * @remarks
   * Children are rendered starting from the beginning of the children list.
   * We can change the rendering order by rearranging said list.
   *
   * A positive `by` arguments move the node up (it will be rendered on top of
   * the elements it has passed). Negative values move it down.
   *
   * @param by - Number of places by which the node should be moved.
   */
  move(by = 1) {
    const parent = this.parent();
    if (by === 0 || !parent) {
      return this;
    }
    const children = parent.children();
    const newChildren = [];
    if (by > 0) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child === this) {
          const target = i + by;
          for (; i < target && i + 1 < children.length; i++) {
            newChildren[i] = children[i + 1];
          }
        }
        newChildren[i] = child;
      }
    } else {
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child === this) {
          const target = i + by;
          for (; i > target && i > 0; i--) {
            newChildren[i] = children[i - 1];
          }
        }
        newChildren[i] = child;
      }
    }
    parent.setParsedChildren(newChildren);
    return this;
  }
  /**
   * Move the node up in relation to its siblings.
   *
   * @remarks
   * The node will exchange places with the sibling right above it (if any) and
   * from then on will be rendered on top of it.
   */
  moveUp() {
    return this.move(1);
  }
  /**
   * Move the node down in relation to its siblings.
   *
   * @remarks
   * The node will exchange places with the sibling right below it (if any) and
   * from then on will be rendered under it.
   */
  moveDown() {
    return this.move(-1);
  }
  /**
   * Move the node to the top in relation to its siblings.
   *
   * @remarks
   * The node will be placed at the end of the children list and from then on
   * will be rendered on top of all of its siblings.
   */
  moveToTop() {
    return this.move(Infinity);
  }
  /**
   * Move the node to the bottom in relation to its siblings.
   *
   * @remarks
   * The node will be placed at the beginning of the children list and from then
   * on will be rendered below all of its siblings.
   */
  moveToBottom() {
    return this.move(-Infinity);
  }
  /**
   * Move the node to the provided position relative to its siblings.
   *
   * @remarks
   * If the node is getting moved to a lower position, it will be placed below
   * the sibling that's currently at the provided index (if any).
   * If the node is getting moved to a higher position, it will be placed above
   * the sibling that's currently at the provided index (if any).
   *
   * @param index - The index to move the node to.
   */
  moveTo(index) {
    const parent = this.parent();
    if (!parent) {
      return this;
    }
    const currentIndex = parent.children().indexOf(this);
    const by = index - currentIndex;
    return this.move(by);
  }
  /**
   * Move the node below the provided node in the parent's layout.
   *
   * @remarks
   * The node will be moved below the provided node and from then on will be
   * rendered below it. By default, if the node is already positioned lower than
   * the sibling node, it will not get moved.
   *
   * @param node - The sibling node below which to move.
   * @param directlyBelow - Whether the node should be positioned directly below
   *                        the sibling. When true, will move the node even if
   *                        it is already positioned below the sibling.
   */
  moveBelow(node, directlyBelow = false) {
    const parent = this.parent();
    if (!parent) {
      return this;
    }
    if (node.parent() !== parent) {
      useLogger().error("Cannot position nodes relative to each other if they don't belong to the same parent.");
      return this;
    }
    const children = parent.children();
    const ownIndex = children.indexOf(this);
    const otherIndex = children.indexOf(node);
    if (!directlyBelow && ownIndex < otherIndex) {
      return this;
    }
    const by = otherIndex - ownIndex - 1;
    return this.move(by);
  }
  /**
   * Move the node above the provided node in the parent's layout.
   *
   * @remarks
   * The node will be moved above the provided node and from then on will be
   * rendered on top of it. By default, if the node is already positioned
   * higher than the sibling node, it will not get moved.
   *
   * @param node - The sibling node below which to move.
   * @param directlyAbove - Whether the node should be positioned directly above the
   *                        sibling. When true, will move the node even if it is
   *                        already positioned above the sibling.
   */
  moveAbove(node, directlyAbove = false) {
    const parent = this.parent();
    if (!parent) {
      return this;
    }
    if (node.parent() !== parent) {
      useLogger().error("Cannot position nodes relative to each other if they don't belong to the same parent.");
      return this;
    }
    const children = parent.children();
    const ownIndex = children.indexOf(this);
    const otherIndex = children.indexOf(node);
    if (!directlyAbove && ownIndex > otherIndex) {
      return this;
    }
    const by = otherIndex - ownIndex + 1;
    return this.move(by);
  }
  /**
   * Change the parent of this node while keeping the absolute transform.
   *
   * @remarks
   * After performing this operation, the node will stay in the same place
   * visually, but its parent will be changed.
   *
   * @param newParent - The new parent of this node.
   */
  reparent(newParent) {
    const position = this.absolutePosition();
    const rotation = this.absoluteRotation();
    const scale = this.absoluteScale();
    newParent.add(this);
    this.absolutePosition(position);
    this.absoluteRotation(rotation);
    this.absoluteScale(scale);
    return this;
  }
  /**
   * Remove all children of this node.
   */
  removeChildren() {
    for (const oldChild of this.realChildren) {
      oldChild.parent(null);
    }
    this.setParsedChildren([]);
    return this;
  }
  /**
   * Get the current children of this node.
   *
   * @remarks
   * Unlike {@link children}, this method does not have any side effects.
   * It does not register the `children` signal as a dependency, and it does not
   * spawn any children. It can be used to safely retrieve the current state of
   * the scene graph for debugging purposes.
   */
  peekChildren() {
    return this.realChildren;
  }
  findAll(predicate) {
    const result = [];
    const queue = this.reversedChildren();
    while (queue.length > 0) {
      const node = queue.pop();
      if (predicate(node)) {
        result.push(node);
      }
      const children = node.children();
      for (let i = children.length - 1; i >= 0; i--) {
        queue.push(children[i]);
      }
    }
    return result;
  }
  findFirst(predicate) {
    const queue = this.reversedChildren();
    while (queue.length > 0) {
      const node = queue.pop();
      if (predicate(node)) {
        return node;
      }
      const children = node.children();
      for (let i = children.length - 1; i >= 0; i--) {
        queue.push(children[i]);
      }
    }
    return null;
  }
  findLast(predicate) {
    const search = [];
    const queue = this.reversedChildren();
    while (queue.length > 0) {
      const node = queue.pop();
      search.push(node);
      const children = node.children();
      for (let i = children.length - 1; i >= 0; i--) {
        queue.push(children[i]);
      }
    }
    while (search.length > 0) {
      const node = search.pop();
      if (predicate(node)) {
        return node;
      }
    }
    return null;
  }
  findAncestor(predicate) {
    let parent = this.parent();
    while (parent) {
      if (predicate(parent)) {
        return parent;
      }
      parent = parent.parent();
    }
    return null;
  }
  /**
   * Get the nth children cast to the specified type.
   *
   * @param index - The index of the child to retrieve.
   */
  childAs(index) {
    return this.children()[index] ?? null;
  }
  /**
   * Get the children array cast to the specified type.
   */
  childrenAs() {
    return this.children();
  }
  /**
   * Get the parent cast to the specified type.
   */
  parentAs() {
    return this.parent() ?? null;
  }
  /**
   * Prepare this node to be disposed of.
   *
   * @remarks
   * This method is called automatically when a scene is refreshed. It will
   * be called even if the node is not currently attached to the tree.
   *
   * The goal of this method is to clean any external references to allow the
   * node to be garbage collected.
   */
  dispose() {
    if (!this.unregister) {
      return;
    }
    this.stateStack = [];
    this.unregister();
    this.unregister = null;
    for (const { signal: signal2 } of this) {
      signal2 == null ? void 0 : signal2.context.dispose();
    }
    for (const child of this.realChildren) {
      child.dispose();
    }
  }
  /**
   * Create a copy of this node.
   *
   * @param customProps - Properties to override.
   */
  clone(customProps = {}) {
    const props = { ...customProps };
    if (isReactive(this.children.context.raw())) {
      props.children ?? (props.children = this.children.context.raw());
    } else if (this.children().length > 0) {
      props.children ?? (props.children = this.children().map((child) => child.clone()));
    }
    for (const { key, meta: meta2, signal: signal2 } of this) {
      if (!meta2.cloneable || key in props)
        continue;
      if (meta2.compound) {
        for (const [key2, property] of meta2.compoundEntries) {
          if (property in props)
            continue;
          const component = signal2[key2];
          if (!component.context.isInitial()) {
            props[property] = component.context.raw();
          }
        }
      } else if (!signal2.context.isInitial()) {
        props[key] = signal2.context.raw();
      }
    }
    return this.instantiate(props);
  }
  /**
   * Create a copy of this node.
   *
   * @remarks
   * Unlike {@link clone}, a snapshot clone calculates any reactive properties
   * at the moment of cloning and passes the raw values to the copy.
   *
   * @param customProps - Properties to override.
   */
  snapshotClone(customProps = {}) {
    const props = {
      ...this.getState(),
      ...customProps
    };
    if (this.children().length > 0) {
      props.children ?? (props.children = this.children().map((child) => child.snapshotClone()));
    }
    return this.instantiate(props);
  }
  /**
   * Create a reactive copy of this node.
   *
   * @remarks
   * A reactive copy has all its properties dynamically updated to match the
   * source node.
   *
   * @param customProps - Properties to override.
   */
  reactiveClone(customProps = {}) {
    const props = { ...customProps };
    if (this.children().length > 0) {
      props.children ?? (props.children = this.children().map((child) => child.reactiveClone()));
    }
    for (const { key, meta: meta2, signal: signal2 } of this) {
      if (!meta2.cloneable || key in props)
        continue;
      props[key] = () => signal2();
    }
    return this.instantiate(props);
  }
  /**
   * Create an instance of this node's class.
   *
   * @param props - Properties to pass to the constructor.
   */
  instantiate(props = {}) {
    return new this.constructor(props);
  }
  /**
   * Set the children without parsing them.
   *
   * @remarks
   * This method assumes that the caller took care of parsing the children and
   * updating the hierarchy.
   *
   * @param value - The children to set.
   */
  setParsedChildren(value) {
    this.children.context.setter(value);
    this.realChildren = value;
  }
  spawnChildren(reactive, children) {
    const parsedChildren = this.parseChildren(children);
    const keep = /* @__PURE__ */ new Set();
    for (const newChild of parsedChildren) {
      const current = newChild.parent.context.raw();
      if (current && current !== this) {
        current.removeChild(newChild);
      }
      keep.add(newChild.key);
      newChild.parent(this);
    }
    for (const oldChild of this.realChildren) {
      if (!keep.has(oldChild.key)) {
        oldChild.parent(null);
      }
    }
    this.hasSpawnedChildren = reactive;
    this.realChildren = parsedChildren;
  }
  /**
   * Parse any `ComponentChildren` into an array of nodes.
   *
   * @param children - The children to parse.
   */
  parseChildren(children) {
    const result = [];
    const array = Array.isArray(children) ? children : [children];
    for (const child of array) {
      if (child instanceof Node_1) {
        result.push(child);
      }
    }
    return result;
  }
  /**
   * Remove the given child.
   */
  removeChild(child) {
    this.setParsedChildren(this.children().filter((node) => node !== child));
  }
  /**
   * Whether this node should be cached or not.
   */
  requiresCache() {
    return this.cache() || this.opacity() < 1 || this.compositeOperation() !== "source-over" || this.hasFilters() || this.hasShadow() || this.shaders().length > 0;
  }
  cacheCanvas() {
    const canvas = document.createElement("canvas").getContext("2d");
    if (!canvas) {
      throw new Error("Could not create a cache canvas");
    }
    return canvas;
  }
  /**
   * Get a cache canvas with the contents of this node rendered onto it.
   */
  cachedCanvas() {
    const context = this.cacheCanvas();
    const cache = this.worldSpaceCacheBBox();
    const matrix = this.localToWorld();
    context.canvas.width = cache.width;
    context.canvas.height = cache.height;
    context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - cache.x, matrix.f - cache.y);
    this.draw(context);
    return context;
  }
  /**
   * Get a bounding box for the contents rendered by this node.
   *
   * @remarks
   * The returned bounding box should be in local space.
   */
  getCacheBBox() {
    return new BBox();
  }
  /**
   * Get a bounding box for the contents rendered by this node as well
   * as its children.
   */
  cacheBBox() {
    const cache = this.getCacheBBox();
    const children = this.children();
    const padding = this.cachePadding();
    if (children.length === 0) {
      return cache.addSpacing(padding);
    }
    const points = cache.corners;
    for (const child of children) {
      const childCache = child.fullCacheBBox();
      const childMatrix = child.localToParent();
      points.push(...childCache.corners.map((r) => r.transformAsPoint(childMatrix)));
    }
    const bbox = BBox.fromPoints(...points);
    return bbox.addSpacing(padding);
  }
  /**
   * Get a bounding box for the contents rendered by this node (including
   * effects applied after caching).
   *
   * @remarks
   * The returned bounding box should be in local space.
   */
  fullCacheBBox() {
    const matrix = this.compositeToLocal();
    const shadowOffset = this.shadowOffset().transform(matrix);
    const shadowBlur = transformScalar(this.shadowBlur(), matrix);
    const result = this.cacheBBox().expand(this.filters.blur() * 2 + shadowBlur);
    if (shadowOffset.x < 0) {
      result.x += shadowOffset.x;
      result.width -= shadowOffset.x;
    } else {
      result.width += shadowOffset.x;
    }
    if (shadowOffset.y < 0) {
      result.y += shadowOffset.y;
      result.height -= shadowOffset.y;
    } else {
      result.height += shadowOffset.y;
    }
    return result;
  }
  /**
   * Get a bounding box in world space for the contents rendered by this node as
   * well as its children.
   *
   * @remarks
   * This is the same the bounding box returned by {@link cacheBBox} only
   * transformed to world space.
   */
  worldSpaceCacheBBox() {
    const viewBBox = BBox.fromSizeCentered(this.view().size()).expand(this.view().cachePadding());
    const canvasBBox = BBox.fromPoints(...viewBBox.transformCorners(this.view().localToWorld()));
    const cacheBBox = BBox.fromPoints(...this.cacheBBox().transformCorners(this.localToWorld()));
    return canvasBBox.intersection(cacheBBox).pixelPerfect.expand(2);
  }
  parentWorldSpaceCacheBBox() {
    var _a2;
    return ((_a2 = this.findAncestor((node) => node.requiresCache())) == null ? void 0 : _a2.worldSpaceCacheBBox()) ?? new BBox(Vector2.zero, useScene2D().getRealSize());
  }
  /**
   * Prepare the given context for drawing a cached node onto it.
   *
   * @remarks
   * This method is called before the contents of the cache canvas are drawn
   * on the screen. It can be used to apply effects to the entire node together
   * with its children, instead of applying them individually.
   * Effects such as transparency, shadows, and filters use this technique.
   *
   * Whether the node is cached is decided by the {@link requiresCache} method.
   *
   * @param context - The context using which the cache will be drawn.
   */
  setupDrawFromCache(context) {
    context.globalCompositeOperation = this.compositeOperation();
    context.globalAlpha *= this.opacity();
    if (this.hasFilters()) {
      context.filter = this.filterString();
    }
    if (this.hasShadow()) {
      const matrix2 = this.compositeToWorld();
      const offset = this.shadowOffset().transform(matrix2);
      const blur = transformScalar(this.shadowBlur(), matrix2);
      context.shadowColor = this.shadowColor().serialize();
      context.shadowBlur = blur;
      context.shadowOffsetX = offset.x;
      context.shadowOffsetY = offset.y;
    }
    const matrix = this.worldToLocal();
    context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  }
  renderFromSource(context, source, x, y) {
    this.setupDrawFromCache(context);
    const compositeOverride = this.compositeOverride();
    context.drawImage(source, x, y);
    if (compositeOverride > 0) {
      context.save();
      context.globalAlpha *= compositeOverride;
      context.globalCompositeOperation = "source-over";
      context.drawImage(source, x, y);
      context.restore();
    }
  }
  shaderCanvas(destination, source) {
    var _a2, _b;
    const shaders = this.shaders();
    if (shaders.length === 0) {
      return null;
    }
    const scene = useScene2D();
    const size = scene.getRealSize();
    const parentCacheRect = this.parentWorldSpaceCacheBBox();
    const cameraToWorld = new DOMMatrix().scaleSelf(size.width / parentCacheRect.width, size.height / -parentCacheRect.height).translateSelf(parentCacheRect.x / -size.width, parentCacheRect.y / size.height - 1);
    const cacheRect = this.worldSpaceCacheBBox();
    const cameraToCache = new DOMMatrix().scaleSelf(size.width / cacheRect.width, size.height / -cacheRect.height).translateSelf(cacheRect.x / -size.width, cacheRect.y / size.height - 1).invertSelf();
    const gl = scene.shaders.getGL();
    scene.shaders.copyTextures(destination, source);
    scene.shaders.clear();
    for (const shader of shaders) {
      const program = scene.shaders.getProgram(shader.fragment);
      if (!program) {
        continue;
      }
      if (shader.uniforms) {
        for (const [name, uniform] of Object.entries(shader.uniforms)) {
          const location = gl.getUniformLocation(program, name);
          if (location === null) {
            continue;
          }
          const value = unwrap(uniform);
          if (typeof value === "number") {
            gl.uniform1f(location, value);
          } else if ("toUniform" in value) {
            value.toUniform(gl, location);
          } else if (value.length === 1) {
            gl.uniform1f(location, value[0]);
          } else if (value.length === 2) {
            gl.uniform2f(location, value[0], value[1]);
          } else if (value.length === 3) {
            gl.uniform3f(location, value[0], value[1], value[2]);
          } else if (value.length === 4) {
            gl.uniform4f(location, value[0], value[1], value[2], value[3]);
          }
        }
      }
      gl.uniform1f(gl.getUniformLocation(program, UNIFORM_TIME), this.view2D.globalTime());
      gl.uniform1i(gl.getUniformLocation(program, UNIFORM_TIME), scene.playback.frame);
      gl.uniformMatrix4fv(gl.getUniformLocation(program, UNIFORM_SOURCE_MATRIX), false, cameraToCache.toFloat32Array());
      gl.uniformMatrix4fv(gl.getUniformLocation(program, UNIFORM_DESTINATION_MATRIX), false, cameraToWorld.toFloat32Array());
      (_a2 = shader.setup) == null ? void 0 : _a2.call(shader, gl, program);
      scene.shaders.render();
      (_b = shader.teardown) == null ? void 0 : _b.call(shader, gl, program);
    }
    return gl.canvas;
  }
  /**
   * Render this node onto the given canvas.
   *
   * @param context - The context to draw with.
   */
  render(context) {
    if (this.absoluteOpacity() <= 0) {
      return;
    }
    context.save();
    this.transformContext(context);
    if (this.requiresCache()) {
      const cacheRect = this.worldSpaceCacheBBox();
      if (cacheRect.width !== 0 && cacheRect.height !== 0) {
        const cache = this.cachedCanvas().canvas;
        const source = this.shaderCanvas(context.canvas, cache);
        if (source) {
          this.renderFromSource(context, source, 0, 0);
        } else {
          this.renderFromSource(context, cache, cacheRect.position.x, cacheRect.position.y);
        }
      }
    } else {
      this.draw(context);
    }
    context.restore();
  }
  /**
   * Draw this node onto the canvas.
   *
   * @remarks
   * This method is used when drawing directly onto the screen as well as onto
   * the cache canvas.
   * It assumes that the context have already been transformed to local space.
   *
   * @param context - The context to draw with.
   */
  draw(context) {
    this.drawChildren(context);
  }
  drawChildren(context) {
    for (const child of this.sortedChildren()) {
      child.render(context);
    }
  }
  /**
   * Draw an overlay for this node.
   *
   * @remarks
   * The overlay for the currently inspected node is displayed on top of the
   * canvas.
   *
   * The provided context is in screen space. The local-to-screen matrix can be
   * used to transform all shapes that need to be displayed.
   * This approach allows to keep the line widths and gizmo sizes consistent,
   * no matter how zoomed-in the view is.
   *
   * @param context - The context to draw with.
   * @param matrix - A local-to-screen matrix.
   */
  drawOverlay(context, matrix) {
    const box = this.cacheBBox().transformCorners(matrix);
    const cache = this.getCacheBBox().transformCorners(matrix);
    context.strokeStyle = "white";
    context.lineWidth = 1;
    context.beginPath();
    drawLine(context, box);
    context.closePath();
    context.stroke();
    context.strokeStyle = "blue";
    context.beginPath();
    drawLine(context, cache);
    context.closePath();
    context.stroke();
  }
  transformContext(context) {
    const matrix = this.localToParent();
    context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  }
  /**
   * Try to find a node intersecting the given position.
   *
   * @param position - The searched position.
   */
  hit(position) {
    let hit = null;
    const local = position.transformAsPoint(this.localToParent().inverse());
    const children = this.children();
    for (let i = children.length - 1; i >= 0; i--) {
      hit = children[i].hit(local);
      if (hit) {
        break;
      }
    }
    return hit;
  }
  /**
   * Collect all asynchronous resources used by this node.
   */
  collectAsyncResources() {
    for (const child of this.children()) {
      child.collectAsyncResources();
    }
  }
  /**
   * Wait for any asynchronous resources that this node or its children have.
   *
   * @remarks
   * Certain resources like images are always loaded asynchronously.
   * Awaiting this method makes sure that all such resources are done loading
   * before continuing the animation.
   */
  async toPromise() {
    do {
      await DependencyContext.consumePromises();
      this.collectAsyncResources();
    } while (DependencyContext.hasPromises());
    return this;
  }
  /**
   * Return a snapshot of the node's current signal values.
   *
   * @remarks
   * This method will calculate the values of any reactive properties of the
   * node at the time the method is called.
   */
  getState() {
    const state = {};
    for (const { key, meta: meta2, signal: signal2 } of this) {
      if (!meta2.cloneable || key in state)
        continue;
      state[key] = signal2();
    }
    return state;
  }
  applyState(state, duration, timing = easeInOutCubic) {
    if (duration === void 0) {
      for (const key in state) {
        const signal2 = this.signalByKey(key);
        if (signal2) {
          signal2(state[key]);
        }
      }
    }
    const tasks = [];
    for (const key in state) {
      const signal2 = this.signalByKey(key);
      if (state[key] !== signal2.context.raw()) {
        tasks.push(signal2(state[key], duration, timing));
      }
    }
    return all(...tasks);
  }
  /**
   * Push a snapshot of the node's current state onto the node's state stack.
   *
   * @remarks
   * This method can be used together with the {@link restore} method to save a
   * node's current state and later restore it. It is possible to store more
   * than one state by calling `save` method multiple times.
   */
  save() {
    this.stateStack.push(this.getState());
  }
  restore(duration, timing = easeInOutCubic) {
    const state = this.stateStack.pop();
    if (state !== void 0) {
      return this.applyState(state, duration, timing);
    }
  }
  *[Symbol.iterator]() {
    for (const key in this.properties) {
      const meta2 = this.properties[key];
      const signal2 = this.signalByKey(key);
      yield { meta: meta2, signal: signal2, key };
    }
  }
  signalByKey(key) {
    return this[key];
  }
  reversedChildren() {
    const children = this.children();
    const result = [];
    for (let i = children.length - 1; i >= 0; i--) {
      result.push(children[i]);
    }
    return result;
  }
};
__decorate$b([
  vector2Signal()
], Node.prototype, "position", void 0);
__decorate$b([
  wrapper(Vector2),
  cloneable(false),
  signal()
], Node.prototype, "absolutePosition", void 0);
__decorate$b([
  initial(0),
  signal()
], Node.prototype, "rotation", void 0);
__decorate$b([
  cloneable(false),
  signal()
], Node.prototype, "absoluteRotation", void 0);
__decorate$b([
  initial(Vector2.one),
  vector2Signal("scale")
], Node.prototype, "scale", void 0);
__decorate$b([
  initial(Vector2.zero),
  vector2Signal("skew")
], Node.prototype, "skew", void 0);
__decorate$b([
  wrapper(Vector2),
  cloneable(false),
  signal()
], Node.prototype, "absoluteScale", void 0);
__decorate$b([
  initial(0),
  signal()
], Node.prototype, "zIndex", void 0);
__decorate$b([
  initial(false),
  signal()
], Node.prototype, "cache", void 0);
__decorate$b([
  spacingSignal("cachePadding")
], Node.prototype, "cachePadding", void 0);
__decorate$b([
  initial(false),
  signal()
], Node.prototype, "composite", void 0);
__decorate$b([
  initial("source-over"),
  signal()
], Node.prototype, "compositeOperation", void 0);
__decorate$b([
  threadable()
], Node.prototype, "tweenCompositeOperation", null);
__decorate$b([
  initial(1),
  parser((value) => clamp(0, 1, value)),
  signal()
], Node.prototype, "opacity", void 0);
__decorate$b([
  computed()
], Node.prototype, "absoluteOpacity", null);
__decorate$b([
  filtersSignal()
], Node.prototype, "filters", void 0);
__decorate$b([
  initial("#0000"),
  colorSignal()
], Node.prototype, "shadowColor", void 0);
__decorate$b([
  initial(0),
  signal()
], Node.prototype, "shadowBlur", void 0);
__decorate$b([
  vector2Signal("shadowOffset")
], Node.prototype, "shadowOffset", void 0);
__decorate$b([
  initial([]),
  parser(parseShader),
  signal()
], Node.prototype, "shaders", void 0);
__decorate$b([
  computed()
], Node.prototype, "hasFilters", null);
__decorate$b([
  computed()
], Node.prototype, "hasShadow", null);
__decorate$b([
  computed()
], Node.prototype, "filterString", null);
__decorate$b([
  inspectable(false),
  cloneable(false),
  signal()
], Node.prototype, "spawner", void 0);
__decorate$b([
  inspectable(false),
  cloneable(false),
  signal()
], Node.prototype, "children", void 0);
__decorate$b([
  computed()
], Node.prototype, "spawnedChildren", null);
__decorate$b([
  computed()
], Node.prototype, "sortedChildren", null);
__decorate$b([
  computed()
], Node.prototype, "localToWorld", null);
__decorate$b([
  computed()
], Node.prototype, "worldToLocal", null);
__decorate$b([
  computed()
], Node.prototype, "worldToParent", null);
__decorate$b([
  computed()
], Node.prototype, "parentToWorld", null);
__decorate$b([
  computed()
], Node.prototype, "localToParent", null);
__decorate$b([
  computed()
], Node.prototype, "compositeToWorld", null);
__decorate$b([
  computed()
], Node.prototype, "compositeRoot", null);
__decorate$b([
  computed()
], Node.prototype, "compositeToLocal", null);
__decorate$b([
  computed()
], Node.prototype, "cacheCanvas", null);
__decorate$b([
  computed()
], Node.prototype, "cachedCanvas", null);
__decorate$b([
  computed()
], Node.prototype, "cacheBBox", null);
__decorate$b([
  computed()
], Node.prototype, "fullCacheBBox", null);
__decorate$b([
  computed()
], Node.prototype, "worldSpaceCacheBBox", null);
__decorate$b([
  computed()
], Node.prototype, "parentWorldSpaceCacheBBox", null);
Node = Node_1 = __decorate$b([
  nodeName("Node")
], Node);
Node.prototype.isClass = true;
var __decorate$a = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var Layout_1;
let Layout = Layout_1 = class Layout2 extends Node {
  get columnGap() {
    return this.gap.x;
  }
  get rowGap() {
    return this.gap.y;
  }
  getX() {
    if (this.isLayoutRoot()) {
      return this.x.context.getter();
    }
    return this.computedPosition().x;
  }
  setX(value) {
    this.x.context.setter(value);
  }
  getY() {
    if (this.isLayoutRoot()) {
      return this.y.context.getter();
    }
    return this.computedPosition().y;
  }
  setY(value) {
    this.y.context.setter(value);
  }
  get width() {
    return this.size.x;
  }
  get height() {
    return this.size.y;
  }
  getWidth() {
    return this.computedSize().width;
  }
  setWidth(value) {
    this.width.context.setter(value);
  }
  *tweenWidth(value, time, timingFunction, interpolationFunction) {
    const width = this.desiredSize().x;
    const lock = typeof width !== "number" || typeof value !== "number";
    let from;
    if (lock) {
      from = this.size.x();
    } else {
      from = width;
    }
    let to;
    if (lock) {
      this.size.x(value);
      to = this.size.x();
    } else {
      to = value;
    }
    this.size.x(from);
    lock && this.lockSize();
    yield* tween(time, (value2) => this.size.x(interpolationFunction(from, to, timingFunction(value2))));
    this.size.x(value);
    lock && this.releaseSize();
  }
  getHeight() {
    return this.computedSize().height;
  }
  setHeight(value) {
    this.height.context.setter(value);
  }
  *tweenHeight(value, time, timingFunction, interpolationFunction) {
    const height = this.desiredSize().y;
    const lock = typeof height !== "number" || typeof value !== "number";
    let from;
    if (lock) {
      from = this.size.y();
    } else {
      from = height;
    }
    let to;
    if (lock) {
      this.size.y(value);
      to = this.size.y();
    } else {
      to = value;
    }
    this.size.y(from);
    lock && this.lockSize();
    yield* tween(time, (value2) => this.size.y(interpolationFunction(from, to, timingFunction(value2))));
    this.size.y(value);
    lock && this.releaseSize();
  }
  /**
   * Get the desired size of this node.
   *
   * @remarks
   * This method can be used to control the size using external factors.
   * By default, the returned size is the same as the one declared by the user.
   */
  desiredSize() {
    return {
      x: this.width.context.getter(),
      y: this.height.context.getter()
    };
  }
  *tweenSize(value, time, timingFunction, interpolationFunction) {
    const size = this.desiredSize();
    let from;
    if (typeof size.x !== "number" || typeof size.y !== "number") {
      from = this.size();
    } else {
      from = new Vector2(size);
    }
    let to;
    if (typeof value === "object" && typeof value.x === "number" && typeof value.y === "number") {
      to = new Vector2(value);
    } else {
      this.size(value);
      to = this.size();
    }
    this.size(from);
    this.lockSize();
    yield* tween(time, (value2) => this.size(interpolationFunction(from, to, timingFunction(value2))));
    this.releaseSize();
    this.size(value);
  }
  /**
   * Get the cardinal point corresponding to the given origin.
   *
   * @param origin - The origin or direction of the point.
   */
  cardinalPoint(origin) {
    switch (origin) {
      case Origin.TopLeft:
        return this.topLeft;
      case Origin.TopRight:
        return this.topRight;
      case Origin.BottomLeft:
        return this.bottomLeft;
      case Origin.BottomRight:
        return this.bottomRight;
      case Origin.Top:
      case Direction.Top:
        return this.top;
      case Origin.Bottom:
      case Direction.Bottom:
        return this.bottom;
      case Origin.Left:
      case Direction.Left:
        return this.left;
      case Origin.Right:
      case Direction.Right:
        return this.right;
      default:
        return this.middle;
    }
  }
  constructor(props) {
    super(props);
    this.element.dataset.motionCanvasKey = this.key;
  }
  lockSize() {
    this.sizeLockCounter(this.sizeLockCounter() + 1);
  }
  releaseSize() {
    this.sizeLockCounter(this.sizeLockCounter() - 1);
  }
  parentTransform() {
    return this.findAncestor(is(Layout_1));
  }
  anchorPosition() {
    const size = this.computedSize();
    const offset = this.offset();
    return size.scale(0.5).mul(offset);
  }
  /**
   * Get the resolved layout mode of this node.
   *
   * @remarks
   * When the mode is `null`, its value will be inherited from the parent.
   *
   * Use {@link layout} to get the raw mode set for this node (without
   * inheritance).
   */
  layoutEnabled() {
    var _a2;
    return this.layout() ?? ((_a2 = this.parentTransform()) == null ? void 0 : _a2.layoutEnabled()) ?? false;
  }
  isLayoutRoot() {
    var _a2;
    return !this.layoutEnabled() || !((_a2 = this.parentTransform()) == null ? void 0 : _a2.layoutEnabled());
  }
  localToParent() {
    const matrix = super.localToParent();
    const offset = this.offset();
    if (!offset.exactlyEquals(Vector2.zero)) {
      const translate = this.size().mul(offset).scale(-0.5);
      matrix.translateSelf(translate.x, translate.y);
    }
    return matrix;
  }
  /**
   * A simplified version of {@link localToParent} matrix used for transforming
   * direction vectors.
   *
   * @internal
   */
  scalingRotationMatrix() {
    const matrix = new DOMMatrix();
    matrix.rotateSelf(0, 0, this.rotation());
    matrix.scaleSelf(this.scale.x(), this.scale.y());
    const offset = this.offset();
    if (!offset.exactlyEquals(Vector2.zero)) {
      const translate = this.size().mul(offset).scale(-0.5);
      matrix.translateSelf(translate.x, translate.y);
    }
    return matrix;
  }
  getComputedLayout() {
    return new BBox(this.element.getBoundingClientRect());
  }
  computedPosition() {
    this.requestLayoutUpdate();
    const box = this.getComputedLayout();
    const position = new Vector2(box.x + box.width / 2 * this.offset.x(), box.y + box.height / 2 * this.offset.y());
    const parent = this.parentTransform();
    if (parent) {
      const parentRect = parent.getComputedLayout();
      position.x -= parentRect.x + (parentRect.width - box.width) / 2;
      position.y -= parentRect.y + (parentRect.height - box.height) / 2;
    }
    return position;
  }
  computedSize() {
    this.requestLayoutUpdate();
    return this.getComputedLayout().size;
  }
  /**
   * Find the closest layout root and apply any new layout changes.
   */
  requestLayoutUpdate() {
    const parent = this.parentTransform();
    if (this.appendedToView()) {
      parent == null ? void 0 : parent.requestFontUpdate();
      this.updateLayout();
    } else {
      parent.requestLayoutUpdate();
    }
  }
  appendedToView() {
    const root = this.isLayoutRoot();
    if (root) {
      this.view().element.append(this.element);
    }
    return root;
  }
  /**
   * Apply any new layout changes to this node and its children.
   */
  updateLayout() {
    this.applyFont();
    this.applyFlex();
    if (this.layoutEnabled()) {
      const children = this.layoutChildren();
      for (const child of children) {
        child.updateLayout();
      }
    }
  }
  layoutChildren() {
    const queue = [...this.children()];
    const result = [];
    const elements = [];
    while (queue.length) {
      const child = queue.shift();
      if (child instanceof Layout_1) {
        if (child.layoutEnabled()) {
          result.push(child);
          elements.push(child.element);
        }
      } else if (child) {
        queue.unshift(...child.children());
      }
    }
    this.element.replaceChildren(...elements);
    return result;
  }
  /**
   * Apply any new font changes to this node and all of its ancestors.
   */
  requestFontUpdate() {
    var _a2;
    this.appendedToView();
    (_a2 = this.parentTransform()) == null ? void 0 : _a2.requestFontUpdate();
    this.applyFont();
  }
  getCacheBBox() {
    return BBox.fromSizeCentered(this.computedSize());
  }
  draw(context) {
    if (this.clip()) {
      const size = this.computedSize();
      if (size.width === 0 || size.height === 0) {
        return;
      }
      context.beginPath();
      context.rect(size.width / -2, size.height / -2, size.width, size.height);
      context.closePath();
      context.clip();
    }
    this.drawChildren(context);
  }
  drawOverlay(context, matrix) {
    const size = this.computedSize();
    const offset = size.mul(this.offset()).scale(0.5).transformAsPoint(matrix);
    const box = BBox.fromSizeCentered(size);
    const layout = box.transformCorners(matrix);
    const padding = box.addSpacing(this.padding().scale(-1)).transformCorners(matrix);
    const margin = box.addSpacing(this.margin()).transformCorners(matrix);
    context.beginPath();
    drawLine(context, margin);
    drawLine(context, layout);
    context.closePath();
    context.fillStyle = "rgba(255,193,125,0.6)";
    context.fill("evenodd");
    context.beginPath();
    drawLine(context, layout);
    drawLine(context, padding);
    context.closePath();
    context.fillStyle = "rgba(180,255,147,0.6)";
    context.fill("evenodd");
    context.beginPath();
    drawLine(context, layout);
    context.closePath();
    context.lineWidth = 1;
    context.strokeStyle = "white";
    context.stroke();
    context.beginPath();
    drawPivot(context, offset);
    context.stroke();
  }
  getOriginDelta(origin) {
    const size = this.computedSize().scale(0.5);
    const offset = this.offset().mul(size);
    if (origin === Origin.Middle) {
      return offset.flipped;
    }
    const newOffset = originToOffset(origin).mul(size);
    return newOffset.sub(offset);
  }
  /**
   * Update the offset of this node and adjust the position to keep it in the
   * same place.
   *
   * @param offset - The new offset.
   */
  moveOffset(offset) {
    const size = this.computedSize().scale(0.5);
    const oldOffset = this.offset().mul(size);
    const newOffset = offset.mul(size);
    this.offset(offset);
    this.position(this.position().add(newOffset).sub(oldOffset));
  }
  parsePixels(value) {
    return value === null ? "" : `${value}px`;
  }
  parseLength(value) {
    if (value === null) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    return `${value}px`;
  }
  applyFlex() {
    this.element.style.position = this.isLayoutRoot() ? "absolute" : "relative";
    const size = this.desiredSize();
    this.element.style.width = this.parseLength(size.x);
    this.element.style.height = this.parseLength(size.y);
    this.element.style.maxWidth = this.parseLength(this.maxWidth());
    this.element.style.minWidth = this.parseLength(this.minWidth());
    this.element.style.maxHeight = this.parseLength(this.maxHeight());
    this.element.style.minHeight = this.parseLength(this.minHeight());
    this.element.style.aspectRatio = this.ratio() === null ? "" : this.ratio().toString();
    this.element.style.marginTop = this.parsePixels(this.margin.top());
    this.element.style.marginBottom = this.parsePixels(this.margin.bottom());
    this.element.style.marginLeft = this.parsePixels(this.margin.left());
    this.element.style.marginRight = this.parsePixels(this.margin.right());
    this.element.style.paddingTop = this.parsePixels(this.padding.top());
    this.element.style.paddingBottom = this.parsePixels(this.padding.bottom());
    this.element.style.paddingLeft = this.parsePixels(this.padding.left());
    this.element.style.paddingRight = this.parsePixels(this.padding.right());
    this.element.style.flexDirection = this.direction();
    this.element.style.flexBasis = this.parseLength(this.basis());
    this.element.style.flexWrap = this.wrap();
    this.element.style.justifyContent = this.justifyContent();
    this.element.style.alignContent = this.alignContent();
    this.element.style.alignItems = this.alignItems();
    this.element.style.alignSelf = this.alignSelf();
    this.element.style.columnGap = this.parseLength(this.gap.x());
    this.element.style.rowGap = this.parseLength(this.gap.y());
    if (this.sizeLockCounter() > 0) {
      this.element.style.flexGrow = "0";
      this.element.style.flexShrink = "0";
    } else {
      this.element.style.flexGrow = this.grow().toString();
      this.element.style.flexShrink = this.shrink().toString();
    }
  }
  applyFont() {
    this.element.style.fontFamily = this.fontFamily.isInitial() ? "" : this.fontFamily();
    this.element.style.fontSize = this.fontSize.isInitial() ? "" : `${this.fontSize()}px`;
    this.element.style.fontStyle = this.fontStyle.isInitial() ? "" : this.fontStyle();
    if (this.lineHeight.isInitial()) {
      this.element.style.lineHeight = "";
    } else {
      const lineHeight = this.lineHeight();
      this.element.style.lineHeight = typeof lineHeight === "string" ? (parseFloat(lineHeight) / 100).toString() : `${lineHeight}px`;
    }
    this.element.style.fontWeight = this.fontWeight.isInitial() ? "" : this.fontWeight().toString();
    this.element.style.letterSpacing = this.letterSpacing.isInitial() ? "" : `${this.letterSpacing()}px`;
    this.element.style.textAlign = this.textAlign.isInitial() ? "" : this.textAlign();
    if (this.textWrap.isInitial()) {
      this.element.style.whiteSpace = "";
    } else {
      const wrap = this.textWrap();
      if (typeof wrap === "boolean") {
        this.element.style.whiteSpace = wrap ? "normal" : "nowrap";
      } else {
        this.element.style.whiteSpace = wrap;
      }
    }
  }
  dispose() {
    var _a2;
    super.dispose();
    (_a2 = this.sizeLockCounter) == null ? void 0 : _a2.context.dispose();
    if (this.element) {
      this.element.remove();
      this.element.innerHTML = "";
    }
    this.element = null;
    this.styles = null;
  }
  hit(position) {
    const local = position.transformAsPoint(this.localToParent().inverse());
    if (this.cacheBBox().includes(local)) {
      return super.hit(position) ?? this;
    }
    return null;
  }
};
__decorate$a([
  initial(null),
  interpolation(boolLerp),
  signal()
], Layout.prototype, "layout", void 0);
__decorate$a([
  initial(null),
  signal()
], Layout.prototype, "maxWidth", void 0);
__decorate$a([
  initial(null),
  signal()
], Layout.prototype, "maxHeight", void 0);
__decorate$a([
  initial(null),
  signal()
], Layout.prototype, "minWidth", void 0);
__decorate$a([
  initial(null),
  signal()
], Layout.prototype, "minHeight", void 0);
__decorate$a([
  initial(null),
  signal()
], Layout.prototype, "ratio", void 0);
__decorate$a([
  spacingSignal("margin")
], Layout.prototype, "margin", void 0);
__decorate$a([
  spacingSignal("padding")
], Layout.prototype, "padding", void 0);
__decorate$a([
  initial("row"),
  signal()
], Layout.prototype, "direction", void 0);
__decorate$a([
  initial(null),
  signal()
], Layout.prototype, "basis", void 0);
__decorate$a([
  initial(0),
  signal()
], Layout.prototype, "grow", void 0);
__decorate$a([
  initial(1),
  signal()
], Layout.prototype, "shrink", void 0);
__decorate$a([
  initial("nowrap"),
  signal()
], Layout.prototype, "wrap", void 0);
__decorate$a([
  initial("start"),
  signal()
], Layout.prototype, "justifyContent", void 0);
__decorate$a([
  initial("normal"),
  signal()
], Layout.prototype, "alignContent", void 0);
__decorate$a([
  initial("stretch"),
  signal()
], Layout.prototype, "alignItems", void 0);
__decorate$a([
  initial("auto"),
  signal()
], Layout.prototype, "alignSelf", void 0);
__decorate$a([
  initial(0),
  vector2Signal({ x: "columnGap", y: "rowGap" })
], Layout.prototype, "gap", void 0);
__decorate$a([
  defaultStyle("font-family"),
  signal()
], Layout.prototype, "fontFamily", void 0);
__decorate$a([
  defaultStyle("font-size", parseFloat),
  signal()
], Layout.prototype, "fontSize", void 0);
__decorate$a([
  defaultStyle("font-style"),
  signal()
], Layout.prototype, "fontStyle", void 0);
__decorate$a([
  defaultStyle("font-weight", parseInt),
  signal()
], Layout.prototype, "fontWeight", void 0);
__decorate$a([
  defaultStyle("line-height", parseFloat),
  signal()
], Layout.prototype, "lineHeight", void 0);
__decorate$a([
  defaultStyle("letter-spacing", (i) => i === "normal" ? 0 : parseFloat(i)),
  signal()
], Layout.prototype, "letterSpacing", void 0);
__decorate$a([
  defaultStyle("white-space", (i) => i === "pre" ? "pre" : i === "normal"),
  signal()
], Layout.prototype, "textWrap", void 0);
__decorate$a([
  initial("inherit"),
  signal()
], Layout.prototype, "textDirection", void 0);
__decorate$a([
  defaultStyle("text-align"),
  signal()
], Layout.prototype, "textAlign", void 0);
__decorate$a([
  initial({ x: null, y: null }),
  vector2Signal({ x: "width", y: "height" })
], Layout.prototype, "size", void 0);
__decorate$a([
  threadable()
], Layout.prototype, "tweenWidth", null);
__decorate$a([
  threadable()
], Layout.prototype, "tweenHeight", null);
__decorate$a([
  computed()
], Layout.prototype, "desiredSize", null);
__decorate$a([
  threadable()
], Layout.prototype, "tweenSize", null);
__decorate$a([
  vector2Signal("offset")
], Layout.prototype, "offset", void 0);
__decorate$a([
  originSignal(Origin.Middle)
], Layout.prototype, "middle", void 0);
__decorate$a([
  originSignal(Origin.Top)
], Layout.prototype, "top", void 0);
__decorate$a([
  originSignal(Origin.Bottom)
], Layout.prototype, "bottom", void 0);
__decorate$a([
  originSignal(Origin.Left)
], Layout.prototype, "left", void 0);
__decorate$a([
  originSignal(Origin.Right)
], Layout.prototype, "right", void 0);
__decorate$a([
  originSignal(Origin.TopLeft)
], Layout.prototype, "topLeft", void 0);
__decorate$a([
  originSignal(Origin.TopRight)
], Layout.prototype, "topRight", void 0);
__decorate$a([
  originSignal(Origin.BottomLeft)
], Layout.prototype, "bottomLeft", void 0);
__decorate$a([
  originSignal(Origin.BottomRight)
], Layout.prototype, "bottomRight", void 0);
__decorate$a([
  initial(false),
  signal()
], Layout.prototype, "clip", void 0);
__decorate$a([
  initial(0),
  signal()
], Layout.prototype, "sizeLockCounter", void 0);
__decorate$a([
  computed()
], Layout.prototype, "parentTransform", null);
__decorate$a([
  computed()
], Layout.prototype, "anchorPosition", null);
__decorate$a([
  computed()
], Layout.prototype, "layoutEnabled", null);
__decorate$a([
  computed()
], Layout.prototype, "isLayoutRoot", null);
__decorate$a([
  computed()
], Layout.prototype, "scalingRotationMatrix", null);
__decorate$a([
  computed()
], Layout.prototype, "computedPosition", null);
__decorate$a([
  computed()
], Layout.prototype, "computedSize", null);
__decorate$a([
  computed()
], Layout.prototype, "requestLayoutUpdate", null);
__decorate$a([
  computed()
], Layout.prototype, "appendedToView", null);
__decorate$a([
  computed()
], Layout.prototype, "updateLayout", null);
__decorate$a([
  computed()
], Layout.prototype, "layoutChildren", null);
__decorate$a([
  computed()
], Layout.prototype, "requestFontUpdate", null);
__decorate$a([
  computed()
], Layout.prototype, "applyFlex", null);
__decorate$a([
  computed()
], Layout.prototype, "applyFont", null);
Layout = Layout_1 = __decorate$a([
  nodeName("Layout")
], Layout);
function originSignal(origin) {
  return (target, key) => {
    signal()(target, key);
    cloneable(false)(target, key);
    const meta2 = getPropertyMeta(target, key);
    meta2.parser = (value) => new Vector2(value);
    meta2.getter = function() {
      return this.computedSize().getOriginOffset(origin).transformAsPoint(this.localToParent());
    };
    meta2.setter = function(value) {
      this.position(modify(value, (unwrapped) => this.getOriginDelta(origin).transform(this.scalingRotationMatrix()).flipped.add(unwrapped)));
      return this;
    };
  };
}
addInitializer(Layout.prototype, (instance) => {
  instance.element = document.createElement("div");
  instance.element.style.display = "flex";
  instance.element.style.boxSizing = "border-box";
  instance.styles = getComputedStyle(instance.element);
});
var __decorate$9 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
let Shape = class Shape2 extends Layout {
  rippleSize() {
    return easeOutExpo(this.rippleStrength(), 0, 50);
  }
  constructor(props) {
    super(props);
    this.rippleStrength = createSignal(0);
  }
  applyText(context) {
    context.direction = this.textDirection();
    this.element.dir = this.textDirection();
  }
  applyStyle(context) {
    context.fillStyle = resolveCanvasStyle(this.fill(), context);
    context.strokeStyle = resolveCanvasStyle(this.stroke(), context);
    context.lineWidth = this.lineWidth();
    context.lineJoin = this.lineJoin();
    context.lineCap = this.lineCap();
    context.setLineDash(this.lineDash());
    context.lineDashOffset = this.lineDashOffset();
    if (!this.antialiased()) {
      context.filter = "url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxmaWx0ZXIgaWQ9ImZpbHRlciIgeD0iMCIgeT0iMCIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj48ZmVDb21wb25lbnRUcmFuc2Zlcj48ZmVGdW5jUiB0eXBlPSJpZGVudGl0eSIvPjxmZUZ1bmNHIHR5cGU9ImlkZW50aXR5Ii8+PGZlRnVuY0IgdHlwZT0iaWRlbnRpdHkiLz48ZmVGdW5jQSB0eXBlPSJkaXNjcmV0ZSIgdGFibGVWYWx1ZXM9IjAgMSIvPjwvZmVDb21wb25lbnRUcmFuc2Zlcj48L2ZpbHRlcj48L3N2Zz4=#filter)";
    }
  }
  draw(context) {
    this.drawShape(context);
    if (this.clip()) {
      context.clip(this.getPath());
    }
    this.drawChildren(context);
  }
  drawShape(context) {
    const path = this.getPath();
    const hasStroke = this.lineWidth() > 0 && this.stroke() !== null;
    const hasFill = this.fill() !== null;
    context.save();
    this.applyStyle(context);
    this.drawRipple(context);
    if (this.strokeFirst()) {
      hasStroke && context.stroke(path);
      hasFill && context.fill(path);
    } else {
      hasFill && context.fill(path);
      hasStroke && context.stroke(path);
    }
    context.restore();
  }
  getCacheBBox() {
    return super.getCacheBBox().expand(this.lineWidth() / 2);
  }
  getPath() {
    return new Path2D();
  }
  getRipplePath() {
    return new Path2D();
  }
  drawRipple(context) {
    const rippleStrength = this.rippleStrength();
    if (rippleStrength > 0) {
      const ripplePath = this.getRipplePath();
      context.save();
      context.globalAlpha *= map(0.54, 0, rippleStrength);
      context.fill(ripplePath);
      context.restore();
    }
  }
  *ripple(duration = 1) {
    this.rippleStrength(0);
    yield* this.rippleStrength(1, duration, linear);
    this.rippleStrength(0);
  }
};
__decorate$9([
  canvasStyleSignal()
], Shape.prototype, "fill", void 0);
__decorate$9([
  canvasStyleSignal()
], Shape.prototype, "stroke", void 0);
__decorate$9([
  initial(false),
  signal()
], Shape.prototype, "strokeFirst", void 0);
__decorate$9([
  initial(0),
  signal()
], Shape.prototype, "lineWidth", void 0);
__decorate$9([
  initial("miter"),
  signal()
], Shape.prototype, "lineJoin", void 0);
__decorate$9([
  initial("butt"),
  signal()
], Shape.prototype, "lineCap", void 0);
__decorate$9([
  initial([]),
  signal()
], Shape.prototype, "lineDash", void 0);
__decorate$9([
  initial(0),
  signal()
], Shape.prototype, "lineDashOffset", void 0);
__decorate$9([
  initial(true),
  signal()
], Shape.prototype, "antialiased", void 0);
__decorate$9([
  computed()
], Shape.prototype, "rippleSize", null);
__decorate$9([
  computed()
], Shape.prototype, "getPath", null);
__decorate$9([
  threadable()
], Shape.prototype, "ripple", null);
Shape = __decorate$9([
  nodeName("Shape")
], Shape);
var __decorate$8 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
let Curve = class Curve2 extends Shape {
  desiredSize() {
    return this.childrenBBox().size;
  }
  constructor(props) {
    super(props);
    this.canHaveSubpath = false;
  }
  /**
   * Convert a percentage along the curve to a distance.
   *
   * @remarks
   * The returned distance is given in relation to the full curve, not
   * accounting for {@link startOffset} and {@link endOffset}.
   *
   * @param value - The percentage along the curve.
   */
  percentageToDistance(value) {
    return clamp(0, this.baseArcLength(), this.startOffset() + this.offsetArcLength() * value);
  }
  /**
   * Convert a distance along the curve to a percentage.
   *
   * @remarks
   * The distance should be given in relation to the full curve, not
   * accounting for {@link startOffset} and {@link endOffset}.
   *
   * @param value - The distance along the curve.
   */
  distanceToPercentage(value) {
    return (value - this.startOffset()) / this.offsetArcLength();
  }
  /**
   * The base arc length of this curve.
   *
   * @remarks
   * This is the entire length of this curve, not accounting for
   * {@link startOffset | the offsets}.
   */
  baseArcLength() {
    return this.profile().arcLength;
  }
  /**
   * The offset arc length of this curve.
   *
   * @remarks
   * This is the length of the curve that accounts for
   * {@link startOffset | the offsets}.
   */
  offsetArcLength() {
    const startOffset = this.startOffset();
    const endOffset = this.endOffset();
    const baseLength = this.baseArcLength();
    return clamp(0, baseLength, baseLength - startOffset - endOffset);
  }
  /**
   * The visible arc length of this curve.
   *
   * @remarks
   * This arc length accounts for both the offset and the {@link start} and
   * {@link end} properties.
   */
  arcLength() {
    return this.offsetArcLength() * Math.abs(this.start() - this.end());
  }
  /**
   * The percentage of the curve that's currently visible.
   *
   * @remarks
   * The returned value is the ratio between the visible length (as defined by
   * {@link start} and {@link end}) and the offset length of the curve.
   */
  completion() {
    return Math.abs(this.start() - this.end());
  }
  processSubpath(_path, _startPoint, _endPoint) {
  }
  curveDrawingInfo() {
    const path = new Path2D();
    let subpath = new Path2D();
    const profile = this.profile();
    let start = this.percentageToDistance(this.start());
    let end = this.percentageToDistance(this.end());
    if (start > end) {
      [start, end] = [end, start];
    }
    const distance = end - start;
    const arrowSize = Math.min(distance / 2, this.arrowSize());
    if (this.startArrow()) {
      start += arrowSize / 2;
    }
    if (this.endArrow()) {
      end -= arrowSize / 2;
    }
    let length = 0;
    let startPoint = null;
    let startTangent = null;
    let endPoint = null;
    let endTangent = null;
    for (const segment of profile.segments) {
      const previousLength = length;
      length += segment.arcLength;
      if (length < start) {
        continue;
      }
      const relativeStart = (start - previousLength) / segment.arcLength;
      const relativeEnd = (end - previousLength) / segment.arcLength;
      const clampedStart = clamp(0, 1, relativeStart);
      const clampedEnd = clamp(0, 1, relativeEnd);
      if (this.canHaveSubpath && endPoint && !segment.getPoint(0).position.equals(endPoint)) {
        path.addPath(subpath);
        this.processSubpath(subpath, startPoint, endPoint);
        subpath = new Path2D();
        startPoint = null;
      }
      const [startCurvePoint, endCurvePoint] = segment.draw(subpath, clampedStart, clampedEnd, startPoint === null);
      if (startPoint === null) {
        startPoint = startCurvePoint.position;
        startTangent = startCurvePoint.normal.flipped.perpendicular;
      }
      endPoint = endCurvePoint.position;
      endTangent = endCurvePoint.normal.flipped.perpendicular;
      if (length > end) {
        break;
      }
    }
    if (this.closed() && this.start.isInitial() && this.end.isInitial() && this.startOffset.isInitial() && this.endOffset.isInitial()) {
      subpath.closePath();
    }
    this.processSubpath(subpath, startPoint, endPoint);
    path.addPath(subpath);
    return {
      startPoint: startPoint ?? Vector2.zero,
      startTangent: startTangent ?? Vector2.right,
      endPoint: endPoint ?? Vector2.zero,
      endTangent: endTangent ?? Vector2.right,
      arrowSize,
      path,
      startOffset: start
    };
  }
  getPointAtDistance(value) {
    return getPointAtDistance(this.profile(), value + this.startOffset());
  }
  getPointAtPercentage(value) {
    return getPointAtDistance(this.profile(), this.percentageToDistance(value));
  }
  getComputedLayout() {
    return this.offsetComputedLayout(super.getComputedLayout());
  }
  offsetComputedLayout(box) {
    box.position = box.position.sub(this.childrenBBox().center);
    return box;
  }
  getPath() {
    return this.curveDrawingInfo().path;
  }
  getCacheBBox() {
    const box = this.childrenBBox();
    const arrowSize = this.startArrow() || this.endArrow() ? this.arrowSize() : 0;
    const lineWidth = this.lineWidth();
    const coefficient = this.lineWidthCoefficient();
    return box.expand(Math.max(0, arrowSize, lineWidth * coefficient));
  }
  lineWidthCoefficient() {
    return this.lineCap() === "square" ? 0.5 * 1.4143 : 0.5;
  }
  /**
   * Check if the path requires a profile.
   *
   * @remarks
   * The profile is only required if certain features are used. Otherwise, the
   * profile generation can be skipped, and the curve can be drawn directly
   * using the 2D context.
   */
  requiresProfile() {
    return !this.start.isInitial() || !this.startOffset.isInitial() || !this.startArrow.isInitial() || !this.end.isInitial() || !this.endOffset.isInitial() || !this.endArrow.isInitial();
  }
  drawShape(context) {
    super.drawShape(context);
    if (this.startArrow() || this.endArrow()) {
      this.drawArrows(context);
    }
  }
  drawArrows(context) {
    const { startPoint, startTangent, endPoint, endTangent, arrowSize } = this.curveDrawingInfo();
    if (arrowSize < 1e-3) {
      return;
    }
    context.save();
    context.beginPath();
    if (this.endArrow()) {
      this.drawArrow(context, endPoint, endTangent.flipped, arrowSize);
    }
    if (this.startArrow()) {
      this.drawArrow(context, startPoint, startTangent, arrowSize);
    }
    context.fillStyle = resolveCanvasStyle(this.stroke(), context);
    context.closePath();
    context.fill();
    context.restore();
  }
  drawArrow(context, center, tangent, arrowSize) {
    const normal = tangent.perpendicular;
    const origin = center.add(tangent.scale(-arrowSize / 2));
    moveTo(context, origin);
    lineTo(context, origin.add(tangent.add(normal).scale(arrowSize)));
    lineTo(context, origin.add(tangent.sub(normal).scale(arrowSize)));
    lineTo(context, origin);
    context.closePath();
  }
};
__decorate$8([
  initial(false),
  signal()
], Curve.prototype, "closed", void 0);
__decorate$8([
  initial(0),
  signal()
], Curve.prototype, "start", void 0);
__decorate$8([
  initial(0),
  signal()
], Curve.prototype, "startOffset", void 0);
__decorate$8([
  initial(false),
  signal()
], Curve.prototype, "startArrow", void 0);
__decorate$8([
  initial(1),
  signal()
], Curve.prototype, "end", void 0);
__decorate$8([
  initial(0),
  signal()
], Curve.prototype, "endOffset", void 0);
__decorate$8([
  initial(false),
  signal()
], Curve.prototype, "endArrow", void 0);
__decorate$8([
  initial(24),
  signal()
], Curve.prototype, "arrowSize", void 0);
__decorate$8([
  computed()
], Curve.prototype, "arcLength", null);
__decorate$8([
  computed()
], Curve.prototype, "curveDrawingInfo", null);
Curve = __decorate$8([
  nodeName("Curve")
], Curve);
class Segment {
}
class CircleSegment extends Segment {
  constructor(center, radius, from, to, counter) {
    super();
    this.center = center;
    this.radius = radius;
    this.from = from;
    this.to = to;
    this.counter = counter;
    this.angle = Math.acos(clamp(-1, 1, from.dot(to)));
    this.length = Math.abs(this.angle * radius);
    const edgeVector = new Vector2(1, 1).scale(radius);
    this.points = [center.sub(edgeVector), center.add(edgeVector)];
  }
  get arcLength() {
    return this.length;
  }
  draw(context, from, to) {
    const counterFactor = this.counter ? -1 : 1;
    const startAngle = this.from.radians + from * this.angle * counterFactor;
    const endAngle = this.to.radians - (1 - to) * this.angle * counterFactor;
    if (Math.abs(this.angle) > 1e-4) {
      context.arc(this.center.x, this.center.y, this.radius, startAngle, endAngle, this.counter);
    }
    const startNormal = Vector2.fromRadians(startAngle);
    const endNormal = Vector2.fromRadians(endAngle);
    return [
      {
        position: this.center.add(startNormal.scale(this.radius)),
        tangent: this.counter ? startNormal : startNormal.flipped,
        normal: this.counter ? startNormal.flipped : startNormal
      },
      {
        position: this.center.add(endNormal.scale(this.radius)),
        tangent: this.counter ? endNormal.flipped : endNormal,
        normal: this.counter ? endNormal.flipped : endNormal
      }
    ];
  }
  getPoint(distance) {
    const counterFactor = this.counter ? -1 : 1;
    const angle = this.from.radians + distance * this.angle * counterFactor;
    const normal = Vector2.fromRadians(angle);
    return {
      position: this.center.add(normal.scale(this.radius)),
      tangent: this.counter ? normal : normal.flipped,
      normal: this.counter ? normal : normal.flipped
    };
  }
}
class Polynomial {
  /**
   * Constructs a constant polynomial
   *
   * @param c0 - The constant coefficient
   */
  static constant(c0) {
    return new Polynomial(c0);
  }
  /**
   * Constructs a linear polynomial
   *
   * @param c0 - The constant coefficient
   * @param c1 - The linear coefficient
   */
  static linear(c0, c1) {
    return new Polynomial(c0, c1);
  }
  /**
   * Constructs a quadratic polynomial
   *
   * @param c0 - The constant coefficient
   * @param c1 - The linear coefficient
   * @param c2 - The quadratic coefficient
   */
  static quadratic(c0, c1, c2) {
    return new Polynomial(c0, c1, c2);
  }
  /**
   * Constructs a cubic polynomial
   *
   * @param c0 - The constant coefficient
   * @param c1 - The linear coefficient
   * @param c2 - The quadratic coefficient
   * @param c3 - The cubic coefficient
   */
  static cubic(c0, c1, c2, c3) {
    return new Polynomial(c0, c1, c2, c3);
  }
  /**
   * The degree of the polynomial
   */
  get degree() {
    if (this.c3 !== 0) {
      return 3;
    } else if (this.c2 !== 0) {
      return 2;
    } else if (this.c1 !== 0) {
      return 1;
    }
    return 0;
  }
  constructor(c0, c1, c2, c3) {
    this.c0 = c0;
    this.c1 = c1 ?? 0;
    this.c2 = c2 ?? 0;
    this.c3 = c3 ?? 0;
  }
  /**
   * Return the nth derivative of the polynomial.
   *
   * @param n - The number of times to differentiate the polynomial.
   */
  differentiate(n = 1) {
    switch (n) {
      case 0:
        return this;
      case 1:
        return new Polynomial(this.c1, 2 * this.c2, 3 * this.c3, 0);
      case 2:
        return new Polynomial(2 * this.c2, 6 * this.c3, 0, 0);
      case 3:
        return new Polynomial(6 * this.c3, 0, 0, 0);
      default:
        throw new Error("Unsupported derivative");
    }
  }
  eval(t, derivative = 0) {
    if (derivative !== 0) {
      return this.differentiate(derivative).eval(t);
    }
    return this.c3 * (t * t * t) + this.c2 * (t * t) + this.c1 * t + this.c0;
  }
  /**
   * Split the polynomial into two polynomials of the same overall shape.
   *
   * @param u - The point at which to split the polynomial.
   */
  split(u) {
    const d = 1 - u;
    const pre = new Polynomial(this.c0, this.c1 * u, this.c2 * u * u, this.c3 * u * u * u);
    const post = new Polynomial(this.eval(0), d * this.differentiate(1).eval(u), d * d / 2 * this.differentiate(2).eval(u), d * d * d / 6 * this.differentiate(3).eval(u));
    return [pre, post];
  }
  /**
   * Calculate the roots (values where this polynomial = 0).
   *
   * @remarks
   * Depending on the degree of the polynomial, returns between 0 and 3 results.
   */
  roots() {
    switch (this.degree) {
      case 3:
        return this.solveCubicRoots();
      case 2:
        return this.solveQuadraticRoots();
      case 1:
        return this.solveLinearRoot();
      case 0:
        return [];
      default:
        throw new Error(`Unsupported polynomial degree: ${this.degree}`);
    }
  }
  /**
   * Calculate the local extrema of the polynomial.
   */
  localExtrema() {
    return this.differentiate().roots();
  }
  /**
   * Calculate the local extrema of the polynomial in the unit interval.
   */
  localExtrema01() {
    const all2 = this.localExtrema();
    const valids = [];
    for (let i = 0; i < all2.length; i++) {
      const t = all2[i];
      if (t >= 0 && t <= 1) {
        valids.push(all2[i]);
      }
    }
    return valids;
  }
  /**
   * Return the output value range within the unit interval.
   */
  outputRange01() {
    let range2 = [this.eval(0), this.eval(1)];
    const encapsulate = (value) => {
      if (range2[1] > range2[0]) {
        range2 = [Math.min(range2[0], value), Math.max(range2[1], value)];
      } else {
        range2 = [Math.min(range2[1], value), Math.max(range2[0], value)];
      }
    };
    this.localExtrema01().forEach((t) => encapsulate(this.eval(t)));
    return range2;
  }
  solveCubicRoots() {
    const a = this.c0;
    const b = this.c1;
    const c = this.c2;
    const d = this.c3;
    const aa = a * a;
    const ac = a * c;
    const bb = b * b;
    const p = (3 * ac - bb) / (3 * aa);
    const q = (2 * bb * b - 9 * ac * b + 27 * aa * d) / (27 * aa * a);
    const dpr = this.solveDepressedCubicRoots(p, q);
    const undepressRoot = (r) => r - b / (3 * a);
    switch (dpr.length) {
      case 1:
        return [undepressRoot(dpr[0])];
      case 2:
        return [undepressRoot(dpr[0]), undepressRoot(dpr[1])];
      case 3:
        return [
          undepressRoot(dpr[0]),
          undepressRoot(dpr[1]),
          undepressRoot(dpr[2])
        ];
      default:
        return [];
    }
  }
  solveDepressedCubicRoots(p, q) {
    if (this.almostZero(p)) {
      return [Math.cbrt(-q)];
    }
    const TAU = Math.PI * 2;
    const discriminant = 4 * p * p * p + 27 * q * q;
    if (discriminant < 1e-5) {
      const pre = 2 * Math.sqrt(-p / 3);
      const acosInner = 3 * q / (2 * p) * Math.sqrt(-3 / p);
      const getRoot = (k) => pre * Math.cos(1 / 3 * Math.acos(clamp(-1, 1, acosInner)) - TAU / 3 * k);
      if (acosInner >= 0.9999) {
        return [getRoot(0), getRoot(2)];
      }
      if (acosInner <= -0.9999) {
        return [getRoot(1), getRoot(2)];
      }
      return [getRoot(0), getRoot(1), getRoot(2)];
    }
    if (discriminant > 0 && p < 0) {
      const coshInner = 1 / 3 * Math.acosh(-3 * Math.abs(q) / (2 * p) * Math.sqrt(-3 / p));
      const r = -2 * Math.sign(q) * Math.sqrt(-p / 3) * Math.cosh(coshInner);
      return [r];
    }
    if (p > 0) {
      const sinhInner = 1 / 3 * Math.asinh(3 * q / (2 * p) * Math.sqrt(3 / p));
      const r = -2 * Math.sqrt(p / 3) * Math.sinh(sinhInner);
      return [r];
    }
    return [];
  }
  solveQuadraticRoots() {
    const a = this.c2;
    const b = this.c1;
    const c = this.c0;
    const rootContent = b * b - 4 * a * c;
    if (this.almostZero(rootContent)) {
      return [-b / (2 * a)];
    }
    if (rootContent >= 0) {
      const root = Math.sqrt(rootContent);
      const r0 = (-b - root) / (2 * a);
      const r1 = (-b + root) / (2 * a);
      return [Math.min(r0, r1), Math.max(r0, r1)];
    }
    return [];
  }
  solveLinearRoot() {
    return [-this.c0 / this.c1];
  }
  almostZero(value) {
    return Math.abs(0 - value) <= Number.EPSILON;
  }
}
class Polynomial2D {
  constructor(c0, c1, c2, c3) {
    this.c0 = c0;
    this.c1 = c1;
    this.c2 = c2;
    this.c3 = c3;
    if (c0 instanceof Polynomial) {
      this.x = c0;
      this.y = c1;
    } else if (c3 !== void 0) {
      this.x = new Polynomial(c0.x, c1.x, c2.x, c3.x);
      this.y = new Polynomial(c0.y, c1.y, c2.y, c3.y);
    } else {
      this.x = new Polynomial(c0.x, c1.x, c2.x);
      this.y = new Polynomial(c0.y, c1.y, c2.y);
    }
  }
  eval(t, derivative = 0) {
    return new Vector2(this.x.differentiate(derivative).eval(t), this.y.differentiate(derivative).eval(t));
  }
  split(u) {
    const [xPre, xPost] = this.x.split(u);
    const [yPre, yPost] = this.y.split(u);
    return [new Polynomial2D(xPre, yPre), new Polynomial2D(xPost, yPost)];
  }
  differentiate(n = 1) {
    return new Polynomial2D(this.x.differentiate(n), this.y.differentiate(n));
  }
  evalDerivative(t) {
    return this.differentiate().eval(t);
  }
  /**
   * Calculate the tight axis-aligned bounds of the curve in the unit interval.
   */
  getBounds() {
    const rangeX = this.x.outputRange01();
    const rangeY = this.y.outputRange01();
    return BBox.fromPoints(new Vector2(Math.min(...rangeX), Math.max(...rangeY)), new Vector2(Math.max(...rangeX), Math.min(...rangeY)));
  }
}
class UniformPolynomialCurveSampler {
  /**
   * @param curve - The curve to sample
   * @param samples - How many points to sample from the provided curve. The
   *                  more points get sampled, the higher the resolution–and
   *                  therefore precision–of the sampler.
   */
  constructor(curve, samples = 20) {
    this.curve = curve;
    this.sampledDistances = [];
    this.resample(samples);
  }
  /**
   * Discard all previously sampled points and resample the provided number of
   * points from the curve.
   *
   * @param samples - The number of points to sample.
   */
  resample(samples) {
    this.sampledDistances = [0];
    let length = 0;
    let previous = this.curve.eval(0).position;
    for (let i = 1; i < samples; i++) {
      const t = i / (samples - 1);
      const curvePoint = this.curve.eval(t);
      const segmentLength = previous.sub(curvePoint.position).magnitude;
      length += segmentLength;
      this.sampledDistances.push(length);
      previous = curvePoint.position;
    }
    this.sampledDistances[this.sampledDistances.length - 1] = this.curve.arcLength;
  }
  /**
   * Return the point at the provided distance along the sampled curve's
   * arclength.
   *
   * @param distance - The distance along the curve's arclength for which to
   *                   retrieve the point.
   */
  pointAtDistance(distance) {
    return this.curve.eval(this.distanceToT(distance));
  }
  /**
   * Return the t value for the point at the provided distance along the sampled
   * curve's arc length.
   *
   * @param distance - The distance along the arclength
   */
  distanceToT(distance) {
    const samples = this.sampledDistances.length;
    distance = clamp(0, this.curve.arcLength, distance);
    for (let i = 0; i < samples; i++) {
      const lower = this.sampledDistances[i];
      const upper = this.sampledDistances[i + 1];
      if (distance >= lower && distance <= upper) {
        return remap(lower, upper, i / (samples - 1), (i + 1) / (samples - 1), distance);
      }
    }
    return 1;
  }
}
class PolynomialSegment extends Segment {
  get arcLength() {
    return this.length;
  }
  constructor(curve, length) {
    super();
    this.curve = curve;
    this.length = length;
    this.pointSampler = new UniformPolynomialCurveSampler(this);
  }
  getBBox() {
    return this.curve.getBounds();
  }
  /**
   * Evaluate the polynomial at the given t value.
   *
   * @param t - The t value at which to evaluate the curve.
   */
  eval(t) {
    const tangent = this.tangent(t);
    return {
      position: this.curve.eval(t),
      tangent,
      normal: tangent.perpendicular
    };
  }
  getPoint(distance) {
    const closestPoint = this.pointSampler.pointAtDistance(this.arcLength * distance);
    return {
      position: closestPoint.position,
      tangent: closestPoint.tangent,
      normal: closestPoint.tangent.perpendicular
    };
  }
  transformPoints(matrix) {
    return this.points.map((point) => point.transformAsPoint(matrix));
  }
  /**
   * Return the tangent of the point that sits at the provided t value on the
   * curve.
   *
   * @param t - The t value at which to evaluate the curve.
   */
  tangent(t) {
    return this.curve.evalDerivative(t).normalized;
  }
  draw(context, start = 0, end = 1, move = true) {
    let curve = null;
    let startT = start;
    let endT = end;
    let points = this.points;
    if (start !== 0 || end !== 1) {
      const startDistance = this.length * start;
      const endDistance = this.length * end;
      startT = this.pointSampler.distanceToT(startDistance);
      endT = this.pointSampler.distanceToT(endDistance);
      const relativeEndT = (endT - startT) / (1 - startT);
      const [, startSegment] = this.split(startT);
      [curve] = startSegment.split(relativeEndT);
      points = curve.points;
    }
    if (move) {
      moveTo(context, points[0]);
    }
    (curve ?? this).doDraw(context);
    const startTangent = this.tangent(startT);
    const endTangent = this.tangent(endT);
    return [
      {
        position: points[0],
        tangent: startTangent,
        normal: startTangent.perpendicular
      },
      {
        position: points.at(-1),
        tangent: endTangent,
        normal: endTangent.perpendicular
      }
    ];
  }
}
var __decorate$7 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
class CubicBezierSegment extends PolynomialSegment {
  get points() {
    return [this.p0, this.p1, this.p2, this.p3];
  }
  constructor(p0, p1, p2, p3) {
    super(new Polynomial2D(
      p0,
      // 3*(-p0+p1)
      p0.flipped.add(p1).scale(3),
      // 3*p0-6*p1+3*p2
      p0.scale(3).sub(p1.scale(6)).add(p2.scale(3)),
      // -p0+3*p1-3*p2+p3
      p0.flipped.add(p1.scale(3)).sub(p2.scale(3)).add(p3)
    ), CubicBezierSegment.getLength(p0, p1, p2, p3));
    this.p0 = p0;
    this.p1 = p1;
    this.p2 = p2;
    this.p3 = p3;
  }
  split(t) {
    const a = new Vector2(this.p0.x + (this.p1.x - this.p0.x) * t, this.p0.y + (this.p1.y - this.p0.y) * t);
    const b = new Vector2(this.p1.x + (this.p2.x - this.p1.x) * t, this.p1.y + (this.p2.y - this.p1.y) * t);
    const c = new Vector2(this.p2.x + (this.p3.x - this.p2.x) * t, this.p2.y + (this.p3.y - this.p2.y) * t);
    const d = new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    const e = new Vector2(b.x + (c.x - b.x) * t, b.y + (c.y - b.y) * t);
    const p = new Vector2(d.x + (e.x - d.x) * t, d.y + (e.y - d.y) * t);
    const left = new CubicBezierSegment(this.p0, a, d, p);
    const right = new CubicBezierSegment(p, e, c, this.p3);
    return [left, right];
  }
  doDraw(context) {
    bezierCurveTo(context, this.p1, this.p2, this.p3);
  }
  static getLength(p0, p1, p2, p3) {
    CubicBezierSegment.el.setAttribute("d", `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`);
    return CubicBezierSegment.el.getTotalLength();
  }
}
__decorate$7([
  lazy(() => document.createElementNS("http://www.w3.org/2000/svg", "path"))
], CubicBezierSegment, "el", void 0);
class LineSegment extends Segment {
  constructor(from, to) {
    super();
    this.from = from;
    this.to = to;
    this.vector = to.sub(from);
    this.length = this.vector.magnitude;
    this.normal = this.vector.perpendicular.normalized.safe;
    this.points = [from, to];
  }
  get arcLength() {
    return this.length;
  }
  draw(context, start = 0, end = 1, move = false) {
    const from = this.from.add(this.vector.scale(start));
    const to = this.from.add(this.vector.scale(end));
    if (move) {
      moveTo(context, from);
    }
    lineTo(context, to);
    return [
      {
        position: from,
        tangent: this.normal.flipped,
        normal: this.normal
      },
      {
        position: to,
        tangent: this.normal,
        normal: this.normal
      }
    ];
  }
  getPoint(distance) {
    const point = this.from.add(this.vector.scale(distance));
    return {
      position: point,
      tangent: this.normal.flipped,
      normal: this.normal
    };
  }
}
function getRectProfile(rect, radius, smoothCorners, cornerSharpness) {
  const profile = {
    arcLength: 0,
    segments: [],
    minSin: 1
  };
  const topLeft = adjustRectRadius(radius.top, radius.right, radius.left, rect);
  const topRight = adjustRectRadius(radius.right, radius.top, radius.bottom, rect);
  const bottomRight = adjustRectRadius(radius.bottom, radius.left, radius.right, rect);
  const bottomLeft = adjustRectRadius(radius.left, radius.bottom, radius.top, rect);
  let from = new Vector2(rect.left + topLeft, rect.top);
  let to = new Vector2(rect.right - topRight, rect.top);
  addSegment(profile, new LineSegment(from, to));
  from = new Vector2(rect.right, rect.top + topRight);
  to = new Vector2(rect.right, rect.bottom - bottomRight);
  if (topRight > 0) {
    addCornerSegment(profile, from.addX(-topRight), topRight, Vector2.down, Vector2.right, smoothCorners, cornerSharpness);
  }
  addSegment(profile, new LineSegment(from, to));
  from = new Vector2(rect.right - bottomRight, rect.bottom);
  to = new Vector2(rect.left + bottomLeft, rect.bottom);
  if (bottomRight > 0) {
    addCornerSegment(profile, from.addY(-bottomRight), bottomRight, Vector2.right, Vector2.up, smoothCorners, cornerSharpness);
  }
  addSegment(profile, new LineSegment(from, to));
  from = new Vector2(rect.left, rect.bottom - bottomLeft);
  to = new Vector2(rect.left, rect.top + topLeft);
  if (bottomLeft > 0) {
    addCornerSegment(profile, from.addX(bottomLeft), bottomLeft, Vector2.up, Vector2.left, smoothCorners, cornerSharpness);
  }
  addSegment(profile, new LineSegment(from, to));
  from = new Vector2(rect.left + topLeft, rect.top);
  if (topLeft > 0) {
    addCornerSegment(profile, from.addY(topLeft), topLeft, Vector2.left, Vector2.down, smoothCorners, cornerSharpness);
  }
  return profile;
}
function addSegment(profile, segment) {
  profile.segments.push(segment);
  profile.arcLength += segment.arcLength;
}
function addCornerSegment(profile, center, radius, fromNormal, toNormal, smooth, sharpness) {
  const from = center.add(fromNormal.scale(radius));
  const to = center.add(toNormal.scale(radius));
  if (smooth) {
    addSegment(profile, new CubicBezierSegment(from, from.add(toNormal.scale(sharpness * radius)), to.add(fromNormal.scale(sharpness * radius)), to));
  } else {
    addSegment(profile, new CircleSegment(center, radius, fromNormal, toNormal, false));
  }
}
var __decorate$6 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
let Rect = class Rect2 extends Curve {
  constructor(props) {
    super(props);
  }
  profile() {
    return getRectProfile(this.childrenBBox(), this.radius(), this.smoothCorners(), this.cornerSharpness());
  }
  desiredSize() {
    return {
      x: this.width.context.getter(),
      y: this.height.context.getter()
    };
  }
  offsetComputedLayout(box) {
    return box;
  }
  childrenBBox() {
    return BBox.fromSizeCentered(this.computedSize());
  }
  getPath() {
    if (this.requiresProfile()) {
      return this.curveDrawingInfo().path;
    }
    const path = new Path2D();
    const radius = this.radius();
    const smoothCorners = this.smoothCorners();
    const cornerSharpness = this.cornerSharpness();
    const box = BBox.fromSizeCentered(this.size());
    drawRoundRect(path, box, radius, smoothCorners, cornerSharpness);
    return path;
  }
  getCacheBBox() {
    return super.getCacheBBox().expand(this.rippleSize());
  }
  getRipplePath() {
    const path = new Path2D();
    const rippleSize = this.rippleSize();
    const radius = this.radius().addScalar(rippleSize);
    const smoothCorners = this.smoothCorners();
    const cornerSharpness = this.cornerSharpness();
    const box = BBox.fromSizeCentered(this.size()).expand(rippleSize);
    drawRoundRect(path, box, radius, smoothCorners, cornerSharpness);
    return path;
  }
};
__decorate$6([
  spacingSignal("radius")
], Rect.prototype, "radius", void 0);
__decorate$6([
  initial(false),
  signal()
], Rect.prototype, "smoothCorners", void 0);
__decorate$6([
  initial(0.6),
  signal()
], Rect.prototype, "cornerSharpness", void 0);
__decorate$6([
  computed()
], Rect.prototype, "profile", null);
Rect = __decorate$6([
  nodeName("Rect")
], Rect);
var __decorate$5 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
class Camera extends Node {
  constructor({ children, ...props }) {
    super(props);
    if (!this.scene()) {
      this.scene(new Node({}));
    }
    if (children) {
      this.scene().add(children);
    }
  }
  getZoom() {
    return 1 / this.scale.x();
  }
  setZoom(value) {
    this.scale(modify(value, (unwrapped) => 1 / unwrapped));
  }
  getDefaultZoom() {
    return this.scale.x.context.getInitial();
  }
  *tweenZoom(value, duration, timingFunction, interpolationFunction) {
    const from = this.scale.x();
    yield* tween(duration, (v) => {
      this.zoom(1 / interpolationFunction(from, 1 / unwrap(value), timingFunction(v)));
    });
  }
  /**
   * Resets the camera's position, rotation and zoom level to their original
   * values.
   *
   * @param duration - The duration of the tween.
   * @param timingFunction - The timing function to use for the tween.
   */
  *reset(duration, timingFunction = easeInOutCubic) {
    yield* all(this.position(DEFAULT, duration, timingFunction), this.zoom(DEFAULT, duration, timingFunction), this.rotation(DEFAULT, duration, timingFunction));
  }
  *centerOn(positionOrNode, duration, timing = easeInOutCubic, interpolationFunction = Vector2.lerp) {
    const position = positionOrNode instanceof Node ? positionOrNode.absolutePosition().transformAsPoint(this.scene().worldToLocal()) : positionOrNode;
    yield* this.position(position, duration, timing, interpolationFunction);
  }
  /**
   * Makes the camera follow a path specified by the provided curve.
   *
   * @remarks
   * This will not change the orientation of the camera. To make the camera
   * orient itself along the curve, use {@link followCurveWithRotation} or
   * {@link followCurveWithRotationReverse}.
   *
   * If you want to follow the curve in reverse, use {@link followCurveReverse}.
   *
   * @param curve - The curve to follow.
   * @param duration - The duration of the tween.
   * @param timing - The timing function to use for the tween.
   */
  *followCurve(curve, duration, timing = easeInOutCubic) {
    yield* tween(duration, (value) => {
      const t = timing(value);
      const point = curve.getPointAtPercentage(t).position.transformAsPoint(curve.localToWorld());
      this.position(point);
    });
  }
  /**
   * Makes the camera follow a path specified by the provided curve in reverse.
   *
   * @remarks
   * This will not change the orientation of the camera. To make the camera
   * orient itself along the curve, use {@link followCurveWithRotation} or
   * {@link followCurveWithRotationReverse}.
   *
   * If you want to follow the curve forward, use {@link followCurve}.
   *
   * @param curve - The curve to follow.
   * @param duration - The duration of the tween.
   * @param timing - The timing function to use for the tween.
   */
  *followCurveReverse(curve, duration, timing = easeInOutCubic) {
    yield* tween(duration, (value) => {
      const t = 1 - timing(value);
      const point = curve.getPointAtPercentage(t).position.transformAsPoint(curve.localToWorld());
      this.position(point);
    });
  }
  /**
   * Makes the camera follow a path specified by the provided curve while
   * pointing the camera the direction of the tangent.
   *
   * @remarks
   * To make the camera follow the curve without changing its orientation, use
   * {@link followCurve} or {@link followCurveReverse}.
   *
   * If you want to follow the curve in reverse, use
   * {@link followCurveWithRotationReverse}.
   *
   * @param curve - The curve to follow.
   * @param duration - The duration of the tween.
   * @param timing - The timing function to use for the tween.
   */
  *followCurveWithRotation(curve, duration, timing = easeInOutCubic) {
    yield* tween(duration, (value) => {
      const t = timing(value);
      const { position, normal } = curve.getPointAtPercentage(t);
      const point = position.transformAsPoint(curve.localToWorld());
      const angle = normal.flipped.perpendicular.degrees;
      this.position(point);
      this.rotation(angle);
    });
  }
  /**
   * Makes the camera follow a path specified by the provided curve in reverse
   * while pointing the camera the direction of the tangent.
   *
   * @remarks
   * To make the camera follow the curve without changing its orientation, use
   * {@link followCurve} or {@link followCurveReverse}.
   *
   * If you want to follow the curve forward, use
   * {@link followCurveWithRotation}.
   *
   * @param curve - The curve to follow.
   * @param duration - The duration of the tween.
   * @param timing - The timing function to use for the tween.
   */
  *followCurveWithRotationReverse(curve, duration, timing = easeInOutCubic) {
    yield* tween(duration, (value) => {
      const t = 1 - timing(value);
      const { position, normal } = curve.getPointAtPercentage(t);
      const point = position.transformAsPoint(curve.localToWorld());
      const angle = normal.flipped.perpendicular.degrees;
      this.position(point);
      this.rotation(angle);
    });
  }
  transformContext(context) {
    const matrix = this.localToParent().inverse();
    context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  }
  hit(position) {
    const local = position.transformAsPoint(this.localToParent());
    return this.scene().hit(local);
  }
  drawChildren(context) {
    this.scene().drawChildren(context);
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static Stage({ children, cameraRef, scene, ...props }) {
    const camera = new Camera({ scene, children });
    cameraRef == null ? void 0 : cameraRef(camera);
    return new Rect({
      clip: true,
      ...props,
      children: [camera]
    });
  }
}
__decorate$5([
  signal()
], Camera.prototype, "scene", void 0);
__decorate$5([
  cloneable(false),
  signal()
], Camera.prototype, "zoom", void 0);
__decorate$5([
  threadable()
], Camera.prototype, "reset", null);
__decorate$5([
  threadable()
], Camera.prototype, "centerOn", null);
__decorate$5([
  threadable()
], Camera.prototype, "followCurve", null);
__decorate$5([
  threadable()
], Camera.prototype, "followCurveReverse", null);
__decorate$5([
  threadable()
], Camera.prototype, "followCurveWithRotation", null);
__decorate$5([
  threadable()
], Camera.prototype, "followCurveWithRotationReverse", null);
var __decorate$4 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var View2D_1;
let View2D = View2D_1 = class View2D2 extends Rect {
  constructor(props) {
    super({
      composite: true,
      fontFamily: "Roboto",
      fontSize: 48,
      lineHeight: "120%",
      textWrap: false,
      fontStyle: "normal",
      ...props
    });
    this.view2D = this;
    View2D_1.shadowRoot.append(this.element);
    this.applyFlex();
  }
  dispose() {
    this.removeChildren();
    super.dispose();
  }
  render(context) {
    this.computedSize();
    this.computedPosition();
    super.render(context);
  }
  /**
   * Find a node by its key.
   *
   * @param key - The key of the node.
   */
  findKey(key) {
    return useScene2D().getNode(key) ?? null;
  }
  requestLayoutUpdate() {
    this.updateLayout();
  }
  requestFontUpdate() {
    this.applyFont();
  }
  view() {
    return this;
  }
};
__decorate$4([
  initial(PlaybackState.Paused),
  signal()
], View2D.prototype, "playbackState", void 0);
__decorate$4([
  initial(0),
  signal()
], View2D.prototype, "globalTime", void 0);
__decorate$4([
  signal()
], View2D.prototype, "assetHash", void 0);
__decorate$4([
  lazy(() => {
    const frameID = "motion-canvas-2d-frame";
    let frame = document.querySelector(`#${frameID}`);
    if (!frame) {
      frame = document.createElement("div");
      frame.id = frameID;
      frame.style.position = "absolute";
      frame.style.pointerEvents = "none";
      frame.style.top = "0";
      frame.style.left = "0";
      frame.style.opacity = "0";
      frame.style.overflow = "hidden";
      document.body.prepend(frame);
    }
    return frame.shadowRoot ?? frame.attachShadow({ mode: "open" });
  })
], View2D, "shadowRoot", void 0);
View2D = View2D_1 = __decorate$4([
  nodeName("View2D")
], View2D);
var __decorate$3 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var Img_1;
let Img = Img_1 = class Img2 extends Rect {
  constructor(props) {
    super(props);
    if (!("src" in props)) {
      useLogger().warn({
        message: "No source specified for the image",
        remarks: `<p>The image won&#39;t be visible unless you specify a source:</p>
<pre class=""><code class="language-tsx"><span class="hljs-keyword">import</span> myImage <span class="hljs-keyword">from</span> <span class="hljs-string">&#x27;./example.png&#x27;</span>;
<span class="hljs-comment">// ...</span>
<span class="language-xml"><span class="hljs-tag">&lt;<span class="hljs-name">Img</span> <span class="hljs-attr">src</span>=<span class="hljs-string">{myImage}</span> /&gt;</span></span>;</code></pre><p>If you did this intentionally, and don&#39;t want to see this warning, set the <code>src</code>
property to <code>null</code>:</p>
<pre class=""><code class="language-tsx">&lt;<span class="hljs-title class_">Img</span> src={<span class="hljs-literal">null</span>} /&gt;</code></pre><p><a href='https://motioncanvas.io/docs/media#images' target='_blank'>Learn more</a> about working with
images.</p>
`,
        inspect: this.key
      });
    }
  }
  desiredSize() {
    const custom = super.desiredSize();
    if (custom.x === null && custom.y === null) {
      const image = this.image();
      return {
        x: image.naturalWidth,
        y: image.naturalHeight
      };
    }
    return custom;
  }
  image() {
    const rawSrc = this.src();
    let src = "";
    let key = "";
    if (rawSrc) {
      key = viaProxy(rawSrc);
      const url = new URL(key, window.location.origin);
      if (url.origin === window.location.origin) {
        const hash = this.view().assetHash();
        url.searchParams.set("asset-hash", hash);
      }
      src = url.toString();
    }
    let image = Img_1.pool[key];
    if (!image) {
      image = document.createElement("img");
      image.crossOrigin = "anonymous";
      image.src = src;
      Img_1.pool[key] = image;
    }
    if (!image.complete) {
      DependencyContext.collectPromise(new Promise((resolve, reject) => {
        image.addEventListener("load", resolve);
        image.addEventListener("error", () => reject(new DetailedError({
          message: `Failed to load an image`,
          remarks: `The <code>src</code> property was set to:
<pre><code>${rawSrc}</code></pre>
...which resolved to the following url:
<pre><code>${src}</code></pre>
Make sure that source is correct and that the image exists.<br/>
<a target='_blank' href='https://motioncanvas.io/docs/media#images'>Learn more</a>
about working with images.`,
          inspect: this.key
        })));
      }));
    }
    return image;
  }
  imageCanvas() {
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!canvas) {
      throw new Error("Could not create an image canvas");
    }
    return canvas;
  }
  filledImageCanvas() {
    const context = this.imageCanvas();
    const image = this.image();
    context.canvas.width = image.naturalWidth;
    context.canvas.height = image.naturalHeight;
    context.imageSmoothingEnabled = this.smoothing();
    context.drawImage(image, 0, 0);
    return context;
  }
  draw(context) {
    this.drawShape(context);
    const alpha = this.alpha();
    if (alpha > 0) {
      const box = BBox.fromSizeCentered(this.computedSize());
      context.save();
      context.clip(this.getPath());
      if (alpha < 1) {
        context.globalAlpha *= alpha;
      }
      context.imageSmoothingEnabled = this.smoothing();
      drawImage(context, this.image(), box);
      context.restore();
    }
    if (this.clip()) {
      context.clip(this.getPath());
    }
    this.drawChildren(context);
  }
  applyFlex() {
    super.applyFlex();
    const image = this.image();
    this.element.style.aspectRatio = (this.ratio() ?? image.naturalWidth / image.naturalHeight).toString();
  }
  /**
   * Get color of the image at the given position.
   *
   * @param position - The position in local space at which to sample the color.
   */
  getColorAtPoint(position) {
    const size = this.computedSize();
    const naturalSize = this.naturalSize();
    const pixelPosition = new Vector2(position).add(this.computedSize().scale(0.5)).mul(naturalSize.div(size).safe);
    return this.getPixelColor(pixelPosition);
  }
  /**
   * The natural size of this image.
   *
   * @remarks
   * The natural size is the size of the source image unaffected by the size
   * and scale properties.
   */
  naturalSize() {
    const image = this.image();
    return new Vector2(image.naturalWidth, image.naturalHeight);
  }
  /**
   * Get color of the image at the given pixel.
   *
   * @param position - The pixel's position.
   */
  getPixelColor(position) {
    const context = this.filledImageCanvas();
    const vector = new Vector2(position);
    const data = context.getImageData(vector.x, vector.y, 1, 1).data;
    return new ExtendedColor({
      r: data[0],
      g: data[1],
      b: data[2],
      a: data[3] / 255
    });
  }
  collectAsyncResources() {
    super.collectAsyncResources();
    this.image();
  }
};
Img.pool = {};
__decorate$3([
  signal()
], Img.prototype, "src", void 0);
__decorate$3([
  initial(1),
  signal()
], Img.prototype, "alpha", void 0);
__decorate$3([
  initial(true),
  signal()
], Img.prototype, "smoothing", void 0);
__decorate$3([
  computed()
], Img.prototype, "image", null);
__decorate$3([
  computed()
], Img.prototype, "imageCanvas", null);
__decorate$3([
  computed()
], Img.prototype, "filledImageCanvas", null);
__decorate$3([
  computed()
], Img.prototype, "naturalSize", null);
Img = Img_1 = __decorate$3([
  nodeName("Img")
], Img);
var __decorate$2 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var TxtLeaf_1;
let TxtLeaf = TxtLeaf_1 = class TxtLeaf2 extends Shape {
  constructor({ children, ...rest }) {
    super(rest);
    if (children) {
      this.text(children);
    }
  }
  parentTxt() {
    const parent = this.parent();
    return parent instanceof Txt ? parent : null;
  }
  draw(context) {
    this.requestFontUpdate();
    this.applyStyle(context);
    this.applyText(context);
    context.font = this.styles.font;
    context.textBaseline = "bottom";
    if ("letterSpacing" in context) {
      context.letterSpacing = `${this.letterSpacing()}px`;
    }
    const fontOffset = context.measureText("").fontBoundingBoxAscent;
    const parentRect = this.element.getBoundingClientRect();
    const { width, height } = this.size();
    const range2 = document.createRange();
    let line = "";
    const lineRect = new BBox();
    for (const childNode of this.element.childNodes) {
      if (!childNode.textContent) {
        continue;
      }
      range2.selectNodeContents(childNode);
      const rangeRect = range2.getBoundingClientRect();
      const x = width / -2 + rangeRect.left - parentRect.left;
      const y = height / -2 + rangeRect.top - parentRect.top + fontOffset;
      if (lineRect.y === y) {
        lineRect.width += rangeRect.width;
        line += childNode.textContent;
      } else {
        this.drawText(context, line, lineRect);
        lineRect.x = x;
        lineRect.y = y;
        lineRect.width = rangeRect.width;
        lineRect.height = rangeRect.height;
        line = childNode.textContent;
      }
    }
    this.drawText(context, line, lineRect);
  }
  drawText(context, text, box) {
    const y = box.y;
    text = text.replace(/\s+/g, " ");
    if (this.lineWidth() <= 0) {
      context.fillText(text, box.x, y);
    } else if (this.strokeFirst()) {
      context.strokeText(text, box.x, y);
      context.fillText(text, box.x, y);
    } else {
      context.fillText(text, box.x, y);
      context.strokeText(text, box.x, y);
    }
  }
  getCacheBBox() {
    const size = this.computedSize();
    const range2 = document.createRange();
    range2.selectNodeContents(this.element);
    const bbox = range2.getBoundingClientRect();
    const lineWidth = this.lineWidth();
    const miterLimitCoefficient = this.lineJoin() === "miter" ? 0.5 * 10 : 0.5;
    return new BBox(-size.width / 2, -size.height / 2, bbox.width, bbox.height).expand([0, this.fontSize() * 0.5]).expand(lineWidth * miterLimitCoefficient);
  }
  applyFlex() {
    super.applyFlex();
    this.element.style.display = "inline";
  }
  updateLayout() {
    this.applyFont();
    this.applyFlex();
    if (this.justifyContent.isInitial()) {
      this.element.style.justifyContent = this.styles.getPropertyValue("text-align");
    }
    const wrap = this.styles.whiteSpace !== "nowrap" && this.styles.whiteSpace !== "pre";
    if (wrap) {
      this.element.innerText = "";
      if (TxtLeaf_1.segmenter) {
        for (const word of TxtLeaf_1.segmenter.segment(this.text())) {
          this.element.appendChild(document.createTextNode(word.segment));
        }
      } else {
        for (const word of this.text().split("")) {
          this.element.appendChild(document.createTextNode(word));
        }
      }
    } else if (this.styles.whiteSpace === "pre") {
      this.element.innerText = "";
      for (const line of this.text().split("\n")) {
        this.element.appendChild(document.createTextNode(line + "\n"));
      }
    } else {
      this.element.innerText = this.text();
    }
  }
};
__decorate$2([
  initial(""),
  interpolation(textLerp),
  signal()
], TxtLeaf.prototype, "text", void 0);
__decorate$2([
  computed()
], TxtLeaf.prototype, "parentTxt", null);
__decorate$2([
  lazy(() => {
    const formatter = document.createElement("span");
    View2D.shadowRoot.append(formatter);
    return formatter;
  })
], TxtLeaf, "formatter", void 0);
__decorate$2([
  lazy(() => {
    try {
      return new Intl.Segmenter(void 0, {
        granularity: "grapheme"
      });
    } catch (e) {
      return null;
    }
  })
], TxtLeaf, "segmenter", void 0);
TxtLeaf = TxtLeaf_1 = __decorate$2([
  nodeName("TxtLeaf")
], TxtLeaf);
[
  "fill",
  "stroke",
  "lineWidth",
  "strokeFirst",
  "lineCap",
  "lineJoin",
  "lineDash",
  "lineDashOffset"
].forEach((prop) => {
  TxtLeaf.prototype[`get${capitalize(prop)}`] = function() {
    var _a2;
    return ((_a2 = this.parentTxt()) == null ? void 0 : _a2[prop]()) ?? this[prop].context.getInitial();
  };
});
var __decorate$1 = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var Txt_1;
let Txt = Txt_1 = class Txt2 extends Shape {
  /**
   * Create a bold text node.
   *
   * @remarks
   * This is a shortcut for
   * ```tsx
   * <Txt fontWeight={700} />
   * ```
   *
   * @param props - Additional text properties.
   */
  static b(props) {
    return new Txt_1({ ...props, fontWeight: 700 });
  }
  /**
   * Create an italic text node.
   *
   * @remarks
   * This is a shortcut for
   * ```tsx
   * <Txt fontStyle={'italic'} />
   * ```
   *
   * @param props - Additional text properties.
   */
  static i(props) {
    return new Txt_1({ ...props, fontStyle: "italic" });
  }
  getText() {
    return this.innerText();
  }
  setText(value) {
    const children = this.children();
    let leaf = null;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (leaf === null && child instanceof TxtLeaf) {
        leaf = child;
      } else {
        child.parent(null);
      }
    }
    if (leaf === null) {
      leaf = new TxtLeaf({ text: value });
      leaf.parent(this);
    } else {
      leaf.text(value);
    }
    this.setParsedChildren([leaf]);
  }
  setChildren(value) {
    if (this.children.context.raw() === value) {
      return;
    }
    if (typeof value === "string") {
      this.text(value);
    } else {
      super.setChildren(value);
    }
  }
  *tweenText(value, time, timingFunction, interpolationFunction) {
    const children = this.children();
    if (children.length !== 1 || !(children[0] instanceof TxtLeaf)) {
      this.text.save();
    }
    const leaf = this.childAs(0);
    const oldText = leaf.text.context.raw();
    const oldSize = this.size.context.raw();
    leaf.text(value);
    const newSize = this.size();
    leaf.text(oldText ?? DEFAULT);
    if (this.height() === 0) {
      this.height(newSize.height);
    }
    yield* all(this.size(newSize, time, timingFunction), leaf.text(value, time, timingFunction, interpolationFunction));
    this.children.context.setter(value);
    this.size(oldSize);
  }
  getLayout() {
    return true;
  }
  constructor({ children, text, ...props }) {
    super(props);
    this.children(text ?? children);
  }
  innerText() {
    const children = this.childrenAs();
    let text = "";
    for (const child of children) {
      text += child.text();
    }
    return text;
  }
  parentTxt() {
    const parent = this.parent();
    return parent instanceof Txt_1 ? parent : null;
  }
  parseChildren(children) {
    const result = [];
    const array = Array.isArray(children) ? children : [children];
    for (const child of array) {
      if (child instanceof Txt_1 || child instanceof TxtLeaf) {
        result.push(child);
      } else if (typeof child === "string") {
        result.push(new TxtLeaf({ text: child }));
      }
    }
    return result;
  }
  applyFlex() {
    super.applyFlex();
    this.element.style.display = this.findAncestor(is(Txt_1)) ? "inline" : "block";
  }
  draw(context) {
    this.drawChildren(context);
  }
};
__decorate$1([
  initial(""),
  signal()
], Txt.prototype, "text", void 0);
__decorate$1([
  threadable()
], Txt.prototype, "tweenText", null);
__decorate$1([
  computed()
], Txt.prototype, "innerText", null);
__decorate$1([
  computed()
], Txt.prototype, "parentTxt", null);
Txt = Txt_1 = __decorate$1([
  nodeName("Txt")
], Txt);
[
  "fill",
  "stroke",
  "lineWidth",
  "strokeFirst",
  "lineCap",
  "lineJoin",
  "lineDash",
  "lineDashOffset"
].forEach((prop) => {
  Txt.prototype[`getDefault${capitalize(prop)}`] = function(initial2) {
    var _a2;
    return ((_a2 = this.parentTxt()) == null ? void 0 : _a2[prop]()) ?? initial2;
  };
});
var __decorate = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var Video_1;
let Video = Video_1 = class Video2 extends Rect {
  constructor({ play, ...props }) {
    super(props);
    this.lastTime = -1;
    if (play) {
      this.play();
    }
  }
  isPlaying() {
    return this.playing();
  }
  getCurrentTime() {
    return this.clampTime(this.time());
  }
  getDuration() {
    return this.video().duration;
  }
  desiredSize() {
    const custom = super.desiredSize();
    if (custom.x === null && custom.y === null) {
      const image = this.video();
      return {
        x: image.videoWidth,
        y: image.videoHeight
      };
    }
    return custom;
  }
  completion() {
    return this.clampTime(this.time()) / this.video().duration;
  }
  video() {
    const src = this.src();
    const key = `${this.key}/${src}`;
    let video = Video_1.pool[key];
    if (!video) {
      video = document.createElement("video");
      video.src = src;
      Video_1.pool[key] = video;
    }
    if (video.readyState < 2) {
      DependencyContext.collectPromise(new Promise((resolve) => {
        const listener = () => {
          resolve();
          video.removeEventListener("canplay", listener);
        };
        video.addEventListener("canplay", listener);
      }));
    }
    return video;
  }
  seekedVideo() {
    const video = this.video();
    const time = this.clampTime(this.time());
    video.playbackRate = this.playbackRate();
    if (!video.paused) {
      video.pause();
    }
    if (this.lastTime === time) {
      return video;
    }
    this.setCurrentTime(time);
    return video;
  }
  fastSeekedVideo() {
    const video = this.video();
    const time = this.clampTime(this.time());
    video.playbackRate = this.playbackRate();
    if (this.lastTime === time) {
      return video;
    }
    const playing = this.playing() && time < video.duration && video.playbackRate > 0;
    if (playing) {
      if (video.paused) {
        DependencyContext.collectPromise(video.play());
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
    if (Math.abs(video.currentTime - time) > 0.2) {
      this.setCurrentTime(time);
    } else if (!playing) {
      video.currentTime = time;
    }
    return video;
  }
  draw(context) {
    this.drawShape(context);
    const alpha = this.alpha();
    if (alpha > 0) {
      const playbackState = this.view().playbackState();
      const video = playbackState === PlaybackState.Playing || playbackState === PlaybackState.Presenting ? this.fastSeekedVideo() : this.seekedVideo();
      const box = BBox.fromSizeCentered(this.computedSize());
      context.save();
      context.clip(this.getPath());
      if (alpha < 1) {
        context.globalAlpha *= alpha;
      }
      context.imageSmoothingEnabled = this.smoothing();
      drawImage(context, video, box);
      context.restore();
    }
    if (this.clip()) {
      context.clip(this.getPath());
    }
    this.drawChildren(context);
  }
  applyFlex() {
    super.applyFlex();
    const video = this.video();
    this.element.style.aspectRatio = (this.ratio() ?? video.videoWidth / video.videoHeight).toString();
  }
  setCurrentTime(value) {
    const video = this.video();
    if (video.readyState < 2)
      return;
    video.currentTime = value;
    this.lastTime = value;
    if (video.seeking) {
      DependencyContext.collectPromise(new Promise((resolve) => {
        const listener = () => {
          resolve();
          video.removeEventListener("seeked", listener);
        };
        video.addEventListener("seeked", listener);
      }));
    }
  }
  setPlaybackRate(playbackRate) {
    let value;
    if (isReactive(playbackRate)) {
      value = playbackRate();
      useLogger().warn({
        message: "Invalid value set as the playback rate",
        remarks: '<p>The <code>playbackRate</code> of a <code>Video</code> cannot be reactive.</p>\n<p>Make sure to use a concrete value and not a function:</p>\n<pre class="wrong"><code class="language-ts">video.<span class="hljs-title function_">playbackRate</span>(<span class="hljs-function">() =&gt;</span> <span class="hljs-number">7</span>);</code></pre><pre class="correct"><code class="language-ts">video.<span class="hljs-title function_">playbackRate</span>(<span class="hljs-number">7</span>);</code></pre><p>If you&#39;re using a signal, extract its value before passing it to the property:</p>\n<pre class="wrong"><code class="language-ts">video.<span class="hljs-title function_">playbackRate</span>(mySignal);</code></pre><pre class="correct"><code class="language-ts">video.<span class="hljs-title function_">playbackRate</span>(<span class="hljs-title function_">mySignal</span>());</code></pre>',
        inspect: this.key,
        stack: new Error().stack
      });
    } else {
      value = playbackRate;
    }
    this.playbackRate.context.setter(value);
    if (this.playing()) {
      if (value === 0) {
        this.pause();
      } else {
        const time = useThread().time;
        const start = time();
        const offset = this.time();
        this.time(() => this.clampTime(offset + (time() - start) * value));
      }
    }
  }
  play() {
    const time = useThread().time;
    const start = time();
    const offset = this.time();
    const playbackRate = this.playbackRate();
    this.playing(true);
    this.time(() => this.clampTime(offset + (time() - start) * playbackRate));
  }
  pause() {
    this.playing(false);
    this.time.save();
    this.video().pause();
  }
  seek(time) {
    const playing = this.playing();
    this.time(this.clampTime(time));
    if (playing) {
      this.play();
    } else {
      this.pause();
    }
  }
  clampTime(time) {
    const duration = this.video().duration;
    if (this.loop()) {
      time %= duration;
    }
    return clamp(0, duration, time);
  }
  collectAsyncResources() {
    super.collectAsyncResources();
    this.seekedVideo();
  }
};
Video.pool = {};
__decorate([
  signal()
], Video.prototype, "src", void 0);
__decorate([
  initial(1),
  signal()
], Video.prototype, "alpha", void 0);
__decorate([
  initial(true),
  signal()
], Video.prototype, "smoothing", void 0);
__decorate([
  initial(false),
  signal()
], Video.prototype, "loop", void 0);
__decorate([
  initial(1),
  signal()
], Video.prototype, "playbackRate", void 0);
__decorate([
  initial(0),
  signal()
], Video.prototype, "time", void 0);
__decorate([
  initial(false),
  signal()
], Video.prototype, "playing", void 0);
__decorate([
  computed()
], Video.prototype, "completion", null);
__decorate([
  computed()
], Video.prototype, "video", null);
__decorate([
  computed()
], Video.prototype, "seekedVideo", null);
__decorate([
  computed()
], Video.prototype, "fastSeekedVideo", null);
Video = Video_1 = __decorate([
  nodeName("Video")
], Video);
class Scene2D extends GeneratorScene {
  constructor(description2) {
    super(description2);
    this.view = null;
    this.registeredNodes = /* @__PURE__ */ new Map();
    this.nodeCounters = /* @__PURE__ */ new Map();
    this.assetHash = Date.now().toString();
    this.recreateView();
  }
  getView() {
    return this.view;
  }
  next() {
    var _a2;
    (_a2 = this.getView()) == null ? void 0 : _a2.playbackState(this.playback.state).globalTime(this.playback.time);
    return super.next();
  }
  draw(context) {
    context.save();
    this.renderLifecycle.dispatch([SceneRenderEvent.BeforeRender, context]);
    context.save();
    this.renderLifecycle.dispatch([SceneRenderEvent.BeginRender, context]);
    this.getView().playbackState(this.playback.state).globalTime(this.playback.time);
    this.getView().render(context);
    this.renderLifecycle.dispatch([SceneRenderEvent.FinishRender, context]);
    context.restore();
    this.renderLifecycle.dispatch([SceneRenderEvent.AfterRender, context]);
    context.restore();
  }
  reset(previousScene) {
    for (const key of this.registeredNodes.keys()) {
      try {
        this.registeredNodes.get(key).dispose();
      } catch (e) {
        this.logger.error(e);
      }
    }
    this.registeredNodes.clear();
    this.registeredNodes = /* @__PURE__ */ new Map();
    this.nodeCounters.clear();
    this.recreateView();
    return super.reset(previousScene);
  }
  inspectPosition(x, y) {
    return this.execute(() => {
      var _a2;
      return ((_a2 = this.getView().hit(new Vector2(x, y))) == null ? void 0 : _a2.key) ?? null;
    });
  }
  validateInspection(element) {
    var _a2;
    return ((_a2 = this.getNode(element)) == null ? void 0 : _a2.key) ?? null;
  }
  inspectAttributes(element) {
    const node = this.getNode(element);
    if (!node)
      return null;
    const attributes = {
      stack: node.creationStack,
      key: node.key
    };
    for (const { key, meta: meta2, signal: signal2 } of node) {
      if (!meta2.inspectable)
        continue;
      attributes[key] = signal2();
    }
    return attributes;
  }
  drawOverlay(element, matrix, context) {
    const node = this.getNode(element);
    if (node) {
      this.execute(() => {
        const cameras = this.getView().findAll(is(Camera));
        const parentCameras = [];
        for (const camera of cameras) {
          const scene = camera.scene();
          if (!scene)
            continue;
          if (scene === node || scene.findFirst((n) => n === node)) {
            parentCameras.push(camera);
          }
        }
        if (parentCameras.length > 0) {
          for (const camera of parentCameras) {
            const cameraParentToWorld = camera.parentToWorld();
            const cameraLocalToParent = camera.localToParent().inverse();
            const nodeLocalToWorld = node.localToWorld();
            node.drawOverlay(context, matrix.multiply(cameraParentToWorld).multiply(cameraLocalToParent).multiply(nodeLocalToWorld));
          }
        } else {
          node.drawOverlay(context, matrix.multiply(node.localToWorld()));
        }
      });
    }
  }
  transformMousePosition(x, y) {
    return new Vector2(x, y).transformAsPoint(this.getView().localToParent().inverse());
  }
  registerNode(node, key) {
    var _a2;
    const className = ((_a2 = node.constructor) == null ? void 0 : _a2.name) ?? "unknown";
    const counter = (this.nodeCounters.get(className) ?? 0) + 1;
    this.nodeCounters.set(className, counter);
    if (key && this.registeredNodes.has(key)) {
      useLogger().error({
        message: `Duplicated node key: "${key}".`,
        inspect: key,
        stack: new Error().stack
      });
      key = void 0;
    }
    key ?? (key = `${this.name}/${className}[${counter}]`);
    this.registeredNodes.set(key, node);
    const currentNodeMap = this.registeredNodes;
    return [key, () => currentNodeMap.delete(key)];
  }
  getNode(key) {
    if (typeof key !== "string")
      return null;
    return this.registeredNodes.get(key) ?? null;
  }
  *getDetachedNodes() {
    for (const node of this.registeredNodes.values()) {
      if (!node.parent() && node !== this.view)
        yield node;
    }
  }
  recreateView() {
    this.execute(() => {
      const size = this.getSize();
      this.view = new View2D({
        position: size.scale(this.resolutionScale / 2),
        scale: this.resolutionScale,
        assetHash: this.assetHash,
        size
      });
    });
  }
}
function makeScene2D(runner) {
  return {
    klass: Scene2D,
    config: runner,
    stack: new Error().stack,
    meta: createSceneMetadata(),
    plugins: ["@motion-canvas/2d/editor"]
  };
}
const gaussianBlur = `#version 300 es
precision highp float;

in vec2 screenUV;
in vec2 sourceUV;
in vec2 destinationUV;

out vec4 outColor;

uniform float time;
uniform float deltaTime;
uniform float framerate;
uniform int frame;
uniform vec2 resolution;
uniform sampler2D sourceTexture;
uniform sampler2D destinationTexture;
uniform mat4 sourceMatrix;
uniform mat4 destinationMatrix;

uniform float Size;
uniform float Quality;
uniform float Directions;

const float Pi = 6.28318530718;

vec4 safeTexture(sampler2D tex, vec2 uv) {
    vec2 clampedUV = clamp(uv, 0.0, 1.0);
    return texture(tex, clampedUV);
}

void main() {
    vec2 radius = Size / resolution.xy;
    vec4 color = safeTexture(sourceTexture, sourceUV);
    float totalWeight = 1.0;

    for (float d = 0.0; d < Pi; d += Pi / Directions) {
        vec2 dir = vec2(cos(d), sin(d));

        for (float i = 1.0; i <= Quality; i++) {
            float dist = i / Quality;
            float weight = 1.0 - smoothstep(0.0, 1.0, dist);

            vec2 offset = dir * radius * dist;

            color += safeTexture(sourceTexture, sourceUV + offset) * weight;
            color += safeTexture(sourceTexture, sourceUV - offset) * weight;
            totalWeight += 2.0 * weight;
        }
    }

    outColor = color / totalWeight;
}


//# sourceURL=src/shaders/gaussianBlur.glsl`;
var __defProp2 = Object.defineProperty;
var __decorateClass = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = decorator(target, key, result) || result;
  if (result) __defProp2(target, key, result);
  return result;
};
const GO_UP = 8 / 30;
const GO_DOWN = 5 / 30;
class AnimatedCaptions extends Node {
  constructor(props) {
    super({ ...props });
    __publicField(this, "CaptionText", createSignal(""));
    __publicField(this, "Opacity", createSignal(0));
    __publicField(this, "Blur", createSignal(0));
    const ScaleFactor = createSignal(() => {
      const height = this.SceneHeight();
      return height > 0 ? height / 720 : 1;
    });
    this.add(
      /* @__PURE__ */ jsx(
        Rect,
        {
          opacity: () => this.ShowCaptions() && this.TranscriptionData().length > 0 && this.CaptionText().trim().replace(/\*/g, "").length > 0 ? this.Opacity() : 0,
          layout: true,
          alignItems: "center",
          justifyContent: "center",
          shaders: [
            {
              fragment: gaussianBlur,
              uniforms: {
                Directions: 12,
                Size: this.Blur,
                Quality: 10
              }
            }
          ],
          children: /* @__PURE__ */ jsx(
            Rect,
            {
              fill: "rgba(0,0,0,0.9)",
              shadowBlur: 50,
              shadowColor: "rgba(0,0,0,0.8)",
              layout: true,
              alignItems: "center",
              justifyContent: "center",
              paddingTop: () => 10 * this.CaptionsSize() * ScaleFactor(),
              paddingBottom: () => 6 * this.CaptionsSize() * ScaleFactor(),
              paddingLeft: () => 14 * this.CaptionsSize() * ScaleFactor(),
              paddingRight: () => 14 * this.CaptionsSize() * ScaleFactor(),
              radius: () => 10 * this.CaptionsSize() * ScaleFactor(),
              children: () => this.CaptionText().split("*").map((caption, index) => {
                if (!caption) return null;
                const [, secondary] = this.CaptionText().split("*");
                return /* @__PURE__ */ jsx(
                  Txt,
                  {
                    shadowBlur: 20,
                    shadowColor: index === 0 ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0)",
                    fill: index === 1 ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,1)",
                    fontWeight: this.CaptionsFontWeight(),
                    fontFamily: this.CaptionsFontFamily(),
                    text: caption.trim(),
                    paddingRight: index === 0 && secondary ? 5 * this.CaptionsSize() * ScaleFactor() : 0,
                    fontSize: () => this.CaptionsSize() * ScaleFactor() * 18
                  },
                  `${caption}-${index}`
                );
              })
            }
          )
        }
      )
    );
  }
  *animate() {
    var _a2;
    const MAX_LENGTH = 50;
    const filteredData = this.TranscriptionData().filter(
      (entry) => entry.speech.trim().length > 0
    );
    if (filteredData.length === 0) {
      this.CaptionText("");
      return;
    }
    let currText = "";
    let currSeconds = 0;
    const captions = /* @__PURE__ */ new Map([
      [currSeconds, /* @__PURE__ */ new Map()]
    ]);
    for (const entry of filteredData) {
      currText += entry.speech;
      (_a2 = captions.get(currSeconds)) == null ? void 0 : _a2.set(entry.start / 1e3, entry.speech);
      if (currText.length > MAX_LENGTH) {
        currSeconds = entry.start / 1e3;
        currText = "";
        captions.set(currSeconds, /* @__PURE__ */ new Map());
      }
    }
    let index = 0;
    for (const [seconds, shortcut] of captions.entries()) {
      this.CaptionText("*" + Array.from(shortcut.values()).join(" "));
      const prevShortcut = Array.from(captions.entries())[index - 1];
      if (!prevShortcut || seconds - prevShortcut[0] >= this.CaptionsDuration()) {
        yield* tween(GO_UP, (value) => {
          this.Opacity(map(0, 1, easeInCubic(value)));
          this.Blur(map(100, 0, easeInCubic(value)));
        });
      }
      index++;
      let prevSeconds = seconds;
      if (prevShortcut) prevSeconds += GO_UP + GO_DOWN;
      let i = 0;
      for (const [startSeconds, caption] of shortcut.entries()) {
        const text = Array.from(shortcut.values()).slice(0, i).join(" ") + ` ${caption}*` + Array.from(shortcut.values()).slice(i + 1).join(" ");
        this.CaptionText(text);
        yield* waitFor(startSeconds - prevSeconds);
        prevSeconds = startSeconds;
        i++;
      }
      if (prevSeconds < this.CaptionsDuration() + seconds) {
        yield* waitFor(
          this.CaptionsDuration() - prevSeconds + seconds - GO_DOWN - GO_UP
        );
      }
      yield* tween(GO_DOWN, (value) => {
        this.Opacity(map(1, 0, easeOutCubic(value)));
        this.Blur(map(0, 100, easeOutCubic(value)));
      });
    }
  }
}
__decorateClass([
  initial(false),
  signal()
], AnimatedCaptions.prototype, "ShowCaptions");
__decorateClass([
  initial(1.5),
  signal()
], AnimatedCaptions.prototype, "CaptionsDuration");
__decorateClass([
  initial(1),
  signal()
], AnimatedCaptions.prototype, "CaptionsSize");
__decorateClass([
  initial([]),
  signal()
], AnimatedCaptions.prototype, "TranscriptionData");
__decorateClass([
  initial(0),
  signal()
], AnimatedCaptions.prototype, "SceneHeight");
__decorateClass([
  initial("Inter Variable"),
  signal()
], AnimatedCaptions.prototype, "CaptionsFontFamily");
__decorateClass([
  initial(400),
  signal()
], AnimatedCaptions.prototype, "CaptionsFontWeight");
const toVector = (transform) => new Vector2(transform.x, transform.y);
function parseTimeToMs(time) {
  if (typeof time === "number") return time;
  if (typeof time === "string") {
    const numeric = parseFloat(time.replace(/[^0-9.]/g, ""));
    return Number.isFinite(numeric) ? numeric * 1e3 : 0;
  }
  return 0;
}
function normalizeRawSegments(segments) {
  if (!(segments == null ? void 0 : segments.length)) return [];
  return segments.flatMap((seg) => {
    if (typeof seg.start === "number" && seg.speech) {
      return [{ start: seg.start, speech: seg.speech }];
    }
    if (seg.text && seg.startTime) {
      const startMs = parseTimeToMs(seg.startTime);
      return [{ start: startMs, speech: seg.text }];
    }
    return [];
  }).filter((s) => s.speech.trim().length > 0);
}
function makeTransitionKey(from, to) {
  return `${from}->${to}`;
}
const luminanceToAlpha = `#version 300 es
precision highp float;

in vec2 screenUV;
in vec2 sourceUV;
in vec2 destinationUV;

out vec4 outColor;

uniform float time;
uniform float deltaTime;
uniform float framerate;
uniform int frame;
uniform vec2 resolution;
uniform sampler2D sourceTexture;
uniform sampler2D destinationTexture;
uniform mat4 sourceMatrix;
uniform mat4 destinationMatrix;

void main() {
    vec4 color = texture(sourceTexture, sourceUV);
    // Convert luminance (brightness) to alpha
    // White pixels (high luminance) → high alpha (opaque)
    // Black pixels (low luminance) → low alpha (transparent)
    float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    outColor = vec4(color.rgb, luminance);
}


//# sourceURL=src/shaders/luminanceToAlpha.glsl`;
function createVideoElements({ clips, view }) {
  const entries = [];
  for (const clip of clips) {
    const ref = createRef();
    if (clip.maskSrc && clip.maskMode) {
      const maskRef = createRef();
      const containerRef = createRef();
      const compositeOp = clip.maskMode === "include" ? "source-in" : "source-out";
      entries.push({ clip, ref, maskRef, containerRef });
      view.add(
        /* @__PURE__ */ jsx(
          Node,
          {
            ref: containerRef,
            cache: true,
            position: toVector(clip.position),
            scale: toVector(clip.scale),
            opacity: 0,
            children: [
              /* @__PURE__ */ jsx(
                Video,
                {
                  ref: maskRef,
                  src: clip.maskSrc,
                  width: 1920,
                  height: 1080,
                  cache: true,
                  shaders: {
                    fragment: luminanceToAlpha,
                    uniforms: {}
                  }
                },
                `mask-${clip.id}`
              ),
              /* @__PURE__ */ jsx(
                Video,
                {
                  ref,
                  src: clip.src,
                  width: 1920,
                  height: 1080,
                  compositeOperation: compositeOp
                },
                `video-clip-${clip.id}`
              )
            ]
          },
          `masked-container-${clip.id}`
        )
      );
    } else {
      entries.push({ clip, ref });
      view.add(
        /* @__PURE__ */ jsx(
          Video,
          {
            ref,
            src: clip.src,
            width: 1920,
            height: 1080,
            opacity: 0,
            position: toVector(clip.position),
            scale: toVector(clip.scale)
          },
          `video-clip-${clip.id}`
        )
      );
    }
  }
  return entries;
}
function* playVideo({
  entry,
  sceneWidth,
  sceneHeight,
  transitions,
  captionRunner
}) {
  const { clip, ref: videoRef, maskRef, containerRef } = entry;
  const transInfo = transitions.get(clip.id);
  const enter = transInfo == null ? void 0 : transInfo.enter;
  const exit = transInfo == null ? void 0 : transInfo.exit;
  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 1e-4);
  let startAt = clip.start;
  let timelineDuration = clip.duration / safeSpeed;
  let offset = clip.offset;
  if (enter) {
    startAt -= enter.duration / 2;
    timelineDuration += enter.duration / 2;
    offset -= enter.duration / 2 * safeSpeed;
  }
  if (exit) {
    timelineDuration += exit.duration / 2;
  }
  const waitTime = Math.max(startAt, 0);
  if (waitTime > 0) {
    yield* waitFor(waitTime);
  }
  const video = videoRef();
  if (!video) return;
  const maskVideo = maskRef == null ? void 0 : maskRef();
  const container = containerRef == null ? void 0 : containerRef();
  const isMaskedClip = !!(maskVideo && container);
  const playback = function* () {
    const safeOffset = Math.max(0, offset);
    video.seek(safeOffset);
    video.playbackRate(safeSpeed);
    if (maskVideo) {
      maskVideo.seek(safeOffset);
      maskVideo.playbackRate(safeSpeed);
    }
    const fit = clip.objectFit ?? "fill";
    let vidW = sceneWidth;
    let vidH = sceneHeight;
    if (fit !== "fill") {
      const domVideo = video.video();
      const srcW = (domVideo == null ? void 0 : domVideo.videoWidth) || 1920;
      const srcH = (domVideo == null ? void 0 : domVideo.videoHeight) || 1080;
      if (srcW > 0 && srcH > 0) {
        const srcRatio = srcW / srcH;
        const sceneRatio = sceneWidth / sceneHeight;
        if (fit === "contain") {
          if (srcRatio > sceneRatio) {
            vidW = sceneWidth;
            vidH = sceneWidth / srcRatio;
          } else {
            vidH = sceneHeight;
            vidW = sceneHeight * srcRatio;
          }
        } else if (fit === "cover") {
          if (srcRatio > sceneRatio) {
            vidH = sceneHeight;
            vidW = sceneHeight * srcRatio;
          } else {
            vidW = sceneWidth;
            vidH = sceneWidth / srcRatio;
          }
        }
      }
    }
    video.width(vidW);
    video.height(vidH);
    if (maskVideo) {
      maskVideo.width(vidW);
      maskVideo.height(vidH);
    }
    let baseScale = toVector(clip.scale);
    let basePos = toVector(clip.position);
    if (clip.focus) {
      const { x, y, width: fw, height: fh, padding } = clip.focus;
      const sX = vidW / Math.max(1, fw + padding * 2);
      const sY = vidH / Math.max(1, fh + padding * 2);
      const s = Math.min(sX, sY);
      baseScale = baseScale.mul(s);
      const fvx = x + fw / 2 - vidW / 2;
      const fvy = y + fh / 2 - vidH / 2;
      const focusOffset = new Vector2(fvx, fvy);
      basePos = basePos.sub(focusOffset.mul(baseScale));
    }
    const opacityTarget = isMaskedClip ? container : video;
    const positionTarget = isMaskedClip ? container : video;
    const scaleTarget = isMaskedClip ? container : video;
    const initialPos = basePos;
    positionTarget.position(initialPos);
    scaleTarget.scale(baseScale);
    if (enter && enter.type === "fade") {
      opacityTarget.opacity(0);
    } else {
      opacityTarget.opacity(1);
    }
    if (enter && enter.type.startsWith("slide")) {
      let startPos = initialPos;
      if (enter.type === "slide-left") startPos = new Vector2(initialPos.x + sceneWidth, initialPos.y);
      else if (enter.type === "slide-right") startPos = new Vector2(initialPos.x - sceneWidth, initialPos.y);
      else if (enter.type === "slide-up") startPos = new Vector2(initialPos.x, initialPos.y + sceneHeight);
      else if (enter.type === "slide-down") startPos = new Vector2(initialPos.x, initialPos.y - sceneHeight);
      positionTarget.position(startPos);
    }
    video.play();
    if (maskVideo) {
      maskVideo.play();
    }
    if (enter) {
      if (enter.type === "fade") {
        yield* opacityTarget.opacity(1, enter.duration);
      } else if (enter.type.startsWith("slide")) {
        yield* positionTarget.position(initialPos, enter.duration);
      } else {
        yield* waitFor(enter.duration);
      }
    }
    const mainDuration = timelineDuration - (enter ? enter.duration : 0) - (exit ? exit.duration : 0);
    if (mainDuration > 0) {
      yield* waitFor(mainDuration);
    }
    if (exit) {
      if (exit.type === "fade") {
        yield* opacityTarget.opacity(0, exit.duration);
      } else if (exit.type.startsWith("slide")) {
        let endPos = initialPos;
        if (exit.type === "slide-left") endPos = new Vector2(initialPos.x - sceneWidth, initialPos.y);
        else if (exit.type === "slide-right") endPos = new Vector2(initialPos.x + sceneWidth, initialPos.y);
        else if (exit.type === "slide-up") endPos = new Vector2(initialPos.x, initialPos.y - sceneHeight);
        else if (exit.type === "slide-down") endPos = new Vector2(initialPos.x, initialPos.y + sceneHeight);
        yield* positionTarget.position(endPos, exit.duration);
      } else {
        yield* waitFor(exit.duration);
      }
    }
    opacityTarget.opacity(0);
    video.pause();
    if (maskVideo) {
      maskVideo.pause();
    }
  };
  if (captionRunner) {
    yield* all(playback(), captionRunner());
  } else {
    yield* playback();
  }
}
function createTextElements({ clips, view, settings: settings2 }) {
  const entries = [];
  for (const clip of clips) {
    const ref = createRef();
    const fontSize = clip.fontSize ?? settings2.defaultFontSize ?? 48;
    const fill = clip.fill ?? settings2.defaultFill ?? "#ffffff";
    entries.push({ clip, ref });
    view.add(
      /* @__PURE__ */ jsx(
        Txt,
        {
          ref,
          text: clip.text,
          fontFamily: settings2.fontFamily,
          fontWeight: settings2.fontWeight,
          fontSize,
          fill,
          x: clip.position.x,
          y: clip.position.y,
          scale: clip.scale,
          opacity: 0
        },
        `text-clip-${clip.id}`
      )
    );
  }
  return entries;
}
function* playText({ entry }) {
  const { clip, ref } = entry;
  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 1e-4);
  const startAt = Math.max(clip.start, 0);
  const timelineDuration = clip.duration / safeSpeed;
  if (startAt > 0) {
    yield* waitFor(startAt);
  }
  const text = ref();
  if (!text) return;
  text.opacity(clip.opacity ?? 1);
  yield* waitFor(timelineDuration);
  text.opacity(0);
}
function createImageElements({ clips, view }) {
  const entries = [];
  for (const clip of clips) {
    const ref = createRef();
    const imgWidth = clip.width ?? 1920;
    const imgHeight = clip.height ?? 1080;
    entries.push({ clip, ref });
    view.add(
      /* @__PURE__ */ jsx(
        Img,
        {
          ref,
          src: clip.src,
          width: imgWidth,
          height: imgHeight,
          x: clip.position.x,
          y: clip.position.y,
          scale: clip.scale,
          opacity: 0
        },
        `image-clip-${clip.id}`
      )
    );
  }
  return entries;
}
function* playImage({ entry }) {
  const { clip, ref } = entry;
  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 1e-4);
  const startAt = Math.max(clip.start, 0);
  const timelineDuration = clip.duration / safeSpeed;
  if (startAt > 0) {
    yield* waitFor(startAt);
  }
  const image = ref();
  if (!image) return;
  image.opacity(1);
  yield* waitFor(timelineDuration);
  image.opacity(0);
}
function createAudioElements({ clips, view, sceneWidth, sceneHeight }) {
  const entries = [];
  for (const clip of clips) {
    const ref = createRef();
    entries.push({ clip, ref });
    view.add(
      /* @__PURE__ */ jsx(
        Video,
        {
          ref,
          src: clip.src,
          width: 1,
          height: 1,
          x: sceneWidth / 2 - 0.5,
          y: sceneHeight / 2 - 0.5
        }
      )
    );
  }
  return entries;
}
function* playAudio({ entry, captionRunner }) {
  const { clip, ref } = entry;
  const speed = clip.speed ?? 1;
  const safeSpeed = Math.max(speed, 1e-4);
  const startAt = Math.max(clip.start, 0);
  const timelineDuration = clip.duration / safeSpeed;
  if (startAt > 0) {
    yield* waitFor(startAt);
  }
  const video = ref();
  if (!video) return;
  const playback = function* () {
    video.seek(clip.offset);
    video.playbackRate(safeSpeed);
    try {
      const htmlVideo = video.video();
      if (htmlVideo) {
        const trackVolume = Math.min(Math.max(clip.volume ?? 1, 0), 1);
        htmlVideo.volume = trackVolume;
      }
    } catch {
    }
    video.play();
    yield* waitFor(timelineDuration);
    video.pause();
  };
  if (captionRunner) {
    yield* all(playback(), captionRunner());
  } else {
    yield* playback();
  }
}
const description = makeScene2D(function* (view) {
  const scene = useScene();
  const { width, height } = scene.getSize();
  const layers = scene.variables.get("layers", [])();
  const transitions = scene.variables.get("transitions", {})();
  const captionSettings = scene.variables.get("captionSettings", {
    fontFamily: "Inter Variable",
    fontWeight: 400,
    distanceFromBottom: 140
  })();
  const textClipSettings = scene.variables.get("textClipSettings", {
    fontFamily: "Inter Variable",
    fontWeight: 400,
    defaultFontSize: 48,
    defaultFill: "#ffffff"
  })();
  const transcriptionRecords = scene.variables.get("transcriptions", {})();
  const transcriptionByAssetId = /* @__PURE__ */ new Map();
  const transcriptionByUrl = /* @__PURE__ */ new Map();
  Object.values(transcriptionRecords ?? {}).forEach((record) => {
    if (record == null ? void 0 : record.assetId) transcriptionByAssetId.set(record.assetId, record);
    if (record == null ? void 0 : record.assetUrl) transcriptionByUrl.set(record.assetUrl, record);
  });
  const clipTransitions = /* @__PURE__ */ new Map();
  for (const layer of layers) {
    if (layer.type !== "video") continue;
    const clips = layer.clips.sort((a, b) => a.start - b.start);
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const prev = clips[i - 1];
      const next = clips[i + 1];
      const entry = {};
      if (prev) {
        const prevEnd = prev.start + prev.duration / (prev.speed || 1);
        if (Math.abs(clip.start - prevEnd) < 0.1) {
          const trans = transitions[makeTransitionKey(prev.id, clip.id)];
          if (trans) entry.enter = trans;
        }
      }
      if (next) {
        const currentEnd = clip.start + clip.duration / (clip.speed || 1);
        if (Math.abs(next.start - currentEnd) < 0.1) {
          const trans = transitions[makeTransitionKey(clip.id, next.id)];
          if (trans) entry.exit = trans;
        }
      }
      clipTransitions.set(clip.id, entry);
    }
  }
  const captionRefs = /* @__PURE__ */ new Map();
  const clipCaptionData = /* @__PURE__ */ new Map();
  const normalizeSegmentsForClip = (clip, segments) => {
    if (!(segments == null ? void 0 : segments.length)) return [];
    const safeSpeed = Math.max(clip.speed ?? 1, 1e-4);
    const offsetSeconds = clip.offset ?? 0;
    const clipSourceEnd = offsetSeconds + clip.duration;
    return segments.map((seg) => ({ startSeconds: seg.start / 1e3, speech: seg.speech.trim() })).filter(({ startSeconds, speech }) => speech.length > 0 && startSeconds >= offsetSeconds && startSeconds <= clipSourceEnd + 0.05).map(({ startSeconds, speech }) => ({
      start: Math.max(0, (startSeconds - offsetSeconds) / safeSpeed * 1e3),
      speech
    })).sort((a, b) => a.start - b.start);
  };
  const registerCaptionForClip = (clip) => {
    var _a2;
    const record = (clip.assetId ? transcriptionByAssetId.get(clip.assetId) : void 0) ?? (clip.src ? transcriptionByUrl.get(clip.src) : void 0);
    if (!((_a2 = record == null ? void 0 : record.segments) == null ? void 0 : _a2.length)) return;
    const rawNormalized = normalizeRawSegments(record.segments);
    if (!rawNormalized.length) return;
    const normalized = normalizeSegmentsForClip(clip, rawNormalized);
    if (!normalized.length) return;
    const ref = createRef();
    captionRefs.set(clip.id, ref);
    clipCaptionData.set(clip.id, normalized);
    view.add(
      /* @__PURE__ */ jsx(
        AnimatedCaptions,
        {
          ref,
          SceneHeight: height,
          y: height / 2 - captionSettings.distanceFromBottom,
          CaptionsSize: 1.1,
          CaptionsDuration: 3,
          ShowCaptions: false,
          TranscriptionData: () => normalized,
          CaptionsFontFamily: captionSettings.fontFamily,
          CaptionsFontWeight: captionSettings.fontWeight,
          zIndex: 1e3
        },
        `captions-${clip.id}`
      )
    );
  };
  const createCaptionRunner = (clip) => {
    const ref = captionRefs.get(clip.id);
    const data = clipCaptionData.get(clip.id);
    if (!ref || !(data == null ? void 0 : data.length)) return void 0;
    return function* () {
      const captionNode = ref();
      if (!captionNode) return;
      captionNode.TranscriptionData(data);
      captionNode.ShowCaptions(true);
      yield* captionNode.animate();
      captionNode.ShowCaptions(false);
    };
  };
  view.add(/* @__PURE__ */ jsx(Rect, { width: "100%", height: "100%", fill: "#141417" }));
  for (const layer of layers) {
    if (layer.type === "video") {
      layer.clips.forEach(registerCaptionForClip);
    } else if (layer.type === "audio") {
      layer.clips.forEach(registerCaptionForClip);
    }
  }
  const videoEntries = [];
  const textEntries = [];
  const imageEntries = [];
  const audioEntries = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    switch (layer.type) {
      case "video": {
        const entries = createVideoElements({
          clips: layer.clips,
          view
        });
        videoEntries.push(...entries);
        break;
      }
      case "text": {
        const entries = createTextElements({
          clips: layer.clips,
          view,
          settings: textClipSettings
        });
        textEntries.push(...entries);
        break;
      }
      case "image": {
        const entries = createImageElements({
          clips: layer.clips,
          view
        });
        imageEntries.push(...entries);
        break;
      }
      case "audio": {
        const entries = createAudioElements({
          clips: layer.clips,
          view,
          sceneWidth: width,
          sceneHeight: height
        });
        audioEntries.push(...entries);
        break;
      }
    }
  }
  function* processVideoClips() {
    if (videoEntries.length === 0) return;
    yield* all(
      ...videoEntries.map(
        (entry) => playVideo({
          entry,
          sceneWidth: width,
          sceneHeight: height,
          transitions: clipTransitions,
          captionRunner: createCaptionRunner(entry.clip)
        })
      )
    );
  }
  function* processTextClips() {
    if (textEntries.length === 0) return;
    yield* all(...textEntries.map((entry) => playText({ entry })));
  }
  function* processImageClips() {
    if (imageEntries.length === 0) return;
    yield* all(...imageEntries.map((entry) => playImage({ entry })));
  }
  function* processAudioTracks() {
    if (audioEntries.length === 0) return;
    yield* all(
      ...audioEntries.map(
        (entry) => playAudio({
          entry,
          captionRunner: createCaptionRunner(entry.clip)
        })
      )
    );
  }
  yield* all(
    processVideoClips(),
    processAudioTracks(),
    processTextClips(),
    processImageClips()
  );
  videoEntries.forEach(({ ref, maskRef, containerRef }) => {
    const video = ref();
    if (video) video.pause();
    const mask = maskRef == null ? void 0 : maskRef();
    if (mask) mask.pause();
    const container = containerRef == null ? void 0 : containerRef();
    if (container) container.opacity(0);
    else if (video) video.opacity(0);
  });
  audioEntries.forEach(({ ref }) => {
    var _a2;
    return (_a2 = ref()) == null ? void 0 : _a2.pause();
  });
});
description.name = "nle_timeline";
metaFile.attach(description.meta);
description.onReplaced ?? (description.onReplaced = new ValueDispatcher(description.config));
const config = makeProject({
  name: "gemini-studio-scene",
  experimentalFeatures: true,
  scenes: [description],
  variables: {
    layers: [],
    // Total timeline duration
    duration: 10,
    transcriptions: {}
  }
});
let meta;
meta ?? (meta = new MetaFile("\0virtual:settings", false));
meta.loadData({ "version": 1, "appearance": { "color": "rgb(51,166,255)", "font": false, "coordinates": true }, "defaults": { "background": null, "size": { "x": 1920, "y": 1080 } } });
const settings = meta;
const project = bootstrap(
  "project",
  { "core": "3.17.2", "two": "3.17.2", "ui": "3.17.2", "vitePlugin": "3.17.2" },
  [],
  config,
  metaFile$1,
  settings
);
if (typeof globalThis !== 'undefined' && 'window' in globalThis) { globalThis.__SCENE_PROJECT__ = project; }
export {
  project as default
};
